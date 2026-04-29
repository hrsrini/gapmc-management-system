import type { Express } from "express";
import path from "path";
import { createServer, type Server } from "http";
import { sql, inArray, and, eq, or, isNull, desc } from "drizzle-orm";
import { storage } from "./storage";
import { db } from "./db";
import { registerAdminRoutes } from "./routes-admin";
import { registerReceiptsIomsRoutes } from "./routes-receipts-ioms";
import { registerHrRoutes } from "./routes-hr";
import { registerTradersAssetsRoutes } from "./routes-traders-assets";
import { registerRentIomsRoutes } from "./routes-rent-ioms";
import { registerMarketIomsRoutes } from "./routes-market-ioms";
import { registerVoucherRoutes } from "./routes-vouchers";
import { registerFleetRoutes } from "./routes-fleet";
import { registerConstructionRoutes } from "./routes-construction";
import { registerDakRoutes } from "./routes-dak";
import { registerPortalRoutes } from "./routes-portal";
import { registerBugRoutes } from "./routes-bugs";
import { registerReportsRoutes } from "./routes-reports";
import { registerFinanceReferenceRoutes } from "./routes-finance-reference";
import { registerAuthMeRoute, registerMfaRoutes, registerPublicAuthRoutes } from "./routes-auth";
import { getMergedSystemConfig, omitSensitiveSystemConfigKeys } from "./system-config";
import { requireAuthApi, requireAdminPermissionByMethod, requireModulePermissionByPath } from "./auth";
import { writeAuditLog } from "./audit";
import { sendApiError } from "./api-errors";
import { agreementDocuments, agreements as agreementsTable, yards } from "@shared/db-schema";
import { INDIAN_PAN_RE, normalizePanInput } from "@shared/india-validation";
import { isPanTakenAcrossActiveMasters } from "./pan-uniqueness";
import { 
  insertTraderSchema, 
  insertInvoiceSchema, 
  insertReceiptSchema, 
  insertMarketFeeSchema,
  insertAgreementSchema,
  insertStockReturnSchema
} from "@shared/schema";
import { z } from "zod";
import multer from "multer";
import { nanoid } from "nanoid";
import {
  extFromAgreementDocumentMime,
  isAllowedAgreementDocumentFileName,
  readAgreementDocumentBuffer,
  writeAgreementDocumentBuffer,
  contentTypeForAgreementDocument,
} from "./agreement-document-storage";

/** Human-readable labels for common validation paths */
const STOCK_RETURN_PATH_LABELS: Record<string, string> = {
  traderId: "Trader",
  traderName: "Trader name",
  period: "Period",
  entries: "Commodity entries",
  status: "Status",
  commodity: "Commodity",
  openingBalance: "Opening balance",
  locallyProcured: "Locally procured",
  purchasedFromTrader: "Purchased from trader",
  sales: "Sales",
  closingBalance: "Closing balance",
};

/** Format Zod validation errors into a single user-friendly message */
function formatZodError(zodError: z.ZodError, pathLabels?: Record<string, string>): string {
  const labels = pathLabels ?? {};
  const parts = zodError.errors.map((e) => {
    const pathKey = e.path.join(".");
    const pathParts = e.path.map((p, i) => {
      const key = e.path.slice(0, i + 1).join(".");
      return labels[key] ?? (typeof p === "number" ? `Entry ${p + 1}` : String(p));
    });
    const label = pathParts.length ? pathParts.join(" → ") : "Form";
    return `${label}: ${e.message}`;
  });
  return parts.length === 1 ? parts[0]! : parts.join(". ");
}

function formatStockReturnValidationError(zodError: z.ZodError): string {
  return formatZodError(zodError, STOCK_RETURN_PATH_LABELS);
}

const updateTraderSchema = insertTraderSchema.partial();
const updateInvoiceSchema = insertInvoiceSchema.partial();
const updateReceiptSchema = insertReceiptSchema.partial();
const updateAgreementSchema = insertAgreementSchema.partial();

const stockReturnEntrySchema = z.object({
  commodity: z.string(),
  openingBalance: z.coerce.number(),
  locallyProcured: z.coerce.number(),
  purchasedFromTrader: z.coerce.number(),
  sales: z.coerce.number(),
  closingBalance: z.coerce.number(),
});

const agreementDocUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // align with SRS doc limit
});
const bulkStockReturnSchema = z.object({
  traderId: z.string(),
  traderName: z.string(),
  period: z.string(),
  entries: z.array(stockReturnEntrySchema),
  status: z.enum(["Draft", "Submitted"]),
  submittedAt: z.string().optional(),
});

const startTime = Date.now();

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  await storage.seedData();

  // Cron trigger: M-03 rent invoice generation (secured by CRON_SECRET; call before requireAuthApi)
  app.post("/api/cron/rent-invoice-generation", async (req, res) => {
    const secret = process.env.CRON_SECRET;
    if (secret && req.headers["x-cron-secret"] !== secret) {
      return sendApiError(res, 401, "CRON_UNAUTHORIZED", "Unauthorized");
    }
    try {
      const { generateRentInvoicesForCurrentMonth } = await import("./cron-rent-invoices");
      const result = await generateRentInvoicesForCurrentMonth();
      return res.json({ ok: true, ...result });
    } catch (e) {
      console.error("Cron rent invoice generation failed:", e);
      return sendApiError(res, 500, "INTERNAL_ERROR", "Cron job failed");
    }
  });

  // M-03: overdue rent invoices + interest accrual on rent_deposit_ledger (secured by CRON_SECRET)
  app.post("/api/cron/m03-rent-arrears-interest", async (req, res) => {
    const secret = process.env.CRON_SECRET;
    if (secret && req.headers["x-cron-secret"] !== secret) {
      return sendApiError(res, 401, "CRON_UNAUTHORIZED", "Unauthorized");
    }
    try {
      const { runM03RentArrearsInterest } = await import("./cron-m03-rent-arrears-interest");
      const result = await runM03RentArrearsInterest();
      return res.json({ ok: true, ...result });
    } catch (e) {
      console.error("Cron M-03 rent arrears interest failed:", e);
      return sendApiError(res, 500, "INTERNAL_ERROR", "Cron job failed");
    }
  });

  app.post("/api/cron/licence-expiry-auto-block", async (req, res) => {
    const secret = process.env.CRON_SECRET;
    if (secret && req.headers["x-cron-secret"] !== secret) {
      return sendApiError(res, 401, "CRON_UNAUTHORIZED", "Unauthorized");
    }
    try {
      const { autoBlockExpiredTraderLicences } = await import("./cron-licence-expiry");
      const result = await autoBlockExpiredTraderLicences();
      return res.json({ ok: true, ...result });
    } catch (e) {
      console.error("Cron licence expiry auto-block failed:", e);
      return sendApiError(res, 500, "INTERNAL_ERROR", "Cron job failed");
    }
  });

  app.post("/api/cron/m02-entity-alerts", async (req, res) => {
    const secret = process.env.CRON_SECRET;
    if (secret && req.headers["x-cron-secret"] !== secret) {
      return sendApiError(res, 401, "CRON_UNAUTHORIZED", "Unauthorized");
    }
    try {
      const { runM02EntityAlerts } = await import("./cron-m02-entity-alerts");
      const result = await runM02EntityAlerts();
      return res.json({ ok: true, ...result });
    } catch (e) {
      console.error("Cron M-02 entity alerts failed:", e);
      return sendApiError(res, 500, "INTERNAL_ERROR", "Cron job failed");
    }
  });

  app.post("/api/cron/hr-retirement-reminders", async (req, res) => {
    const secret = process.env.CRON_SECRET;
    if (secret && req.headers["x-cron-secret"] !== secret) {
      return sendApiError(res, 401, "CRON_UNAUTHORIZED", "Unauthorized");
    }
    try {
      const { runHrRetirementReminders } = await import("./cron-hr-retirement");
      const result = await runHrRetirementReminders();
      return res.json({ ok: true, ...result });
    } catch (e) {
      console.error("Cron HR retirement reminders failed:", e);
      return sendApiError(res, 500, "INTERNAL_ERROR", "Cron job failed");
    }
  });

  app.post("/api/cron/operational-reminders-digest", async (req, res) => {
    const secret = process.env.CRON_SECRET;
    if (secret && req.headers["x-cron-secret"] !== secret) {
      return sendApiError(res, 401, "CRON_UNAUTHORIZED", "Unauthorized");
    }
    try {
      const { runOperationalRemindersDigest } = await import("./cron-operational-reminders");
      const result = await runOperationalRemindersDigest();
      return res.json({ ok: true, ...result });
    } catch (e) {
      console.error("Cron operational digest failed:", e);
      return sendApiError(res, 500, "INTERNAL_ERROR", "Cron job failed");
    }
  });

  app.post("/api/cron/amc-renewal-digest", async (req, res) => {
    const secret = process.env.CRON_SECRET;
    if (secret && req.headers["x-cron-secret"] !== secret) {
      return sendApiError(res, 401, "CRON_UNAUTHORIZED", "Unauthorized");
    }
    try {
      const { runAmcRenewalDigest } = await import("./cron-amc-renewal-digest");
      const result = await runAmcRenewalDigest();
      return res.json({ ok: true, ...result });
    } catch (e) {
      console.error("Cron AMC renewal digest failed:", e);
      return sendApiError(res, 500, "INTERNAL_ERROR", "Cron job failed");
    }
  });

  app.post("/api/cron/amc-monthly-bills", async (req, res) => {
    const secret = process.env.CRON_SECRET;
    if (secret && req.headers["x-cron-secret"] !== secret) {
      return sendApiError(res, 401, "CRON_UNAUTHORIZED", "Unauthorized");
    }
    try {
      const { generateMonthlyAmcBillsIfMissing } = await import("./cron-amc-bills");
      const result = await generateMonthlyAmcBillsIfMissing();
      if (result.disabled) {
        return res.json({
          ok: true,
          ...result,
          message: "AMC auto-generation is off: set amc_monthly_auto_generate to true in Admin → Config.",
        });
      }
      return res.json({ ok: true, ...result });
    } catch (e) {
      console.error("Cron AMC monthly bills failed:", e);
      return sendApiError(res, 500, "INTERNAL_ERROR", "Cron job failed");
    }
  });

  app.post("/api/cron/data-retention-audit", async (req, res) => {
    const secret = process.env.CRON_SECRET;
    if (secret && req.headers["x-cron-secret"] !== secret) {
      return sendApiError(res, 401, "CRON_UNAUTHORIZED", "Unauthorized");
    }
    try {
      const { runDataRetentionAuditJob } = await import("./data-retention-audit");
      const { getRequestClientIp } = await import("./audit");
      const summary = await runDataRetentionAuditJob({ ip: getRequestClientIp(req) });
      return res.json({ ok: true, ...summary });
    } catch (e) {
      console.error("Cron data retention audit failed:", e);
      return sendApiError(res, 500, "INTERNAL_ERROR", "Cron job failed");
    }
  });

  /** One-shot SLA tick (same logic as hourly in-process loop). Secured by CRON_SECRET when set. */
  app.post("/api/cron/sla-reminder-tick", async (req, res) => {
    const secret = process.env.CRON_SECRET;
    if (secret && req.headers["x-cron-secret"] !== secret) {
      return sendApiError(res, 401, "CRON_UNAUTHORIZED", "Unauthorized");
    }
    try {
      const { runSlaTick } = await import("./sla-reminder");
      await runSlaTick();
      return res.json({ ok: true });
    } catch (e) {
      console.error("Cron SLA reminder tick failed:", e);
      return sendApiError(res, 500, "INTERNAL_ERROR", "Cron job failed");
    }
  });

  // Login/logout before requireAuthApi (Express 5 + session.save must be awaited in the handler).
  registerPublicAuthRoutes(app);
  registerMfaRoutes(app);

  // US-M10-005: external entity portal auth + read-only APIs (separate from employee users).
  // Registered before requireAuthApi so portal users don't need employee sessions.
  registerPortalRoutes(app);

  // Require session for all other /api routes; attach req.user and req.scopedLocationIds
  app.use(requireAuthApi);

  registerAuthMeRoute(app);

  // M-09 terminology compatibility: treat /api/ioms/tapal/* as /api/ioms/dak/*
  // Do this early so auth + permission routing sees the rewritten path.
  app.use((req, _res, next) => {
    if (req.url.startsWith("/api/ioms/tapal")) {
      req.url = req.url.replace("/api/ioms/tapal", "/api/ioms/dak");
    }
    next();
  });

  // IOMS M-10: Admin — require M-10 permission by method (Read/Create/Update/Delete) from role_permissions
  app.use("/api/admin", requireAdminPermissionByMethod);

  // Role permissions for all other modules (M-01 .. M-09): path → module, method → action; ADMIN full access, READ_ONLY only Read
  app.use(requireModulePermissionByPath);

  // Reports: scoped yards including inactive (filters must show deactivated locations).
  app.get("/api/yards/for-reports", async (req, res) => {
    try {
      const ids = req.scopedLocationIds ?? [];
      if (ids.length === 0) {
        return res.json([]);
      }
      const list = await db.select().from(yards).where(inArray(yards.id, ids)).orderBy(yards.name);
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch yards");
    }
  });

  // Yards scoped to current user's assigned locations — active only (dropdowns, filters).
  app.get("/api/yards", async (req, res) => {
    try {
      const ids = req.scopedLocationIds ?? [];
      if (ids.length === 0) {
        return res.json([]);
      }
      const activeCond = or(eq(yards.isActive, true), isNull(yards.isActive));
      const list = await db
        .select()
        .from(yards)
        .where(and(inArray(yards.id, ids), activeCond))
        .orderBy(yards.name);
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch yards");
    }
  });

  /**
   * PAN uniqueness check (UI onBlur).
   * Rule: unique across active employees + active entities (TrackA licences, TrackB entities, ad-hoc).
   */
  app.get("/api/identity/pan/check", async (req, res) => {
    try {
      if (!req.user) return sendApiError(res, 401, "AUTH_NOT_AUTHENTICATED", "Not authenticated");
      const pan = normalizePanInput(String(req.query.pan ?? ""));
      if (!pan) return sendApiError(res, 400, "PAN_REQUIRED", "pan is required");
      if (pan.length !== 10 || !INDIAN_PAN_RE.test(pan)) {
        return sendApiError(res, 400, "PAN_FORMAT", "PAN must match ABCDE1234F.");
      }
      const taken = await isPanTakenAcrossActiveMasters({ panUpper: pan });
      if (taken) return res.json({ ok: false, message: "PAN is already used by another active record." });
      return res.json({ ok: true });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to check PAN");
    }
  });

  // IOMS M-10: Admin (RBAC) routes — yards, users, roles, config, audit
  registerAdminRoutes(app);

  /** Merged system_config + code defaults; any authenticated user (forms use for suggested values). Sensitive keys omitted. */
  app.get("/api/system/config", async (_req, res) => {
    try {
      const merged = await getMergedSystemConfig();
      res.json(omitSensitiveSystemConfigKeys(merged));
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to load system configuration");
    }
  });

  app.get("/api/system/payment-gateway", async (_req, res) => {
    try {
      const { getPaymentGatewayAdapter } = await import("./payment-gateway");
      const a = getPaymentGatewayAdapter();
      res.json({ mode: a.mode, description: a.describe() });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to read payment gateway config");
    }
  });

  // IOMS M-05: Receipts Online — central receipt engine
  registerReceiptsIomsRoutes(app);

  // IOMS M-01: HRMS
  registerHrRoutes(app);

  // IOMS M-02: Trader & Asset ID Management
  registerTradersAssetsRoutes(app);

  // IOMS M-03: Rent / GST Tax Invoice (rent_invoices, ledger, credit_notes; does not touch gapmc.invoices)
  registerRentIomsRoutes(app);

  // IOMS M-04: Market Fee & Commodities (commodities, fee rates, farmers, transactions, check post; does not touch gapmc.market_fees)
  registerMarketIomsRoutes(app);

  // IOMS M-06: Payment Vouchers
  registerVoucherRoutes(app);

  // IOMS M-07: Vehicle Fleet
  registerFleetRoutes(app);

  // IOMS M-08: Construction & Maintenance
  registerConstructionRoutes(app);

  // IOMS M-09: Correspondence (Dak) — underlying implementation
  registerDakRoutes(app);

  // Bug tracking (all authenticated users)
  registerBugRoutes(app);

  // Finance reference data (authenticated; no module code)
  registerFinanceReferenceRoutes(app);

  // IOMS yard-scoped reports and CSV export
  registerReportsRoutes(app);

  // Health check (public, no auth)
  app.get("/api/health", async (_req, res) => {
    const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
    let database: "ok" | "error" = "error";
    try {
      await db.execute(sql`SELECT 1`);
      database = "ok";
    } catch {
      // database unreachable or not configured
    }
    const status = database === "ok" ? "ok" : "degraded";
    res.status(database === "ok" ? 200 : 503).json({
      status,
      database,
      uptimeSeconds,
      timestamp: new Date().toISOString(),
    });
  });

  // Traders
  app.get("/api/traders", async (req, res) => {
    try {
      const traders = await storage.getTraders();
      res.json(traders);
    } catch (error) {
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch traders");
    }
  });

  app.get("/api/traders/:id", async (req, res) => {
    try {
      const trader = await storage.getTrader(req.params.id);
      if (!trader) return sendApiError(res, 404, "LEGACY_TRADER_NOT_FOUND", "Trader not found");
      res.json(trader);
    } catch (error) {
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch trader");
    }
  });

  app.post("/api/traders", async (req, res) => {
    try {
      const validatedData = insertTraderSchema.parse(req.body);
      const trader = await storage.createTrader(validatedData);
      await storage.createActivityLog({
        action: 'Trader Registered',
        module: 'Traders',
        user: req.user?.name ?? 'System',
        timestamp: new Date().toISOString(),
      });
      writeAuditLog(req, { module: 'Traders', action: 'Create', recordId: trader.id, afterValue: trader }).catch((e) => console.error('Audit log failed:', e));
      res.status(201).json(trader);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return sendApiError(res, 400, "LEGACY_VALIDATION_FAILED", "Validation failed", error.errors);
      }
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create trader");
    }
  });

  app.put("/api/traders/:id", async (req, res) => {
    try {
      const before = await storage.getTrader(req.params.id);
      const validatedData = updateTraderSchema.parse(req.body);
      const trader = await storage.updateTrader(req.params.id, validatedData);
      if (!trader) return sendApiError(res, 404, "LEGACY_TRADER_NOT_FOUND", "Trader not found");
      writeAuditLog(req, { module: 'Traders', action: 'Update', recordId: req.params.id, beforeValue: before ?? undefined, afterValue: trader }).catch((e) => console.error('Audit log failed:', e));
      res.json(trader);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return sendApiError(res, 400, "LEGACY_VALIDATION_FAILED", "Validation failed", error.errors);
      }
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to update trader");
    }
  });

  app.delete("/api/traders/:id", async (req, res) => {
    try {
      const before = await storage.getTrader(req.params.id);
      const deleted = await storage.deleteTrader(req.params.id);
      if (!deleted) return sendApiError(res, 404, "LEGACY_TRADER_NOT_FOUND", "Trader not found");
      writeAuditLog(req, { module: 'Traders', action: 'Delete', recordId: req.params.id, beforeValue: before ?? undefined }).catch((e) => console.error('Audit log failed:', e));
      res.json({ success: true });
    } catch (error) {
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to delete trader");
    }
  });

  // Invoices
  app.get("/api/invoices", async (req, res) => {
    try {
      const invoices = await storage.getInvoices();
      res.json(invoices);
    } catch (error) {
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch invoices");
    }
  });

  app.get("/api/invoices/:id", async (req, res) => {
    try {
      const invoice = await storage.getInvoice(req.params.id);
      if (!invoice) return sendApiError(res, 404, "LEGACY_INVOICE_NOT_FOUND", "Invoice not found");
      res.json(invoice);
    } catch (error) {
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch invoice");
    }
  });

  app.post("/api/invoices", async (req, res) => {
    try {
      const validatedData = insertInvoiceSchema.parse(req.body);
      const invoice = await storage.createInvoice(validatedData);
      await storage.createActivityLog({
        action: 'Invoice Generated',
        module: 'Rent/Tax',
        user: req.user?.name ?? 'System',
        timestamp: new Date().toISOString(),
      });
      writeAuditLog(req, { module: 'Rent/Tax', action: 'Create', recordId: invoice.id, afterValue: invoice }).catch((e) => console.error('Audit log failed:', e));
      res.status(201).json(invoice);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return sendApiError(res, 400, "LEGACY_VALIDATION_FAILED", "Validation failed", error.errors);
      }
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create invoice");
    }
  });

  app.put("/api/invoices/:id", async (req, res) => {
    try {
      const before = await storage.getInvoice(req.params.id);
      const validatedData = updateInvoiceSchema.parse(req.body);
      const invoice = await storage.updateInvoice(req.params.id, validatedData);
      if (!invoice) return sendApiError(res, 404, "LEGACY_INVOICE_NOT_FOUND", "Invoice not found");
      writeAuditLog(req, { module: 'Rent/Tax', action: 'Update', recordId: req.params.id, beforeValue: before ?? undefined, afterValue: invoice }).catch((e) => console.error('Audit log failed:', e));
      res.json(invoice);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return sendApiError(res, 400, "LEGACY_VALIDATION_FAILED", "Validation failed", error.errors);
      }
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to update invoice");
    }
  });

  app.delete("/api/invoices/:id", async (req, res) => {
    try {
      const before = await storage.getInvoice(req.params.id);
      const deleted = await storage.deleteInvoice(req.params.id);
      if (!deleted) return sendApiError(res, 404, "LEGACY_INVOICE_NOT_FOUND", "Invoice not found");
      writeAuditLog(req, { module: 'Rent/Tax', action: 'Delete', recordId: req.params.id, beforeValue: before ?? undefined }).catch((e) => console.error('Audit log failed:', e));
      res.json({ success: true });
    } catch (error) {
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to delete invoice");
    }
  });

  // Receipts
  app.get("/api/receipts", async (req, res) => {
    try {
      const receipts = await storage.getReceipts();
      res.json(receipts);
    } catch (error) {
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch receipts");
    }
  });

  app.get("/api/receipts/:id", async (req, res) => {
    try {
      const receipt = await storage.getReceipt(req.params.id);
      if (!receipt) return sendApiError(res, 404, "LEGACY_RECEIPT_NOT_FOUND", "Receipt not found");
      res.json(receipt);
    } catch (error) {
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch receipt");
    }
  });

  app.post("/api/receipts", async (req, res) => {
    try {
      const validatedData = insertReceiptSchema.parse(req.body);
      const receipt = await storage.createReceipt(validatedData);
      await storage.createActivityLog({
        action: 'Receipt Created',
        module: 'Receipts',
        user: req.user?.name ?? 'System',
        timestamp: new Date().toISOString(),
      });
      writeAuditLog(req, { module: 'Receipts', action: 'Create', recordId: receipt.id, afterValue: receipt }).catch((e) => console.error('Audit log failed:', e));
      res.status(201).json(receipt);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return sendApiError(res, 400, "LEGACY_VALIDATION_FAILED", "Validation failed", error.errors);
      }
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create receipt");
    }
  });

  app.put("/api/receipts/:id", async (req, res) => {
    try {
      const validatedData = updateReceiptSchema.parse(req.body);
      const before = await storage.getReceipt(req.params.id);
      const receipt = await storage.updateReceipt(req.params.id, validatedData);
      if (!receipt) return sendApiError(res, 404, "LEGACY_RECEIPT_NOT_FOUND", "Receipt not found");
      writeAuditLog(req, { module: 'Receipts', action: 'Update', recordId: req.params.id, beforeValue: before ?? undefined, afterValue: receipt }).catch((e) => console.error('Audit log failed:', e));
      res.json(receipt);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return sendApiError(res, 400, "LEGACY_VALIDATION_FAILED", "Validation failed", error.errors);
      }
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to update receipt");
    }
  });

  app.delete("/api/receipts/:id", async (req, res) => {
    try {
      const before = await storage.getReceipt(req.params.id);
      const deleted = await storage.deleteReceipt(req.params.id);
      if (!deleted) return sendApiError(res, 404, "LEGACY_RECEIPT_NOT_FOUND", "Receipt not found");
      writeAuditLog(req, { module: 'Receipts', action: 'Delete', recordId: req.params.id, beforeValue: before ?? undefined }).catch((e) => console.error('Audit log failed:', e));
      res.json({ success: true });
    } catch (error) {
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to delete receipt");
    }
  });

  // Market Fee
  app.get("/api/marketfees", async (req, res) => {
    try {
      const marketFees = await storage.getMarketFees();
      res.json(marketFees);
    } catch (error) {
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch market fees");
    }
  });

  app.post("/api/marketfees", async (req, res) => {
    try {
      const validatedData = insertMarketFeeSchema.parse(req.body);
      const marketFee = await storage.createMarketFee(validatedData);
      await storage.createActivityLog({
        action: 'Market Fee Entry',
        module: 'Market Fee',
        user: req.user?.name ?? 'System',
        timestamp: new Date().toISOString(),
      });
      writeAuditLog(req, { module: 'Market Fee', action: 'Create', recordId: marketFee.id, afterValue: marketFee }).catch((e) => console.error('Audit log failed:', e));
      res.status(201).json(marketFee);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return sendApiError(res, 400, "LEGACY_VALIDATION_FAILED", "Validation failed", error.errors);
      }
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create market fee entry");
    }
  });

  // Agreements
  app.get("/api/agreements", async (req, res) => {
    try {
      const agreements = await storage.getAgreements();
      res.json(agreements);
    } catch (error) {
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch agreements");
    }
  });

  app.post("/api/agreements", async (req, res) => {
    try {
      const validatedData = insertAgreementSchema.parse(req.body);
      const agreement = await storage.createAgreement(validatedData);
      writeAuditLog(req, { module: 'Agreements', action: 'Create', recordId: agreement.id, afterValue: agreement }).catch((e) => console.error('Audit log failed:', e));
      res.status(201).json(agreement);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return sendApiError(res, 400, "LEGACY_VALIDATION_FAILED", "Validation failed", error.errors);
      }
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create agreement");
    }
  });

  app.put("/api/agreements/:id", async (req, res) => {
    try {
      const validatedData = updateAgreementSchema.parse(req.body);
      const before = await storage.getAgreement(req.params.id);
      const agreement = await storage.updateAgreement(req.params.id, validatedData);
      if (!agreement) return sendApiError(res, 404, "LEGACY_AGREEMENT_NOT_FOUND", "Agreement not found");
      writeAuditLog(req, { module: 'Agreements', action: 'Update', recordId: req.params.id, beforeValue: before ?? undefined, afterValue: agreement }).catch((e) => console.error('Audit log failed:', e));
      res.json(agreement);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return sendApiError(res, 400, "LEGACY_VALIDATION_FAILED", "Validation failed", error.errors);
      }
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to update agreement");
    }
  });

  // Agreement documents (US-M02-013): list/upload/download versioned files per agreement
  app.get("/api/agreements/:id/documents", async (req, res) => {
    try {
      const agreementId = String(req.params.id ?? "").trim();
      const [ag] = await db.select({ id: agreementsTable.id }).from(agreementsTable).where(eq(agreementsTable.id, agreementId)).limit(1);
      if (!ag) return sendApiError(res, 404, "AGREEMENT_NOT_FOUND", "Agreement not found");
      const rows = await db
        .select()
        .from(agreementDocuments)
        .where(eq(agreementDocuments.agreementId, agreementId))
        .orderBy(desc(agreementDocuments.version));
      return res.json(rows);
    } catch (e) {
      console.error(e);
      return sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch agreement documents");
    }
  });

  app.post("/api/agreements/:id/documents", (req, res) => {
    agreementDocUpload.single("file")(req, res, async (err: unknown) => {
      try {
        if (err && typeof err === "object" && (err as { code?: string }).code === "LIMIT_FILE_SIZE") {
          return sendApiError(res, 400, "AGREEMENT_DOC_TOO_LARGE", "Document must be 5 MB or smaller.");
        }
        if (err) {
          const msg = err instanceof Error ? err.message : "Upload failed";
          return sendApiError(res, 400, "AGREEMENT_DOC_UPLOAD_FAILED", msg);
        }
        const agreementId = String(req.params.id ?? "").trim();
        const [ag] = await db.select({ id: agreementsTable.id }).from(agreementsTable).where(eq(agreementsTable.id, agreementId)).limit(1);
        if (!ag) return sendApiError(res, 404, "AGREEMENT_NOT_FOUND", "Agreement not found");

        const file = (req as unknown as { file?: Express.Multer.File }).file;
        if (!file) return sendApiError(res, 400, "AGREEMENT_DOC_REQUIRED", "Upload file required (field name: file)");

        const ext = extFromAgreementDocumentMime(file.mimetype);
        if (!ext) {
          return sendApiError(res, 400, "AGREEMENT_DOC_TYPE", "Only PDF/JPG/PNG documents are allowed.");
        }

        const maxRow = await db
          .select({ v: sql<number>`COALESCE(MAX(${agreementDocuments.version}), 0)` })
          .from(agreementDocuments)
          .where(eq(agreementDocuments.agreementId, agreementId));
        const nextVersion = Number(maxRow?.[0]?.v ?? 0) + 1;

        const stored = `${nanoid(16)}${ext}`;
        await writeAgreementDocumentBuffer(agreementId, stored, file.buffer);

        const id = nanoid();
        const ts = new Date().toISOString();
        await db.insert(agreementDocuments).values({
          id,
          agreementId,
          version: nextVersion,
          fileName: file.originalname ? String(file.originalname) : stored,
          mimeType: file.mimetype,
          sizeBytes: file.size,
          blobKey: `agreements/${agreementId}/${stored}`,
          uploadedBy: req.user?.id ?? null,
          createdAt: ts,
        });
        const [row] = await db.select().from(agreementDocuments).where(eq(agreementDocuments.id, id)).limit(1);
        writeAuditLog(req, { module: "Agreements", action: "UploadDocument", recordId: id, afterValue: row }).catch((e) =>
          console.error("Audit log failed:", e),
        );
        return res.status(201).json(row);
      } catch (e) {
        console.error(e);
        return sendApiError(res, 500, "INTERNAL_ERROR", "Failed to upload agreement document");
      }
    });
  });

  app.get("/api/agreements/:id/documents/:docId/download", async (req, res) => {
    try {
      const agreementId = String(req.params.id ?? "").trim();
      const docId = String(req.params.docId ?? "").trim();
      const [doc] = await db.select().from(agreementDocuments).where(eq(agreementDocuments.id, docId)).limit(1);
      if (!doc || doc.agreementId !== agreementId) {
        return sendApiError(res, 404, "AGREEMENT_DOC_NOT_FOUND", "Document not found");
      }
      const stored = path.basename(String(doc.blobKey ?? "").replace(/\\/g, "/"));
      if (!isAllowedAgreementDocumentFileName(stored)) {
        return sendApiError(res, 400, "AGREEMENT_DOC_NAME_INVALID", "Invalid stored file name");
      }
      const buf = await readAgreementDocumentBuffer(agreementId, stored);
      if (!buf?.length) {
        return sendApiError(
          res,
          404,
          "AGREEMENT_DOC_MISSING",
          "Document missing on server. Restore the uploads folder that matches this database, or re-upload the file.",
        );
      }
      res.setHeader("Content-Type", contentTypeForAgreementDocument(stored));
      res.setHeader("Cache-Control", "private, max-age=3600");
      const safeName = (doc.fileName ?? stored).replace(/[\r\n"]/g, "_");
      res.setHeader("Content-Disposition", `inline; filename=\"${safeName}\"`);
      return res.send(buf);
    } catch (e) {
      console.error(e);
      return sendApiError(res, 500, "INTERNAL_ERROR", "Failed to download agreement document");
    }
  });

  // Stock Returns
  app.get("/api/stockreturns", async (req, res) => {
    try {
      const stockReturns = await storage.getStockReturns();
      res.json(stockReturns);
    } catch (error) {
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch stock returns");
    }
  });

  const sampleStockReturns = [
    { traderId: "TRD001", traderName: "Ramesh Naik", period: "2026-01", commodity: "Vegetables", openingBalance: 100, locallyProcured: 50, purchasedFromTrader: 20, sales: 120, closingBalance: 50, status: "Submitted" as const },
    { traderId: "TRD001", traderName: "Ramesh Naik", period: "2026-01", commodity: "Fruits", openingBalance: 80, locallyProcured: 40, purchasedFromTrader: 15, sales: 90, closingBalance: 45, status: "Submitted" as const },
    { traderId: "TRD003", traderName: "Santosh Kamat", period: "2026-01", commodity: "Vegetables", openingBalance: 60, locallyProcured: 30, purchasedFromTrader: 10, sales: 70, closingBalance: 30, status: "Submitted" as const },
  ];

  app.post("/api/seed-sample-stock-returns", async (_req, res) => {
    try {
      const existing = await storage.getStockReturns();
      if (existing.length > 0) {
        return res.status(200).json({ message: "Sample data already exists", count: existing.length });
      }
      const created = [];
      for (const sr of sampleStockReturns) {
        const one = await storage.createStockReturn(sr);
        created.push(one);
      }
      res.status(201).json({ message: "Sample stock returns added", created: created.length });
    } catch (error) {
      console.error("Seed sample stock returns error:", error);
      const msg = error instanceof Error ? error.message : "Failed to seed sample data";
      sendApiError(res, 500, "INTERNAL_ERROR", msg);
    }
  });

  app.post("/api/stockreturns", async (req, res) => {
    try {
      const parsed = bulkStockReturnSchema.safeParse(req.body);
      if (!parsed.success) {
        const message = formatStockReturnValidationError(parsed.error);
        return sendApiError(res, 400, "STOCK_RETURN_VALIDATION_FAILED", message, parsed.error.errors);
      }
      const { traderId, traderName, period, entries, status } = parsed.data;
      if (entries.length === 0 && status !== "Draft") {
        return sendApiError(res, 400, "STOCK_RETURN_ENTRIES_REQUIRED", "At least one commodity entry is required to submit");
      }
      const created = [];
      for (const entry of entries) {
        const one = await storage.createStockReturn({
          traderId,
          traderName,
          period,
          commodity: entry.commodity,
          openingBalance: Number(entry.openingBalance) || 0,
          locallyProcured: Number(entry.locallyProcured) || 0,
          purchasedFromTrader: Number(entry.purchasedFromTrader) || 0,
          sales: Number(entry.sales) || 0,
          closingBalance: Number(entry.closingBalance) || 0,
          status,
        });
        created.push(one);
      }
      if (created.length > 0) {
        await storage.createActivityLog({
          action: "Stock Returns Submitted",
          module: "Market Fee",
          user: req.user?.name ?? "System",
          timestamp: new Date().toISOString(),
        });
        writeAuditLog(req, { module: 'Market Fee', action: 'StockReturnsSubmit', recordId: created[0]?.id, afterValue: { count: created.length, ids: created.map((r) => r.id) } }).catch((e) => console.error('Audit log failed:', e));
      }
      res.status(201).json(created);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const message = formatStockReturnValidationError(error);
        return sendApiError(res, 400, "STOCK_RETURN_VALIDATION_FAILED", message, error.errors);
      }
      console.error("POST /api/stockreturns error:", error);
      const message = error instanceof Error ? error.message : "Failed to create stock return";
      sendApiError(res, 500, "INTERNAL_ERROR", message);
    }
  });

  // Activity Logs
  app.get("/api/activity", async (req, res) => {
    try {
      const logs = await storage.getActivityLogs();
      res.json(logs);
    } catch (error) {
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch activity logs");
    }
  });

  // Dashboard Stats
  app.get("/api/stats", async (req, res) => {
    try {
      const traders = await storage.getTraders();
      const invoices = await storage.getInvoices();
      const receipts = await storage.getReceipts();
      
      res.json({
        totalTraders: traders.length,
        activeInvoices: invoices.filter(i => i.status !== 'Paid').length,
        pendingReceipts: invoices.filter(i => i.status === 'Pending').length,
        todaysCollection: receipts.reduce((sum, r) => sum + r.total, 0),
      });
    } catch (error) {
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch stats");
    }
  });

  return httpServer;
}
