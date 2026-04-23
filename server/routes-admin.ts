/**
 * IOMS M-10: RBAC & System Administration API routes.
 * M-10 admin: yards, roles, permission matrix, config, audit. App logins are managed via HR only (/api/hr/employees/:id/login).
 */
import type { Express, NextFunction, Request, Response } from "express";
import multer from "multer";
import { eq, desc, and, sql } from "drizzle-orm";
import { db } from "./db";
import {
  yards,
  users,
  roles,
  userRoles,
  userYards,
  systemConfig,
  slaConfig,
  auditLog,
  permissions,
  rolePermissions,
  expenditureHeads,
  tallyLedgers,
} from "@shared/db-schema";
import { nanoid } from "nanoid";
import { SYSTEM_CONFIG_KEYS } from "@shared/system-config-defaults";
import { getMergedSystemConfig } from "./system-config";
import { getDataRetentionSummary } from "./data-retention-audit";
import { writeAuditLog } from "./audit";
import { sendApiError } from "./api-errors";
import {
  clearReceiptLogoFiles,
  getActiveReceiptLogoKey,
  hasUploadedReceiptLogo,
  mimeForReceiptLogoKey,
  readUploadedReceiptLogoBuffer,
  writeReceiptLogoUpload,
} from "./receipt-logo-storage";
import { HrEmployeeRuleError, normalizeMobile10 } from "./hr-employee-rules";

const receiptLogoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    if (file.mimetype === "image/png" || file.mimetype === "image/jpeg") cb(null, true);
    else cb(new Error("ADMIN_RECEIPT_LOGO_TYPE: Only PNG or JPEG images are allowed."));
  },
});

function multerReceiptLogo(req: Request, res: Response, next: NextFunction): void {
  receiptLogoUpload.single("logo")(req, res, (err: unknown) => {
    if (!err) return next();
    const msg = err instanceof Error ? err.message : "Upload failed";
    if (msg.includes("ADMIN_RECEIPT_LOGO_TYPE")) {
      return sendApiError(res, 400, "ADMIN_RECEIPT_LOGO_TYPE", "Only PNG or JPEG images are allowed.");
    }
    if (err && typeof err === "object" && (err as { code?: string }).code === "LIMIT_FILE_SIZE") {
      return sendApiError(res, 400, "ADMIN_RECEIPT_LOGO_TOO_LARGE", "Logo must be 2 MB or smaller.");
    }
    console.error(err);
    return sendApiError(res, 400, "ADMIN_RECEIPT_LOGO_UPLOAD_FAILED", msg);
  });
}

export function registerAdminRoutes(app: Express) {
  const now = () => new Date().toISOString();

  // ----- Yards (locations) -----
  app.get("/api/admin/yards", async (_req, res) => {
    try {
      const list = await db.select().from(yards).orderBy(yards.name);
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch yards");
    }
  });

  app.post("/api/admin/yards", async (req, res) => {
    try {
      const { name, code, type, phone, mobile, address } = req.body;
      if (!name || !code || !type) {
        return sendApiError(res, 400, "ADMIN_YARD_FIELDS_REQUIRED", "name, code, type required");
      }
      let mobileNorm: string | null;
      try {
        mobileNorm = normalizeMobile10(mobile ?? null);
      } catch (e) {
        if (e instanceof HrEmployeeRuleError) {
          return sendApiError(res, 400, e.code, e.message);
        }
        throw e;
      }
      const id = nanoid();
      await db.insert(yards).values({
        id,
        name: String(name),
        code: String(code),
        type: String(type),
        phone: phone ? String(phone) : null,
        mobile: mobileNorm,
        address: address ? String(address) : null,
        isActive: true,
      });
      const [row] = await db.select().from(yards).where(eq(yards.id, id));
      writeAuditLog(req, { module: "M-10", action: "CreateLocation", recordId: id, afterValue: row }).catch((e) =>
        console.error("Audit log failed:", e),
      );
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create yard");
    }
  });

  app.put("/api/admin/yards/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const [before] = await db.select().from(yards).where(eq(yards.id, id)).limit(1);
      const { name, code, type, phone, mobile, address, isActive } = req.body;
      let mobilePatch: { mobile: string | null } | null = null;
      if (mobile !== undefined) {
        try {
          mobilePatch = {
            mobile: normalizeMobile10(mobile == null || String(mobile).trim() === "" ? null : mobile),
          };
        } catch (e) {
          if (e instanceof HrEmployeeRuleError) {
            return sendApiError(res, 400, e.code, e.message);
          }
          throw e;
        }
      }
      await db.update(yards).set({
        ...(name != null && { name: String(name) }),
        ...(code != null && { code: String(code) }),
        ...(type != null && { type: String(type) }),
        ...(phone !== undefined && { phone: phone ? String(phone) : null }),
        ...(mobilePatch ?? {}),
        ...(address !== undefined && { address: address ? String(address) : null }),
        ...(isActive !== undefined && { isActive: Boolean(isActive) }),
      }).where(eq(yards.id, id));
      const [row] = await db.select().from(yards).where(eq(yards.id, id));
      if (!row) return sendApiError(res, 404, "ADMIN_YARD_NOT_FOUND", "Yard not found");
      writeAuditLog(req, { module: "M-10", action: "UpdateLocation", recordId: id, beforeValue: before, afterValue: row }).catch((e) =>
        console.error("Audit log failed:", e),
      );
      res.json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to update yard");
    }
  });

  // ----- System config (defaults merged for UI; PUT only allows known keys) -----
  app.get("/api/admin/config", async (_req, res) => {
    try {
      const merged = await getMergedSystemConfig();
      res.json(merged);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch config");
    }
  });

  app.put("/api/admin/config", async (req, res) => {
    try {
      const userId = req.user!.id;
      const body = req.body as Record<string, unknown>;
      const before = await getMergedSystemConfig();
      for (const key of SYSTEM_CONFIG_KEYS) {
        if (!(key in body)) continue;
        const value = String(body[key] ?? "");
        if (key === "expenditure_head_authority_url") {
          const u = value.trim();
          if (u.length > 0) {
            try {
              const parsed = new URL(u);
              if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
                return sendApiError(
                  res,
                  400,
                  "ADMIN_CONFIG_URL_INVALID",
                  "expenditure_head_authority_url must be an http(s) URL",
                );
              }
            } catch {
              return sendApiError(res, 400, "ADMIN_CONFIG_URL_INVALID", "Invalid expenditure_head_authority_url");
            }
          }
        }
        if (key.startsWith("data_retention_") && key.endsWith("_years")) {
          const n = parseFloat(value.trim());
          if (!Number.isFinite(n) || n < 1 || n > 50) {
            return sendApiError(res, 400, "ADMIN_CONFIG_RETENTION_YEARS", "Retention years must be a number from 1 to 50.");
          }
        }
        if (key === "dak_diary_sequence_scope") {
          const v = value.trim().toLowerCase();
          if (v !== "per_yard") {
            return sendApiError(
              res,
              400,
              "ADMIN_CONFIG_DAK_SCOPE",
              "Dak diary sequence scope must be per_yard (central HO-wide sequence is disabled per client policy).",
            );
          }
        }
        if (key === "rent_tds_annual_threshold_inr") {
          const n = parseFloat(value.trim());
          if (!Number.isFinite(n) || n < 0 || n > 5_00_00_000) {
            return sendApiError(res, 400, "ADMIN_CONFIG_RENT_TDS_THRESHOLD", "rent_tds_annual_threshold_inr must be between 0 and 50000000.");
          }
        }
        if (key === "rent_tds_rate_percent") {
          const n = parseFloat(value.trim());
          if (!Number.isFinite(n) || n < 0 || n > 40) {
            return sendApiError(res, 400, "ADMIN_CONFIG_RENT_TDS_RATE", "rent_tds_rate_percent must be between 0 and 40.");
          }
        }
        if (key === "amc_monthly_auto_generate") {
          const v = value.trim().toLowerCase();
          if (v !== "true" && v !== "false") {
            return sendApiError(res, 400, "ADMIN_CONFIG_AMC_FLAG", "amc_monthly_auto_generate must be true or false.");
          }
        }
        if (key === "tally_xml_export_enabled") {
          const v = value.trim().toLowerCase();
          if (v !== "true" && v !== "false") {
            return sendApiError(res, 400, "ADMIN_CONFIG_TALLY_XML_FLAG", "tally_xml_export_enabled must be true or false.");
          }
        }
        if (key === "rent_dishonour_bank_charge_hint") {
          if (value.length > 500) {
            return sendApiError(res, 400, "ADMIN_CONFIG_DISHONOUR_HINT", "rent_dishonour_bank_charge_hint must be at most 500 characters.");
          }
        }
        if (key === "rent_dishonour_bank_charge_inr") {
          const n = parseFloat(value.trim());
          if (!Number.isFinite(n) || n < 0 || n > 5_00_000) {
            return sendApiError(
              res,
              400,
              "ADMIN_CONFIG_DISHONOUR_BANK_INR",
              "rent_dishonour_bank_charge_inr must be between 0 and 500000.",
            );
          }
        }
        await db
          .insert(systemConfig)
          .values({
            key,
            value,
            updatedBy: userId,
            updatedAt: now(),
          })
          .onConflictDoUpdate({
            target: systemConfig.key,
            set: { value, updatedBy: userId, updatedAt: now() },
          });
      }
      const after = await getMergedSystemConfig();
      writeAuditLog(req, {
        module: "M-10",
        action: "Update",
        recordId: "system_config",
        beforeValue: before,
        afterValue: after,
      }).catch((err) => console.error("Audit log failed:", err));
      res.json(after);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to update config");
    }
  });

  /** Read-only: record counts at or past configured retention ages (no deletes). */
  app.get("/api/admin/data-retention-summary", async (_req, res) => {
    try {
      const summary = await getDataRetentionSummary();
      res.json(summary);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to build data retention summary");
    }
  });

  // ----- Receipt PDF logo (uploads/branding; overrides env RECEIPT_PDF_LOGO_* for PDF generation) -----
  app.get("/api/admin/branding/receipt-logo/status", async (_req, res) => {
    try {
      res.json({ hasLogo: await hasUploadedReceiptLogo() });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to read logo status");
    }
  });

  app.get("/api/admin/branding/receipt-logo/image", async (_req, res) => {
    try {
      const key = await getActiveReceiptLogoKey();
      if (!key) return sendApiError(res, 404, "ADMIN_RECEIPT_LOGO_NOT_FOUND", "No logo uploaded yet.");
      const buf = await readUploadedReceiptLogoBuffer();
      if (!buf) return sendApiError(res, 404, "ADMIN_RECEIPT_LOGO_NOT_FOUND", "No logo uploaded yet.");
      res.setHeader("Content-Type", mimeForReceiptLogoKey(key));
      res.setHeader("Cache-Control", "no-store");
      res.send(buf);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to read logo");
    }
  });

  app.post("/api/admin/branding/receipt-logo", multerReceiptLogo, async (req, res) => {
    try {
      const file = req.file;
      if (!file?.buffer?.length) {
        return sendApiError(res, 400, "ADMIN_RECEIPT_LOGO_REQUIRED", "Choose a PNG or JPEG file (field name: logo).");
      }
      await writeReceiptLogoUpload(file.buffer, file.mimetype);
      writeAuditLog(req, {
        module: "M-10",
        action: "UploadReceiptPdfLogo",
        recordId: "branding/receipt-logo",
        afterValue: { mime: file.mimetype, size: file.size },
      }).catch((e) => console.error("Audit log failed:", e));
      res.status(201).json({ ok: true, hasLogo: true });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to save logo");
    }
  });

  app.delete("/api/admin/branding/receipt-logo", async (req, res) => {
    try {
      const hadFile = await hasUploadedReceiptLogo();
      await clearReceiptLogoFiles();
      writeAuditLog(req, {
        module: "M-10",
        action: "DeleteReceiptPdfLogo",
        recordId: "branding/receipt-logo",
        beforeValue: { hadFile },
      }).catch((e) => console.error("Audit log failed:", e));
      res.json({ ok: true, hasLogo: false });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to remove logo");
    }
  });

  // ----- Roles -----
  app.get("/api/admin/roles", async (_req, res) => {
    try {
      const list = await db.select().from(roles).orderBy(roles.tier);
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch roles");
    }
  });

  app.post("/api/admin/roles", async (req, res) => {
    try {
      const { name, tier, description } = req.body;
      if (!name || !tier || typeof name !== "string" || typeof tier !== "string") {
        return sendApiError(res, 400, "ADMIN_ROLE_FIELDS_REQUIRED", "name and tier required");
      }
      const id = nanoid();
      await db.insert(roles).values({
        id,
        name: name.trim(),
        tier: tier.trim(),
        description: description != null && description !== "" ? String(description).trim() : null,
      });
      const [row] = await db.select().from(roles).where(eq(roles.id, id));
      writeAuditLog(req, { module: "M-10", action: "CreateRole", recordId: id, afterValue: row }).catch((e) =>
        console.error("Audit log failed:", e),
      );
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      const err = e as { code?: string };
      if (err.code === "23505") return sendApiError(res, 400, "ADMIN_ROLE_DUPLICATE", "Role name or tier already exists");
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create role");
    }
  });

  app.put("/api/admin/roles/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const { name, tier, description } = req.body;
      const [existing] = await db.select().from(roles).where(eq(roles.id, id)).limit(1);
      if (!existing) return sendApiError(res, 404, "ADMIN_ROLE_NOT_FOUND", "Role not found");
      const updates: Record<string, string | null> = {};
      if (name !== undefined) {
        const v = String(name).trim();
        if (!v) return sendApiError(res, 400, "ADMIN_ROLE_NAME_EMPTY", "name cannot be empty");
        updates.name = v;
      }
      if (tier !== undefined) {
        const v = String(tier).trim();
        if (!v) return sendApiError(res, 400, "ADMIN_ROLE_TIER_EMPTY", "tier cannot be empty");
        updates.tier = v;
      }
      if (description !== undefined) updates.description = description === "" || description == null ? null : String(description).trim();
      if (Object.keys(updates).length === 0) {
        const [row] = await db.select().from(roles).where(eq(roles.id, id));
        return res.json(row);
      }
      await db.update(roles).set(updates).where(eq(roles.id, id));
      const [row] = await db.select().from(roles).where(eq(roles.id, id));
      if (!row) return sendApiError(res, 404, "ADMIN_ROLE_NOT_FOUND", "Role not found");
      writeAuditLog(req, { module: "M-10", action: "UpdateRole", recordId: id, beforeValue: existing, afterValue: row }).catch((e) =>
        console.error("Audit log failed:", e),
      );
      res.json(row);
    } catch (e) {
      console.error(e);
      const err = e as { code?: string };
      if (err.code === "23505") return sendApiError(res, 400, "ADMIN_ROLE_DUPLICATE", "Role name or tier already exists");
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to update role");
    }
  });

  app.delete("/api/admin/roles/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const [existing] = await db.select().from(roles).where(eq(roles.id, id)).limit(1);
      if (!existing) return sendApiError(res, 404, "ADMIN_ROLE_NOT_FOUND", "Role not found");
      const inUse = await db.select({ userId: userRoles.userId }).from(userRoles).where(eq(userRoles.roleId, id)).limit(1);
      if (inUse.length > 0) {
        return sendApiError(res, 400, "ADMIN_ROLE_IN_USE", "Cannot delete role: it is assigned to one or more users");
      }
      writeAuditLog(req, { module: "M-10", action: "DeleteRole", recordId: id, beforeValue: existing }).catch((e) =>
        console.error("Audit log failed:", e),
      );
      await db.delete(roles).where(eq(roles.id, id));
      res.status(204).send();
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to delete role");
    }
  });

  // App logins are created/updated only via HR: POST/PUT /api/hr/employees/:id/login (no standalone user admin API).

  // ----- Expenditure head → Tally ledger (M-10 / finance mapping) -----
  app.put("/api/admin/expenditure-heads/:id/tally-ledger", async (req, res) => {
    try {
      const id = req.params.id;
      const tallyLedgerId = req.body?.tallyLedgerId;
      const tl =
        tallyLedgerId === null || tallyLedgerId === undefined || String(tallyLedgerId).trim() === ""
          ? null
          : String(tallyLedgerId).trim();
      const [before] = await db.select().from(expenditureHeads).where(eq(expenditureHeads.id, id)).limit(1);
      if (!before) return sendApiError(res, 404, "ADMIN_EXPENDITURE_HEAD_NOT_FOUND", "Expenditure head not found");
      if (tl) {
        const [exists] = await db.select().from(tallyLedgers).where(eq(tallyLedgers.id, tl)).limit(1);
        if (!exists) return sendApiError(res, 400, "ADMIN_TALLY_LEDGER_UNKNOWN", "Unknown tally ledger id");
      }
      await db.update(expenditureHeads).set({ tallyLedgerId: tl }).where(eq(expenditureHeads.id, id));
      const [row] = await db.select().from(expenditureHeads).where(eq(expenditureHeads.id, id)).limit(1);
      await writeAuditLog(req, {
        module: "Admin",
        action: "Update",
        recordId: id,
        beforeValue: before,
        afterValue: row,
      }).catch((e) => console.error("Audit log failed:", e));
      res.json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to update tally mapping");
    }
  });

  // ----- Audit log -----
  app.get("/api/admin/audit", async (req, res) => {
    try {
      const { module: mod, userId, limit = "100" } = req.query;
      const limitN = Math.min(Math.max(Number(limit) || 100, 1), 500);
      const conditions = [];
      if (mod && typeof mod === "string") conditions.push(eq(auditLog.module, mod));
      if (userId && typeof userId === "string") conditions.push(eq(auditLog.userId, userId));
      const rows = conditions.length
        ? await db
            .select({
              id: auditLog.id,
              userId: auditLog.userId,
              module: auditLog.module,
              action: auditLog.action,
              recordId: auditLog.recordId,
              beforeValue: auditLog.beforeValue,
              afterValue: auditLog.afterValue,
              ip: auditLog.ip,
              createdAt: auditLog.createdAt,
              userEmail: users.email,
              userName: users.name,
            })
            .from(auditLog)
            .leftJoin(users, eq(auditLog.userId, users.id))
            .where(and(...conditions))
            .orderBy(desc(auditLog.createdAt))
            .limit(limitN)
        : await db
            .select({
              id: auditLog.id,
              userId: auditLog.userId,
              module: auditLog.module,
              action: auditLog.action,
              recordId: auditLog.recordId,
              beforeValue: auditLog.beforeValue,
              afterValue: auditLog.afterValue,
              ip: auditLog.ip,
              createdAt: auditLog.createdAt,
              userEmail: users.email,
              userName: users.name,
            })
            .from(auditLog)
            .leftJoin(users, eq(auditLog.userId, users.id))
            .orderBy(desc(auditLog.createdAt))
            .limit(limitN);
      res.json(rows);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch audit log");
    }
  });

  // ----- Permissions (read-only for matrix) -----
  app.get("/api/admin/permissions", async (_req, res) => {
    try {
      const list = await db.select().from(permissions);
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch permissions");
    }
  });

  app.get("/api/admin/role-permissions", async (_req, res) => {
    try {
      const list = await db.select().from(rolePermissions);
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch role permissions");
    }
  });

  app.post("/api/admin/role-permissions", async (req, res) => {
    try {
      const { roleId, permissionId } = req.body;
      if (!roleId || !permissionId) {
        return sendApiError(res, 400, "ADMIN_PERMISSION_MATRIX_FIELDS", "roleId and permissionId required");
      }
      await db.insert(rolePermissions).values({
        roleId: String(roleId),
        permissionId: String(permissionId),
      }).onConflictDoNothing();
      writeAuditLog(req, {
        module: "M-10",
        action: "AssignRolePermission",
        recordId: `${roleId}:${permissionId}`,
        afterValue: { roleId: String(roleId), permissionId: String(permissionId) },
      }).catch((e) => console.error("Audit log failed:", e));
      res.status(201).json({ roleId: String(roleId), permissionId: String(permissionId) });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to assign permission to role");
    }
  });

  app.delete("/api/admin/role-permissions", async (req, res) => {
    try {
      const { roleId, permissionId } = req.query;
      if (!roleId || !permissionId || typeof roleId !== "string" || typeof permissionId !== "string") {
        return sendApiError(res, 400, "ADMIN_PERMISSION_MATRIX_QUERY", "roleId and permissionId required (query params)");
      }
      writeAuditLog(req, {
        module: "M-10",
        action: "RemoveRolePermission",
        recordId: `${roleId}:${permissionId}`,
        beforeValue: { roleId, permissionId },
      }).catch((e) => console.error("Audit log failed:", e));
      await db.delete(rolePermissions).where(
        and(eq(rolePermissions.roleId, roleId), eq(rolePermissions.permissionId, permissionId))
      );
      res.status(204).send();
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to remove permission from role");
    }
  });

  // ----- SLA Config (M-10) -----
  app.get("/api/admin/sla-config", async (_req, res) => {
    try {
      const list = await db.select().from(slaConfig).orderBy(slaConfig.workflow);
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch SLA config");
    }
  });

  app.post("/api/admin/sla-config", async (req, res) => {
    try {
      const body = req.body;
      const id = nanoid();
      await db.insert(slaConfig).values({
        id,
        workflow: String(body.workflow ?? ""),
        hours: Number(body.hours ?? 24),
        alertRole: body.alertRole ? String(body.alertRole) : null,
      });
      const [row] = await db.select().from(slaConfig).where(eq(slaConfig.id, id));
      writeAuditLog(req, { module: "M-10", action: "CreateSlaConfig", recordId: id, afterValue: row }).catch((e) =>
        console.error("Audit log failed:", e),
      );
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create SLA config");
    }
  });

  app.put("/api/admin/sla-config/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const [existing] = await db.select().from(slaConfig).where(eq(slaConfig.id, id)).limit(1);
      if (!existing) return sendApiError(res, 404, "ADMIN_SLA_CONFIG_NOT_FOUND", "Not found");
      const body = req.body;
      const updates: Record<string, unknown> = {};
      ["workflow", "hours", "alertRole"].forEach((k) => {
        if (body[k] === undefined) return;
        if (k === "hours") updates[k] = Number(body[k]);
        else updates[k] = body[k] == null ? null : String(body[k]);
      });
      await db.update(slaConfig).set(updates as Record<string, string | number | null>).where(eq(slaConfig.id, id));
      const [row] = await db.select().from(slaConfig).where(eq(slaConfig.id, id));
      if (!row) return sendApiError(res, 404, "ADMIN_SLA_CONFIG_NOT_FOUND", "Not found");
      writeAuditLog(req, { module: "M-10", action: "UpdateSlaConfig", recordId: id, beforeValue: existing, afterValue: row }).catch((e) =>
        console.error("Audit log failed:", e),
      );
      res.json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to update SLA config");
    }
  });
}
