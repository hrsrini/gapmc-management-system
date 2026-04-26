/**
 * IOMS M-05: Receipts Online — central receipt engine.
 * Receipt numbers: GAPLMB/[LOC]/[FY]/[HEAD]/[NNN]
 */
import type { Express, Request } from "express";
import { eq, desc, and, sql, inArray } from "drizzle-orm";
import QRCode from "qrcode";
import { db } from "./db";
import { yards, receiptSequence, iomsReceipts, paymentGatewayLog, rentInvoices } from "@shared/db-schema";
import { buildIomsReceiptPdf } from "./receipt-pdf";
import {
  recordChequeDishonourLedgerForM03Receipt,
  recordRentCollectionForM03Receipt,
} from "./rent-deposit-ledger-from-receipt";
import { nanoid } from "nanoid";
import { getRequestClientIp, writeAuditLog, writeAuditLogSystem } from "./audit";
import { sendApiError } from "./api-errors";
import { tenantLicenceIsGstExempt } from "./gst-exempt";
import { applyPaymentGatewayCallback } from "./payment-gateway-callback";
import { isPaymentWebhookHmacMandatory, verifyPaymentWebhookHmac } from "./payment-webhook-hmac";
import { getMergedSystemConfig, parseSystemConfigNumber } from "./system-config";
import { computeRentArrearsSimpleInterest, rentPeriodMonthEndIso } from "./rent-interest";
import { getM03RentReceiptArrearsDisclosure } from "./rent-receipt-arrears";
import { parseUnifiedEntityId } from "@shared/unified-entity-id";

async function dishonourRecomputationHint(
  existing: typeof iomsReceipts.$inferSelect,
): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  const cfg = await getMergedSystemConfig();
  const rate = parseSystemConfigNumber(cfg, "rent_arrears_interest_percent_per_annum");
  const bankHint = String(cfg.rent_dishonour_bank_charge_hint ?? "").trim();
  const bankChargeInr = parseSystemConfigNumber(cfg, "rent_dishonour_bank_charge_inr");

  if (existing.revenueHead === "Rent" && existing.sourceModule === "M-03" && existing.sourceRecordId) {
    const [inv] = await db
      .select()
      .from(rentInvoices)
      .where(eq(rentInvoices.id, existing.sourceRecordId))
      .limit(1);
    if (!inv) {
      return `Rent receipt reversed; linked invoice ${existing.sourceRecordId} not found. Adjust ledger per finance.`;
    }
    const due = rentPeriodMonthEndIso(inv.periodMonth);
    const principal =
      Number(inv.rentAmount ?? 0) ||
      Number(inv.totalAmount ?? 0) ||
      Number(existing.totalAmount ?? 0);
    if (!due) {
      return `Rent receipt reversed; invoice periodMonth "${inv.periodMonth}" is not YYYY-MM — set due date manually. Principal reference ₹${principal.toFixed(2)}. Adjust deposit / re-bill per finance.`;
    }
    const { days, interest } = computeRentArrearsSimpleInterest({
      principal,
      percentPerAnnum: rate,
      dueDateIso: due,
      asOfDateIso: today,
    });
    let msg = `Rent dishonour: simple interest from invoice period end (${due}) to ${today}: ${days} day(s) at ${rate}% p.a. on ₹${principal.toFixed(2)} (rent base) → approx ₹${interest.toFixed(2)} (ongoing accrual posts to rent deposit ledger via M-03 arrears cron when configured).`;
    if (bankChargeInr > 0) msg += ` Reference bank charge (config): ₹${bankChargeInr.toFixed(2)} (not posted).`;
    if (bankHint) msg += ` ${bankHint}`;
    return msg;
  }

  if (existing.sourceModule === "M-04" && existing.sourceRecordId) {
    return `Receipt reversed; source M-04 record ${existing.sourceRecordId}. Review market fee / arrival and re-bill per yard rules.`;
  }

  return "Receipt reversed; review linked source module records and ledgers per finance.";
}

function allowAuthenticatedPaymentCallbackSimulate(): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  return process.env.PAYMENT_DEV_CALLBACK_ENABLED === "true";
}

/** Phase 1 (client): in-app cash / cheque (+ DD); electronic gateway later. */
const PHASE1_PAYMENT_MODES = new Set(["Cash", "Cheque", "DD"]);

class ReceiptPaymentModeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReceiptPaymentModeError";
  }
}

class ReceiptUnifiedEntityIdError extends Error {
  constructor() {
    super("unifiedEntityId must be TA:<id> | TB:<id> | AH:<id>");
    this.name = "ReceiptUnifiedEntityIdError";
  }
}

function normalizeReceiptUnifiedEntityId(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const t = String(raw).trim();
  if (!t) return null;
  if (!parseUnifiedEntityId(t)) throw new ReceiptUnifiedEntityIdError();
  return t;
}

function assertPhase1PaymentMode(mode: string): void {
  if (process.env.RECEIPT_ALLOW_ANY_PAYMENT_MODE === "true") return;
  const m = String(mode ?? "").trim();
  // Allow Online when gateway initiation is enabled (UAT / Phase-2 prep).
  if (m === "Online" && process.env.PAYMENT_GATEWAY_INIT_ENABLED === "true") return;
  if (!PHASE1_PAYMENT_MODES.has(m)) {
    throw new ReceiptPaymentModeError(`Phase 1: paymentMode must be Cash, Cheque, or DD (got "${m || "empty"}").`);
  }
}

const REVENUE_HEAD_CODES: Record<string, string> = {
  Rent: "RENT",
  GSTInvoice: "GST",
  MarketFee: "MFEE",
  LicenceFee: "LCFEE",
  SecurityDeposit: "SECDEP",
  Miscellaneous: "MISC",
};

function getFinancialYear(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = d.getMonth();
  // April start: FY 2025 = Apr 2025 - Mar 2026
  if (m >= 3) return `${y}-${String(y + 1).slice(-2)}`;
  return `${y - 1}-${String(y).slice(-2)}`;
}

/** Generate next receipt number and increment sequence (atomic). */
export async function generateNextReceiptNo(
  yardId: string,
  revenueHead: string
): Promise<string> {
  const headCode = REVENUE_HEAD_CODES[revenueHead] ?? "MISC";
  const fy = getFinancialYear();

  const [yard] = await db.select({ code: yards.code }).from(yards).where(eq(yards.id, yardId));
  const loc = yard?.code ?? "LOC";

  const nextSeq = await db.transaction(async (tx) => {
    await tx.insert(receiptSequence).values({
      yardId,
      revenueHead,
      financialYear: fy,
      lastSeq: 0,
    }).onConflictDoNothing();
    const [updated] = await tx
      .update(receiptSequence)
      .set({ lastSeq: sql`${receiptSequence.lastSeq} + 1` })
      .where(
        and(
          eq(receiptSequence.yardId, yardId),
          eq(receiptSequence.revenueHead, revenueHead),
          eq(receiptSequence.financialYear, fy)
        )
      )
      .returning({ lastSeq: receiptSequence.lastSeq });
    return updated?.lastSeq ?? 1;
  });

  return `GAPLMB/${loc}/${fy}/${headCode}/${String(nextSeq).padStart(4, "0")}`;
}

/** Internal: create a receipt (called by M-02, M-03, M-04, M-06, M-08). */
export async function createIomsReceipt(params: {
  yardId: string;
  revenueHead: string;
  payerName?: string;
  payerType?: string;
  payerRefId?: string;
  /** FR-AST-014 phase-1: grace period transaction flag (licence expired but within window). */
  isGracePeriod?: boolean;
  amount: number;
  cgst?: number;
  sgst?: number;
  /** M-03 rent: TDS on rent component (194-I), copied from `rent_invoices.tds_amount` when applicable. */
  tdsAmount?: number;
  paymentMode: string;
  sourceModule?: string;
  sourceRecordId?: string;
  /** When set, must be `TA:|TB:|AH:` (M-02 unified entity register). */
  unifiedEntityId?: string | null;
  createdBy: string;
}): Promise<{ id: string; receiptNo: string }> {
  assertPhase1PaymentMode(params.paymentMode);
  const totalAmount = params.amount + (params.cgst ?? 0) + (params.sgst ?? 0);
  const receiptNo = await generateNextReceiptNo(params.yardId, params.revenueHead);
  const id = nanoid();
  const now = new Date().toISOString();
  const unifiedEntityId = normalizeReceiptUnifiedEntityId(params.unifiedEntityId);

  await db.insert(iomsReceipts).values({
    id,
    receiptNo,
    yardId: params.yardId,
    revenueHead: params.revenueHead,
    payerName: params.payerName ?? null,
    payerType: params.payerType ?? null,
    payerRefId: params.payerRefId ?? null,
    isGracePeriod: Boolean(params.isGracePeriod),
    amount: params.amount,
    cgst: params.cgst ?? 0,
    sgst: params.sgst ?? 0,
    totalAmount,
    tdsAmount: Number(params.tdsAmount ?? 0) || 0,
    paymentMode: params.paymentMode,
    sourceModule: params.sourceModule ?? null,
    sourceRecordId: params.sourceRecordId ?? null,
    unifiedEntityId,
    qrCodeUrl: `/api/ioms/receipts/public/qr?receiptNo=${encodeURIComponent(receiptNo)}`,
    pdfUrl: null,
    status: "Pending",
    createdBy: params.createdBy,
    createdAt: now,
  });

  return { id, receiptNo };
}

export function registerReceiptsIomsRoutes(app: Express) {
  // Public PNG QR (embed in UI / print); must stay before /:id and match auth public list
  app.get("/api/ioms/receipts/public/qr", async (req, res) => {
    try {
      const raw = req.query.receiptNo;
      const receiptNo = typeof raw === "string" ? decodeURIComponent(raw.trim()) : "";
      if (!receiptNo) {
        return sendApiError(res, 400, "RECEIPT_QR_NO_REQUIRED", "Query receiptNo is required");
      }
      const [row] = await db
        .select({ receiptNo: iomsReceipts.receiptNo })
        .from(iomsReceipts)
        .where(eq(iomsReceipts.receiptNo, receiptNo))
        .limit(1);
      if (!row) return sendApiError(res, 404, "RECEIPT_VERIFY_NOT_FOUND", "Receipt not found", { receiptNo });

      const base =
        (process.env.PUBLIC_APP_URL && process.env.PUBLIC_APP_URL.replace(/\/$/, "")) ||
        `${req.protocol}://${req.get("host") || "localhost"}`;
      const verifyUrl = `${base}/verify/${encodeURIComponent(receiptNo)}`;

      const png = await QRCode.toBuffer(verifyUrl, { type: "png", margin: 1, width: 240 });
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "public, max-age=300");
      res.send(png);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to generate QR");
    }
  });

  // List IOMS receipts (filter by yard, revenue_head, date range; scoped to user's yards)
  app.get("/api/ioms/receipts", async (req, res) => {
    try {
      const { yardId, revenueHead, from, to, limit = "100" } = req.query;
      const conditions = [];
      const scopedIds = req.scopedLocationIds;
      if (scopedIds && scopedIds.length > 0) {
        conditions.push(inArray(iomsReceipts.yardId, scopedIds));
      }
      if (yardId && typeof yardId === "string") conditions.push(eq(iomsReceipts.yardId, yardId));
      if (revenueHead && typeof revenueHead === "string")
        conditions.push(eq(iomsReceipts.revenueHead, revenueHead));
      if (from && typeof from === "string")
        conditions.push(sql`${iomsReceipts.createdAt} >= ${from}`);
      if (to && typeof to === "string")
        conditions.push(sql`${iomsReceipts.createdAt} <= ${to}`);
      const base = db
        .select()
        .from(iomsReceipts)
        .orderBy(desc(iomsReceipts.createdAt))
        .limit(Math.min(Number(limit) || 100, 500));
      const list = conditions.length > 0 ? await base.where(and(...conditions)) : await base;
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch receipts");
    }
  });

  // US-M05-002: cash-in-hand / deposit dashboard (scoped)
  // Query: yardId (optional), date=YYYY-MM-DD (optional; defaults today)
  app.get("/api/ioms/receipts/dashboard/cash-in-hand", async (req, res) => {
    try {
      const yardId = String(req.query.yardId ?? "").trim();
      const date = String(req.query.date ?? new Date().toISOString().slice(0, 10)).trim(); // YYYY-MM-DD
      const iso = /^\d{4}-\d{2}-\d{2}$/;
      if (!iso.test(date)) return sendApiError(res, 400, "RECEIPT_DASH_DATE", "date must be YYYY-MM-DD");
      const scopedIds = req.scopedLocationIds;
      if (yardId && scopedIds && scopedIds.length > 0 && !scopedIds.includes(yardId)) {
        return sendApiError(res, 403, "RECEIPT_YARD_ACCESS_DENIED", "You do not have access to this yard");
      }

      const conds = [
        inArray(iomsReceipts.status, ["Paid", "Reconciled"]),
        eq(sql`substring(${iomsReceipts.createdAt}, 1, 10)`, date),
      ];
      if (scopedIds && scopedIds.length > 0) conds.push(inArray(iomsReceipts.yardId, scopedIds));
      if (yardId) conds.push(eq(iomsReceipts.yardId, yardId));

      const rows = await db
        .select({
          paymentMode: iomsReceipts.paymentMode,
          revenueHead: iomsReceipts.revenueHead,
          total: sql<number>`coalesce(sum(${iomsReceipts.totalAmount}), 0)`,
          count: sql<number>`count(*)::int`,
        })
        .from(iomsReceipts)
        .where(and(...conds))
        .groupBy(iomsReceipts.paymentMode, iomsReceipts.revenueHead);

      const byMode: Record<string, { total: number; count: number }> = {};
      for (const r of rows) {
        const m = String(r.paymentMode ?? "Unknown");
        byMode[m] = {
          total: Math.round(((byMode[m]?.total ?? 0) + (Number(r.total ?? 0) || 0)) * 100) / 100,
          count: (byMode[m]?.count ?? 0) + (Number(r.count ?? 0) || 0),
        };
      }

      res.json({
        date,
        yardId: yardId || null,
        totalsByMode: byMode,
        rows,
      });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to compute cash-in-hand dashboard");
    }
  });

  // US-M05-007: yearly summary by revenue head (scoped)
  // Query: financialYear=YYYY-YY (optional; defaults current FY)
  app.get("/api/ioms/receipts/summary/yearly", async (req, res) => {
    try {
      const fy = String(req.query.financialYear ?? "").trim();
      const fyNorm = fy && /^\d{4}-\d{2}$/.test(fy) ? fy : null;
      const scopedIds = req.scopedLocationIds;
      const whereParts = [inArray(iomsReceipts.status, ["Paid", "Reconciled"])];
      if (scopedIds && scopedIds.length > 0) whereParts.push(inArray(iomsReceipts.yardId, scopedIds));
      // receiptNo format includes FY segment: GAPLMB/LOC/FY/HEAD/NNNN
      if (fyNorm) whereParts.push(sql`${iomsReceipts.receiptNo} like ${`%/${fyNorm}/%`}`);

      const rows = await db
        .select({
          revenueHead: iomsReceipts.revenueHead,
          total: sql<number>`coalesce(sum(${iomsReceipts.totalAmount}), 0)`,
          count: sql<number>`count(*)::int`,
        })
        .from(iomsReceipts)
        .where(and(...whereParts))
        .groupBy(iomsReceipts.revenueHead)
        .orderBy(iomsReceipts.revenueHead);

      const grandTotal = rows.reduce((s, r) => s + (Number(r.total ?? 0) || 0), 0);
      res.json({
        financialYear: fyNorm,
        count: rows.reduce((s, r) => s + (Number(r.count ?? 0) || 0), 0),
        grandTotal: Math.round(grandTotal * 100) / 100,
        rows: rows.map((r) => ({ ...r, total: Math.round((Number(r.total ?? 0) || 0) * 100) / 100 })),
      });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to compute yearly receipt summary");
    }
  });

  // Public verify by receipt number (no auth) — must be before /:id
  app.get("/api/ioms/receipts/verify/:receiptNo", async (req, res) => {
    try {
      const receiptNo = decodeURIComponent(req.params.receiptNo);
      const [row] = await db
        .select()
        .from(iomsReceipts)
        .where(eq(iomsReceipts.receiptNo, receiptNo));
      if (!row) return sendApiError(res, 404, "RECEIPT_VERIFY_NOT_FOUND", "Receipt not found", { receiptNo });
      res.json({
        receiptNo: row.receiptNo,
        amount: row.amount,
        totalAmount: row.totalAmount,
        revenueHead: row.revenueHead,
        paymentMode: row.paymentMode,
        status: row.status,
        createdAt: row.createdAt,
      });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to verify receipt");
    }
  });

  // Server-generated receipt PDF (auth) — before /:id so "pdf" is not parsed as id
  app.get("/api/ioms/receipts/:id/pdf", async (req, res) => {
    try {
      const copy = String(req.query.copy ?? "").trim().toLowerCase(); // duplicate
      const [row] = await db.select().from(iomsReceipts).where(eq(iomsReceipts.id, req.params.id));
      if (!row) return sendApiError(res, 404, "RECEIPT_NOT_FOUND", "Receipt not found");
      const scopedIds = req.scopedLocationIds;
      if (scopedIds && scopedIds.length > 0 && !scopedIds.includes(row.yardId)) {
        return sendApiError(res, 404, "RECEIPT_NOT_FOUND", "Receipt not found");
      }
      const isDuplicate = copy === "duplicate";
      if (isDuplicate) {
        const roles = req.user?.roles?.map((r) => r.tier) ?? [];
        const allowed = roles.includes("DV") || roles.includes("DA") || roles.includes("ADMIN");
        if (!allowed) {
          return sendApiError(res, 403, "RECEIPT_DUPLICATE_DENIED", "Only DV/DA/Admin can print authorised duplicate receipts.");
        }
      }
      const [yard] = await db.select({ name: yards.name }).from(yards).where(eq(yards.id, row.yardId)).limit(1);
      const verifyBase =
        (process.env.PUBLIC_APP_URL && process.env.PUBLIC_APP_URL.replace(/\/$/, "")) ||
        `${req.protocol}://${req.get("host") || "localhost"}`;
      const arrearsDisclosure = await getM03RentReceiptArrearsDisclosure(row);
      const pdf = await buildIomsReceiptPdf({
        receipt: row,
        yardName: yard?.name ?? null,
        verifyBaseUrl: verifyBase,
        arrearsDisclosure,
        duplicateLabel: isDuplicate ? "DUPLICATE" : null,
      });
      const safeName = row.receiptNo.replace(/[^\w.-]+/g, "_");
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="receipt-${safeName}.pdf"`);
      res.send(pdf);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to generate receipt PDF");
    }
  });

  // Reconciliation: gateway log vs receipts (scoped to user's yards) — MUST be before /:id so "reconciliation" is not captured as an id
  app.get("/api/ioms/receipts/reconciliation", async (req, res) => {
    try {
      const scopedIds = req.scopedLocationIds;
      const receiptWhere = scopedIds && scopedIds.length > 0 ? inArray(iomsReceipts.yardId, scopedIds) : undefined;
      const [gatewayLogs, receipts] = await Promise.all([
        db.select().from(paymentGatewayLog).orderBy(desc(paymentGatewayLog.createdAt)).limit(200),
        receiptWhere
          ? db.select().from(iomsReceipts).where(receiptWhere).orderBy(desc(iomsReceipts.createdAt)).limit(200)
          : db.select().from(iomsReceipts).orderBy(desc(iomsReceipts.createdAt)).limit(200),
      ]);
      const receiptMap = new Map(receipts.map((r) => [r.id, r]));
      const matched: { logId: string; receiptId: string }[] = [];
      const unmatchedLogs: typeof gatewayLogs = [];
      for (const log of gatewayLogs) {
        const rec = receiptMap.get(log.receiptId);
        if (rec && rec.status === "Paid") matched.push({ logId: log.id, receiptId: log.receiptId });
        else unmatchedLogs.push(log);
      }
      res.json({
        gatewayLogCount: gatewayLogs.length,
        receiptCount: receipts.length,
        matched,
        unmatchedLogs: unmatchedLogs.slice(0, 50),
      });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch reconciliation data");
    }
  });

  // Get one receipt by id (scoped to user's yards)
  app.get("/api/ioms/receipts/:id", async (req, res) => {
    try {
      const [row] = await db
        .select()
        .from(iomsReceipts)
        .where(eq(iomsReceipts.id, req.params.id));
      if (!row) return sendApiError(res, 404, "RECEIPT_NOT_FOUND", "Receipt not found");
      const scopedIds = req.scopedLocationIds;
      if (scopedIds && scopedIds.length > 0 && !scopedIds.includes(row.yardId)) {
        return sendApiError(res, 404, "RECEIPT_NOT_FOUND", "Receipt not found");
      }
      const rentArrearsDisclosure = await getM03RentReceiptArrearsDisclosure(row);
      res.json(rentArrearsDisclosure ? { ...row, rentArrearsDisclosure } : row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch receipt");
    }
  });

  // Internal create (for other modules) — require body; yardId must be in user's scope
  app.post("/api/ioms/receipts", async (req, res) => {
    try {
      const body = req.body as Record<string, unknown>;
      const yardId = body.yardId as string;
      const revenueHead = body.revenueHead as string;
      const amount = Number(body.amount);
      if (!yardId || !revenueHead || !Number.isFinite(amount) || amount < 0) {
        return sendApiError(res, 400, "RECEIPT_CREATE_FIELDS_REQUIRED", "yardId, revenueHead, amount (number) required");
      }
      assertPhase1PaymentMode(String(body.paymentMode ?? "Cash"));
      const scopedIds = req.scopedLocationIds;
      if (scopedIds && scopedIds.length > 0 && !scopedIds.includes(yardId)) {
        return sendApiError(res, 403, "RECEIPT_YARD_ACCESS_DENIED", "You do not have access to this yard");
      }
      const createdBy = (req.user?.id as string) ?? (body.createdBy as string) ?? "system";
      const payerType = body.payerType as string | undefined;
      const payerRefId = body.payerRefId as string | undefined;
      let cgst = body.cgst != null ? Number(body.cgst) : undefined;
      let sgst = body.sgst != null ? Number(body.sgst) : undefined;
      if (payerType === "TenantLicence" && payerRefId && (await tenantLicenceIsGstExempt(payerRefId))) {
        cgst = 0;
        sgst = 0;
      }
      let unifiedEntityId: string | null | undefined;
      if (body.unifiedEntityId !== undefined && body.unifiedEntityId !== null && String(body.unifiedEntityId).trim()) {
        const t = String(body.unifiedEntityId).trim();
        if (!parseUnifiedEntityId(t)) {
          return sendApiError(res, 400, "RECEIPT_UNIFIED_ENTITY_ID_INVALID", "unifiedEntityId must be TA:<id> | TB:<id> | AH:<id>");
        }
        unifiedEntityId = t;
      }
      const result = await createIomsReceipt({
        yardId,
        revenueHead,
        payerName: body.payerName as string | undefined,
        payerType,
        payerRefId,
        amount,
        cgst,
        sgst,
        paymentMode: (body.paymentMode as string) ?? "Cash",
        sourceModule: body.sourceModule as string | undefined,
        sourceRecordId: body.sourceRecordId as string | undefined,
        unifiedEntityId,
        createdBy,
      });
      const [row] = await db.select().from(iomsReceipts).where(eq(iomsReceipts.id, result.id));
      if (row) writeAuditLog(req, { module: "Receipts", action: "Create", recordId: result.id, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.status(201).json(result);
    } catch (e: unknown) {
      if (e instanceof ReceiptPaymentModeError) {
        return sendApiError(res, 400, "RECEIPT_PAYMENT_MODE_INVALID", e.message);
      }
      if (e instanceof ReceiptUnifiedEntityIdError) {
        return sendApiError(res, 400, "RECEIPT_UNIFIED_ENTITY_ID_INVALID", e.message);
      }
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create receipt");
    }
  });

  // Mark receipt as Paid (e.g. after gateway callback)
  app.patch("/api/ioms/receipts/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const [existing] = await db.select().from(iomsReceipts).where(eq(iomsReceipts.id, id));
      if (!existing) return sendApiError(res, 404, "RECEIPT_NOT_FOUND", "Receipt not found");
      const scopedIds = req.scopedLocationIds;
      if (scopedIds && scopedIds.length > 0 && !scopedIds.includes(existing.yardId)) {
        return sendApiError(res, 404, "RECEIPT_NOT_FOUND", "Receipt not found");
      }
      const body = req.body as Record<string, unknown>;
      const status = body.status as string;
      const gatewayRef = body.gatewayRef as string | undefined;
      const dishonourReason =
        typeof body.dishonourReason === "string" && body.dishonourReason.trim()
          ? body.dishonourReason.trim()
          : undefined;
      if (status !== "Paid" && status !== "Failed" && status !== "Reconciled" && status !== "Reversed") {
        return sendApiError(
          res,
          400,
          "RECEIPT_STATUS_INVALID",
          "status must be Paid, Failed, Reconciled, or Reversed",
        );
      }
      if (status === "Reversed") {
        const mode = String(existing.paymentMode ?? "");
        if (mode !== "Cheque" && mode !== "DD") {
          return sendApiError(
            res,
            400,
            "RECEIPT_CHEQUE_DISHONOUR_INVALID",
            "Only Cheque or DD receipts can be marked Reversed (dishonour).",
          );
        }
        if (existing.status !== "Paid" && existing.status !== "Reconciled") {
          return sendApiError(
            res,
            400,
            "RECEIPT_CHEQUE_DISHONOUR_INVALID",
            "Receipt must be Paid or Reconciled before dishonour reversal.",
          );
        }
      }
      await db
        .update(iomsReceipts)
        .set({
          status,
          ...(gatewayRef != null && { gatewayRef }),
        })
        .where(eq(iomsReceipts.id, id));
      const [row] = await db.select().from(iomsReceipts).where(eq(iomsReceipts.id, id));
      if (!row) return sendApiError(res, 404, "RECEIPT_NOT_FOUND", "Receipt not found");

      let rentDepositLedgerNotice: string | undefined;
      if (
        (status === "Paid" || status === "Reconciled") &&
        existing.status !== "Paid" &&
        existing.status !== "Reconciled"
      ) {
        const coll = await recordRentCollectionForM03Receipt(row);
        rentDepositLedgerNotice = coll.message;
      }

      // If this receipt settles a rent invoice, mark invoice Paid when fully covered (online or counter receipts).
      if ((status === "Paid" || status === "Reconciled") && row.sourceModule === "M-03" && row.sourceRecordId) {
        const invoiceId = String(row.sourceRecordId);
        const [inv] = await db.select().from(rentInvoices).where(eq(rentInvoices.id, invoiceId)).limit(1);
        if (inv) {
          const allRecs = await db
            .select({ totalAmount: iomsReceipts.totalAmount, status: iomsReceipts.status })
            .from(iomsReceipts)
            .where(and(eq(iomsReceipts.sourceModule, "M-03"), eq(iomsReceipts.sourceRecordId, invoiceId)));
          const paidSum = allRecs
            .filter((r) => String(r.status ?? "") === "Paid" || String(r.status ?? "") === "Reconciled")
            .reduce((s, r) => s + Number(r.totalAmount ?? 0), 0);
          const total = Number(inv.totalAmount ?? 0);
          if (paidSum >= total - 0.01 && String(inv.status ?? "") !== "Paid") {
            await db.update(rentInvoices).set({ status: "Paid" }).where(eq(rentInvoices.id, invoiceId));
          }
        }
      }

      let rentRecomputationNote: string | undefined;
      if (status === "Reversed") {
        const ledgerRes = await recordChequeDishonourLedgerForM03Receipt(existing);
        const hint = await dishonourRecomputationHint(existing);
        rentRecomputationNote = [hint, ledgerRes.message].filter(Boolean).join(" ");
      }

      const afterForAudit =
        status === "Reversed"
          ? {
              ...row,
              ...(dishonourReason ? { dishonourReason } : {}),
              ...(rentRecomputationNote ? { rentRecomputationNote } : {}),
            }
          : row;
      writeAuditLog(req, {
        module: "Receipts",
        action: status === "Reversed" ? "ChequeDishonour" : "Update",
        recordId: id,
        beforeValue: existing,
        afterValue: afterForAudit,
      }).catch((e) => console.error("Audit log failed:", e));
      if (status === "Reversed" && rentRecomputationNote) {
        const cfg = await getMergedSystemConfig();
        const bankChargeInr = parseSystemConfigNumber(cfg, "rent_dishonour_bank_charge_inr");
        const bankHint = String(cfg.rent_dishonour_bank_charge_hint ?? "").trim();
        const voucherCreateQuery =
          existing.revenueHead === "Rent" &&
          existing.sourceModule === "M-03" &&
          bankChargeInr > 0 &&
          row.yardId
            ? new URLSearchParams({
                yardId: row.yardId,
                amount: String(bankChargeInr),
                voucherType: "OperationalExpense",
                description: `Bank charge reference after rent receipt dishonour (${row.receiptNo ?? id}); post per finance.`,
              }).toString()
            : "";
        return res.json({
          ...row,
          dishonourReason: dishonourReason ?? null,
          rentRecomputationNote,
          rentDishonourScaffold:
            existing.revenueHead === "Rent" && existing.sourceModule === "M-03"
              ? {
                  bankChargeInr: bankChargeInr > 0 ? bankChargeInr : null,
                  bankChargeHint: bankHint || null,
                  voucherCreateHref: voucherCreateQuery ? `/vouchers/create?${voucherCreateQuery}` : null,
                }
              : undefined,
        });
      }
      if (rentDepositLedgerNotice) {
        return res.json({ ...row, rentDepositLedgerNotice });
      }
      res.json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to update receipt");
    }
  });

  // ----- Payment-gateway simulation (auth-protected) -----
  // Real provider webhooks can be wired later; for now this creates a gateway log and allows marking success/failure.
  app.post("/api/ioms/receipts/:id/payments/initiate", async (req, res) => {
    try {
      if (process.env.PAYMENT_GATEWAY_INIT_ENABLED !== "true") {
        return sendApiError(
          res,
          403,
          "RECEIPT_GATEWAY_DISABLED",
          "Phase 1: record payments as Cash, Cheque, or DD. Electronic payment initiation is disabled until the gateway is enabled (set PAYMENT_GATEWAY_INIT_ENABLED=true).",
        );
      }
      const receiptId = req.params.id;
      const { gateway } = (req.body ?? {}) as Record<string, unknown>;

      const [receipt] = await db.select().from(iomsReceipts).where(eq(iomsReceipts.id, receiptId)).limit(1);
      if (!receipt) return sendApiError(res, 404, "RECEIPT_NOT_FOUND", "Receipt not found");
      const scopedIds = req.scopedLocationIds;
      if (scopedIds && scopedIds.length > 0 && !scopedIds.includes(receipt.yardId)) {
        return sendApiError(res, 404, "RECEIPT_NOT_FOUND", "Receipt not found");
      }

      const gatewayTxnId = nanoid();
      const now = new Date().toISOString();
      await db.insert(paymentGatewayLog).values({
        id: nanoid(),
        receiptId: receipt.id,
        gateway: String(gateway ?? "MockGateway"),
        gatewayTxnId,
        status: "Initiated",
        amount: receipt.totalAmount,
        gatewayResponse: null,
        createdAt: now,
      });

      writeAuditLog(req, {
        module: "Receipts",
        action: "PaymentInitiated",
        recordId: receipt.id,
        afterValue: { receiptId: receipt.id, gateway: String(gateway ?? "MockGateway"), gatewayTxnId },
      }).catch((e) => console.error("Audit log failed:", e));

      res.status(201).json({ gatewayTxnId });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to initiate payment");
    }
  });

  /** UAT: complete mock payment without HMAC (session auth). Production only if PAYMENT_DEV_CALLBACK_ENABLED=true. */
  app.post("/api/ioms/receipts/:id/payments/dev-simulate-callback", async (req, res) => {
    try {
      if (process.env.PAYMENT_GATEWAY_INIT_ENABLED !== "true") {
        return sendApiError(
          res,
          403,
          "RECEIPT_GATEWAY_DISABLED",
          "Phase 1: electronic payment initiation is disabled until the gateway is enabled (set PAYMENT_GATEWAY_INIT_ENABLED=true).",
        );
      }
      if (!allowAuthenticatedPaymentCallbackSimulate()) {
        return sendApiError(
          res,
          403,
          "PAYMENT_DEV_CALLBACK_DISABLED",
          "Authenticated payment simulate is not allowed in production unless PAYMENT_DEV_CALLBACK_ENABLED=true.",
        );
      }
      const receiptId = req.params.id;
      const body = (req.body ?? {}) as Record<string, unknown>;
      const gatewayTxnId = body.gatewayTxnId != null ? String(body.gatewayTxnId) : "";
      const status = body.status != null ? String(body.status) : "";
      const gatewayRef = body.gatewayRef != null ? String(body.gatewayRef) : undefined;
      if (!gatewayTxnId || !status) {
        return sendApiError(res, 400, "RECEIPT_CALLBACK_FIELDS_REQUIRED", "gatewayTxnId and status are required");
      }

      const result = await applyPaymentGatewayCallback({
        gatewayTxnId,
        status,
        gatewayRef,
        rawBody: body,
        scopedLocationIds: req.scopedLocationIds,
        expectedReceiptId: receiptId,
      });
      if (!result.ok) {
        return sendApiError(res, result.httpStatus, result.code, result.message);
      }

      writeAuditLog(req, {
        module: "Receipts",
        action: "PaymentCallbackSimulated",
        recordId: result.receiptId,
        beforeValue: { receipt: result.receiptBefore, paymentGatewayLog: result.logBefore },
        afterValue: {
          receipt: result.receiptAfter,
          paymentGatewayLog: result.logAfter,
          gatewayTxnId: result.gatewayTxnId,
          status: result.status,
        },
      }).catch((e) => console.error("Audit log failed:", e));

      res.json(result.receiptAfter);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to simulate payment callback");
    }
  });

  app.post("/api/ioms/receipts/payments/callback", async (req, res) => {
    try {
      if (isPaymentWebhookHmacMandatory() && !process.env.PAYMENT_WEBHOOK_HMAC_SECRET?.trim()) {
        return sendApiError(
          res,
          503,
          "PAYMENT_WEBHOOK_HMAC_NOT_CONFIGURED",
          "PAYMENT_WEBHOOK_REQUIRE_HMAC is true but PAYMENT_WEBHOOK_HMAC_SECRET is not set.",
        );
      }
      const hmac = verifyPaymentWebhookHmac(req as Request & { rawBody?: Buffer });
      if (!hmac.ok) {
        return sendApiError(res, 401, "PAYMENT_WEBHOOK_HMAC_INVALID", hmac.reason);
      }
      const body = req.body as Record<string, unknown>;
      const gatewayTxnId = body.gatewayTxnId ? String(body.gatewayTxnId) : null;
      const status = body.status ? String(body.status) : null; // Paid | Failed | Reconciled
      const gatewayRef = body.gatewayRef ? String(body.gatewayRef) : undefined;

      if (!gatewayTxnId || !status) {
        return sendApiError(res, 400, "RECEIPT_CALLBACK_FIELDS_REQUIRED", "gatewayTxnId and status are required");
      }

      const result = await applyPaymentGatewayCallback({
        gatewayTxnId,
        status,
        gatewayRef,
        rawBody: body,
        scopedLocationIds: req.scopedLocationIds,
      });
      if (!result.ok) {
        return sendApiError(res, result.httpStatus, result.code, result.message);
      }

      writeAuditLogSystem(
        {
          module: "Receipts",
          action: "PaymentCallback",
          recordId: result.receiptId,
          beforeValue: { receipt: result.receiptBefore, paymentGatewayLog: result.logBefore },
          afterValue: {
            receipt: result.receiptAfter,
            paymentGatewayLog: result.logAfter,
            actor: "payment_webhook",
            gatewayTxnId: result.gatewayTxnId,
            status: result.status,
          },
        },
        { ip: getRequestClientIp(req) },
      ).catch((e) => console.error("Audit log failed:", e));

      res.json(result.receiptAfter);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to process callback");
    }
  });
}
