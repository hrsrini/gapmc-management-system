/**
 * IOMS M-10: RBAC & System Administration API routes.
 * M-10 admin: yards, roles, permission matrix, config, audit. App logins are managed via HR only (/api/hr/employees/:id/login).
 */
import type { Express, NextFunction, Request, Response } from "express";
import multer from "multer";
import { eq, desc, asc, and, sql, count } from "drizzle-orm";
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
  measurementUnits,
  commodities,
  rentBillingConfig,
} from "@shared/db-schema";
import { nanoid } from "nanoid";
import {
  SYSTEM_CONFIG_KEYS,
  SYSTEM_CONFIG_KEYS_SENSITIVE,
  type SystemConfigKey,
} from "@shared/system-config-defaults";
import { SIDEBAR_MENU_VISIBILITY_PAGE_HREF } from "@shared/nav-sidebar-hidden";
import { getMergedSystemConfig } from "./system-config";
import { getDataRetentionSummary } from "./data-retention-audit";
import { writeAuditLog } from "./audit";
import { describeStorageFailure, sendApiError } from "./api-errors";
import {
  clearReceiptLogoFiles,
  hasUploadedReceiptLogo,
  loadActiveReceiptLogo,
  mimeForReceiptLogoKey,
  writeReceiptLogoUpload,
} from "./receipt-logo-storage";
import {
  clearLeaveOrderSignatureFiles,
  hasUploadedLeaveOrderSignature,
  loadActiveLeaveOrderSignature,
  mimeForLeaveOrderSignatureKey,
  writeLeaveOrderSignatureUpload,
} from "./leave-signature-storage";
import { getConfiguredObjectStorageDriver } from "./object-storage";
import { HrEmployeeRuleError, normalizeMobile10 } from "./hr-employee-rules";
import { SMTP_EMAIL_CONFIG_KEYS } from "@shared/smtp-email-config";
import {
  adminEmailConfigDto,
  adminEmailConfigDtoAsync,
  saveEmailConfigValues,
  validateAndNormalizeEmailConfigPut,
} from "./admin-email-config";
import { pickEmailConfigValues, sendSmtpMail, verifySmtpConnection } from "./smtp-config";
import { getSupabaseStorageBucket, getSupabaseStoragePrefix } from "./supabase-admin";

function redactSystemConfigForAudit(map: Record<SystemConfigKey, string>): Record<string, string> {
  const o: Record<string, string> = { ...map };
  for (const k of SYSTEM_CONFIG_KEYS_SENSITIVE) {
    const v = o[k]?.trim();
    if (v) o[k] = "[configured]";
  }
  return o;
}

function redactSensitiveConfigHistoryValue(key: string, val: string | null): string | null {
  if (val == null) return null;
  if (!SYSTEM_CONFIG_KEYS_SENSITIVE.includes(key as SystemConfigKey)) return val;
  const t = val.trim();
  if (t === "" || t === "[configured]") return val;
  return "[redacted]";
}

const receiptLogoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    const mime = file.mimetype.toLowerCase().split(";")[0].trim();
    if (mime === "image/png" || mime === "image/jpeg" || mime === "image/jpg" || mime === "image/pjpeg") {
      cb(null, true);
    } else {
      cb(new Error("ADMIN_RECEIPT_LOGO_TYPE: Only PNG or JPEG images are allowed."));
    }
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
      const { name, code, type, phone, mobile, address, email } = req.body;
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
        email: email != null && String(email).trim() !== "" ? String(email).trim() : null,
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
      const { name, code, type, phone, mobile, address, email, isActive } = req.body;
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
        ...(email !== undefined && { email: email != null && String(email).trim() !== "" ? String(email).trim() : null }),
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
      const out: Record<string, string> = { ...merged };
      for (const k of SMTP_EMAIL_CONFIG_KEYS) {
        delete out[k];
      }
      res.json(out);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch config");
    }
  });

  app.get("/api/admin/email-config", async (_req, res) => {
    try {
      const merged = await getMergedSystemConfig();
      res.json(await adminEmailConfigDtoAsync(merged));
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch email config");
    }
  });

  app.put("/api/admin/email-config", async (req, res) => {
    try {
      const userId = req.user!.id;
      const body = req.body as Record<string, unknown>;
      const merged = await getMergedSystemConfig();
      const before = pickEmailConfigValues(merged);
      const { values, error } = await validateAndNormalizeEmailConfigPut(body, before);
      if (error) {
        return sendApiError(res, 400, error.code, error.message);
      }
      await saveEmailConfigValues(userId, values, SMTP_EMAIL_CONFIG_KEYS);
      const afterMerged = await getMergedSystemConfig();
      writeAuditLog(req, {
        module: "M-10",
        action: "Update",
        recordId: "email_config",
        beforeValue: adminEmailConfigDto(merged),
        afterValue: adminEmailConfigDto(afterMerged),
      }).catch((err) => console.error("Audit log failed:", err));
      res.json(await adminEmailConfigDtoAsync(afterMerged));
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to update email config");
    }
  });

  app.post("/api/admin/email-config/test", async (req, res) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const merged = await getMergedSystemConfig();
      const dto = await adminEmailConfigDtoAsync(merged);
      const to = String(body.to ?? dto.notify_email_to ?? "").trim();
      if (!to) {
        return sendApiError(res, 400, "SMTP_TEST_TO", "Set default notify inbox or provide a test recipient email.");
      }
      await verifySmtpConnection();
      const ts = new Date().toISOString();
      await sendSmtpMail({
        to,
        subject: "[GAPMC IOMS] Gmail SMTP test",
        text:
          `This is a test message from GAPMC IOMS at ${ts}.\n\n` +
          `If you received this, Admin → Config → Gmail SMTP is working.`,
      });
      res.json({ ok: true, to, sentAt: ts });
    } catch (e) {
      console.error(e);
      const msg = e instanceof Error ? e.message : "SMTP test failed";
      sendApiError(res, 400, "SMTP_TEST_FAILED", msg);
    }
  });

  /**
   * US-M01-016: system_config version history derived from audit_log diffs.
   * Returns latest N "system_config" updates with per-key changes.
   */
  app.get("/api/admin/config/history", async (req, res) => {
    try {
      const limit = Math.max(1, Math.min(200, Number(req.query.limit ?? 50) || 50));
      const key = req.query.key ? String(req.query.key) : null;

      const rows = await db
        .select({
          id: auditLog.id,
          userId: auditLog.userId,
          createdAt: auditLog.createdAt,
          ip: auditLog.ip,
          beforeValue: auditLog.beforeValue,
          afterValue: auditLog.afterValue,
        })
        .from(auditLog)
        .where(and(eq(auditLog.recordId, "system_config"), eq(auditLog.module, "M-10")))
        .orderBy(desc(auditLog.createdAt))
        .limit(limit);

      const out = rows.map((r) => {
        const before = (r.beforeValue ?? {}) as Record<string, unknown>;
        const after = (r.afterValue ?? {}) as Record<string, unknown>;
        const changes: { key: string; before: string | null; after: string | null }[] = [];
        const keys = Array.from(new Set<string>([...Object.keys(before), ...Object.keys(after)]));
        for (const k of keys) {
          if (key && k !== key) continue;
          const b = redactSensitiveConfigHistoryValue(k, before[k] == null ? null : String(before[k]));
          const a = redactSensitiveConfigHistoryValue(k, after[k] == null ? null : String(after[k]));
          if (b !== a) changes.push({ key: k, before: b, after: a });
        }
        return {
          id: r.id,
          actorUserId: r.userId,
          createdAt: r.createdAt,
          ip: r.ip,
          changeCount: changes.length,
          changes,
        };
      });

      res.json({ limit, key, rows: out.filter((x) => x.changeCount > 0) });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to load config history");
    }
  });

  app.put("/api/admin/config", async (req, res) => {
    try {
      const userId = req.user!.id;
      const body = req.body as Record<string, unknown>;
      const before = await getMergedSystemConfig();
      for (const key of SYSTEM_CONFIG_KEYS) {
        if (!(key in body)) continue;
        let value = String(body[key] ?? "");
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
        if (key === "rent_invoice_cgst_percent" || key === "rent_invoice_sgst_percent") {
          const n = parseFloat(value.trim());
          if (!Number.isFinite(n) || n < 0 || n > 100) {
            return sendApiError(
              res,
              400,
              "ADMIN_CONFIG_RENT_GST_PERCENT",
              "rent_invoice_cgst_percent and rent_invoice_sgst_percent must be between 0 and 100.",
            );
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
        if (key === "ui_dashboard_show_kpi_cards") {
          const v = value.trim().toLowerCase();
          if (v !== "true" && v !== "false") {
            return sendApiError(res, 400, "ADMIN_CONFIG_DASHBOARD_KPI_FLAG", "ui_dashboard_show_kpi_cards must be true or false.");
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
        if (key === "ui_sidebar_hidden_hrefs_json") {
          let parsed: unknown;
          try {
            parsed = JSON.parse(value.trim() === "" ? "[]" : value.trim());
          } catch {
            return sendApiError(res, 400, "ADMIN_CONFIG_SIDEBAR_JSON", "ui_sidebar_hidden_hrefs_json must be valid JSON.");
          }
          if (!Array.isArray(parsed)) {
            return sendApiError(
              res,
              400,
              "ADMIN_CONFIG_SIDEBAR_JSON",
              "ui_sidebar_hidden_hrefs_json must be a JSON array of path strings.",
            );
          }
          const paths: string[] = [];
          for (const x of parsed) {
            if (typeof x !== "string" || !x.startsWith("/") || x.length > 256) {
              return sendApiError(
                res,
                400,
                "ADMIN_CONFIG_SIDEBAR_JSON",
                "Each hidden menu entry must be a non-empty path string starting with / (max 256 chars).",
              );
            }
            paths.push(x);
          }
          const filtered = paths.filter((p) => p !== SIDEBAR_MENU_VISIBILITY_PAGE_HREF);
          value = JSON.stringify(filtered.sort());
        }
        if (key === "aadhaar_hmac_secret") {
          const t = value.trim();
          if (t.length > 0 && (t.length < 16 || t.length > 2048)) {
            return sendApiError(
              res,
              400,
              "ADMIN_CONFIG_AADHAAR_HMAC_SECRET",
              "aadhaar_hmac_secret must be empty (unset) or between 16 and 2048 characters.",
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
        beforeValue: redactSystemConfigForAudit(before),
        afterValue: redactSystemConfigForAudit(after),
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
      const driver = getConfiguredObjectStorageDriver();
      res.json({
        hasLogo: await hasUploadedReceiptLogo(),
        storage: {
          driver,
          ...(driver === "supabase"
            ? { bucket: getSupabaseStorageBucket(), prefix: getSupabaseStoragePrefix() }
            : {}),
        },
      });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", describeStorageFailure(e, "Failed to read logo status"));
    }
  });

  app.get("/api/admin/branding/receipt-logo/image", async (_req, res) => {
    try {
      const loaded = await loadActiveReceiptLogo();
      if (!loaded) {
        return sendApiError(res, 404, "ADMIN_RECEIPT_LOGO_NOT_FOUND", "No logo uploaded yet.");
      }
      res.setHeader("Content-Type", mimeForReceiptLogoKey(loaded.key));
      res.setHeader("Cache-Control", "no-store");
      res.send(loaded.buffer);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", describeStorageFailure(e, "Failed to read logo"));
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
      sendApiError(res, 500, "INTERNAL_ERROR", describeStorageFailure(e, "Failed to save logo"));
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
      sendApiError(res, 500, "INTERNAL_ERROR", describeStorageFailure(e, "Failed to remove logo"));
    }
  });

  // ----- Leave Sanction Order secretary signature (until digital signature is live) -----
  app.get("/api/admin/branding/leave-order-signature/status", async (_req, res) => {
    try {
      const driver = getConfiguredObjectStorageDriver();
      res.json({
        hasSignature: await hasUploadedLeaveOrderSignature(),
        storage: {
          driver,
          ...(driver === "supabase"
            ? { bucket: getSupabaseStorageBucket(), prefix: getSupabaseStoragePrefix() }
            : {}),
        },
      });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", describeStorageFailure(e, "Failed to read signature status"));
    }
  });

  app.get("/api/admin/branding/leave-order-signature/image", async (_req, res) => {
    try {
      const loaded = await loadActiveLeaveOrderSignature();
      if (!loaded) {
        return sendApiError(res, 404, "ADMIN_LEAVE_SIGNATURE_NOT_FOUND", "No secretary signature uploaded yet.");
      }
      res.setHeader("Content-Type", mimeForLeaveOrderSignatureKey(loaded.key));
      res.setHeader("Cache-Control", "no-store");
      res.send(loaded.buffer);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", describeStorageFailure(e, "Failed to read signature"));
    }
  });

  app.post("/api/admin/branding/leave-order-signature", multerReceiptLogo, async (req, res) => {
    try {
      const file = req.file;
      if (!file?.buffer?.length) {
        return sendApiError(
          res,
          400,
          "ADMIN_LEAVE_SIGNATURE_REQUIRED",
          "Choose a PNG or JPEG file (field name: logo).",
        );
      }
      await writeLeaveOrderSignatureUpload(file.buffer, file.mimetype);
      writeAuditLog(req, {
        module: "M-10",
        action: "UploadLeaveOrderSignature",
        recordId: "branding/leave-order-signature",
        afterValue: { mime: file.mimetype, size: file.size },
      }).catch((e) => console.error("Audit log failed:", e));
      res.status(201).json({ ok: true, hasSignature: true });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", describeStorageFailure(e, "Failed to save signature"));
    }
  });

  app.delete("/api/admin/branding/leave-order-signature", async (req, res) => {
    try {
      const hadFile = await hasUploadedLeaveOrderSignature();
      await clearLeaveOrderSignatureFiles();
      writeAuditLog(req, {
        module: "M-10",
        action: "DeleteLeaveOrderSignature",
        recordId: "branding/leave-order-signature",
        beforeValue: { hadFile },
      }).catch((e) => console.error("Audit log failed:", e));
      res.json({ ok: true, hasSignature: false });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", describeStorageFailure(e, "Failed to remove signature"));
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

  // ----- Measurement units (M-04 master; Admin CRUD) -----
  app.get("/api/admin/measurement-units", async (_req, res) => {
    try {
      const list = await db
        .select()
        .from(measurementUnits)
        .orderBy(asc(measurementUnits.sortOrder), asc(measurementUnits.name));
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch measurement units");
    }
  });

  app.post("/api/admin/measurement-units", async (req, res) => {
    try {
      const name = String(req.body?.name ?? "").trim();
      if (!name) return sendApiError(res, 400, "ADMIN_UNIT_NAME_REQUIRED", "name is required");
      const sortOrder = Number(req.body?.sortOrder ?? 0);
      const isActive = req.body?.isActive !== undefined ? Boolean(req.body.isActive) : true;
      const id = nanoid();
      await db.insert(measurementUnits).values({
        id,
        name,
        sortOrder: Number.isFinite(sortOrder) ? sortOrder : 0,
        isActive,
        createdAt: now(),
      });
      const [row] = await db.select().from(measurementUnits).where(eq(measurementUnits.id, id));
      writeAuditLog(req, { module: "M-10", action: "CreateMeasurementUnit", recordId: id, afterValue: row }).catch((e) =>
        console.error("Audit log failed:", e),
      );
      res.status(201).json(row);
    } catch (e: unknown) {
      const code = e && typeof e === "object" && "code" in e ? (e as { code?: string }).code : "";
      if (code === "23505") {
        return sendApiError(res, 409, "ADMIN_UNIT_NAME_DUPLICATE", "A unit with this name already exists");
      }
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create measurement unit");
    }
  });

  app.put("/api/admin/measurement-units/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const [existing] = await db.select().from(measurementUnits).where(eq(measurementUnits.id, id)).limit(1);
      if (!existing) return sendApiError(res, 404, "ADMIN_UNIT_NOT_FOUND", "Not found");
      const body = req.body;
      const updates: Record<string, unknown> = {};
      if (body.name !== undefined) {
        const name = String(body.name ?? "").trim();
        if (!name) return sendApiError(res, 400, "ADMIN_UNIT_NAME_REQUIRED", "name cannot be empty");
        updates.name = name;
      }
      if (body.sortOrder !== undefined) {
        const n = Number(body.sortOrder);
        updates.sortOrder = Number.isFinite(n) ? n : 0;
      }
      if (body.isActive !== undefined) updates.isActive = Boolean(body.isActive);
      if (Object.keys(updates).length > 0) {
        await db.update(measurementUnits).set(updates as Record<string, string | number | boolean>).where(eq(measurementUnits.id, id));
      }
      const [row] = await db.select().from(measurementUnits).where(eq(measurementUnits.id, id));
      if (!row) return sendApiError(res, 404, "ADMIN_UNIT_NOT_FOUND", "Not found");
      writeAuditLog(req, { module: "M-10", action: "UpdateMeasurementUnit", recordId: id, beforeValue: existing, afterValue: row }).catch((e) =>
        console.error("Audit log failed:", e),
      );
      res.json(row);
    } catch (e: unknown) {
      const code = e && typeof e === "object" && "code" in e ? (e as { code?: string }).code : "";
      if (code === "23505") {
        return sendApiError(res, 409, "ADMIN_UNIT_NAME_DUPLICATE", "A unit with this name already exists");
      }
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to update measurement unit");
    }
  });

  app.delete("/api/admin/measurement-units/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const [existing] = await db.select().from(measurementUnits).where(eq(measurementUnits.id, id)).limit(1);
      if (!existing) return sendApiError(res, 404, "ADMIN_UNIT_NOT_FOUND", "Not found");
      const [{ c: n }] = await db
        .select({ c: count() })
        .from(commodities)
        .where(eq(commodities.unitId, id));
      if (Number(n) > 0) {
        return sendApiError(res, 409, "ADMIN_UNIT_IN_USE", "This unit is assigned to one or more commodities; deactivate it instead of deleting.");
      }
      await db.delete(measurementUnits).where(eq(measurementUnits.id, id));
      writeAuditLog(req, { module: "M-10", action: "DeleteMeasurementUnit", recordId: id, beforeValue: existing }).catch((e) =>
        console.error("Audit log failed:", e),
      );
      res.status(204).send();
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to delete measurement unit");
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

  // ----- M-03 rent billing config (prorata / overstay) -----
  app.get("/api/admin/rent-billing-config", async (_req, res) => {
    try {
      const list = await db.select().from(rentBillingConfig).orderBy(desc(rentBillingConfig.effectiveFrom));
      res.json(list);
    } catch (e) {
      console.error(e);
      const pg = e as { code?: string };
      if (pg?.code === "42P01") {
        return sendApiError(
          res,
          503,
          "RENT_BILLING_CONFIG_SCHEMA_MISSING",
          "Run: npm run db:apply-m03-rent-invoice-billing-types",
        );
      }
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch rent billing config");
    }
  });

  app.post("/api/admin/rent-billing-config", async (req, res) => {
    try {
      const body = req.body as Record<string, unknown>;
      const effectiveFrom = String(body.effectiveFrom ?? "").trim().slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) {
        return sendApiError(res, 400, "EFFECTIVE_FROM", "effectiveFrom must be YYYY-MM-DD");
      }
      const prorataFactor = Number(body.prorataFactor ?? 1);
      const overstayFactor = Number(body.overstayFactor ?? 2);
      if (!Number.isFinite(prorataFactor) || prorataFactor <= 0) {
        return sendApiError(res, 400, "PRORATA_FACTOR", "prorataFactor must be > 0");
      }
      if (!Number.isFinite(overstayFactor) || overstayFactor <= 0) {
        return sendApiError(res, 400, "OVERSTAY_FACTOR", "overstayFactor must be > 0");
      }
      const prorataDaysBasis = String(body.prorataDaysBasis ?? "Calendar") === "Fixed" ? "Fixed" : "Calendar";
      const overstayDaysBasis = String(body.overstayDaysBasis ?? "Calendar") === "Fixed" ? "Fixed" : "Calendar";
      const prorataFixedDays =
        body.prorataFixedDays != null && String(body.prorataFixedDays).trim() !== ""
          ? Number(body.prorataFixedDays)
          : null;
      const overstayFixedDays =
        body.overstayFixedDays != null && String(body.overstayFixedDays).trim() !== ""
          ? Number(body.overstayFixedDays)
          : null;
      const id = nanoid();
      const ts = now();
      await db.insert(rentBillingConfig).values({
        id,
        effectiveFrom,
        prorataFactor,
        prorataDaysBasis,
        prorataFixedDays: prorataDaysBasis === "Fixed" ? prorataFixedDays : null,
        overstayFactor,
        overstayDaysBasis,
        overstayFixedDays: overstayDaysBasis === "Fixed" ? overstayFixedDays : null,
        createdAt: ts,
        updatedAt: ts,
      });
      const [row] = await db.select().from(rentBillingConfig).where(eq(rentBillingConfig.id, id));
      writeAuditLog(req, { module: "M-10", action: "CreateRentBillingConfig", recordId: id, afterValue: row }).catch(
        (err) => console.error("Audit log failed:", err),
      );
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create rent billing config");
    }
  });

  app.put("/api/admin/rent-billing-config/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const [existing] = await db.select().from(rentBillingConfig).where(eq(rentBillingConfig.id, id)).limit(1);
      if (!existing) return sendApiError(res, 404, "RENT_BILLING_CONFIG_NOT_FOUND", "Not found");
      const body = req.body as Record<string, unknown>;
      const updates: Record<string, unknown> = { updatedAt: now() };
      if (body.effectiveFrom !== undefined) {
        const ef = String(body.effectiveFrom).trim().slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(ef)) {
          return sendApiError(res, 400, "EFFECTIVE_FROM", "effectiveFrom must be YYYY-MM-DD");
        }
        updates.effectiveFrom = ef;
      }
      if (body.prorataFactor !== undefined) updates.prorataFactor = Number(body.prorataFactor);
      if (body.overstayFactor !== undefined) updates.overstayFactor = Number(body.overstayFactor);
      if (body.prorataDaysBasis !== undefined) {
        updates.prorataDaysBasis = String(body.prorataDaysBasis) === "Fixed" ? "Fixed" : "Calendar";
      }
      if (body.overstayDaysBasis !== undefined) {
        updates.overstayDaysBasis = String(body.overstayDaysBasis) === "Fixed" ? "Fixed" : "Calendar";
      }
      if (body.prorataFixedDays !== undefined) {
        updates.prorataFixedDays =
          body.prorataFixedDays == null || String(body.prorataFixedDays).trim() === ""
            ? null
            : Number(body.prorataFixedDays);
      }
      if (body.overstayFixedDays !== undefined) {
        updates.overstayFixedDays =
          body.overstayFixedDays == null || String(body.overstayFixedDays).trim() === ""
            ? null
            : Number(body.overstayFixedDays);
      }
      await db
        .update(rentBillingConfig)
        .set(updates as Record<string, string | number | null>)
        .where(eq(rentBillingConfig.id, id));
      const [row] = await db.select().from(rentBillingConfig).where(eq(rentBillingConfig.id, id));
      if (!row) return sendApiError(res, 404, "RENT_BILLING_CONFIG_NOT_FOUND", "Not found");
      writeAuditLog(req, {
        module: "M-10",
        action: "UpdateRentBillingConfig",
        recordId: id,
        beforeValue: existing,
        afterValue: row,
      }).catch((err) => console.error("Audit log failed:", err));
      res.json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to update rent billing config");
    }
  });
}
