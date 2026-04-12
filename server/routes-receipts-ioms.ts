/**
 * IOMS M-05: Receipts Online — central receipt engine.
 * Receipt numbers: GAPLMB/[LOC]/[FY]/[HEAD]/[NNN]
 */
import type { Express, Request } from "express";
import { eq, desc, and, sql, inArray } from "drizzle-orm";
import QRCode from "qrcode";
import { db } from "./db";
import { yards, receiptSequence, iomsReceipts, paymentGatewayLog } from "@shared/db-schema";
import { nanoid } from "nanoid";
import { writeAuditLog } from "./audit";
import { sendApiError } from "./api-errors";
import { tenantLicenceIsGstExempt } from "./gst-exempt";
import { verifyPaymentWebhookHmac } from "./payment-webhook-hmac";

/** Phase 1 (client): in-app cash / cheque (+ DD); electronic gateway later. */
const PHASE1_PAYMENT_MODES = new Set(["Cash", "Cheque", "DD"]);

class ReceiptPaymentModeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReceiptPaymentModeError";
  }
}

function assertPhase1PaymentMode(mode: string): void {
  if (process.env.RECEIPT_ALLOW_ANY_PAYMENT_MODE === "true") return;
  const m = String(mode ?? "").trim();
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
  amount: number;
  cgst?: number;
  sgst?: number;
  paymentMode: string;
  sourceModule?: string;
  sourceRecordId?: string;
  createdBy: string;
}): Promise<{ id: string; receiptNo: string }> {
  assertPhase1PaymentMode(params.paymentMode);
  const totalAmount = params.amount + (params.cgst ?? 0) + (params.sgst ?? 0);
  const receiptNo = await generateNextReceiptNo(params.yardId, params.revenueHead);
  const id = nanoid();
  const now = new Date().toISOString();

  await db.insert(iomsReceipts).values({
    id,
    receiptNo,
    yardId: params.yardId,
    revenueHead: params.revenueHead,
    payerName: params.payerName ?? null,
    payerType: params.payerType ?? null,
    payerRefId: params.payerRefId ?? null,
    amount: params.amount,
    cgst: params.cgst ?? 0,
    sgst: params.sgst ?? 0,
    totalAmount,
    paymentMode: params.paymentMode,
    sourceModule: params.sourceModule ?? null,
    sourceRecordId: params.sourceRecordId ?? null,
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
      res.json(row);
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
        createdBy,
      });
      const [row] = await db.select().from(iomsReceipts).where(eq(iomsReceipts.id, result.id));
      if (row) writeAuditLog(req, { module: "Receipts", action: "Create", recordId: result.id, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.status(201).json(result);
    } catch (e: unknown) {
      if (e instanceof ReceiptPaymentModeError) {
        return sendApiError(res, 400, "RECEIPT_PAYMENT_MODE_INVALID", e.message);
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
      const afterForAudit =
        status === "Reversed"
          ? {
              ...row,
              ...(dishonourReason ? { dishonourReason } : {}),
              rentRecomputationNote: "Pending GAPMB interest formula and rent re-run.",
            }
          : row;
      writeAuditLog(req, {
        module: "Receipts",
        action: status === "Reversed" ? "ChequeDishonour" : "Update",
        recordId: id,
        beforeValue: existing,
        afterValue: afterForAudit,
      }).catch((e) => console.error("Audit log failed:", e));
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

  app.post("/api/ioms/receipts/payments/callback", async (req, res) => {
    try {
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
      if (!["Paid", "Failed", "Reconciled"].includes(status)) {
        return sendApiError(res, 400, "RECEIPT_STATUS_INVALID", "status must be Paid, Failed, or Reconciled");
      }

      const [log] = await db.select().from(paymentGatewayLog).where(eq(paymentGatewayLog.gatewayTxnId, gatewayTxnId)).limit(1);
      if (!log) return sendApiError(res, 404, "PAYMENT_LOG_NOT_FOUND", "Payment log not found");

      const [receipt] = await db.select().from(iomsReceipts).where(eq(iomsReceipts.id, log.receiptId)).limit(1);
      if (!receipt) return sendApiError(res, 404, "RECEIPT_NOT_FOUND", "Receipt not found");
      const scopedIds = req.scopedLocationIds;
      if (scopedIds && scopedIds.length > 0 && !scopedIds.includes(receipt.yardId)) {
        return sendApiError(res, 404, "RECEIPT_NOT_FOUND", "Receipt not found");
      }

      await db
        .update(paymentGatewayLog)
        .set({
          status,
          gatewayResponse: body.gatewayResponse ?? body,
        })
        .where(eq(paymentGatewayLog.id, log.id));

      await db
        .update(iomsReceipts)
        .set({
          status,
          ...(gatewayRef != null && { gatewayRef }),
        })
        .where(eq(iomsReceipts.id, receipt.id));

      const [updatedLog] = await db.select().from(paymentGatewayLog).where(eq(paymentGatewayLog.id, log.id)).limit(1);
      const [updatedReceipt] = await db.select().from(iomsReceipts).where(eq(iomsReceipts.id, receipt.id)).limit(1);
      if (!updatedReceipt) return sendApiError(res, 404, "RECEIPT_NOT_FOUND", "Receipt not found");

      writeAuditLog(req, {
        module: "Receipts",
        action: "PaymentCallback",
        recordId: receipt.id,
        beforeValue: { receipt, paymentGatewayLog: log },
        afterValue: { receipt: updatedReceipt, paymentGatewayLog: updatedLog ?? null },
      }).catch((e) => console.error("Audit log failed:", e));

      res.json(updatedReceipt);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to process callback");
    }
  });
}
