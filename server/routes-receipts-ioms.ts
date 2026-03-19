/**
 * IOMS M-05: Receipts Online — central receipt engine.
 * Receipt numbers: GAPLMB/[LOC]/[FY]/[HEAD]/[NNN]
 */
import type { Express } from "express";
import { eq, desc, and, sql, inArray } from "drizzle-orm";
import { db } from "./db";
import { yards, receiptSequence, iomsReceipts, paymentGatewayLog } from "@shared/db-schema";
import { nanoid } from "nanoid";
import { writeAuditLog } from "./audit";

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
    // Legacy compatibility: UI can use QR image URLs if present, while current QR is generated client-side.
    qrCodeUrl: `/verify/${encodeURIComponent(receiptNo)}`,
    pdfUrl: null,
    status: "Pending",
    createdBy: params.createdBy,
    createdAt: now,
  });

  return { id, receiptNo };
}

export function registerReceiptsIomsRoutes(app: Express) {
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
      res.status(500).json({ error: "Failed to fetch receipts" });
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
      if (!row)
        return res.status(404).json({ error: "Receipt not found", receiptNo });
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
      res.status(500).json({ error: "Failed to verify receipt" });
    }
  });

  // Get one receipt by id (scoped to user's yards)
  app.get("/api/ioms/receipts/:id", async (req, res) => {
    try {
      const [row] = await db
        .select()
        .from(iomsReceipts)
        .where(eq(iomsReceipts.id, req.params.id));
      if (!row) return res.status(404).json({ error: "Receipt not found" });
      const scopedIds = req.scopedLocationIds;
      if (scopedIds && scopedIds.length > 0 && !scopedIds.includes(row.yardId)) {
        return res.status(404).json({ error: "Receipt not found" });
      }
      res.json(row);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to fetch receipt" });
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
        return res.status(400).json({
          error: "yardId, revenueHead, amount (number) required",
        });
      }
      const scopedIds = req.scopedLocationIds;
      if (scopedIds && scopedIds.length > 0 && !scopedIds.includes(yardId)) {
        return res.status(403).json({ error: "You do not have access to this yard" });
      }
      const createdBy = (req.user?.id as string) ?? (body.createdBy as string) ?? "system";
      const result = await createIomsReceipt({
        yardId,
        revenueHead,
        payerName: body.payerName as string | undefined,
        payerType: body.payerType as string | undefined,
        payerRefId: body.payerRefId as string | undefined,
        amount,
        cgst: body.cgst != null ? Number(body.cgst) : undefined,
        sgst: body.sgst != null ? Number(body.sgst) : undefined,
        paymentMode: (body.paymentMode as string) ?? "Cash",
        sourceModule: body.sourceModule as string | undefined,
        sourceRecordId: body.sourceRecordId as string | undefined,
        createdBy,
      });
      const [row] = await db.select().from(iomsReceipts).where(eq(iomsReceipts.id, result.id));
      if (row) writeAuditLog(req, { module: "Receipts", action: "Create", recordId: result.id, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.status(201).json(result);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to create receipt" });
    }
  });

  // Mark receipt as Paid (e.g. after gateway callback)
  app.patch("/api/ioms/receipts/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const [existing] = await db.select().from(iomsReceipts).where(eq(iomsReceipts.id, id));
      if (!existing) return res.status(404).json({ error: "Receipt not found" });
      const scopedIds = req.scopedLocationIds;
      if (scopedIds && scopedIds.length > 0 && !scopedIds.includes(existing.yardId)) {
        return res.status(404).json({ error: "Receipt not found" });
      }
      const body = req.body as Record<string, unknown>;
      const status = body.status as string;
      const gatewayRef = body.gatewayRef as string | undefined;
      if (status !== "Paid" && status !== "Failed" && status !== "Reconciled") {
        return res.status(400).json({ error: "status must be Paid, Failed, or Reconciled" });
      }
      await db
        .update(iomsReceipts)
        .set({
          status,
          ...(gatewayRef != null && { gatewayRef }),
        })
        .where(eq(iomsReceipts.id, id));
      const [row] = await db.select().from(iomsReceipts).where(eq(iomsReceipts.id, id));
      if (!row) return res.status(404).json({ error: "Receipt not found" });
      writeAuditLog(req, { module: "Receipts", action: "Update", recordId: id, beforeValue: existing, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.json(row);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to update receipt" });
    }
  });

  // ----- Payment-gateway simulation (auth-protected) -----
  // Real provider webhooks can be wired later; for now this creates a gateway log and allows marking success/failure.
  app.post("/api/ioms/receipts/:id/payments/initiate", async (req, res) => {
    try {
      const receiptId = req.params.id;
      const { gateway } = (req.body ?? {}) as Record<string, unknown>;

      const [receipt] = await db.select().from(iomsReceipts).where(eq(iomsReceipts.id, receiptId)).limit(1);
      if (!receipt) return res.status(404).json({ error: "Receipt not found" });
      const scopedIds = req.scopedLocationIds;
      if (scopedIds && scopedIds.length > 0 && !scopedIds.includes(receipt.yardId)) {
        return res.status(404).json({ error: "Receipt not found" });
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
      res.status(500).json({ error: "Failed to initiate payment" });
    }
  });

  app.post("/api/ioms/receipts/payments/callback", async (req, res) => {
    try {
      const body = req.body as Record<string, unknown>;
      const gatewayTxnId = body.gatewayTxnId ? String(body.gatewayTxnId) : null;
      const status = body.status ? String(body.status) : null; // Paid | Failed | Reconciled
      const gatewayRef = body.gatewayRef ? String(body.gatewayRef) : undefined;

      if (!gatewayTxnId || !status) {
        return res.status(400).json({ error: "gatewayTxnId and status are required" });
      }
      if (!["Paid", "Failed", "Reconciled"].includes(status)) {
        return res.status(400).json({ error: "status must be Paid, Failed, or Reconciled" });
      }

      const [log] = await db.select().from(paymentGatewayLog).where(eq(paymentGatewayLog.gatewayTxnId, gatewayTxnId)).limit(1);
      if (!log) return res.status(404).json({ error: "Payment log not found" });

      const [receipt] = await db.select().from(iomsReceipts).where(eq(iomsReceipts.id, log.receiptId)).limit(1);
      if (!receipt) return res.status(404).json({ error: "Receipt not found" });
      const scopedIds = req.scopedLocationIds;
      if (scopedIds && scopedIds.length > 0 && !scopedIds.includes(receipt.yardId)) {
        return res.status(404).json({ error: "Receipt not found" });
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

      const [updatedReceipt] = await db.select().from(iomsReceipts).where(eq(iomsReceipts.id, receipt.id)).limit(1);
      if (!updatedReceipt) return res.status(404).json({ error: "Receipt not found" });

      writeAuditLog(req, {
        module: "Receipts",
        action: "PaymentCallback",
        recordId: receipt.id,
        beforeValue: receipt,
        afterValue: updatedReceipt,
      }).catch((e) => console.error("Audit log failed:", e));

      res.json(updatedReceipt);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to process callback" });
    }
  });

  // Reconciliation: gateway log vs receipts (scoped to user's yards)
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
        matched: matched.length,
        unmatchedLogs: unmatchedLogs.slice(0, 50),
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to fetch reconciliation data" });
    }
  });
}
