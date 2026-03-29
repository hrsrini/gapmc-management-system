/**
 * Bug tickets: all authenticated users may create and view; comment only on own tickets;
 * ADMIN tier may manage status, assignment, resolution, and comment on any ticket.
 */
import type { Express, Request, Response, NextFunction } from "express";
import { eq, and, desc, sql, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import multer from "multer";
import path from "path";
import fs from "fs";
import { z } from "zod";
import { db } from "./db";
import {
  bugTickets,
  bugAttachments,
  bugComments,
  bugTicketSeq,
  users,
} from "@shared/db-schema";
import { createBugBodySchema, patchBugSchema, bugCommentSchema, BUG_STATUSES } from "@shared/bug-taxonomy";
import { writeAuditLog } from "./audit";
import type { AuthUser } from "./auth";

const UPLOAD_ROOT = path.resolve(process.cwd(), "uploads", "bugs");

const ALLOWED_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
]);

const ALLOWED_EXT = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".pdf",
  ".txt",
]);

function ensureUploadDir(): void {
  fs.mkdirSync(UPLOAD_ROOT, { recursive: true });
}

function isAdmin(user: AuthUser | undefined): boolean {
  return Boolean(user?.roles?.some((r) => r.tier === "ADMIN"));
}

function canCommentOnTicket(user: AuthUser | undefined, reporterUserId: string): boolean {
  if (!user) return false;
  if (isAdmin(user)) return true;
  return user.id === reporterUserId;
}

async function nextTicketNo(): Promise<string> {
  const year = String(new Date().getFullYear());
  const [row] = await db
    .insert(bugTicketSeq)
    .values({ year, lastSeq: 1 })
    .onConflictDoUpdate({
      target: bugTicketSeq.year,
      set: { lastSeq: sql`${bugTicketSeq.lastSeq} + 1` },
    })
    .returning({ lastSeq: bugTicketSeq.lastSeq });
  const seq = row?.lastSeq ?? 1;
  return `BUG-${year}-${String(seq).padStart(5, "0")}`;
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    ensureUploadDir();
    cb(null, UPLOAD_ROOT);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeExt = ALLOWED_EXT.has(ext) ? ext : "";
    cb(null, `${nanoid(24)}${safeExt}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024, files: 5 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_MIMES.has(file.mimetype) && ALLOWED_EXT.has(ext)) {
      cb(null, true);
      return;
    }
    cb(new Error("Invalid file type. Allowed: images, PDF, plain text."));
  },
});

function multerBugCreate(req: Request, res: Response, next: NextFunction): void {
  upload.array("files", 5)(req, res, (err: unknown) => {
    if (err) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      res.status(400).json({ error: msg });
      return;
    }
    next();
  });
}

export function registerBugRoutes(app: Express): void {
  const now = () => new Date().toISOString();

  app.get("/api/bugs", async (req, res) => {
    try {
      const user = req.user!;
      const scopeRaw = req.query.scope;
      const scopeStr = String(Array.isArray(scopeRaw) ? scopeRaw[0] : scopeRaw ?? "all").toLowerCase();
      const scope = scopeStr === "mine" ? "mine" : "all";
      const statusRaw = req.query.status;
      const statusFilter =
        statusRaw === undefined || statusRaw === ""
          ? undefined
          : String(Array.isArray(statusRaw) ? statusRaw[0] : statusRaw).trim();
      const statusOk = Boolean(statusFilter && (BUG_STATUSES as readonly string[]).includes(statusFilter));
      const conditions = [];
      if (scope === "mine") {
        conditions.push(eq(bugTickets.reporterUserId, user.id));
      }
      if (statusOk) {
        conditions.push(eq(bugTickets.status, statusFilter!));
      }
      const q = db
        .select({
          id: bugTickets.id,
          ticketNo: bugTickets.ticketNo,
          title: bugTickets.title,
          bugType: bugTickets.bugType,
          bugSubtype: bugTickets.bugSubtype,
          severity: bugTickets.severity,
          status: bugTickets.status,
          reporterUserId: bugTickets.reporterUserId,
          reporterName: users.name,
          assignedToUserId: bugTickets.assignedToUserId,
          createdAt: bugTickets.createdAt,
          updatedAt: bugTickets.updatedAt,
        })
        .from(bugTickets)
        .innerJoin(users, eq(users.id, bugTickets.reporterUserId));
      const filtered = conditions.length > 0 ? q.where(and(...conditions)) : q;
      const list = await filtered.orderBy(desc(bugTickets.createdAt));
      res.json(list);
    } catch (e) {
      console.error(e);
      const code = e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : "";
      const hint = code === "42P01" ? " Run npm run db:push to create gapmc tables (including bug tracking)." : "";
      res.status(500).json({ error: `Failed to list bugs.${hint}` });
    }
  });

  app.get("/api/bugs/dashboard", async (req, res) => {
    try {
      const user = req.user!;
      const admin = isAdmin(user);

      const countBy = async (
        field: typeof bugTickets.status | typeof bugTickets.severity,
        whereReporter?: string,
      ) => {
        const base = db
          .select({
            key: field,
            /** Avoid SQL alias `count` (reserved); coerce for JSON (no BigInt). */
            n: sql<number>`count(*)::int`,
          })
          .from(bugTickets);
        const rows = whereReporter
          ? await base.where(eq(bugTickets.reporterUserId, whereReporter)).groupBy(field)
          : await base.groupBy(field);
        const out: Record<string, number> = {};
        for (const r of rows) {
          if (r.key != null && r.key !== "") {
            const v = r.n;
            out[r.key] = typeof v === "bigint" ? Number(v) : Number(v) || 0;
          }
        }
        return out;
      };

      const statusAll = await countBy(bugTickets.status);
      const severityAll = await countBy(bugTickets.severity);
      const statusMine = await countBy(bugTickets.status, user.id);
      const severityMine = await countBy(bugTickets.severity, user.id);

      const recentAll = await db
        .select({
          id: bugTickets.id,
          ticketNo: bugTickets.ticketNo,
          title: bugTickets.title,
          status: bugTickets.status,
          severity: bugTickets.severity,
          reporterUserId: bugTickets.reporterUserId,
          reporterName: users.name,
          createdAt: bugTickets.createdAt,
        })
        .from(bugTickets)
        .innerJoin(users, eq(users.id, bugTickets.reporterUserId))
        .orderBy(desc(bugTickets.createdAt))
        .limit(12);

      const recentMine = await db
        .select({
          id: bugTickets.id,
          ticketNo: bugTickets.ticketNo,
          title: bugTickets.title,
          status: bugTickets.status,
          severity: bugTickets.severity,
          createdAt: bugTickets.createdAt,
        })
        .from(bugTickets)
        .where(eq(bugTickets.reporterUserId, user.id))
        .orderBy(desc(bugTickets.createdAt))
        .limit(12);

      let unassignedOpen: number | undefined;
      if (admin) {
        const [u] = await db
          .select({ n: sql<number>`count(*)::int` })
          .from(bugTickets)
          .where(and(eq(bugTickets.status, "open"), isNull(bugTickets.assignedToUserId)));
        const raw = u?.n;
        unassignedOpen =
          raw === undefined || raw === null ? 0 : typeof raw === "bigint" ? Number(raw) : Number(raw) || 0;
      }

      res.json({
        isAdmin: admin,
        statusAll,
        severityAll,
        statusMine,
        severityMine,
        recentAll,
        recentMine,
        ...(admin ? { unassignedOpen } : {}),
      });
    } catch (e) {
      console.error(e);
      const code = e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : "";
      const hint = code === "42P01" ? " Run npm run db:push to create gapmc tables (including bug tracking)." : "";
      res.status(500).json({ error: `Failed to load dashboard.${hint}` });
    }
  });

  app.get("/api/bugs/:id", async (req, res) => {
    try {
      const [ticket] = await db.select().from(bugTickets).where(eq(bugTickets.id, req.params.id)).limit(1);
      if (!ticket) return res.status(404).json({ error: "Bug not found" });

      const [reporter] = await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, ticket.reporterUserId)).limit(1);
      let assignee: { name: string; email: string } | null = null;
      if (ticket.assignedToUserId) {
        const [a] = await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, ticket.assignedToUserId)).limit(1);
        assignee = a ?? null;
      }

      const attachments = await db
        .select({
          id: bugAttachments.id,
          originalFilename: bugAttachments.originalFilename,
          mimeType: bugAttachments.mimeType,
          sizeBytes: bugAttachments.sizeBytes,
          createdAt: bugAttachments.createdAt,
        })
        .from(bugAttachments)
        .where(eq(bugAttachments.bugTicketId, ticket.id))
        .orderBy(desc(bugAttachments.createdAt));

      const commentRows = await db
        .select({
          id: bugComments.id,
          userId: bugComments.userId,
          body: bugComments.body,
          createdAt: bugComments.createdAt,
          authorName: users.name,
        })
        .from(bugComments)
        .innerJoin(users, eq(users.id, bugComments.userId))
        .where(eq(bugComments.bugTicketId, ticket.id))
        .orderBy(bugComments.createdAt);

      res.json({
        ticket,
        reporter,
        assignee,
        attachments,
        comments: commentRows,
        canComment: canCommentOnTicket(req.user, ticket.reporterUserId),
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to load bug" });
    }
  });

  app.post("/api/bugs", multerBugCreate, async (req, res) => {
    try {
      const user = req.user!;
      const body = createBugBodySchema.parse({
        title: req.body.title,
        description: req.body.description,
        bugType: req.body.bugType,
        bugSubtype: req.body.bugSubtype,
        severity: req.body.severity,
      });

      const ticketNo = await nextTicketNo();
      const id = nanoid();
      const ts = now();

      await db.insert(bugTickets).values({
        id,
        ticketNo,
        title: body.title,
        description: body.description,
        bugType: body.bugType,
        bugSubtype: body.bugSubtype,
        severity: body.severity,
        status: "open",
        reporterUserId: user.id,
        assignedToUserId: null,
        resolutionSummary: null,
        closedByUserId: null,
        resolvedAt: null,
        closedAt: null,
        createdAt: ts,
        updatedAt: ts,
      });

      const files = (req.files as Express.Multer.File[] | undefined) ?? [];
      for (const f of files) {
        const ext = path.extname(f.originalname).toLowerCase();
        if (!ALLOWED_EXT.has(ext) || !ALLOWED_MIMES.has(f.mimetype)) {
          fs.unlink(f.path, () => {});
          continue;
        }
        await db.insert(bugAttachments).values({
          id: nanoid(),
          bugTicketId: id,
          uploadedByUserId: user.id,
          originalFilename: path.basename(f.originalname).slice(0, 255),
          storedFilename: f.filename,
          mimeType: f.mimetype,
          sizeBytes: f.size,
          createdAt: ts,
        });
      }

      writeAuditLog(req, {
        module: "Bugs",
        action: "Create",
        recordId: id,
        afterValue: { ticketNo, title: body.title },
      }).catch((err) => console.error("Audit log failed:", err));

      const [row] = await db.select().from(bugTickets).where(eq(bugTickets.id, id));
      res.status(201).json(row);
    } catch (e) {
      if (e instanceof z.ZodError) {
        return res.status(400).json({ error: "Validation failed", details: e.errors });
      }
      console.error(e);
      res.status(500).json({ error: "Failed to create bug" });
    }
  });

  app.patch("/api/bugs/:id", async (req, res) => {
    try {
      if (!isAdmin(req.user)) {
        return res.status(403).json({ error: "Only administrators can update bug tickets" });
      }
      const [existing] = await db.select().from(bugTickets).where(eq(bugTickets.id, req.params.id)).limit(1);
      if (!existing) return res.status(404).json({ error: "Bug not found" });

      const patch = patchBugSchema.parse(req.body);
      const ts = now();
      const updates: Partial<typeof bugTickets.$inferInsert> = { updatedAt: ts };

      if (patch.status !== undefined) updates.status = patch.status;
      if (patch.resolutionSummary !== undefined) updates.resolutionSummary = patch.resolutionSummary;
      if (patch.assignedToUserId !== undefined) {
        if (patch.assignedToUserId === null) {
          updates.assignedToUserId = null;
        } else {
          const [u] = await db.select({ id: users.id }).from(users).where(eq(users.id, patch.assignedToUserId)).limit(1);
          if (!u) return res.status(400).json({ error: "Assignee user not found" });
          updates.assignedToUserId = patch.assignedToUserId;
        }
      }

      if (patch.status === "resolved" && !existing.resolvedAt) {
        updates.resolvedAt = ts;
      }
      if (patch.status === "closed") {
        updates.closedAt = ts;
        updates.closedByUserId = req.user!.id;
      }
      if (patch.status && patch.status !== "closed" && existing.status === "closed") {
        updates.closedAt = null;
        updates.closedByUserId = null;
      }

      await db.update(bugTickets).set(updates).where(eq(bugTickets.id, existing.id));
      const [row] = await db.select().from(bugTickets).where(eq(bugTickets.id, existing.id));

      writeAuditLog(req, {
        module: "Bugs",
        action: "Update",
        recordId: existing.id,
        beforeValue: existing,
        afterValue: row,
      }).catch((err) => console.error("Audit log failed:", err));

      res.json(row);
    } catch (e) {
      if (e instanceof z.ZodError) {
        return res.status(400).json({ error: "Validation failed", details: e.errors });
      }
      console.error(e);
      res.status(500).json({ error: "Failed to update bug" });
    }
  });

  app.post("/api/bugs/:id/comments", async (req, res) => {
    try {
      const [ticket] = await db.select().from(bugTickets).where(eq(bugTickets.id, req.params.id)).limit(1);
      if (!ticket) return res.status(404).json({ error: "Bug not found" });
      if (!canCommentOnTicket(req.user, ticket.reporterUserId)) {
        return res.status(403).json({ error: "You can only comment on bugs you reported" });
      }

      const { body } = bugCommentSchema.parse(req.body);
      const id = nanoid();
      const ts = now();
      await db.insert(bugComments).values({
        id,
        bugTicketId: ticket.id,
        userId: req.user!.id,
        body,
        createdAt: ts,
      });

      const [author] = await db.select({ name: users.name }).from(users).where(eq(users.id, req.user!.id)).limit(1);

      writeAuditLog(req, {
        module: "Bugs",
        action: "Comment",
        recordId: ticket.id,
        afterValue: { commentId: id },
      }).catch((err) => console.error("Audit log failed:", err));

      res.status(201).json({
        id,
        userId: req.user!.id,
        body,
        createdAt: ts,
        authorName: author?.name ?? "",
      });
    } catch (e) {
      if (e instanceof z.ZodError) {
        return res.status(400).json({ error: "Validation failed", details: e.errors });
      }
      console.error(e);
      res.status(500).json({ error: "Failed to add comment" });
    }
  });

  app.get("/api/bugs/:id/attachments/:attachmentId/download", async (req, res) => {
    try {
      const [ticket] = await db.select().from(bugTickets).where(eq(bugTickets.id, req.params.id)).limit(1);
      if (!ticket) return res.status(404).json({ error: "Bug not found" });

      const [att] = await db
        .select()
        .from(bugAttachments)
        .where(
          and(
            eq(bugAttachments.id, req.params.attachmentId),
            eq(bugAttachments.bugTicketId, ticket.id),
          ),
        )
        .limit(1);
      if (!att) return res.status(404).json({ error: "Attachment not found" });

      const safeName = path.basename(att.storedFilename);
      const fullPath = path.join(UPLOAD_ROOT, safeName);
      if (!fullPath.startsWith(UPLOAD_ROOT) || !fs.existsSync(fullPath)) {
        return res.status(404).json({ error: "File not found" });
      }

      res.setHeader("Content-Type", att.mimeType);
      res.download(fullPath, att.originalFilename, (err) => {
        if (err && !res.headersSent) res.status(500).json({ error: "Download failed" });
      });
    } catch (e) {
      console.error(e);
      if (!res.headersSent) res.status(500).json({ error: "Download failed" });
    }
  });
}
