/**
 * US-M10-005: External entity (Trader/TrackB) portal access.
 *
 * This is a separate auth surface from employee-linked app users.
 * It uses express-session with a different session key in the same cookie.
 */
import type { Express, Request, Response, NextFunction } from "express";
import { compare, hash } from "bcryptjs";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./db";
import { sendApiError } from "./api-errors";
import { sendTransactionalEmailTo } from "./notify";
import { portalUsers, entities, traderLicences, iomsReceipts, preReceipts } from "@shared/db-schema";
import { parseUnifiedEntityId, unifiedEntityIdFromTrackA, unifiedEntityIdFromTrackB } from "@shared/unified-entity-id";

type PortalSession = Request & {
  session: Request["session"] & { portalUserId?: string };
};

async function loadPortalUserById(id: string) {
  const [row] = await db.select().from(portalUsers).where(eq(portalUsers.id, id)).limit(1);
  if (!row || !row.isActive) return null;
  return row;
}

async function requirePortalAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const ps = req as PortalSession;
  const id = ps.session.portalUserId;
  if (!id) return sendApiError(res, 401, "PORTAL_NOT_AUTHENTICATED", "Not authenticated");
  const user = await loadPortalUserById(String(id));
  if (!user) return sendApiError(res, 401, "PORTAL_NOT_AUTHENTICATED", "Not authenticated");
  (req as Request & { portalUser?: typeof user }).portalUser = user;
  next();
}

export function registerPortalRoutes(app: Express) {
  // --- auth ---
  app.post("/api/portal/auth/login", async (req, res) => {
    try {
      const email = String(req.body?.email ?? "").trim().toLowerCase();
      const password = String(req.body?.password ?? "");
      if (!email || !password) return sendApiError(res, 400, "PORTAL_LOGIN_REQUIRED", "Email and password are required");
      const [u] = await db.select().from(portalUsers).where(sql`lower(${portalUsers.email}) = ${email}`).limit(1);
      if (!u || !u.isActive) return sendApiError(res, 401, "PORTAL_LOGIN_FAILED", "Invalid credentials");
      const ok = await compare(password, u.passwordHash);
      if (!ok) return sendApiError(res, 401, "PORTAL_LOGIN_FAILED", "Invalid credentials");
      (req as PortalSession).session.portalUserId = u.id;
      await new Promise<void>((resolve, reject) => req.session.save((err) => (err ? reject(err) : resolve())));
      await db.update(portalUsers).set({ lastLoginAt: new Date().toISOString() }).where(eq(portalUsers.id, u.id));
      res.json({
        user: {
          id: u.id,
          email: u.email,
          unifiedEntityId: u.unifiedEntityId,
          forcePasswordChange: Boolean(u.forcePasswordChange),
        },
      });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to login");
    }
  });

  app.post("/api/portal/auth/logout", async (req, res) => {
    (req as PortalSession).session.portalUserId = undefined;
    await new Promise<void>((resolve) => req.session.save(() => resolve()));
    res.json({ ok: true });
  });

  app.get("/api/portal/me", requirePortalAuth, async (req, res) => {
    const u = (req as Request & { portalUser: any }).portalUser;
    res.json({ user: { id: u.id, email: u.email, unifiedEntityId: u.unifiedEntityId, forcePasswordChange: Boolean(u.forcePasswordChange) } });
  });

  app.post("/api/portal/auth/change-password", requirePortalAuth, async (req, res) => {
    try {
      const u = (req as Request & { portalUser: any }).portalUser;
      const newPassword = String(req.body?.newPassword ?? "");
      if (!newPassword || newPassword.length < 8) {
        return sendApiError(res, 400, "PORTAL_PASSWORD_WEAK", "Password must be at least 8 characters");
      }
      const passwordHash = await hash(newPassword, 10);
      await db.update(portalUsers).set({ passwordHash, forcePasswordChange: false }).where(eq(portalUsers.id, u.id));
      res.json({ ok: true });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to change password");
    }
  });

  // --- provisioning (admin) ---
  app.post("/api/admin/portal-users/provision", async (req, res) => {
    try {
      const unifiedEntityId = String(req.body?.unifiedEntityId ?? "").trim();
      const parsed = parseUnifiedEntityId(unifiedEntityId);
      if (!parsed) return sendApiError(res, 400, "PORTAL_ENTITY_INVALID", "unifiedEntityId must be TA:<id> or TB:<id> or AH:<id>");
      if (parsed.kind === "AH") {
        return sendApiError(res, 400, "PORTAL_ENTITY_KIND_UNSUPPORTED", "Ad-hoc entity portal provisioning is not enabled");
      }

      // resolve email + status from master
      let email = "";
      let active = false;
      if (parsed.kind === "TB") {
        const [e] = await db
          .select({ email: entities.email, status: entities.status })
          .from(entities)
          .where(eq(entities.id, parsed.refId))
          .limit(1);
        email = String(e?.email ?? "").trim();
        active = String(e?.status ?? "") === "Active";
      } else {
        const [l] = await db
          .select({ email: traderLicences.email, status: traderLicences.status })
          .from(traderLicences)
          .where(eq(traderLicences.id, parsed.refId))
          .limit(1);
        email = String(l?.email ?? "").trim();
        active = String(l?.status ?? "") === "Active";
      }
      if (!active) return sendApiError(res, 400, "PORTAL_ENTITY_NOT_ACTIVE", "Entity must be Active to provision portal access");
      if (!email) return sendApiError(res, 400, "PORTAL_ENTITY_EMAIL_REQUIRED", "Entity email is required in M-02 before provisioning");

      const [existing] = await db.select().from(portalUsers).where(eq(portalUsers.unifiedEntityId, unifiedEntityId)).limit(1);
      if (existing) {
        return res.json({ ok: true, portalUserId: existing.id, email: existing.email, alreadyProvisioned: true });
      }

      const tempPassword = nanoid(12);
      const passwordHash = await hash(tempPassword, 10);
      const id = nanoid();
      const ts = new Date().toISOString();
      await db.insert(portalUsers).values({
        id,
        unifiedEntityId,
        email,
        passwordHash,
        isActive: true,
        disabledAt: null,
        forcePasswordChange: true,
        lastLoginAt: null,
        provisionedAt: ts,
        provisionedBy: req.user?.id ?? null,
      });

      await sendTransactionalEmailTo(
        email,
        "GAPMC Portal access (read-only)",
        `Your portal access has been provisioned.\n\nLogin: ${email}\nTemporary password: ${tempPassword}\n\nYou will be asked to change your password after login.`,
      );

      res.status(201).json({ ok: true, portalUserId: id, email, alreadyProvisioned: false });
    } catch (e) {
      console.error(e);
      const msg = e instanceof Error ? e.message : String(e);
      if (/duplicate|unique|23505/i.test(msg)) {
        return sendApiError(res, 409, "PORTAL_USER_DUPLICATE", "Portal user already exists");
      }
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to provision portal access");
    }
  });

  // --- read-only data APIs for portal ---
  app.get("/api/portal/receipts", requirePortalAuth, async (req, res) => {
    try {
      const u = (req as Request & { portalUser: any }).portalUser;
      const rows = await db
        .select()
        .from(iomsReceipts)
        .where(eq(iomsReceipts.unifiedEntityId, u.unifiedEntityId))
        .orderBy(sql`${iomsReceipts.createdAt} desc`);
      res.json(rows);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch receipts");
    }
  });

  app.get("/api/portal/pre-receipts", requirePortalAuth, async (req, res) => {
    try {
      const u = (req as Request & { portalUser: any }).portalUser;
      const parsed = parseUnifiedEntityId(String(u.unifiedEntityId));
      if (!parsed || parsed.kind !== "TB") return res.json([]);
      const rows = await db.select().from(preReceipts).where(eq(preReceipts.entityId, parsed.refId)).orderBy(sql`coalesce(${preReceipts.issuedAt}, ${preReceipts.updatedAt}) desc`);
      res.json(rows);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch pre-receipts");
    }
  });

  // Helper endpoint for “dues” based on receipts only (payment history view).
  app.get("/api/portal/payment-history", requirePortalAuth, async (req, res) => {
    try {
      const u = (req as Request & { portalUser: any }).portalUser;
      const rows = await db
        .select({
          id: iomsReceipts.id,
          receiptNo: iomsReceipts.receiptNo,
          createdAt: iomsReceipts.createdAt,
          amount: iomsReceipts.amount,
          revenueHead: iomsReceipts.revenueHead,
          paymentMode: iomsReceipts.paymentMode,
          status: iomsReceipts.status,
        })
        .from(iomsReceipts)
        .where(eq(iomsReceipts.unifiedEntityId, u.unifiedEntityId))
        .orderBy(sql`${iomsReceipts.createdAt} desc`);
      res.json(rows);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch payment history");
    }
  });
}

/** Disable portal access for a unified entity id (used when entity is suspended/inactive). */
export async function disablePortalAccessForUnifiedEntity(unifiedEntityId: string, by: string | null): Promise<void> {
  const ts = new Date().toISOString();
  await db
    .update(portalUsers)
    .set({ isActive: false, disabledAt: ts, provisionedBy: by ?? undefined })
    .where(eq(portalUsers.unifiedEntityId, unifiedEntityId));
}

