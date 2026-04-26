/**
 * IOMS M-04: Market Fee & Commodities API routes.
 * Tables: commodities, market_fee_rates, farmers, purchase_transactions,
 * check_post_inward, check_post_inward_commodities, check_post_outward, exit_permits, check_post_bank_deposits.
 * Does not touch existing gapmc.market_fees (live table).
 */
import type { Express, Response } from "express";
import { eq, desc, and, or, inArray, sql, gte, lte, lt, isNull } from "drizzle-orm";
import { db } from "./db";
import {
  commodities,
  marketFeeRates,
  farmers,
  purchaseTransactions,
  marketMonthlyReturns,
  marketMonthlyReturnLines,
  checkPostInward,
  checkPostInwardCommodities,
  checkPostOutward,
  exitPermits,
  checkPostBankDeposits,
  traderLicences,
  iomsReceipts,
  yards,
  marketReturnAckSequence,
  marketDailyPrices,
  marketFeeLedger,
  marketCommodityReportSnapshots,
} from "@shared/db-schema";
import { nanoid } from "nanoid";
import {
  canCreatePurchaseTransaction,
  canEditDraftPurchaseTransaction,
  canTransitionPurchaseTransaction,
  canVerifyCheckPostInward,
  assertSegregationDoDvDa,
} from "./workflow";
import { writeAuditLog } from "./audit";
import { sendApiError } from "./api-errors";
import { HrEmployeeRuleError, normalizeAadhaarMasked, normalizeMobile10 } from "./hr-employee-rules";
import { validateDvReturnToDraft } from "@shared/workflow-rejection";
import { createIomsReceipt } from "./routes-receipts-ioms";
import { unifiedEntityIdFromTrackA } from "@shared/unified-entity-id";
import { getMergedSystemConfig, parseSystemConfigNumber } from "./system-config";
import {
  assertIsoTransactionDate,
  marketFeePercentMatchesResolved,
  resolveMarketFeePercentForPurchase,
} from "./market-fee-resolve";
import { buildMarketReturnPdf } from "./market-return-pdf";

function sendHrRule(res: Response, e: unknown): boolean {
  if (e instanceof HrEmployeeRuleError) {
    sendApiError(res, 400, e.code, e.message);
    return true;
  }
  return false;
}

export function registerMarketIomsRoutes(app: Express) {
  const isScopedCheckPost = (req: { scopedLocationIds?: string[] }, checkPostId: string) => {
    const scopedIds = req.scopedLocationIds;
    if (!checkPostId) return false;
    if (!scopedIds || scopedIds.length === 0) return true;
    return scopedIds.includes(checkPostId);
  };

  const isValidStatus = (value: string, allowed: string[]) => allowed.includes(value);
  const nowIso = () => new Date().toISOString();

  async function evaluateMarketFeeLicenceWindow(args: {
    licenceValidToIso: string | null | undefined;
    transactionDateIso: string;
  }): Promise<{ ok: true; isGrace: boolean; warning: string | null } | { ok: false; code: string; message: string }> {
    const vt = String(args.licenceValidToIso ?? "").trim();
    const iso = /^\d{4}-\d{2}-\d{2}$/;
    const tx = String(args.transactionDateIso ?? "").trim();
    if (!vt || !iso.test(vt) || !iso.test(tx)) return { ok: true, isGrace: false, warning: null };
    if (tx <= vt) return { ok: true, isGrace: false, warning: null };

    const cfg = await getMergedSystemConfig();
    const windowEnd = String(cfg.market_transaction_window_end_iso ?? "").trim();
    if (!iso.test(windowEnd)) {
      return { ok: false, code: "E-AST-002", message: "Licence expired; transaction blocked until renewal is approved." };
    }
    if (tx <= windowEnd) {
      return { ok: true, isGrace: true, warning: `Licence expired on ${vt}. Renewal required before ${windowEnd}.` };
    }
    return { ok: false, code: "E-AST-002", message: "Licence expired; transaction blocked until renewal is approved." };
  }

  function isValidMonthPeriod(p: string): boolean {
    return /^\d{4}-\d{2}$/.test(p);
  }

  function monthToRange(periodYm: string): { from: string; to: string } {
    const [y, m] = periodYm.split("-").map((x) => parseInt(x, 10));
    const start = new Date(Date.UTC(y, m - 1, 1, 12, 0, 0));
    const end = new Date(Date.UTC(y, m, 1, 12, 0, 0)); // next month
    return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
  }

  function deadlineIsoForPeriod(periodYm: string, deadlineDay: number): string {
    const [yStr, mStr] = periodYm.split("-");
    const y = parseInt(yStr, 10);
    const m = parseInt(mStr, 10);
    const d = Math.min(28, Math.max(1, Math.trunc(deadlineDay || 7)));
    // Deadline is day `d` of following month.
    const dt = new Date(Date.UTC(y, m, d, 12, 0, 0)); // m is 1-based; Date.UTC month is 0-based; y,m -> next month
    return dt.toISOString().slice(0, 10);
  }

  function daysLateForSubmission(deadlineIso: string, submittedAtIso: string): number {
    const d0 = new Date(`${deadlineIso}T12:00:00.000Z`).getTime();
    const d1 = new Date(`${String(submittedAtIso).slice(0, 10)}T12:00:00.000Z`).getTime();
    const diff = Math.floor((d1 - d0) / 86400000);
    return diff > 0 ? diff : 0;
  }

  async function allocateMarketReturnAckRef(params: { yardId: string; period: string }): Promise<string> {
    // SRS example: GAPLMB/MG/2026/01/E1234/00001
    // Implemented format (yard code-based): GAPLMB/{YARD_CODE}/{YYYY}/{MM}/E/{NNNNN}
    const { yardId, period } = params;
    const [yStr, mStr] = period.split("-");
    const year = parseInt(yStr, 10);
    const mm = mStr;
    const [yard] = await db.select({ code: yards.code }).from(yards).where(eq(yards.id, yardId)).limit(1);
    const yardCode = (yard?.code ?? yardId).replace(/[^\w-]+/g, "").toUpperCase();

    // Atomic increment per yard+year.
    const existing = await db
      .select()
      .from(marketReturnAckSequence)
      .where(and(eq(marketReturnAckSequence.yardId, yardId), eq(marketReturnAckSequence.year, year)))
      .limit(1);
    if (existing.length === 0) {
      await db.insert(marketReturnAckSequence).values({ yardId, year, lastSeq: 0 });
    }
    await db
      .update(marketReturnAckSequence)
      .set({ lastSeq: sql`${marketReturnAckSequence.lastSeq} + 1` })
      .where(and(eq(marketReturnAckSequence.yardId, yardId), eq(marketReturnAckSequence.year, year)));
    const [row] = await db
      .select({ lastSeq: marketReturnAckSequence.lastSeq })
      .from(marketReturnAckSequence)
      .where(and(eq(marketReturnAckSequence.yardId, yardId), eq(marketReturnAckSequence.year, year)))
      .limit(1);
    const n = row?.lastSeq ?? 1;
    const seq = String(n).padStart(5, "0");
    return `GAPLMB/${yardCode}/${year}/${mm}/E/${seq}`;
  }

  function monthToExclusiveEnd(periodYm: string): string {
    // exclusive upper bound (YYYY-MM-01 of next month)
    return monthToRange(periodYm).to;
  }

  async function buildReturnPreview(args: {
    traderLicenceId: string;
    period: string; // YYYY-MM
  }): Promise<
    Array<{
      commodityId: string;
      openingQty: number;
      purchaseQty: number;
      purchaseValueInr: number;
      salesQty: number;
      closingQty: number;
    }>
  > {
    const { traderLicenceId, period } = args;
    const { from, to } = monthToRange(period);

    // Aggregate from Approved yard transactions (purchase_transactions).
    const purchaseAgg = await db
      .select({
        commodityId: purchaseTransactions.commodityId,
        purchaseQty: sql<number>`sum(${purchaseTransactions.quantity})`,
        purchaseValueInr: sql<number>`sum(${purchaseTransactions.declaredValue})`,
      })
      .from(purchaseTransactions)
      .where(
        and(
          eq(purchaseTransactions.traderLicenceId, traderLicenceId),
          eq(purchaseTransactions.status, "Approved"),
          gte(purchaseTransactions.transactionDate, from),
          lt(purchaseTransactions.transactionDate, to),
        ),
      )
      .groupBy(purchaseTransactions.commodityId);

    // Aggregate from Verified checkpost inward commodity lines (qty/value).
    const inwardAgg = await db
      .select({
        commodityId: checkPostInwardCommodities.commodityId,
        purchaseQty: sql<number>`sum(${checkPostInwardCommodities.quantity})`,
        purchaseValueInr: sql<number>`sum(${checkPostInwardCommodities.value})`,
      })
      .from(checkPostInwardCommodities)
      .innerJoin(checkPostInward, eq(checkPostInwardCommodities.inwardId, checkPostInward.id))
      .where(
        and(
          eq(checkPostInward.traderLicenceId, traderLicenceId),
          eq(checkPostInward.status, "Verified"),
          gte(checkPostInward.entryDate, from),
          lt(checkPostInward.entryDate, to),
        ),
      )
      .groupBy(checkPostInwardCommodities.commodityId);

    const merged = new Map<string, { qty: number; val: number }>();
    for (const r of purchaseAgg) {
      const k = String(r.commodityId);
      merged.set(k, {
        qty: Number(r.purchaseQty ?? 0) || 0,
        val: Number(r.purchaseValueInr ?? 0) || 0,
      });
    }
    for (const r of inwardAgg) {
      const k = String(r.commodityId);
      const prev = merged.get(k) ?? { qty: 0, val: 0 };
      merged.set(k, {
        qty: prev.qty + (Number(r.purchaseQty ?? 0) || 0),
        val: prev.val + (Number(r.purchaseValueInr ?? 0) || 0),
      });
    }

    // Opening balances: take latest submitted/approved return prior to this period.
    const prior = await db
      .select({
        period: marketMonthlyReturns.period,
        commodityId: marketMonthlyReturnLines.commodityId,
        closingQty: marketMonthlyReturnLines.closingQty,
      })
      .from(marketMonthlyReturns)
      .innerJoin(marketMonthlyReturnLines, eq(marketMonthlyReturnLines.returnId, marketMonthlyReturns.id))
      .where(
        and(
          eq(marketMonthlyReturns.traderLicenceId, traderLicenceId),
          inArray(marketMonthlyReturns.status, ["Submitted", "Verified", "Approved"]),
          lt(marketMonthlyReturns.period, period),
        ),
      )
      .orderBy(desc(marketMonthlyReturns.period));

    const openingByCommodity = new Map<string, number>();
    for (const r of prior) {
      const k = String(r.commodityId);
      if (openingByCommodity.has(k)) continue; // first row per commodity is latest due to orderBy period desc
      openingByCommodity.set(k, Number(r.closingQty ?? 0) || 0);
    }

    const out: Array<{
      commodityId: string;
      openingQty: number;
      purchaseQty: number;
      purchaseValueInr: number;
      salesQty: number;
      closingQty: number;
    }> = [];
    for (const [commodityId, v] of Array.from(merged.entries())) {
      const openingQty = openingByCommodity.get(commodityId) ?? 0;
      const salesQty = 0;
      const closingQty = openingQty + v.qty - salesQty;
      out.push({
        commodityId,
        openingQty,
        purchaseQty: v.qty,
        purchaseValueInr: v.val,
        salesQty,
        closingQty,
      });
    }
    return out.sort((a, b) => a.commodityId.localeCompare(b.commodityId));
  }

  // ----- Consolidated fee statement (US-M04-011) -----
  app.get("/api/ioms/market/fee-statement", async (req, res) => {
    try {
      const traderLicenceId = String(req.query.traderLicenceId ?? "").trim();
      const toPeriod = String(req.query.toPeriod ?? "").trim(); // YYYY-MM
      if (!traderLicenceId || !toPeriod) {
        return sendApiError(res, 400, "MKT_STATEMENT_FIELDS", "traderLicenceId and toPeriod (YYYY-MM) are required");
      }
      if (!isValidMonthPeriod(toPeriod)) {
        return sendApiError(res, 400, "MKT_STATEMENT_PERIOD", "toPeriod must be YYYY-MM");
      }
      const scopedIds = req.scopedLocationIds;
      const [lic] = await db.select().from(traderLicences).where(eq(traderLicences.id, traderLicenceId)).limit(1);
      if (!lic) return sendApiError(res, 404, "LICENCE_NOT_FOUND", "Trader licence not found");
      if (scopedIds && scopedIds.length > 0 && !scopedIds.includes(lic.yardId)) {
        return sendApiError(res, 404, "LICENCE_NOT_FOUND", "Trader licence not found");
      }

      const endExclusive = monthToExclusiveEnd(toPeriod);

      // Payable = sum of Approved purchase transaction market fee amounts (includes Adjustment rows which are negative).
      const payableRows = await db
        .select({
          sumFee: sql<number>`sum(${purchaseTransactions.marketFeeAmount})`,
        })
        .from(purchaseTransactions)
        .where(
          and(
            eq(purchaseTransactions.traderLicenceId, traderLicenceId),
            eq(purchaseTransactions.status, "Approved"),
            lt(purchaseTransactions.transactionDate, endExclusive),
          ),
        );
      const totalPayable = Number(payableRows?.[0]?.sumFee ?? 0) || 0;

      // Paid = sum of Paid/Reconciled receipts for MarketFee payer=trader licence (createdAt date <= endExclusive).
      const paidRows = await db
        .select({
          sumPaid: sql<number>`sum(${iomsReceipts.totalAmount})`,
        })
        .from(iomsReceipts)
        .where(
          and(
            eq(iomsReceipts.revenueHead, "MarketFee"),
            eq(iomsReceipts.payerType, "TraderLicence"),
            eq(iomsReceipts.payerRefId, traderLicenceId),
            inArray(iomsReceipts.status, ["Paid", "Reconciled"]),
            lt(sql`substring(${iomsReceipts.createdAt}, 1, 10)`, endExclusive),
          ),
        );
      const totalPaid = Number(paidRows?.[0]?.sumPaid ?? 0) || 0;

      const outstanding = Math.max(0, Math.round((totalPayable - totalPaid) * 100) / 100);

      res.json({
        traderLicenceId,
        toPeriod,
        totalPayable,
        totalPaid,
        outstanding,
        note:
          "Phase-1 statement: payable is derived from Approved yard transactions (purchase_transactions). Checkpost inward commodity fees are not yet rolled into this statement unless they are billed via a MarketFee receipt.",
      });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to compute market fee statement");
    }
  });

  app.post("/api/ioms/market/fee-statement/pay", async (req, res) => {
    try {
      const body = req.body as Record<string, unknown>;
      const traderLicenceId = String(body.traderLicenceId ?? "").trim();
      const toPeriod = String(body.toPeriod ?? "").trim();
      if (!traderLicenceId || !toPeriod) {
        return sendApiError(res, 400, "MKT_STATEMENT_FIELDS", "traderLicenceId and toPeriod (YYYY-MM) are required");
      }
      if (!isValidMonthPeriod(toPeriod)) {
        return sendApiError(res, 400, "MKT_STATEMENT_PERIOD", "toPeriod must be YYYY-MM");
      }
      const scopedIds = req.scopedLocationIds;
      const [lic] = await db.select().from(traderLicences).where(eq(traderLicences.id, traderLicenceId)).limit(1);
      if (!lic) return sendApiError(res, 404, "LICENCE_NOT_FOUND", "Trader licence not found");
      if (scopedIds && scopedIds.length > 0 && !scopedIds.includes(lic.yardId)) {
        return sendApiError(res, 404, "LICENCE_NOT_FOUND", "Trader licence not found");
      }

      // Recompute outstanding server-side (idempotent key per trader+period).
      const endExclusive = monthToExclusiveEnd(toPeriod);
      const payableRows = await db
        .select({ sumFee: sql<number>`sum(${purchaseTransactions.marketFeeAmount})` })
        .from(purchaseTransactions)
        .where(
          and(
            eq(purchaseTransactions.traderLicenceId, traderLicenceId),
            eq(purchaseTransactions.status, "Approved"),
            lt(purchaseTransactions.transactionDate, endExclusive),
          ),
        );
      const totalPayable = Number(payableRows?.[0]?.sumFee ?? 0) || 0;
      const paidRows = await db
        .select({ sumPaid: sql<number>`sum(${iomsReceipts.totalAmount})` })
        .from(iomsReceipts)
        .where(
          and(
            eq(iomsReceipts.revenueHead, "MarketFee"),
            eq(iomsReceipts.payerType, "TraderLicence"),
            eq(iomsReceipts.payerRefId, traderLicenceId),
            inArray(iomsReceipts.status, ["Paid", "Reconciled"]),
            lt(sql`substring(${iomsReceipts.createdAt}, 1, 10)`, endExclusive),
          ),
        );
      const totalPaid = Number(paidRows?.[0]?.sumPaid ?? 0) || 0;
      const outstanding = Math.max(0, Math.round((totalPayable - totalPaid) * 100) / 100);
      if (outstanding <= 0) {
        return sendApiError(res, 400, "MKT_STATEMENT_NOTHING_DUE", "No outstanding market fee for this period.");
      }

      const recordId = `market_fee_statement:${traderLicenceId}:${toPeriod}`;
      const [existingReceipt] = await db
        .select()
        .from(iomsReceipts)
        .where(and(eq(iomsReceipts.sourceModule, "M-04"), eq(iomsReceipts.sourceRecordId, recordId)))
        .limit(1);
      if (existingReceipt) {
        return res.json({ ok: true, receiptId: existingReceipt.id, receiptNo: existingReceipt.receiptNo });
      }

      const createdBy = req.user?.id ?? "system";
      const created = await createIomsReceipt({
        yardId: lic.yardId,
        revenueHead: "MarketFee",
        payerName: lic.firmName ?? traderLicenceId,
        payerType: "TraderLicence",
        payerRefId: traderLicenceId,
        amount: outstanding,
        paymentMode: "Cash",
        sourceModule: "M-04",
        sourceRecordId: recordId,
        unifiedEntityId: unifiedEntityIdFromTrackA(traderLicenceId),
        createdBy,
      });
      const [row] = await db.select().from(iomsReceipts).where(eq(iomsReceipts.id, created.id)).limit(1);
      if (row) {
        writeAuditLog(req, { module: "Market", action: "CreateStatementReceipt", recordId: row.id, afterValue: row }).catch((e) =>
          console.error("Audit log failed:", e),
        );
      }
      res.status(201).json({ ok: true, receiptId: created.id, receiptNo: created.receiptNo });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create statement receipt");
    }
  });

  // ----- Daily official prices (US-M04-003) -----
  function isoDay(s: string): string | null {
    const v = String(s ?? "").trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
  }
  function todayIso(): string {
    return new Date().toISOString().slice(0, 10);
  }
  function computeModalRupeeRounded(prices: number[]): number {
    const freq = new Map<number, number>();
    for (const p of prices) {
      const r = Math.round(p);
      freq.set(r, (freq.get(r) ?? 0) + 1);
    }
    let best: number | null = null;
    let bestCount = -1;
      for (const [k, c] of Array.from(freq.entries())) {
      if (c > bestCount || (c === bestCount && (best == null || k < best))) {
        best = k;
        bestCount = c;
      }
    }
    return best == null ? 0 : best;
  }

  app.post("/api/ioms/market/daily-prices/generate", async (req, res) => {
    try {
      const yardId = String(req.body?.yardId ?? "").trim();
      const date = isoDay(req.body?.date ?? "");
      if (!yardId || !date) {
        return sendApiError(res, 400, "MKT_DAILY_PRICES_FIELDS", "yardId and date (YYYY-MM-DD) are required");
      }
      const scopedIds = req.scopedLocationIds;
      if (scopedIds && scopedIds.length > 0 && !scopedIds.includes(yardId)) {
        return sendApiError(res, 403, "MKT_DAILY_PRICES_YARD_DENIED", "You do not have access to this yard");
      }
      if (date > todayIso()) {
        return sendApiError(res, 400, "MKT_DAILY_PRICES_FUTURE_DATE", "Cannot generate official prices for a future date");
      }

      const [yard] = await db.select().from(yards).where(eq(yards.id, yardId)).limit(1);
      const yardType = String((yard as { type?: string | null })?.type ?? "");

      // Arrivals source depends on yard type:
      // - Yard: Approved purchase_transactions for that day
      // - CheckPost: Verified inward commodity lines for that day (value/qty provides unit price)
      const arrivals =
        yardType === "CheckPost"
          ? await db
              .select({
                commodityId: checkPostInwardCommodities.commodityId,
                qty: checkPostInwardCommodities.quantity,
                value: checkPostInwardCommodities.value,
              })
              .from(checkPostInwardCommodities)
              .innerJoin(checkPostInward, eq(checkPostInwardCommodities.inwardId, checkPostInward.id))
              .where(
                and(
                  eq(checkPostInward.checkPostId, yardId),
                  eq(checkPostInward.status, "Verified"),
                  eq(checkPostInward.entryDate, date),
                ),
              )
          : await db
              .select({
                commodityId: purchaseTransactions.commodityId,
                qty: purchaseTransactions.quantity,
                value: purchaseTransactions.declaredValue,
              })
              .from(purchaseTransactions)
              .where(
                and(
                  eq(purchaseTransactions.yardId, yardId),
                  eq(purchaseTransactions.status, "Approved"),
                  eq(purchaseTransactions.transactionDate, date),
                ),
              );

      const byCommodity = new Map<string, { prices: number[]; qtySum: number }>();
      for (const r of arrivals) {
        const q = Number(r.qty ?? 0) || 0;
        const v = Number(r.value ?? 0) || 0;
        if (q <= 0) continue;
        const unitPrice = v / q;
        if (!Number.isFinite(unitPrice) || unitPrice <= 0) continue;
        const k = String(r.commodityId);
        const cur = byCommodity.get(k) ?? { prices: [], qtySum: 0 };
        cur.prices.push(unitPrice);
        cur.qtySum += q;
        byCommodity.set(k, cur);
      }

      const generatedAt = new Date().toISOString();
      const generatedBy = req.user?.id ?? null;

      const inserts: Array<{
        commodityId: string;
        min: number;
        max: number;
        modal: number;
        sampleCount: number;
        totalQty: number;
      }> = [];
      for (const [commodityId, v] of Array.from(byCommodity.entries())) {
        const ps = v.prices.slice().sort((a: number, b: number) => a - b);
        if (ps.length === 0) continue;
        const min = Number(ps[0].toFixed(2));
        const max = Number(ps[ps.length - 1].toFixed(2));
        const modal = Number(computeModalRupeeRounded(ps).toFixed(2));
        inserts.push({
          commodityId,
          min,
          max,
          modal,
          sampleCount: ps.length,
          totalQty: Number(v.qtySum.toFixed(2)),
        });
      }

      await db.transaction(async (tx) => {
        await tx
          .delete(marketDailyPrices)
          .where(and(eq(marketDailyPrices.yardId, yardId), eq(marketDailyPrices.date, date)));
        for (const u of inserts) {
          await tx.insert(marketDailyPrices).values({
            id: nanoid(),
            yardId,
            date,
            commodityId: u.commodityId,
            minPriceInrPerUnit: u.min,
            maxPriceInrPerUnit: u.max,
            modalPriceInrPerUnit: u.modal,
            sampleCount: u.sampleCount,
            totalQty: u.totalQty,
            generatedAt,
            generatedBy,
          });
        }
      });

      res.json({
        ok: true,
        yardId,
        yardType: yardType || "Yard",
        date,
        commodities: inserts.length,
        arrivalSamples: arrivals.length,
      });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to generate daily prices");
    }
  });

  app.get("/api/ioms/market/daily-prices", async (req, res) => {
    try {
      const yardId = String(req.query.yardId ?? "").trim();
      const date = isoDay(String(req.query.date ?? ""));
      if (!yardId || !date) {
        return sendApiError(res, 400, "MKT_DAILY_PRICES_FIELDS", "yardId and date (YYYY-MM-DD) are required");
      }
      const scopedIds = req.scopedLocationIds;
      if (scopedIds && scopedIds.length > 0 && !scopedIds.includes(yardId)) {
        return sendApiError(res, 403, "MKT_DAILY_PRICES_YARD_DENIED", "You do not have access to this yard");
      }
      const list = await db
        .select()
        .from(marketDailyPrices)
        .where(and(eq(marketDailyPrices.yardId, yardId), eq(marketDailyPrices.date, date)))
        .orderBy(marketDailyPrices.commodityId);
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch daily prices");
    }
  });

  // ----- Commodity arrival/price report (US-M04-007) -----
  app.get("/api/ioms/market/reports/commodity-summary", async (req, res) => {
    try {
      const yardId = String(req.query.yardId ?? "").trim(); // optional
      const from = String(req.query.from ?? "").trim(); // YYYY-MM-DD
      const to = String(req.query.to ?? "").trim(); // YYYY-MM-DD (inclusive)
      const iso = /^\d{4}-\d{2}-\d{2}$/;
      if (!iso.test(from) || !iso.test(to)) {
        return sendApiError(res, 400, "MKT_REP_RANGE", "from and to must be YYYY-MM-DD");
      }
      if (to < from) return sendApiError(res, 400, "MKT_REP_RANGE", "to must be on/after from");

      const scopedIds = req.scopedLocationIds;
      const yardFilter = yardId ? [yardId] : scopedIds ?? [];
      if (yardId && scopedIds && scopedIds.length > 0 && !scopedIds.includes(yardId)) {
        return sendApiError(res, 403, "MKT_REP_YARD_DENIED", "You do not have access to this yard");
      }

      // Arrivals from yard purchases (Approved) in range.
      const arrivalsConds = [
        eq(purchaseTransactions.status, "Approved"),
        gte(purchaseTransactions.transactionDate, from),
        lte(purchaseTransactions.transactionDate, to),
      ];
      if (yardFilter.length > 0) arrivalsConds.push(inArray(purchaseTransactions.yardId, yardFilter));

      const arrivalAgg = await db
        .select({
          yardId: purchaseTransactions.yardId,
          commodityId: purchaseTransactions.commodityId,
          qty: sql<number>`coalesce(sum(${purchaseTransactions.quantity}), 0)`,
          value: sql<number>`coalesce(sum(${purchaseTransactions.declaredValue}), 0)`,
          samples: sql<number>`count(*)`,
        })
        .from(purchaseTransactions)
        .where(and(...arrivalsConds))
        .groupBy(purchaseTransactions.yardId, purchaseTransactions.commodityId);

      // Price trends from generated daily prices in range.
      const priceConds = [gte(marketDailyPrices.date, from), lte(marketDailyPrices.date, to)];
      if (yardFilter.length > 0) priceConds.push(inArray(marketDailyPrices.yardId, yardFilter));

      const priceAgg = await db
        .select({
          yardId: marketDailyPrices.yardId,
          commodityId: marketDailyPrices.commodityId,
          min: sql<number>`min(${marketDailyPrices.minPriceInrPerUnit})`,
          max: sql<number>`max(${marketDailyPrices.maxPriceInrPerUnit})`,
          modalAvg: sql<number>`avg(${marketDailyPrices.modalPriceInrPerUnit})`,
          days: sql<number>`count(*)`,
        })
        .from(marketDailyPrices)
        .where(and(...priceConds))
        .groupBy(marketDailyPrices.yardId, marketDailyPrices.commodityId);

      const priceKey = (y: string, c: string) => `${y}::${c}`;
      const priceByKey = new Map<string, (typeof priceAgg)[number]>();
      for (const p of priceAgg) priceByKey.set(priceKey(String(p.yardId), String(p.commodityId)), p);

      const rows = arrivalAgg.map((a) => {
        const y = String(a.yardId);
        const c = String(a.commodityId);
        const p = priceByKey.get(priceKey(y, c));
        return {
          yardId: y,
          commodityId: c,
          totalQty: Math.round((Number(a.qty ?? 0) || 0) * 100) / 100,
          totalValueInr: Math.round((Number(a.value ?? 0) || 0) * 100) / 100,
          arrivalSamples: Number(a.samples ?? 0) || 0,
          priceDays: p ? Number(p.days ?? 0) || 0 : 0,
          minPrice: p ? Math.round((Number(p.min ?? 0) || 0) * 100) / 100 : null,
          maxPrice: p ? Math.round((Number(p.max ?? 0) || 0) * 100) / 100 : null,
          modalPriceAvg: p ? Math.round((Number(p.modalAvg ?? 0) || 0) * 100) / 100 : null,
        };
      });

      res.json({ from, to, yardId: yardId || null, rows });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to build commodity summary report");
    }
  });

  app.post("/api/ioms/market/reports/commodity-summary/generate", async (req, res) => {
    try {
      const body = req.body as Record<string, unknown>;
      const reportKind = String(body.reportKind ?? "Custom").trim();
      const yardId = body.yardId != null && String(body.yardId).trim() !== "" ? String(body.yardId).trim() : null;
      const from = String(body.from ?? "").trim();
      const to = String(body.to ?? "").trim();
      const iso = /^\d{4}-\d{2}-\d{2}$/;
      if (!iso.test(from) || !iso.test(to) || to < from) {
        return sendApiError(res, 400, "MKT_REP_RANGE", "from/to must be YYYY-MM-DD and to >= from");
      }
      const scopedIds = req.scopedLocationIds;
      if (yardId && scopedIds && scopedIds.length > 0 && !scopedIds.includes(yardId)) {
        return sendApiError(res, 403, "MKT_REP_YARD_DENIED", "You do not have access to this yard");
      }

      // Reuse the same aggregation logic as the GET endpoint by inlining.
      const yardFilter = yardId ? [yardId] : scopedIds ?? [];
      const arrivalsConds = [
        eq(purchaseTransactions.status, "Approved"),
        gte(purchaseTransactions.transactionDate, from),
        lte(purchaseTransactions.transactionDate, to),
      ];
      if (yardFilter.length > 0) arrivalsConds.push(inArray(purchaseTransactions.yardId, yardFilter));
      const arrivalAgg = await db
        .select({
          yardId: purchaseTransactions.yardId,
          commodityId: purchaseTransactions.commodityId,
          qty: sql<number>`coalesce(sum(${purchaseTransactions.quantity}), 0)`,
          value: sql<number>`coalesce(sum(${purchaseTransactions.declaredValue}), 0)`,
          samples: sql<number>`count(*)`,
        })
        .from(purchaseTransactions)
        .where(and(...arrivalsConds))
        .groupBy(purchaseTransactions.yardId, purchaseTransactions.commodityId);

      const priceConds = [gte(marketDailyPrices.date, from), lte(marketDailyPrices.date, to)];
      if (yardFilter.length > 0) priceConds.push(inArray(marketDailyPrices.yardId, yardFilter));
      const priceAgg = await db
        .select({
          yardId: marketDailyPrices.yardId,
          commodityId: marketDailyPrices.commodityId,
          min: sql<number>`min(${marketDailyPrices.minPriceInrPerUnit})`,
          max: sql<number>`max(${marketDailyPrices.maxPriceInrPerUnit})`,
          modalAvg: sql<number>`avg(${marketDailyPrices.modalPriceInrPerUnit})`,
          days: sql<number>`count(*)`,
        })
        .from(marketDailyPrices)
        .where(and(...priceConds))
        .groupBy(marketDailyPrices.yardId, marketDailyPrices.commodityId);

      const priceKey = (y: string, c: string) => `${y}::${c}`;
      const priceByKey = new Map<string, (typeof priceAgg)[number]>();
      for (const p of priceAgg) priceByKey.set(priceKey(String(p.yardId), String(p.commodityId)), p);

      const rows = arrivalAgg.map((a) => {
        const y = String(a.yardId);
        const c = String(a.commodityId);
        const p = priceByKey.get(priceKey(y, c));
        return {
          yardId: y,
          commodityId: c,
          totalQty: Math.round((Number(a.qty ?? 0) || 0) * 100) / 100,
          totalValueInr: Math.round((Number(a.value ?? 0) || 0) * 100) / 100,
          arrivalSamples: Number(a.samples ?? 0) || 0,
          priceDays: p ? Number(p.days ?? 0) || 0 : 0,
          minPrice: p ? Math.round((Number(p.min ?? 0) || 0) * 100) / 100 : null,
          maxPrice: p ? Math.round((Number(p.max ?? 0) || 0) * 100) / 100 : null,
          modalPriceAvg: p ? Math.round((Number(p.modalAvg ?? 0) || 0) * 100) / 100 : null,
        };
      });

      const id = nanoid();
      const generatedAt = new Date().toISOString();
      const generatedBy = req.user?.id ?? null;
      await db.insert(marketCommodityReportSnapshots).values({
        id,
        reportKind: reportKind || "Custom",
        yardId,
        from,
        to,
        rowsJson: rows,
        generatedAt,
        generatedBy,
      });

      res.status(201).json({ ok: true, id, reportKind: reportKind || "Custom", yardId, from, to, rows: rows.length });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to generate commodity report snapshot");
    }
  });

  app.get("/api/ioms/market/reports/commodity-summary/snapshots", async (req, res) => {
    try {
      const scopedIds = req.scopedLocationIds;
      const yardId = String(req.query.yardId ?? "").trim();
      const conditions = [];
      if (yardId) conditions.push(eq(marketCommodityReportSnapshots.yardId, yardId));
      if (scopedIds && scopedIds.length > 0) {
        // allow null (HO) + scoped yard ids
        conditions.push(or(isNull(marketCommodityReportSnapshots.yardId), inArray(marketCommodityReportSnapshots.yardId, scopedIds)));
      }
      const base = db.select().from(marketCommodityReportSnapshots).orderBy(desc(marketCommodityReportSnapshots.generatedAt)).limit(100);
      const list = conditions.length ? await base.where(and(...conditions)) : await base;
      res.json(list.map((r) => ({ ...r, rowsJson: undefined })));
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to list commodity report snapshots");
    }
  });

  app.get("/api/ioms/market/reports/commodity-summary/snapshots/:id", async (req, res) => {
    try {
      const id = String(req.params.id ?? "");
      const [row] = await db.select().from(marketCommodityReportSnapshots).where(eq(marketCommodityReportSnapshots.id, id)).limit(1);
      if (!row) return sendApiError(res, 404, "MKT_REP_SNAPSHOT_NOT_FOUND", "Snapshot not found");
      const scopedIds = req.scopedLocationIds;
      if (scopedIds && scopedIds.length > 0 && row.yardId && !scopedIds.includes(String(row.yardId))) {
        return sendApiError(res, 404, "MKT_REP_SNAPSHOT_NOT_FOUND", "Snapshot not found");
      }
      res.json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch snapshot");
    }
  });

  // ----- Market fee advance ledger (US-M04-004) -----
  async function getMarketFeeAdvanceBalance(traderLicenceId: string): Promise<number> {
    const rows = await db
      .select({ sumAmt: sql<number>`coalesce(sum(${marketFeeLedger.amountInr}), 0)` })
      .from(marketFeeLedger)
      .where(eq(marketFeeLedger.traderLicenceId, traderLicenceId));
    return Number(rows?.[0]?.sumAmt ?? 0) || 0;
  }

  app.get("/api/ioms/market/advance-ledger", async (req, res) => {
    try {
      const traderLicenceId = String(req.query.traderLicenceId ?? "").trim();
      if (!traderLicenceId) return sendApiError(res, 400, "MKT_ADV_FIELDS", "traderLicenceId is required");

      const [lic] = await db.select().from(traderLicences).where(eq(traderLicences.id, traderLicenceId)).limit(1);
      if (!lic) return sendApiError(res, 404, "LICENCE_NOT_FOUND", "Trader licence not found");
      const scopedIds = req.scopedLocationIds;
      if (scopedIds && scopedIds.length > 0 && !scopedIds.includes(lic.yardId)) {
        return sendApiError(res, 404, "LICENCE_NOT_FOUND", "Trader licence not found");
      }

      const entries = await db
        .select()
        .from(marketFeeLedger)
        .where(eq(marketFeeLedger.traderLicenceId, traderLicenceId))
        .orderBy(desc(marketFeeLedger.createdAt));
      const balance = entries.reduce((s, e) => s + (Number(e.amountInr ?? 0) || 0), 0);
      const cfg = await getMergedSystemConfig();
      const threshold = parseSystemConfigNumber(cfg, "market_fee_advance_min_threshold_inr");
      res.json({
        traderLicenceId,
        balance: Math.round(balance * 100) / 100,
        belowThreshold: threshold > 0 ? balance < threshold : false,
        thresholdInr: threshold,
        entries,
      });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch advance ledger");
    }
  });

  app.post("/api/ioms/market/advance-ledger/deposit", async (req, res) => {
    try {
      const body = req.body as Record<string, unknown>;
      const traderLicenceId = String(body.traderLicenceId ?? "").trim();
      const amount = Number(body.amountInr ?? NaN);
      const paymentMode = String(body.paymentMode ?? "Cash").trim();
      if (!traderLicenceId || !Number.isFinite(amount) || amount <= 0) {
        return sendApiError(res, 400, "MKT_ADV_DEPOSIT_FIELDS", "traderLicenceId and positive amountInr are required");
      }

      const [lic] = await db.select().from(traderLicences).where(eq(traderLicences.id, traderLicenceId)).limit(1);
      if (!lic) return sendApiError(res, 404, "LICENCE_NOT_FOUND", "Trader licence not found");
      const scopedIds = req.scopedLocationIds;
      if (scopedIds && scopedIds.length > 0 && !scopedIds.includes(lic.yardId)) {
        return sendApiError(res, 404, "LICENCE_NOT_FOUND", "Trader licence not found");
      }

      const createdBy = req.user?.id ?? "system";
      const receipt = await createIomsReceipt({
        yardId: lic.yardId,
        revenueHead: "MarketFee",
        payerName: lic.firmName ?? traderLicenceId,
        payerType: "TraderLicence",
        payerRefId: traderLicenceId,
        amount: Number(amount.toFixed(2)),
        paymentMode,
        sourceModule: "M-04",
        sourceRecordId: `market_advance_deposit:${traderLicenceId}:${new Date().toISOString()}`,
        unifiedEntityId: unifiedEntityIdFromTrackA(traderLicenceId),
        createdBy,
      });

      // Phase-1: counter deposit is considered paid immediately.
      await db.update(iomsReceipts).set({ status: "Paid", gatewayRef: "Manual" }).where(eq(iomsReceipts.id, receipt.id));

      const now = new Date().toISOString();
      const entryId = nanoid();
      await db.insert(marketFeeLedger).values({
        id: entryId,
        traderLicenceId,
        yardId: lic.yardId,
        entryDate: now.slice(0, 10),
        entryType: "Deposit",
        amountInr: Number(amount.toFixed(2)),
        receiptId: receipt.id,
        sourceModule: "M-04",
        sourceRecordId: receipt.id,
        createdBy,
        createdAt: now,
      });

      const balance = await getMarketFeeAdvanceBalance(traderLicenceId);
      res.status(201).json({ ok: true, receiptId: receipt.id, ledgerEntryId: entryId, newBalance: balance });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to record deposit");
    }
  });

  app.post("/api/ioms/market/advance-ledger/refund", async (req, res) => {
    try {
      const body = req.body as Record<string, unknown>;
      const traderLicenceId = String(body.traderLicenceId ?? "").trim();
      const amount = Number(body.amountInr ?? NaN);
      const paymentMode = String(body.paymentMode ?? "Cash").trim();
      if (!traderLicenceId || !Number.isFinite(amount) || amount <= 0) {
        return sendApiError(res, 400, "MKT_ADV_REFUND_FIELDS", "traderLicenceId and positive amountInr are required");
      }
      const [lic] = await db.select().from(traderLicences).where(eq(traderLicences.id, traderLicenceId)).limit(1);
      if (!lic) return sendApiError(res, 404, "LICENCE_NOT_FOUND", "Trader licence not found");
      const scopedIds = req.scopedLocationIds;
      if (scopedIds && scopedIds.length > 0 && !scopedIds.includes(lic.yardId)) {
        return sendApiError(res, 404, "LICENCE_NOT_FOUND", "Trader licence not found");
      }

      const bal = await getMarketFeeAdvanceBalance(traderLicenceId);
      if (bal < amount - 0.01) {
        return sendApiError(res, 400, "MKT_ADV_REFUND_TOO_MUCH", "Refund amount exceeds advance balance", {
          balance: bal,
        });
      }

      // Represent refund via a MarketFee receipt with status Reversed (cash outflow record).
      const createdBy = req.user?.id ?? "system";
      const receipt = await createIomsReceipt({
        yardId: lic.yardId,
        revenueHead: "MarketFee",
        payerName: lic.firmName ?? traderLicenceId,
        payerType: "TraderLicence",
        payerRefId: traderLicenceId,
        amount: Number(amount.toFixed(2)),
        paymentMode,
        sourceModule: "M-04",
        sourceRecordId: `market_advance_refund:${traderLicenceId}:${new Date().toISOString()}`,
        unifiedEntityId: unifiedEntityIdFromTrackA(traderLicenceId),
        createdBy,
      });
      await db.update(iomsReceipts).set({ status: "Reversed", gatewayRef: "RefundOut" }).where(eq(iomsReceipts.id, receipt.id));

      const now = new Date().toISOString();
      const entryId = nanoid();
      await db.insert(marketFeeLedger).values({
        id: entryId,
        traderLicenceId,
        yardId: lic.yardId,
        entryDate: now.slice(0, 10),
        entryType: "Refund",
        amountInr: Number((-amount).toFixed(2)),
        receiptId: receipt.id,
        sourceModule: "M-04",
        sourceRecordId: receipt.id,
        createdBy,
        createdAt: now,
      });

      const newBal = await getMarketFeeAdvanceBalance(traderLicenceId);
      res.status(201).json({ ok: true, receiptId: receipt.id, ledgerEntryId: entryId, newBalance: newBal });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to record refund");
    }
  });

  // ----- Reports: Market fee collections & bank deposits -----
  app.get("/api/ioms/market/reports/collections", async (req, res) => {
    try {
      const from = String(req.query.from ?? "").trim(); // YYYY-MM-DD (optional)
      const to = String(req.query.to ?? "").trim(); // YYYY-MM-DD (optional)
      const yardId = String(req.query.yardId ?? "").trim(); // optional
      const traderLicenceId = String(req.query.traderLicenceId ?? "").trim(); // optional
      const commodityId = String(req.query.commodityId ?? "").trim(); // optional

      const scopedIds = req.scopedLocationIds;
      const iso = /^\d{4}-\d{2}-\d{2}$/;
      const fromIso = from && iso.test(from) ? from : "";
      const toIso = to && iso.test(to) ? to : "";

      const conds = [eq(iomsReceipts.revenueHead, "MarketFee"), inArray(iomsReceipts.status, ["Paid", "Reconciled"])];
      if (scopedIds && scopedIds.length > 0) conds.push(inArray(iomsReceipts.yardId, scopedIds));
      if (yardId) conds.push(eq(iomsReceipts.yardId, yardId));
      if (traderLicenceId) conds.push(eq(iomsReceipts.payerRefId, traderLicenceId));
      if (fromIso) conds.push(gte(sql`substring(${iomsReceipts.createdAt}, 1, 10)`, fromIso));
      if (toIso) conds.push(lte(sql`substring(${iomsReceipts.createdAt}, 1, 10)`, toIso));

      const receipts = await db
        .select({
          id: iomsReceipts.id,
          receiptNo: iomsReceipts.receiptNo,
          yardId: iomsReceipts.yardId,
          payerRefId: iomsReceipts.payerRefId,
          payerName: iomsReceipts.payerName,
          paymentMode: iomsReceipts.paymentMode,
          totalAmount: iomsReceipts.totalAmount,
          createdAt: iomsReceipts.createdAt,
          isGracePeriod: iomsReceipts.isGracePeriod,
          sourceModule: iomsReceipts.sourceModule,
          sourceRecordId: iomsReceipts.sourceRecordId,
        })
        .from(iomsReceipts)
        .where(and(...conds))
        .orderBy(desc(iomsReceipts.createdAt))
        .limit(2000);

      // Optional commodity filter: only applies when receipts can be traced to yard purchase tx or checkpost inward.
      let filteredReceipts = receipts;
      if (commodityId) {
        const sourceIds = receipts.map((r) => String(r.sourceRecordId ?? "")).filter(Boolean);
        const yardMatches = new Set<string>();
        const inwardMatches = new Set<string>();

        if (sourceIds.length > 0) {
          const purchaseRows = await db
            .select({ id: purchaseTransactions.id })
            .from(purchaseTransactions)
            .where(and(inArray(purchaseTransactions.id, sourceIds), eq(purchaseTransactions.commodityId, commodityId)));
          for (const p of purchaseRows) yardMatches.add(String(p.id));

          const inwardRows = await db
            .select({ inwardId: checkPostInwardCommodities.inwardId })
            .from(checkPostInwardCommodities)
            .where(and(inArray(checkPostInwardCommodities.inwardId, sourceIds), eq(checkPostInwardCommodities.commodityId, commodityId)));
          for (const i of inwardRows) inwardMatches.add(String(i.inwardId));
        }

        filteredReceipts = receipts.filter((r) => {
          const sid = String(r.sourceRecordId ?? "");
          return yardMatches.has(sid) || inwardMatches.has(sid);
        });
      }

      const totalsByMode: Record<string, number> = {};
      let grandTotal = 0;
      for (const r of filteredReceipts) {
        const mode = String(r.paymentMode ?? "Unknown");
        const amt = Number(r.totalAmount ?? 0) || 0;
        totalsByMode[mode] = (totalsByMode[mode] ?? 0) + amt;
        grandTotal += amt;
      }

      res.json({
        from: fromIso || null,
        to: toIso || null,
        yardId: yardId || null,
        traderLicenceId: traderLicenceId || null,
        commodityId: commodityId || null,
        count: filteredReceipts.length,
        grandTotal: Math.round(grandTotal * 100) / 100,
        totalsByMode: Object.fromEntries(Object.entries(totalsByMode).map(([k, v]) => [k, Math.round(v * 100) / 100])),
        receipts: filteredReceipts,
      });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to build market collections report");
    }
  });

  app.get("/api/ioms/market/reports/bank-deposits", async (req, res) => {
    try {
      const from = String(req.query.from ?? "").trim();
      const to = String(req.query.to ?? "").trim();
      const checkPostId = String(req.query.checkPostId ?? "").trim();
      const scopedIds = req.scopedLocationIds;
      const iso = /^\d{4}-\d{2}-\d{2}$/;
      const fromIso = from && iso.test(from) ? from : "";
      const toIso = to && iso.test(to) ? to : "";

      const conds = [];
      if (scopedIds && scopedIds.length > 0) conds.push(inArray(checkPostBankDeposits.checkPostId, scopedIds));
      if (checkPostId) conds.push(eq(checkPostBankDeposits.checkPostId, checkPostId));
      if (fromIso) conds.push(gte(checkPostBankDeposits.depositDate, fromIso));
      if (toIso) conds.push(lte(checkPostBankDeposits.depositDate, toIso));

      const base = db.select().from(checkPostBankDeposits).orderBy(desc(checkPostBankDeposits.depositDate));
      const rows = conds.length ? await base.where(and(...conds)) : await base;
      const total = rows.reduce((s, r) => s + (Number(r.amount ?? 0) || 0), 0);
      res.json({
        from: fromIso || null,
        to: toIso || null,
        checkPostId: checkPostId || null,
        count: rows.length,
        totalAmount: Math.round(total * 100) / 100,
        rows,
      });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch bank deposit report");
    }
  });

  // ----- Commodities -----
  app.get("/api/ioms/commodities", async (_req, res) => {
    try {
      const list = await db.select().from(commodities).orderBy(commodities.name);
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch commodities");
    }
  });

  app.post("/api/ioms/commodities", async (req, res) => {
    try {
      const body = req.body;
      const id = nanoid();
      await db.insert(commodities).values({
        id,
        name: String(body.name ?? ""),
        variety: body.variety ? String(body.variety) : null,
        unit: body.unit ? String(body.unit) : null,
        gradeType: body.gradeType ? String(body.gradeType) : null,
        isActive: body.isActive !== undefined ? Boolean(body.isActive) : true,
      });
      const [row] = await db.select().from(commodities).where(eq(commodities.id, id));
      if (row) writeAuditLog(req, { module: "Market", action: "Create", recordId: id, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create commodity");
    }
  });

  app.put("/api/ioms/commodities/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const [existingCommodity] = await db.select().from(commodities).where(eq(commodities.id, id)).limit(1);
      if (!existingCommodity) return sendApiError(res, 404, "IOMS_COMMODITY_NOT_FOUND", "Not found");
      const body = req.body;
      const updates: Record<string, unknown> = {};
      ["name", "variety", "unit", "gradeType", "isActive"].forEach((k) => {
        if (body[k] === undefined) return;
        if (k === "isActive") updates.isActive = Boolean(body.isActive);
        else updates[k] = body[k] == null ? null : String(body[k]);
      });
      await db.update(commodities).set(updates as Record<string, string | boolean | null>).where(eq(commodities.id, id));
      const [row] = await db.select().from(commodities).where(eq(commodities.id, id));
      if (!row) return sendApiError(res, 404, "IOMS_COMMODITY_NOT_FOUND", "Not found");
      writeAuditLog(req, { module: "Market", action: "Update", recordId: id, beforeValue: existingCommodity, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to update commodity");
    }
  });

  // ----- Market fee rates (scoped by user yards; null yardId = global) -----
  app.get("/api/ioms/market/fee-rates", async (req, res) => {
    try {
      const yardId = req.query.yardId as string | undefined;
      const conditions = [];
      const scopedIds = req.scopedLocationIds;
      if (scopedIds && scopedIds.length > 0) {
        conditions.push(or(sql`${marketFeeRates.yardId} IS NULL`, inArray(marketFeeRates.yardId, scopedIds)));
      }
      if (yardId) conditions.push(eq(marketFeeRates.yardId, yardId));
      const base = db.select().from(marketFeeRates).orderBy(desc(marketFeeRates.validTo));
      const list = conditions.length > 0 ? await base.where(and(...conditions)) : await base;
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch fee rates");
    }
  });

  /** Resolved market fee % for a yard + commodity + transaction date (matrix, else system_config market_fee_percent). */
  app.get("/api/ioms/market/fee-preview", async (req, res) => {
    try {
      const yardId = String(req.query.yardId ?? "").trim();
      const commodityId = String(req.query.commodityId ?? "").trim();
      const transactionDate = String(req.query.transactionDate ?? "").trim();
      if (!yardId || !commodityId || !transactionDate) {
        return sendApiError(
          res,
          400,
          "IOMS_MARKET_FEE_PREVIEW_FIELDS",
          "yardId, commodityId and transactionDate query parameters are required",
        );
      }
      let td: string;
      try {
        td = assertIsoTransactionDate(transactionDate);
      } catch {
        return sendApiError(res, 400, "IOMS_MARKET_FEE_PREVIEW_DATE", "transactionDate must be YYYY-MM-DD");
      }
      const scopedIds = req.scopedLocationIds;
      if (scopedIds && scopedIds.length > 0 && !scopedIds.includes(yardId)) {
        return sendApiError(res, 403, "IOMS_MARKET_YARD_ACCESS_DENIED", "You do not have access to this yard");
      }
      const resolved = await resolveMarketFeePercentForPurchase({ yardId, commodityId, transactionDate: td });
      res.json({
        marketFeePercent: resolved.feePercent,
        source: resolved.source,
        rateId: resolved.rateId,
      });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to resolve market fee");
    }
  });

  app.post("/api/ioms/market/fee-rates", async (req, res) => {
    try {
      const body = req.body;
      const yardId = body.yardId ? String(body.yardId) : null;
      const scopedIds = req.scopedLocationIds;
      if (yardId && scopedIds && scopedIds.length > 0 && !scopedIds.includes(yardId)) {
        return sendApiError(res, 403, "IOMS_MARKET_YARD_ACCESS_DENIED", "You do not have access to this yard");
      }
      const sys = await getMergedSystemConfig();
      const defaultPct = parseSystemConfigNumber(sys, "market_fee_percent");
      const id = nanoid();
      await db.insert(marketFeeRates).values({
        id,
        commodityId: String(body.commodityId ?? ""),
        validFrom: String(body.validFrom ?? ""),
        validTo: String(body.validTo ?? ""),
        feePercent: body.feePercent != null && body.feePercent !== "" ? Number(body.feePercent) : defaultPct,
        yardId,
      });
      const [row] = await db.select().from(marketFeeRates).where(eq(marketFeeRates.id, id));
      if (row) writeAuditLog(req, { module: "Market", action: "Create", recordId: id, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create fee rate");
    }
  });

  // ----- Farmers (scoped by user yards) -----
  app.get("/api/ioms/farmers", async (req, res) => {
    try {
      const yardId = req.query.yardId as string | undefined;
      const conditions = [];
      const scopedIds = req.scopedLocationIds;
      if (scopedIds && scopedIds.length > 0) conditions.push(inArray(farmers.yardId, scopedIds));
      if (yardId) conditions.push(eq(farmers.yardId, yardId));
      const base = db.select().from(farmers).orderBy(farmers.name);
      const list = conditions.length > 0 ? await base.where(and(...conditions)) : await base;
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch farmers");
    }
  });

  app.post("/api/ioms/farmers", async (req, res) => {
    try {
      const body = req.body;
      const yardId = String(body.yardId ?? "");
      const scopedIds = req.scopedLocationIds;
      if (scopedIds && scopedIds.length > 0 && !scopedIds.includes(yardId)) {
        return sendApiError(res, 403, "IOMS_MARKET_YARD_ACCESS_DENIED", "You do not have access to this yard");
      }
      let aadhaarNorm: string | null;
      let mobileNorm: string | null;
      try {
        aadhaarNorm = normalizeAadhaarMasked(body.aadhaarToken ?? null);
        mobileNorm = normalizeMobile10(body.mobile ?? null);
      } catch (e) {
        if (sendHrRule(res, e)) return;
        throw e;
      }
      const id = nanoid();
      await db.insert(farmers).values({
        id,
        name: String(body.name ?? ""),
        yardId,
        krishiCardNo: body.krishiCardNo ? String(body.krishiCardNo) : null,
        village: body.village ? String(body.village) : null,
        taluk: body.taluk ? String(body.taluk) : null,
        district: body.district ? String(body.district) : null,
        mobile: mobileNorm,
        aadhaarToken: aadhaarNorm,
      });
      const [row] = await db.select().from(farmers).where(eq(farmers.id, id));
      if (row) writeAuditLog(req, { module: "Market", action: "Create", recordId: id, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create farmer");
    }
  });

  app.put("/api/ioms/farmers/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const [existing] = await db.select().from(farmers).where(eq(farmers.id, id)).limit(1);
      if (!existing) return sendApiError(res, 404, "IOMS_FARMER_NOT_FOUND", "Not found");
      const scopedIds = req.scopedLocationIds;
      if (scopedIds && scopedIds.length > 0 && !scopedIds.includes(existing.yardId)) {
        return sendApiError(res, 404, "IOMS_FARMER_NOT_FOUND", "Not found");
      }
      const body = req.body;
      const updates: Record<string, unknown> = {};
      ["name", "yardId", "krishiCardNo", "village", "taluk", "district"].forEach((k) => {
        if (body[k] !== undefined) updates[k] = body[k] == null ? null : String(body[k]);
      });
      if (body.mobile !== undefined) {
        try {
          updates.mobile = normalizeMobile10(
            body.mobile == null || String(body.mobile).trim() === "" ? null : String(body.mobile),
          );
        } catch (e) {
          if (sendHrRule(res, e)) return;
          throw e;
        }
      }
      if (body.aadhaarToken !== undefined) {
        try {
          updates.aadhaarToken = normalizeAadhaarMasked(
            body.aadhaarToken == null || String(body.aadhaarToken).trim() === ""
              ? null
              : String(body.aadhaarToken),
          );
        } catch (e) {
          if (sendHrRule(res, e)) return;
          throw e;
        }
      }
      if (updates.yardId && scopedIds && scopedIds.length > 0 && !scopedIds.includes(updates.yardId as string)) {
        return sendApiError(res, 403, "IOMS_MARKET_YARD_ACCESS_DENIED", "You do not have access to this yard");
      }
      await db.update(farmers).set(updates as Record<string, string | null>).where(eq(farmers.id, id));
      const [row] = await db.select().from(farmers).where(eq(farmers.id, id));
      if (!row) return sendApiError(res, 404, "IOMS_FARMER_NOT_FOUND", "Not found");
      writeAuditLog(req, { module: "Market", action: "Update", recordId: id, beforeValue: existing, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to update farmer");
    }
  });

  // ----- Purchase transactions (scoped by user yards) -----
  app.get("/api/ioms/market/transactions", async (req, res) => {
    try {
      const yardId = req.query.yardId as string | undefined;
      const status = req.query.status as string | undefined;
      const conditions = [];
      const scopedIds = req.scopedLocationIds;
      if (scopedIds && scopedIds.length > 0) conditions.push(inArray(purchaseTransactions.yardId, scopedIds));
      if (yardId) conditions.push(eq(purchaseTransactions.yardId, yardId));
      if (status) conditions.push(eq(purchaseTransactions.status, status));
      const parentTransactionId = req.query.parentTransactionId as string | undefined;
      if (parentTransactionId) conditions.push(eq(purchaseTransactions.parentTransactionId, parentTransactionId));
      const base = db.select().from(purchaseTransactions).orderBy(desc(purchaseTransactions.transactionDate));
      const list = conditions.length > 0 ? await base.where(and(...conditions)) : await base;
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch transactions");
    }
  });

  app.post("/api/ioms/market/transactions", async (req, res) => {
    try {
      if (!canCreatePurchaseTransaction(req.user)) {
        return sendApiError(
          res,
          403,
          "PURCHASE_TX_CREATE_DENIED",
          "Only Data Originator or Admin can create purchase transactions",
        );
      }
      const body = req.body;
      const parentTransactionId = body.parentTransactionId ? String(body.parentTransactionId) : null;
      if (parentTransactionId) {
        const [parent] = await db
          .select()
          .from(purchaseTransactions)
          .where(eq(purchaseTransactions.id, parentTransactionId))
          .limit(1);
        if (!parent) {
          return sendApiError(res, 404, "PURCHASE_TX_PARENT_NOT_FOUND", "Original transaction not found");
        }
        if (parent.status !== "Approved") {
          return sendApiError(
            res,
            400,
            "PURCHASE_TX_ADJUSTMENT_PARENT_NOT_APPROVED",
            "Adjusted return must reference an Approved purchase",
          );
        }
        const scopedIds = req.scopedLocationIds;
        if (scopedIds && scopedIds.length > 0 && !scopedIds.includes(parent.yardId)) {
          return sendApiError(res, 403, "PURCHASE_TX_YARD_ACCESS_DENIED", "You do not have access to this yard");
        }
        const marketFeeAmount = Number(body.marketFeeAmount ?? 0);
        if (Number.isNaN(marketFeeAmount) || marketFeeAmount >= 0) {
          return sendApiError(
            res,
            400,
            "PURCHASE_TX_ADJUSTMENT_FEE_NEGATIVE",
            "Adjustment requires negative marketFeeAmount (market fee credit)",
          );
        }
        const declaredValue = Number(body.declaredValue ?? 0);
        if (Number.isNaN(declaredValue) || declaredValue < 0) {
          return sendApiError(
            res,
            400,
            "PURCHASE_TX_DECLARED_VALUE_INVALID",
            "declaredValue must be a non-negative number",
          );
        }
        const quantity = Number(body.quantity ?? parent.quantity);
        if (Number.isNaN(quantity) || quantity <= 0) {
          return sendApiError(res, 400, "PURCHASE_TX_QUANTITY_INVALID", "quantity must be greater than 0");
        }
        const id = nanoid();
        await db.insert(purchaseTransactions).values({
          id,
          yardId: parent.yardId,
          commodityId: parent.commodityId,
          traderLicenceId: parent.traderLicenceId,
          quantity,
          unit: String(body.unit ?? parent.unit),
          weight: body.weight != null ? Number(body.weight) : parent.weight,
          declaredValue,
          marketFeePercent: Number(body.marketFeePercent ?? parent.marketFeePercent),
          marketFeeAmount,
          purchaseType: String(body.purchaseType ?? parent.purchaseType),
          grade: body.grade != null ? String(body.grade) : parent.grade,
          transactionDate: String(body.transactionDate ?? new Date().toISOString().slice(0, 10)),
          status: "Draft",
          farmerId: body.farmerId != null ? String(body.farmerId) : parent.farmerId,
          receiptId: null,
          doUser: req.user?.id ?? null,
          dvUser: null,
          daUser: null,
          parentTransactionId,
          entryKind: "Adjustment",
        });
        const [row] = await db.select().from(purchaseTransactions).where(eq(purchaseTransactions.id, id));
        if (row) {
          writeAuditLog(req, { module: "Market", action: "CreateAdjustment", recordId: id, afterValue: row }).catch((e) =>
            console.error("Audit log failed:", e),
          );
        }
        return res.status(201).json(row);
      }

      const yardId = String(body.yardId ?? "");
      const commodityId = String(body.commodityId ?? "");
      const traderLicenceId = String(body.traderLicenceId ?? "");
      const quantity = Number(body.quantity ?? 0);
      const declaredValue = Number(body.declaredValue ?? 0);
      const transactionDateRaw = String(body.transactionDate ?? "");
      const unit = String(body.unit ?? "");
      const purchaseType = String(body.purchaseType ?? "");
      const weight = body.weight != null ? Number(body.weight) : null;

      if (!yardId || !commodityId || !traderLicenceId || !transactionDateRaw || !unit || !purchaseType) {
        return sendApiError(
          res,
          400,
          "PURCHASE_TX_FIELDS_REQUIRED",
          "yardId, commodityId, traderLicenceId, transactionDate, unit and purchaseType are required",
        );
      }
      let transactionDate: string;
      try {
        transactionDate = assertIsoTransactionDate(transactionDateRaw);
      } catch {
        return sendApiError(res, 400, "PURCHASE_TX_TRANSACTION_DATE_INVALID", "transactionDate must be YYYY-MM-DD");
      }
      // US-M04-003 acceptance: block future-dated arrival entry.
      const today = new Date().toISOString().slice(0, 10);
      if (transactionDate > today) {
        return sendApiError(res, 400, "PURCHASE_TX_FUTURE_DATE", "Future-dated arrivals are not allowed.");
      }
      if (Number.isNaN(quantity) || quantity <= 0) {
        return sendApiError(res, 400, "PURCHASE_TX_QUANTITY_INVALID", "quantity must be greater than 0");
      }
      if (Number.isNaN(declaredValue) || declaredValue < 0) {
        return sendApiError(
          res,
          400,
          "PURCHASE_TX_DECLARED_VALUE_INVALID",
          "declaredValue must be a non-negative number",
        );
      }
      if (weight != null && (Number.isNaN(weight) || weight < 0)) {
        return sendApiError(res, 400, "PURCHASE_TX_WEIGHT_INVALID", "weight must be a non-negative number");
      }

      const scopedIds = req.scopedLocationIds;
      if (scopedIds && scopedIds.length > 0 && !scopedIds.includes(yardId)) {
        return sendApiError(res, 403, "PURCHASE_TX_YARD_ACCESS_DENIED", "You do not have access to this yard");
      }
      const [commodity] = await db.select({ id: commodities.id }).from(commodities).where(eq(commodities.id, commodityId)).limit(1);
      if (!commodity) return sendApiError(res, 404, "PURCHASE_TX_COMMODITY_NOT_FOUND", "Commodity not found");
      const [licence] = await db
        .select({
          id: traderLicences.id,
          yardId: traderLicences.yardId,
          status: traderLicences.status,
          isBlocked: traderLicences.isBlocked,
          validFrom: traderLicences.validFrom,
          validTo: traderLicences.validTo,
        })
        .from(traderLicences)
        .where(eq(traderLicences.id, traderLicenceId))
        .limit(1);
      if (!licence) return sendApiError(res, 404, "PURCHASE_TX_LICENCE_NOT_FOUND", "Trader licence not found");
      if (licence.yardId && licence.yardId !== yardId) {
        return sendApiError(
          res,
          400,
          "PURCHASE_TX_LICENCE_YARD_MISMATCH",
          "Trader licence belongs to a different yard",
        );
      }
      if (licence.status !== "Active") {
        return sendApiError(
          res,
          400,
          "PURCHASE_TX_TRADER_NOT_ACTIVE",
          `Trader licence must be Active for purchases (current status: ${licence.status}).`,
        );
      }
      if (licence.isBlocked) {
        return sendApiError(res, 400, "PURCHASE_TX_TRADER_BLOCKED", "Trader licence is blocked.");
      }
      const vf = licence.validFrom?.trim() ?? "";
      const vt = licence.validTo?.trim() ?? "";
      const iso = /^\d{4}-\d{2}-\d{2}$/;
      if (vf && iso.test(vf) && vt && iso.test(vt)) {
        if (transactionDate < vf) {
          return sendApiError(
            res,
            400,
            "PURCHASE_TX_TRADER_OUTSIDE_VALIDITY",
            "Transaction date is outside the trader licence valid period.",
          );
        }
      }

      const windowEval = await evaluateMarketFeeLicenceWindow({
        licenceValidToIso: licence.validTo,
        transactionDateIso: transactionDate,
      });
      if (!windowEval.ok) {
        return sendApiError(res, 400, windowEval.code, windowEval.message);
      }

      const resolved = await resolveMarketFeePercentForPurchase({ yardId, commodityId, transactionDate });
      const marketFeePercent = resolved.feePercent;
      const bodyHasPercent =
        body.marketFeePercent !== undefined && body.marketFeePercent !== null && String(body.marketFeePercent).trim() !== "";
      if (bodyHasPercent) {
        const bodyPercent = Number(body.marketFeePercent);
        if (Number.isNaN(bodyPercent) || bodyPercent < 0 || bodyPercent > 100) {
          return sendApiError(
            res,
            400,
            "PURCHASE_TX_MARKET_FEE_PERCENT_INVALID",
            "marketFeePercent must be between 0 and 100",
          );
        }
        if (!marketFeePercentMatchesResolved(bodyPercent, marketFeePercent)) {
          return sendApiError(
            res,
            400,
            "PURCHASE_TX_MARKET_FEE_PERCENT_MISMATCH",
            `marketFeePercent must match the effective rate for this commodity, yard, and date (${marketFeePercent}%). Omit marketFeePercent to accept the server rate.`,
          );
        }
      }

      const computedMarketFeeAmount = Number(((declaredValue * marketFeePercent) / 100).toFixed(2));
      const marketFeeAmount = body.marketFeeAmount != null ? Number(body.marketFeeAmount) : computedMarketFeeAmount;
      if (Number.isNaN(marketFeePercent) || marketFeePercent < 0 || marketFeePercent > 100) {
        return sendApiError(
          res,
          400,
          "PURCHASE_TX_MARKET_FEE_PERCENT_INVALID",
          "Resolved marketFeePercent must be between 0 and 100",
        );
      }
      if (Number.isNaN(marketFeeAmount) || marketFeeAmount < 0) {
        return sendApiError(
          res,
          400,
          "PURCHASE_TX_MARKET_FEE_AMOUNT_INVALID",
          "marketFeeAmount must be a non-negative number",
        );
      }
      if (Math.abs(marketFeeAmount - computedMarketFeeAmount) > 0.02) {
        return sendApiError(
          res,
          400,
          "PURCHASE_TX_MARKET_FEE_AMOUNT_MISMATCH",
          `marketFeeAmount must equal declaredValue × resolved fee % (${computedMarketFeeAmount.toFixed(2)}). Omit marketFeeAmount to accept the computed amount.`,
        );
      }

      const id = nanoid();
      await db.insert(purchaseTransactions).values({
        id,
        yardId,
        commodityId,
        traderLicenceId,
        quantity,
        unit,
        declaredValue,
        marketFeePercent,
        marketFeeAmount,
        purchaseType,
        transactionDate,
        isGracePeriod: windowEval.isGrace,
        status: "Draft",
        farmerId: body.farmerId ? String(body.farmerId) : null,
        weight,
        grade: body.grade ? String(body.grade) : null,
        receiptId: body.receiptId ? String(body.receiptId) : null,
        doUser: req.user?.id ?? null,
        dvUser: null,
        daUser: null,
        parentTransactionId: null,
        entryKind: "Original",
      });
      const [row] = await db.select().from(purchaseTransactions).where(eq(purchaseTransactions.id, id));
      if (row) {
        writeAuditLog(req, { module: "Market", action: "Create", recordId: id, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      }
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create transaction");
    }
  });

  app.put("/api/ioms/market/transactions/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const [existing] = await db.select().from(purchaseTransactions).where(eq(purchaseTransactions.id, id));
      if (!existing) {
        return sendApiError(res, 404, "PURCHASE_TX_NOT_FOUND", "Purchase transaction not found");
      }
      const scopedIds = req.scopedLocationIds;
      if (scopedIds && scopedIds.length > 0 && !scopedIds.includes(existing.yardId)) {
        return sendApiError(res, 404, "PURCHASE_TX_NOT_FOUND", "Purchase transaction not found");
      }
      const body = req.body;
      const newStatus = body.status !== undefined ? String(body.status) : existing.status;
      const statusChange = newStatus !== existing.status;
      const transition = statusChange ? canTransitionPurchaseTransaction(req.user, existing.status, newStatus) : null;

      let dvReturnRemarks: string | null = null;
      if (statusChange) {
        if (!transition?.allowed) {
          return sendApiError(
            res,
            403,
            "PURCHASE_TX_STATUS_TRANSITION_DENIED",
            `You cannot change status from ${existing.status} to ${newStatus}. Only DV can verify; only DA can approve.`,
          );
        }
        const seg = assertSegregationDoDvDa(req.user, existing, {
          setDvUser: transition?.setDvUser,
          setDaUser: transition?.setDaUser,
        });
        if (!seg.ok) {
          return sendApiError(res, 403, "PURCHASE_TX_DO_DV_DA_SEGREGATION", seg.error);
        }
        if (existing.status === "Verified" && newStatus === "Draft") {
          const ret = validateDvReturnToDraft(body as Record<string, unknown>);
          if (!ret.ok) return sendApiError(res, 400, "PURCHASE_TX_DV_RETURN_INVALID", ret.error);
          dvReturnRemarks = ret.remarks;
        }
      } else if (existing.status === "Draft" && !canEditDraftPurchaseTransaction(req.user)) {
        return sendApiError(
          res,
          403,
          "PURCHASE_TX_DRAFT_EDIT_DENIED",
          "Only Data Originator or Admin can edit draft transactions",
        );
      }

      const updates: Record<string, unknown> = {};
      ["transactionNo", "yardId", "commodityId", "farmerId", "traderLicenceId", "quantity", "unit", "weight", "declaredValue", "marketFeePercent", "marketFeeAmount", "purchaseType", "grade", "transactionDate", "status", "receiptId", "doUser", "dvUser", "daUser"].forEach((k) => {
        if (body[k] === undefined) return;
        if (["quantity", "weight", "declaredValue", "marketFeePercent", "marketFeeAmount"].includes(k)) updates[k] = Number(body[k]);
        else updates[k] = body[k] == null ? null : String(body[k]);
      });
      if (updates.yardId && scopedIds && scopedIds.length > 0 && !scopedIds.includes(String(updates.yardId))) {
        return sendApiError(res, 403, "PURCHASE_TX_YARD_ACCESS_DENIED", "You do not have access to this yard");
      }
      if (updates.quantity != null && (Number.isNaN(Number(updates.quantity)) || Number(updates.quantity) <= 0)) {
        return sendApiError(res, 400, "PURCHASE_TX_QUANTITY_INVALID", "quantity must be greater than 0");
      }
      if (updates.declaredValue != null && (Number.isNaN(Number(updates.declaredValue)) || Number(updates.declaredValue) < 0)) {
        return sendApiError(
          res,
          400,
          "PURCHASE_TX_DECLARED_VALUE_INVALID",
          "declaredValue must be a non-negative number",
        );
      }
      if (
        updates.marketFeePercent != null &&
        (Number.isNaN(Number(updates.marketFeePercent)) ||
          Number(updates.marketFeePercent) < 0 ||
          Number(updates.marketFeePercent) > 100)
      ) {
        return sendApiError(
          res,
          400,
          "PURCHASE_TX_MARKET_FEE_PERCENT_INVALID",
          "marketFeePercent must be between 0 and 100",
        );
      }
      if (updates.marketFeeAmount != null && (Number.isNaN(Number(updates.marketFeeAmount)) || Number(updates.marketFeeAmount) < 0)) {
        return sendApiError(
          res,
          400,
          "PURCHASE_TX_MARKET_FEE_AMOUNT_INVALID",
          "marketFeeAmount must be a non-negative number",
        );
      }
      if (updates.weight != null && (Number.isNaN(Number(updates.weight)) || Number(updates.weight) < 0)) {
        return sendApiError(res, 400, "PURCHASE_TX_WEIGHT_INVALID", "weight must be a non-negative number");
      }

      const isDraftOriginal = existing.status === "Draft" && existing.entryKind === "Original";
      if (isDraftOriginal && (updates.marketFeePercent != null || updates.marketFeeAmount != null)) {
        const mergedYard = updates.yardId != null ? String(updates.yardId) : String(existing.yardId ?? "");
        const mergedCommodity = updates.commodityId != null ? String(updates.commodityId) : String(existing.commodityId ?? "");
        const mergedDateRaw =
          updates.transactionDate != null ? String(updates.transactionDate) : String(existing.transactionDate ?? "");
        let td: string;
        try {
          td = assertIsoTransactionDate(mergedDateRaw);
        } catch {
          return sendApiError(res, 400, "PURCHASE_TX_TRANSACTION_DATE_INVALID", "transactionDate must be YYYY-MM-DD");
        }
        const mergedDeclared =
          updates.declaredValue != null ? Number(updates.declaredValue) : Number(existing.declaredValue ?? 0);
        const resolved = await resolveMarketFeePercentForPurchase({
          yardId: mergedYard,
          commodityId: mergedCommodity,
          transactionDate: td,
        });
        if (updates.marketFeePercent != null) {
          if (!marketFeePercentMatchesResolved(Number(updates.marketFeePercent), resolved.feePercent)) {
            return sendApiError(
              res,
              400,
              "PURCHASE_TX_MARKET_FEE_PERCENT_MISMATCH",
              `marketFeePercent must match the effective rate for this commodity, yard, and date (${resolved.feePercent}%).`,
            );
          }
        }
        const effectivePct =
          updates.marketFeePercent != null ? Number(updates.marketFeePercent) : resolved.feePercent;
        const computedAmt = Number(((mergedDeclared * effectivePct) / 100).toFixed(2));
        if (updates.marketFeeAmount != null) {
          if (Math.abs(Number(updates.marketFeeAmount) - computedAmt) > 0.02) {
            return sendApiError(
              res,
              400,
              "PURCHASE_TX_MARKET_FEE_AMOUNT_MISMATCH",
              `marketFeeAmount must equal declaredValue × fee % (${computedAmt.toFixed(2)}).`,
            );
          }
        }
      }

      if (transition?.setDvUser) updates.dvUser = req.user?.id ?? null;
      if (transition?.setDaUser) updates.daUser = req.user?.id ?? null;
      if (dvReturnRemarks !== null) {
        updates.dvReturnRemarks = dvReturnRemarks;
        updates.workflowRevisionCount = Number(existing.workflowRevisionCount ?? 0) + 1;
      }

      await db.update(purchaseTransactions).set(updates as Record<string, string | number | null>).where(eq(purchaseTransactions.id, id));
      const [row] = await db.select().from(purchaseTransactions).where(eq(purchaseTransactions.id, id));
      if (!row) return sendApiError(res, 404, "PURCHASE_TX_NOT_FOUND", "Not found");
      let responseRow = row;

      // Phase-1 linkage: when a market purchase transaction is Approved,
      // ensure a MarketFee receipt exists and link it back.
      if (statusChange && newStatus === "Approved") {
        const shouldCreateReceipt =
          (responseRow.receiptId == null || responseRow.receiptId === "") &&
          responseRow.marketFeeAmount != null &&
          Number(responseRow.marketFeeAmount) >= 0;

        if (shouldCreateReceipt) {
          const [existingReceipt] = await db
            .select()
            .from(iomsReceipts)
            .where(and(eq(iomsReceipts.sourceModule, "M-04"), eq(iomsReceipts.sourceRecordId, responseRow.id)))
            .limit(1);

          let receiptRow = existingReceipt ?? null;
          if (!receiptRow) {
            // US-M04-004: If trader has sufficient advance balance, auto-adjust and mark receipt Paid.
            const advBal = await getMarketFeeAdvanceBalance(String(responseRow.traderLicenceId));
            const feeDue = Number(responseRow.marketFeeAmount ?? 0) || 0;

            const [licence] = await db
              .select()
              .from(traderLicences)
              .where(eq(traderLicences.id, responseRow.traderLicenceId))
              .limit(1);

            const createdBy = req.user?.id ?? "system";
            const created = await createIomsReceipt({
              yardId: responseRow.yardId,
              revenueHead: "MarketFee",
              payerName: licence?.firmName ?? responseRow.traderLicenceId,
              payerType: "TraderLicence",
              payerRefId: responseRow.traderLicenceId,
              isGracePeriod: Boolean((responseRow as { isGracePeriod?: boolean | null }).isGracePeriod),
              amount: Number(responseRow.marketFeeAmount ?? 0),
              paymentMode: "Cash",
              sourceModule: "M-04",
              sourceRecordId: responseRow.id,
              unifiedEntityId: unifiedEntityIdFromTrackA(responseRow.traderLicenceId),
              createdBy,
            });

            const [createdRow] = await db
              .select()
              .from(iomsReceipts)
              .where(eq(iomsReceipts.id, created.id))
              .limit(1);

            receiptRow = createdRow ?? null;
            if (createdRow) {
              await writeAuditLog(req, {
                module: "Receipts",
                action: "Create",
                recordId: createdRow.id,
                afterValue: createdRow,
              }).catch((e) => console.error("Audit log failed:", e));
            }

            if (feeDue > 0 && advBal >= feeDue - 0.01 && receiptRow?.id) {
              // Debit advance ledger and mark receipt paid.
              const now = new Date().toISOString();
              await db.insert(marketFeeLedger).values({
                id: nanoid(),
                traderLicenceId: String(responseRow.traderLicenceId),
                yardId: String(responseRow.yardId),
                entryDate: String(responseRow.transactionDate).slice(0, 10),
                entryType: "Adjustment",
                amountInr: Number((-feeDue).toFixed(2)),
                receiptId: receiptRow.id,
                sourceModule: "M-04",
                sourceRecordId: String(responseRow.id),
                createdBy,
                createdAt: now,
              });
              await db
                .update(iomsReceipts)
                .set({ status: "Paid", gatewayRef: "AdvanceAdjust" })
                .where(eq(iomsReceipts.id, receiptRow.id));
              const [paidRow] = await db.select().from(iomsReceipts).where(eq(iomsReceipts.id, receiptRow.id)).limit(1);
              receiptRow = paidRow ?? receiptRow;
            }
          }

          if (receiptRow?.id) {
            await db
              .update(purchaseTransactions)
              .set({ receiptId: receiptRow.id })
              .where(eq(purchaseTransactions.id, responseRow.id));

            const [updated] = await db
              .select()
              .from(purchaseTransactions)
              .where(eq(purchaseTransactions.id, responseRow.id))
              .limit(1);
            if (updated) responseRow = updated;
          }
        }
      }

      writeAuditLog(req, { module: "Market", action: "Update", recordId: id, beforeValue: existing, afterValue: responseRow }).catch((e) => console.error("Audit log failed:", e));
      res.json(responseRow);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to update purchase transaction");
    }
  });

  // ----- Monthly returns (wizard) -----
  app.get("/api/ioms/market/returns", async (req, res) => {
    try {
      const traderLicenceId = String(req.query.traderLicenceId ?? "").trim();
      const period = String(req.query.period ?? "").trim();
      const list = traderLicenceId
        ? await db
            .select()
            .from(marketMonthlyReturns)
            .where(eq(marketMonthlyReturns.traderLicenceId, traderLicenceId))
            .orderBy(desc(marketMonthlyReturns.period))
        : await db.select().from(marketMonthlyReturns).orderBy(desc(marketMonthlyReturns.period));
      const filtered = period ? list.filter((r) => r.period === period) : list;
      res.json(filtered);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch market returns");
    }
  });

  /** Step-2 preview: aggregates purchases for trader+month; opening from prior closing. */
  app.get("/api/ioms/market/returns/preview", async (req, res) => {
    try {
      const traderLicenceId = String(req.query.traderLicenceId ?? "").trim();
      const period = String(req.query.period ?? "").trim();
      if (!traderLicenceId || !period) {
        return sendApiError(res, 400, "MKT_RETURN_PREVIEW_FIELDS", "traderLicenceId and period (YYYY-MM) are required");
      }
      if (!isValidMonthPeriod(period)) {
        return sendApiError(res, 400, "MKT_RETURN_PREVIEW_PERIOD", "period must be YYYY-MM");
      }
      const scopedIds = req.scopedLocationIds;
      const [lic] = await db.select().from(traderLicences).where(eq(traderLicences.id, traderLicenceId)).limit(1);
      if (!lic) return sendApiError(res, 404, "LICENCE_NOT_FOUND", "Trader licence not found");
      if (scopedIds && scopedIds.length > 0 && !scopedIds.includes(lic.yardId)) {
        return sendApiError(res, 404, "LICENCE_NOT_FOUND", "Trader licence not found");
      }
      const lines = await buildReturnPreview({ traderLicenceId, period });
      const totalPurchaseValueInr = lines.reduce((s, l) => s + (Number(l.purchaseValueInr ?? 0) || 0), 0);
      res.json({ traderLicenceId, period, totalPurchaseValueInr, lines });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to preview market return");
    }
  });

  app.get("/api/ioms/market/returns/:id", async (req, res) => {
    try {
      const id = String(req.params.id ?? "").trim();
      const [ret] = await db.select().from(marketMonthlyReturns).where(eq(marketMonthlyReturns.id, id)).limit(1);
      if (!ret) return sendApiError(res, 404, "MKT_RETURN_NOT_FOUND", "Return not found");
      const scopedIds = req.scopedLocationIds;
      const [lic] = await db.select().from(traderLicences).where(eq(traderLicences.id, ret.traderLicenceId)).limit(1);
      if (!lic) return sendApiError(res, 404, "MKT_RETURN_NOT_FOUND", "Return not found");
      if (scopedIds && scopedIds.length > 0 && !scopedIds.includes(lic.yardId)) {
        return sendApiError(res, 404, "MKT_RETURN_NOT_FOUND", "Return not found");
      }
      const lines = await db.select().from(marketMonthlyReturnLines).where(eq(marketMonthlyReturnLines.returnId, id));
      res.json({ ...ret, lines });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch market return");
    }
  });

  app.get("/api/ioms/market/returns/:id/pdf", async (req, res) => {
    try {
      const id = String(req.params.id ?? "").trim();
      const [ret] = await db.select().from(marketMonthlyReturns).where(eq(marketMonthlyReturns.id, id)).limit(1);
      if (!ret) return sendApiError(res, 404, "MKT_RETURN_NOT_FOUND", "Return not found");
      const scopedIds = req.scopedLocationIds;
      const [lic] = await db.select().from(traderLicences).where(eq(traderLicences.id, ret.traderLicenceId)).limit(1);
      if (!lic) return sendApiError(res, 404, "MKT_RETURN_NOT_FOUND", "Return not found");
      if (scopedIds && scopedIds.length > 0 && !scopedIds.includes(lic.yardId)) {
        return sendApiError(res, 404, "MKT_RETURN_NOT_FOUND", "Return not found");
      }
      const [yard] = await db.select({ name: yards.name, code: yards.code }).from(yards).where(eq(yards.id, lic.yardId)).limit(1);
      const yardLabel = yard?.name ? `${yard.name} (${yard.code})` : lic.yardId;
      const traderLabel = lic.licenceNo ? `${lic.licenceNo}${lic.firmName ? ` — ${lic.firmName}` : ""}` : (lic.firmName ?? lic.id);
      const lines = await db.select().from(marketMonthlyReturnLines).where(eq(marketMonthlyReturnLines.returnId, id));
      const pdf = await buildMarketReturnPdf({ ret, lines, yardLabel, traderLabel });
      const safeName = (ret.acknowledgementRef ?? ret.id).replace(/[^\w.-]+/g, "_");
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="market-return-${safeName}.pdf"`);
      res.send(pdf);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to generate return PDF");
    }
  });

  /**
   * Create or submit a monthly return.
   * - If status=Draft: save lines (no ack ref)
   * - If status=Submitted: generate acknowledgementRef and lock the record for later verify/approve
   */
  app.post("/api/ioms/market/returns", async (req, res) => {
    try {
      const body = req.body as Record<string, unknown>;
      const traderLicenceId = String(body.traderLicenceId ?? "").trim();
      const period = String(body.period ?? "").trim();
      const status = String(body.status ?? "Draft").trim() || "Draft";
      const filingMode = String(body.filingMode ?? "Self").trim() || "Self";
      const linesRaw = (body.lines ?? []) as unknown;
      if (!traderLicenceId || !period) {
        return sendApiError(res, 400, "MKT_RETURN_FIELDS_REQUIRED", "traderLicenceId and period are required");
      }
      if (!isValidMonthPeriod(period)) {
        return sendApiError(res, 400, "MKT_RETURN_PERIOD", "period must be YYYY-MM");
      }
      if (!["Draft", "Submitted"].includes(status)) {
        return sendApiError(res, 400, "MKT_RETURN_STATUS", "status must be Draft or Submitted");
      }
      const scopedIds = req.scopedLocationIds;
      const [lic] = await db.select().from(traderLicences).where(eq(traderLicences.id, traderLicenceId)).limit(1);
      if (!lic) return sendApiError(res, 404, "LICENCE_NOT_FOUND", "Trader licence not found");
      if (scopedIds && scopedIds.length > 0 && !scopedIds.includes(lic.yardId)) {
        return sendApiError(res, 404, "LICENCE_NOT_FOUND", "Trader licence not found");
      }

      const id = nanoid();
      const ts = nowIso();
      const ackRef = status === "Submitted" ? await allocateMarketReturnAckRef({ yardId: lic.yardId, period }) : null;

      if (!Array.isArray(linesRaw)) {
        return sendApiError(res, 400, "MKT_RETURN_LINES", "lines must be an array");
      }
      const lines = linesRaw
        .map((x) => x as Record<string, unknown>)
        .map((o) => ({
          commodityId: String(o.commodityId ?? "").trim(),
          openingQty: Number(o.openingQty ?? 0) || 0,
          purchaseQty: Number(o.purchaseQty ?? 0) || 0,
          purchaseValueInr: Number(o.purchaseValueInr ?? 0) || 0,
          salesQty: Number(o.salesQty ?? 0) || 0,
        }))
        .filter((l) => l.commodityId);

      // If submitting, always recompute purchase totals from server preview to prevent tampering.
      let effectiveLines = lines;
      if (status === "Submitted") {
        const preview = await buildReturnPreview({ traderLicenceId, period });
        const byCommodity = new Map(preview.map((p) => [p.commodityId, p]));
        effectiveLines = effectiveLines.map((l) => {
          const p = byCommodity.get(l.commodityId);
          const openingQty = p ? p.openingQty : l.openingQty;
          const purchaseQty = p ? p.purchaseQty : 0;
          const purchaseValueInr = p ? p.purchaseValueInr : 0;
          const closingQty = openingQty + purchaseQty - l.salesQty;
          return { ...l, openingQty, purchaseQty, purchaseValueInr, closingQty };
        });
      }

      const totalPurchaseValueInr = effectiveLines.reduce((s, l) => s + (Number(l.purchaseValueInr ?? 0) || 0), 0);
      // Default 1% fee per workbook statement; can be made configurable later.
      const totalMarketFeeInr = Number(((totalPurchaseValueInr * 1) / 100).toFixed(2));

      const cfg = await getMergedSystemConfig();
      const deadlineDay = parseSystemConfigNumber(cfg, "market_return_deadline_day");
      const interestRate = parseSystemConfigNumber(cfg, "market_return_interest_percent_per_annum");
      const deadlineDate = deadlineIsoForPeriod(period, deadlineDay);
      const daysLate = status === "Submitted" ? daysLateForSubmission(deadlineDate, ts) : 0;
      const lateSubmissionFlag = daysLate > 0;
      const interestAmountInr =
        status === "Submitted" && daysLate > 0
          ? Number(((totalMarketFeeInr * (interestRate / 100)) / 365 * daysLate).toFixed(2))
          : 0;

      await db.transaction(async (tx) => {
        await tx.insert(marketMonthlyReturns).values({
          id,
          traderLicenceId,
          period,
          status,
          acknowledgementRef: ackRef,
          filingMode,
          filedByUserId: req.user?.id ?? null,
          totalPurchaseValueInr,
          totalMarketFeeInr,
          lateSubmissionFlag,
          deadlineDate,
          daysLate,
          interestAmountInr,
          submittedAt: status === "Submitted" ? ts : null,
          createdAt: ts,
          updatedAt: ts,
        });
        for (const l of effectiveLines) {
          await tx.insert(marketMonthlyReturnLines).values({
            id: nanoid(),
            returnId: id,
            commodityId: l.commodityId,
            openingQty: l.openingQty,
            purchaseQty: l.purchaseQty,
            purchaseValueInr: l.purchaseValueInr,
            salesQty: l.salesQty,
            closingQty: (l as { closingQty?: number }).closingQty ?? (l.openingQty + l.purchaseQty - l.salesQty),
          });
        }
      });

      const [row] = await db.select().from(marketMonthlyReturns).where(eq(marketMonthlyReturns.id, id)).limit(1);
      if (row) {
        writeAuditLog(req, { module: "Market", action: "CreateReturn", recordId: id, afterValue: row }).catch((e) =>
          console.error("Audit log failed:", e),
        );
      }
      res.status(201).json({ ...row, lines: await db.select().from(marketMonthlyReturnLines).where(eq(marketMonthlyReturnLines.returnId, id)) });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create market return");
    }
  });

  // ----- Check post inward -----
  app.get("/api/ioms/checkpost/inward", async (req, res) => {
    try {
      const checkPostId = req.query.checkPostId as string | undefined;
      const scopedIds = req.scopedLocationIds;
      const conditions = [];
      if (scopedIds && scopedIds.length > 0) conditions.push(inArray(checkPostInward.checkPostId, scopedIds));
      if (checkPostId) conditions.push(eq(checkPostInward.checkPostId, checkPostId));
      const base = db.select().from(checkPostInward).orderBy(desc(checkPostInward.entryDate));
      let list = conditions.length > 0 ? await base.where(and(...conditions)) : await base;
      if (checkPostId) list = list.filter((r) => r.checkPostId === checkPostId);
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch inward entries");
    }
  });

  app.post("/api/ioms/checkpost/inward", async (req, res) => {
    try {
      const body = req.body;
      const checkPostId = String(body.checkPostId ?? "");
      const transactionType = String(body.transactionType ?? "Permanent");
      const entryDate = String(body.entryDate ?? "");
      const status = String(body.status ?? "Draft");
      const totalCharges = body.totalCharges != null ? Number(body.totalCharges) : null;
      const isDvOrAdmin = Boolean(req.user?.roles?.some((r) => r.tier === "DV" || r.tier === "ADMIN"));
      const traderLicenceId =
        body.traderLicenceId != null && String(body.traderLicenceId).trim() !== "" ? String(body.traderLicenceId).trim() : null;

      if (!checkPostId || !entryDate) {
        return sendApiError(res, 400, "CHECKPOST_INWARD_FIELDS_REQUIRED", "checkPostId and entryDate are required");
      }
      // US-M04-003 acceptance: block future-dated arrival entry.
      const today = new Date().toISOString().slice(0, 10);
      if (String(entryDate) > today) {
        return sendApiError(res, 400, "CHECKPOST_INWARD_FUTURE_DATE", "Future-dated arrivals are not allowed.");
      }
      if (!isScopedCheckPost(req, checkPostId)) {
        return sendApiError(res, 403, "CHECKPOST_ACCESS_DENIED", "You do not have access to this check post");
      }
      if (!isValidStatus(status, ["Draft", "Verified"])) {
        return sendApiError(res, 400, "CHECKPOST_INWARD_STATUS_INVALID", "Invalid status. Allowed: Draft, Verified");
      }
      if (status === "Verified" && !isDvOrAdmin) {
        return sendApiError(
          res,
          403,
          "CHECKPOST_INWARD_CREATE_VERIFY_DENIED",
          "Only DV or Admin can create inward entries as Verified",
        );
      }
      if (totalCharges != null && (Number.isNaN(totalCharges) || totalCharges < 0)) {
        return sendApiError(
          res,
          400,
          "CHECKPOST_INWARD_TOTAL_CHARGES_INVALID",
          "totalCharges must be a non-negative number",
        );
      }

      let isGracePeriod = false;
      if (traderLicenceId) {
        const [lic] = await db.select().from(traderLicences).where(eq(traderLicences.id, traderLicenceId)).limit(1);
        if (!lic) return sendApiError(res, 404, "LICENCE_NOT_FOUND", "Trader licence not found");
        const evalRes = await evaluateMarketFeeLicenceWindow({ licenceValidToIso: lic.validTo, transactionDateIso: entryDate });
        if (!evalRes.ok) return sendApiError(res, 400, evalRes.code, evalRes.message);
        isGracePeriod = evalRes.isGrace;
      }

      const id = nanoid();
      await db.insert(checkPostInward).values({
        id,
        checkPostId,
        transactionType,
        entryDate,
        status,
        traderLicenceId,
        invoiceNumber: body.invoiceNumber ? String(body.invoiceNumber) : null,
        vehicleNumber: body.vehicleNumber ? String(body.vehicleNumber) : null,
        fromFirm: body.fromFirm ? String(body.fromFirm) : null,
        toFirm: body.toFirm ? String(body.toFirm) : null,
        fromState: body.fromState ? String(body.fromState) : null,
        toState: body.toState ? String(body.toState) : null,
        totalCharges,
        encodedData: body.encodedData ? String(body.encodedData) : null,
        isGracePeriod,
        officerId: body.officerId ? String(body.officerId) : null,
      });
      const [row] = await db.select().from(checkPostInward).where(eq(checkPostInward.id, id));
      if (row) {
        writeAuditLog(req, { module: "CheckPost", action: "Create", recordId: id, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      }
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create inward entry");
    }
  });

  app.put("/api/ioms/checkpost/inward/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const [existing] = await db.select().from(checkPostInward).where(eq(checkPostInward.id, id));
      if (!existing) return sendApiError(res, 404, "CHECKPOST_INWARD_NOT_FOUND", "Check post inward entry not found");
      if (!isScopedCheckPost(req, existing.checkPostId)) {
        return sendApiError(res, 403, "CHECKPOST_ACCESS_DENIED", "You do not have access to this check post");
      }
      const body = req.body;
      const newStatus = body.status !== undefined ? String(body.status) : existing.status;
      if (!isValidStatus(newStatus, ["Draft", "Verified"])) {
        return sendApiError(res, 400, "CHECKPOST_INWARD_STATUS_INVALID", "Invalid status. Allowed: Draft, Verified");
      }
      if (existing.status === "Draft" && newStatus === "Verified") {
        if (!canVerifyCheckPostInward(req.user)) {
          return sendApiError(
            res,
            403,
            "CHECKPOST_INWARD_VERIFY_DENIED",
            "Only DV or Admin can verify check post inward entries.",
          );
        }
      }
      if (existing.status === "Verified" && newStatus !== "Verified") {
        return sendApiError(
          res,
          400,
          "CHECKPOST_INWARD_NO_REVERT_FROM_VERIFIED",
          "Verified inward entries cannot be moved back to Draft",
        );
      }

      // Phase-1 linkage: on verification, ensure inward has commodity lines and a MarketFee receipt.
      if (existing.status === "Draft" && newStatus === "Verified") {
        const lines = await db
          .select()
          .from(checkPostInwardCommodities)
          .where(eq(checkPostInwardCommodities.inwardId, existing.id));
        if (!lines || lines.length === 0) {
          return sendApiError(
            res,
            400,
            "CHECKPOST_INWARD_VERIFY_REQUIRES_LINES",
            "Add at least one commodity line before verifying the inward entry.",
          );
        }
        const computedFee = Number(
          lines
            .reduce((s, l) => {
              const explicit = l.marketFeeAmount != null ? Number(l.marketFeeAmount) : null;
              if (explicit != null && Number.isFinite(explicit)) return s + explicit;
              const v = Number(l.value ?? 0) || 0;
              const p = l.marketFeePercent != null ? Number(l.marketFeePercent) : 0;
              if (!Number.isFinite(p) || p <= 0) return s;
              return s + (v * p) / 100;
            }, 0)
            .toFixed(2),
        );

        const totalCharges =
          existing.totalCharges != null && Number.isFinite(Number(existing.totalCharges))
            ? Number(existing.totalCharges)
            : computedFee;

        if (totalCharges > 0 && (!existing.traderLicenceId || String(existing.traderLicenceId).trim() === "")) {
          return sendApiError(
            res,
            400,
            "CHECKPOST_INWARD_VERIFY_REQUIRES_TRADER",
            "Trader licence is required to verify a chargeable inward entry.",
          );
        }

        const shouldCreateReceipt =
          (!("receiptId" in existing) || !(existing as { receiptId?: string | null }).receiptId) && totalCharges >= 0;

        let receiptIdToLink: string | null = (existing as { receiptId?: string | null }).receiptId ?? null;
        if (shouldCreateReceipt) {
          const [existingReceipt] = await db
            .select()
            .from(iomsReceipts)
            .where(and(eq(iomsReceipts.sourceModule, "M-04"), eq(iomsReceipts.sourceRecordId, existing.id)))
            .limit(1);

          let receiptRow = existingReceipt ?? null;
          if (!receiptRow) {
            const [licence] =
              existing.traderLicenceId != null
                ? await db.select().from(traderLicences).where(eq(traderLicences.id, String(existing.traderLicenceId))).limit(1)
                : [null];
            const createdBy = req.user?.id ?? "system";
            const created = await createIomsReceipt({
              yardId: existing.checkPostId,
              revenueHead: "MarketFee",
              payerName: licence?.firmName ?? existing.traderLicenceId ?? existing.fromFirm ?? "—",
              payerType: existing.traderLicenceId ? "TraderLicence" : "Other",
              payerRefId: existing.traderLicenceId ?? undefined,
              isGracePeriod: Boolean((existing as { isGracePeriod?: boolean | null }).isGracePeriod),
              amount: totalCharges,
              paymentMode: "Cash",
              sourceModule: "M-04",
              sourceRecordId: existing.id,
              unifiedEntityId: existing.traderLicenceId ? unifiedEntityIdFromTrackA(existing.traderLicenceId) : null,
              createdBy,
            });
            const [createdRow] = await db.select().from(iomsReceipts).where(eq(iomsReceipts.id, created.id)).limit(1);
            receiptRow = createdRow ?? null;
          }
          receiptIdToLink = receiptRow?.id ?? null;
        }

        // Inject computed totals/receipt link into updates below.
        body.totalCharges = totalCharges;
        if (receiptIdToLink) body.receiptId = receiptIdToLink;
      }

      // Once verified, core fields are immutable.
      if (existing.status === "Verified") {
        const forbiddenAfterVerify = [
          "checkPostId",
          "transactionType",
          "entryDate",
          "traderLicenceId",
          "invoiceNumber",
          "vehicleNumber",
          "fromFirm",
          "toFirm",
          "fromState",
          "toState",
          "totalCharges",
          "receiptId",
          "encodedData",
          "officerId",
        ];
        const tried = forbiddenAfterVerify.some((k) => body[k] !== undefined);
        if (tried) {
          return sendApiError(
            res,
            400,
            "CHECKPOST_INWARD_VERIFIED_IMMUTABLE",
            "Verified inward entries are immutable; only status metadata can be updated.",
          );
        }
      }

      const updates: Record<string, unknown> = {};
      ["checkPostId", "transactionType", "entryDate", "status", "traderLicenceId", "invoiceNumber", "vehicleNumber", "fromFirm", "toFirm", "fromState", "toState", "totalCharges", "receiptId", "encodedData", "officerId"].forEach((k) => {
        if (body[k] === undefined) return;
        if (k === "totalCharges") updates[k] = body[k] == null ? null : Number(body[k]);
        else updates[k] = body[k] == null ? null : String(body[k]);
      });
      if (updates.checkPostId && !isScopedCheckPost(req, String(updates.checkPostId))) {
        return sendApiError(res, 403, "CHECKPOST_ACCESS_DENIED", "You do not have access to this check post");
      }
      await db.update(checkPostInward).set(updates as Record<string, string | number | null>).where(eq(checkPostInward.id, id));
      const [row] = await db.select().from(checkPostInward).where(eq(checkPostInward.id, id));
      if (!row) return sendApiError(res, 404, "CHECKPOST_INWARD_NOT_FOUND", "Not found");
      writeAuditLog(req, { module: "CheckPost", action: "Update", recordId: id, beforeValue: existing, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to update check post inward");
    }
  });

  // ----- Check post inward commodities (line items) -----
  app.get("/api/ioms/checkpost/inward/:inwardId/commodities", async (req, res) => {
    try {
      const [inward] = await db.select().from(checkPostInward).where(eq(checkPostInward.id, req.params.inwardId)).limit(1);
      if (!inward) return sendApiError(res, 404, "CHECKPOST_INWARD_NOT_FOUND", "Inward entry not found");
      if (!isScopedCheckPost(req, inward.checkPostId)) {
        return sendApiError(res, 403, "CHECKPOST_ACCESS_DENIED", "You do not have access to this check post");
      }
      const list = await db.select().from(checkPostInwardCommodities).where(eq(checkPostInwardCommodities.inwardId, req.params.inwardId));
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch inward commodities");
    }
  });

  app.post("/api/ioms/checkpost/inward/:inwardId/commodities", async (req, res) => {
    try {
      const inwardId = req.params.inwardId;
      const body = req.body;
      const [inward] = await db.select().from(checkPostInward).where(eq(checkPostInward.id, inwardId)).limit(1);
      if (!inward) return sendApiError(res, 404, "CHECKPOST_INWARD_NOT_FOUND", "Inward entry not found");
      if (!isScopedCheckPost(req, inward.checkPostId)) {
        return sendApiError(res, 403, "CHECKPOST_ACCESS_DENIED", "You do not have access to this check post");
      }

      const commodityId = String(body.commodityId ?? "");
      const unit = String(body.unit ?? "");
      const quantity = Number(body.quantity ?? 0);
      const value = Number(body.value ?? 0);
      const marketFeePercent = body.marketFeePercent != null ? Number(body.marketFeePercent) : null;
      const marketFeeAmount = body.marketFeeAmount != null ? Number(body.marketFeeAmount) : null;

      if (!commodityId || !unit) {
        return sendApiError(res, 400, "CHECKPOST_LINE_COMMODITY_REQUIRED", "commodityId and unit are required");
      }
      if (Number.isNaN(quantity) || quantity <= 0) {
        return sendApiError(res, 400, "CHECKPOST_LINE_QUANTITY_INVALID", "quantity must be greater than 0");
      }
      if (Number.isNaN(value) || value < 0) {
        return sendApiError(res, 400, "CHECKPOST_LINE_VALUE_INVALID", "value must be a non-negative number");
      }
      if (marketFeePercent != null && (Number.isNaN(marketFeePercent) || marketFeePercent < 0 || marketFeePercent > 100)) {
        return sendApiError(
          res,
          400,
          "CHECKPOST_LINE_MARKET_FEE_PERCENT_INVALID",
          "marketFeePercent must be between 0 and 100",
        );
      }
      if (marketFeeAmount != null && (Number.isNaN(marketFeeAmount) || marketFeeAmount < 0)) {
        return sendApiError(
          res,
          400,
          "CHECKPOST_LINE_MARKET_FEE_AMOUNT_INVALID",
          "marketFeeAmount must be a non-negative number",
        );
      }

      const id = nanoid();
      await db.insert(checkPostInwardCommodities).values({
        id,
        inwardId,
        commodityId,
        unit,
        quantity,
        value,
        marketFeePercent,
        marketFeeAmount,
      });
      const [row] = await db.select().from(checkPostInwardCommodities).where(eq(checkPostInwardCommodities.id, id));
      if (row) {
        writeAuditLog(req, { module: "CheckPost", action: "Create", recordId: id, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      }
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create inward commodity");
    }
  });

  // ----- Check post outward -----
  app.get("/api/ioms/checkpost/outward", async (req, res) => {
    try {
      const checkPostId = req.query.checkPostId as string | undefined;
      const scopedIds = req.scopedLocationIds;
      const conditions = [];
      if (scopedIds && scopedIds.length > 0) conditions.push(inArray(checkPostOutward.checkPostId, scopedIds));
      if (checkPostId) conditions.push(eq(checkPostOutward.checkPostId, checkPostId));
      const base = db.select().from(checkPostOutward).orderBy(desc(checkPostOutward.entryDate));
      let list = conditions.length > 0 ? await base.where(and(...conditions)) : await base;
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch outward entries");
    }
  });

  app.post("/api/ioms/checkpost/outward", async (req, res) => {
    try {
      const body = req.body;
      const checkPostId = String(body.checkPostId ?? "");
      const inwardRefId = String(body.inwardRefId ?? "");
      const entryDate = String(body.entryDate ?? "");
      if (!checkPostId || !inwardRefId || !entryDate) {
        return sendApiError(
          res,
          400,
          "CHECKPOST_OUTWARD_FIELDS_REQUIRED",
          "checkPostId, inwardRefId and entryDate are required",
        );
      }
      if (!isScopedCheckPost(req, checkPostId)) {
        return sendApiError(res, 403, "CHECKPOST_ACCESS_DENIED", "You do not have access to this check post");
      }
      const id = nanoid();
      await db.insert(checkPostOutward).values({
        id,
        checkPostId,
        inwardRefId,
        entryDate,
        vehicleNumber: body.vehicleNumber ? String(body.vehicleNumber) : null,
        receiptNumber: body.receiptNumber ? String(body.receiptNumber) : null,
      });
      const [row] = await db.select().from(checkPostOutward).where(eq(checkPostOutward.id, id));
      if (row) {
        writeAuditLog(req, { module: "CheckPost", action: "Create", recordId: id, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      }
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create outward entry");
    }
  });

  app.put("/api/ioms/checkpost/outward/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const [existing] = await db.select().from(checkPostOutward).where(eq(checkPostOutward.id, id)).limit(1);
      if (!existing) return sendApiError(res, 404, "CHECKPOST_OUTWARD_NOT_FOUND", "Not found");
      if (!isScopedCheckPost(req, existing.checkPostId)) {
        return sendApiError(res, 403, "CHECKPOST_ACCESS_DENIED", "You do not have access to this check post");
      }
      const body = req.body;
      const updates: Record<string, unknown> = {};
      ["checkPostId", "inwardRefId", "entryDate", "vehicleNumber", "receiptNumber"].forEach((k) => {
        if (body[k] === undefined) return;
        updates[k] = body[k] == null ? null : String(body[k]);
      });
      if (updates.checkPostId && !isScopedCheckPost(req, String(updates.checkPostId))) {
        return sendApiError(res, 403, "CHECKPOST_ACCESS_DENIED", "You do not have access to this check post");
      }
      await db.update(checkPostOutward).set(updates as Record<string, string | null>).where(eq(checkPostOutward.id, id));
      const [row] = await db.select().from(checkPostOutward).where(eq(checkPostOutward.id, id));
      if (!row) return sendApiError(res, 404, "CHECKPOST_OUTWARD_NOT_FOUND", "Not found");
      writeAuditLog(req, { module: "CheckPost", action: "Update", recordId: id, beforeValue: existing, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to update outward entry");
    }
  });

  // ----- Stock returns report (Import/Export) -----
  app.get("/api/ioms/checkpost/stock-returns", async (req, res) => {
    try {
      const from = String(req.query.from ?? "").trim(); // YYYY-MM-DD (optional)
      const to = String(req.query.to ?? "").trim(); // YYYY-MM-DD (optional)
      const checkPostId = String(req.query.checkPostId ?? "").trim(); // optional

      const iso = /^\d{4}-\d{2}-\d{2}$/;
      const fromIso = from && iso.test(from) ? from : "";
      const toIso = to && iso.test(to) ? to : "";

      const scopedIds = req.scopedLocationIds;

      const importConds = [];
      if (scopedIds && scopedIds.length > 0) importConds.push(inArray(checkPostInward.checkPostId, scopedIds));
      if (checkPostId) importConds.push(eq(checkPostInward.checkPostId, checkPostId));
      if (fromIso) importConds.push(gte(checkPostInward.entryDate, fromIso));
      if (toIso) importConds.push(lte(checkPostInward.entryDate, toIso));

      const exportConds = [];
      if (scopedIds && scopedIds.length > 0) exportConds.push(inArray(checkPostOutward.checkPostId, scopedIds));
      if (checkPostId) exportConds.push(eq(checkPostOutward.checkPostId, checkPostId));
      if (fromIso) exportConds.push(gte(checkPostOutward.entryDate, fromIso));
      if (toIso) exportConds.push(lte(checkPostOutward.entryDate, toIso));

      const imports = await db
        .select({
          checkPostId: checkPostInward.checkPostId,
          commodityId: checkPostInwardCommodities.commodityId,
          quantity: sql<number>`coalesce(sum(${checkPostInwardCommodities.quantity}), 0)`,
          value: sql<number>`coalesce(sum(${checkPostInwardCommodities.value}), 0)`,
        })
        .from(checkPostInwardCommodities)
        .innerJoin(checkPostInward, eq(checkPostInwardCommodities.inwardId, checkPostInward.id))
        .where(importConds.length ? and(...importConds) : undefined)
        .groupBy(checkPostInward.checkPostId, checkPostInwardCommodities.commodityId)
        .orderBy(checkPostInward.checkPostId);

      const exports = await db
        .select({
          checkPostId: checkPostOutward.checkPostId,
          commodityId: checkPostInwardCommodities.commodityId,
          quantity: sql<number>`coalesce(sum(${checkPostInwardCommodities.quantity}), 0)`,
          value: sql<number>`coalesce(sum(${checkPostInwardCommodities.value}), 0)`,
        })
        .from(checkPostOutward)
        .innerJoin(checkPostInwardCommodities, eq(checkPostOutward.inwardRefId, checkPostInwardCommodities.inwardId))
        .where(exportConds.length ? and(...exportConds) : undefined)
        .groupBy(checkPostOutward.checkPostId, checkPostInwardCommodities.commodityId)
        .orderBy(checkPostOutward.checkPostId);

      const importTotalQty = imports.reduce((s, r) => s + (Number(r.quantity ?? 0) || 0), 0);
      const importTotalValue = imports.reduce((s, r) => s + (Number(r.value ?? 0) || 0), 0);
      const exportTotalQty = exports.reduce((s, r) => s + (Number(r.quantity ?? 0) || 0), 0);
      const exportTotalValue = exports.reduce((s, r) => s + (Number(r.value ?? 0) || 0), 0);

      res.json({
        from: fromIso || null,
        to: toIso || null,
        checkPostId: checkPostId || null,
        imports,
        exports,
        totals: {
          importQty: Math.round(importTotalQty * 100) / 100,
          importValue: Math.round(importTotalValue * 100) / 100,
          exportQty: Math.round(exportTotalQty * 100) / 100,
          exportValue: Math.round(exportTotalValue * 100) / 100,
        },
      });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to build stock returns report");
    }
  });

  // ----- Exit permits -----
  app.get("/api/ioms/checkpost/exit-permits", async (req, res) => {
    try {
      const scopedIds = req.scopedLocationIds;
      const list = await db.select().from(exitPermits).orderBy(desc(exitPermits.issuedDate));
      if (!scopedIds || scopedIds.length === 0) {
        return res.json(list);
      }
      const inwardIds = Array.from(new Set(list.map((p) => p.inwardId)));
      if (inwardIds.length === 0) return res.json([]);
      const inwardRows = await db
        .select({ id: checkPostInward.id, checkPostId: checkPostInward.checkPostId })
        .from(checkPostInward)
        .where(inArray(checkPostInward.id, inwardIds));
      const allowedInwardIds = new Set(
        inwardRows.filter((r) => scopedIds.includes(r.checkPostId)).map((r) => r.id)
      );
      const scoped = list.filter((p) => allowedInwardIds.has(p.inwardId));
      res.json(scoped);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch exit permits");
    }
  });

  app.post("/api/ioms/checkpost/exit-permits", async (req, res) => {
    try {
      const body = req.body;
      const permitNo = String(body.permitNo ?? "");
      const inwardId = String(body.inwardId ?? "");
      const issuedDate = String(body.issuedDate ?? "");
      const officerId = String(body.officerId ?? "");
      if (!permitNo || !inwardId || !issuedDate || !officerId) {
        return sendApiError(
          res,
          400,
          "CHECKPOST_EXIT_PERMIT_FIELDS_REQUIRED",
          "permitNo, inwardId, issuedDate and officerId are required",
        );
      }
      const [inward] = await db.select().from(checkPostInward).where(eq(checkPostInward.id, inwardId)).limit(1);
      if (!inward) return sendApiError(res, 404, "CHECKPOST_INWARD_NOT_FOUND", "Inward entry not found");
      if (!isScopedCheckPost(req, inward.checkPostId)) {
        return sendApiError(res, 403, "CHECKPOST_ACCESS_DENIED", "You do not have access to this check post");
      }
      const id = nanoid();
      await db.insert(exitPermits).values({
        id,
        permitNo,
        inwardId,
        issuedDate,
        officerId,
      });
      const [row] = await db.select().from(exitPermits).where(eq(exitPermits.id, id));
      if (row) {
        writeAuditLog(req, { module: "CheckPost", action: "Create", recordId: id, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      }
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create exit permit");
    }
  });

  app.put("/api/ioms/checkpost/exit-permits/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const [existing] = await db.select().from(exitPermits).where(eq(exitPermits.id, id)).limit(1);
      if (!existing) return sendApiError(res, 404, "CHECKPOST_EXIT_PERMIT_NOT_FOUND", "Not found");
      const [existingInward] = await db.select().from(checkPostInward).where(eq(checkPostInward.id, existing.inwardId)).limit(1);
      if (existingInward && !isScopedCheckPost(req, existingInward.checkPostId)) {
        return sendApiError(res, 403, "CHECKPOST_ACCESS_DENIED", "You do not have access to this check post");
      }
      const body = req.body;
      const updates: Record<string, unknown> = {};
      ["permitNo", "inwardId", "issuedDate", "officerId"].forEach((k) => {
        if (body[k] === undefined) return;
        updates[k] = body[k] == null ? null : String(body[k]);
      });
      if (updates.inwardId) {
        const [newInward] = await db.select().from(checkPostInward).where(eq(checkPostInward.id, String(updates.inwardId))).limit(1);
        if (!newInward) return sendApiError(res, 404, "CHECKPOST_INWARD_NOT_FOUND", "Inward entry not found");
        if (!isScopedCheckPost(req, newInward.checkPostId)) {
          return sendApiError(res, 403, "CHECKPOST_ACCESS_DENIED", "You do not have access to this check post");
        }
      }
      await db.update(exitPermits).set(updates as Record<string, string | null>).where(eq(exitPermits.id, id));
      const [row] = await db.select().from(exitPermits).where(eq(exitPermits.id, id));
      if (!row) return sendApiError(res, 404, "CHECKPOST_EXIT_PERMIT_NOT_FOUND", "Not found");
      writeAuditLog(req, { module: "CheckPost", action: "Update", recordId: id, beforeValue: existing, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to update exit permit");
    }
  });

  // ----- Check post bank deposits -----
  app.get("/api/ioms/checkpost/bank-deposits", async (req, res) => {
    try {
      const checkPostId = req.query.checkPostId as string | undefined;
      const scopedIds = req.scopedLocationIds;
      const conditions = [];
      if (scopedIds && scopedIds.length > 0) conditions.push(inArray(checkPostBankDeposits.checkPostId, scopedIds));
      if (checkPostId) conditions.push(eq(checkPostBankDeposits.checkPostId, checkPostId));
      const base = db.select().from(checkPostBankDeposits).orderBy(desc(checkPostBankDeposits.depositDate));
      let list = conditions.length > 0 ? await base.where(and(...conditions)) : await base;
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch bank deposits");
    }
  });

  app.post("/api/ioms/checkpost/bank-deposits", async (req, res) => {
    try {
      const body = req.body;
      const checkPostId = String(body.checkPostId ?? "");
      const depositDate = String(body.depositDate ?? "");
      const bankName = String(body.bankName ?? "");
      const amount = Number(body.amount ?? 0);
      const status = String(body.status ?? "Recorded");
      const isDvOrAdmin = Boolean(req.user?.roles?.some((r) => r.tier === "DV" || r.tier === "ADMIN"));
      if (!checkPostId || !depositDate || !bankName) {
        return sendApiError(
          res,
          400,
          "CHECKPOST_DEPOSIT_FIELDS_REQUIRED",
          "checkPostId, depositDate and bankName are required",
        );
      }
      if (!isScopedCheckPost(req, checkPostId)) {
        return sendApiError(res, 403, "CHECKPOST_ACCESS_DENIED", "You do not have access to this check post");
      }
      if (Number.isNaN(amount) || amount <= 0) {
        return sendApiError(res, 400, "CHECKPOST_DEPOSIT_AMOUNT_POSITIVE", "amount must be greater than 0");
      }
      if (!isValidStatus(status, ["Recorded", "Verified"])) {
        return sendApiError(res, 400, "CHECKPOST_DEPOSIT_STATUS_INVALID", "Invalid status. Allowed: Recorded, Verified");
      }
      if (status === "Verified" && !isDvOrAdmin) {
        return sendApiError(
          res,
          403,
          "CHECKPOST_DEPOSIT_VERIFY_DENIED",
          "Only DV or Admin can mark bank deposits as Verified",
        );
      }
      const id = nanoid();
      await db.insert(checkPostBankDeposits).values({
        id,
        checkPostId,
        depositDate,
        bankName,
        amount,
        status,
        accountNumber: body.accountNumber ? String(body.accountNumber) : null,
        voucherDetails: body.voucherDetails ? String(body.voucherDetails) : null,
        narration: body.narration ? String(body.narration) : null,
        verifiedBy: status === "Verified" ? (req.user?.id ?? null) : (body.verifiedBy ? String(body.verifiedBy) : null),
      });
      const [row] = await db.select().from(checkPostBankDeposits).where(eq(checkPostBankDeposits.id, id));
      if (row) {
        writeAuditLog(req, { module: "CheckPost", action: "Create", recordId: id, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      }
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create bank deposit");
    }
  });

  app.put("/api/ioms/checkpost/bank-deposits/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const [existing] = await db.select().from(checkPostBankDeposits).where(eq(checkPostBankDeposits.id, id)).limit(1);
      if (!existing) return sendApiError(res, 404, "CHECKPOST_DEPOSIT_NOT_FOUND", "Not found");
      if (!isScopedCheckPost(req, existing.checkPostId)) {
        return sendApiError(res, 403, "CHECKPOST_ACCESS_DENIED", "You do not have access to this check post");
      }
      const body = req.body;
      const updates: Record<string, unknown> = {};
      ["checkPostId", "depositDate", "bankName", "status", "accountNumber", "voucherDetails", "narration", "verifiedBy"].forEach((k) => {
        if (body[k] !== undefined) updates[k] = body[k] == null ? null : String(body[k]);
      });
      if (body.amount !== undefined) updates.amount = body.amount == null ? null : Number(body.amount);
      const isDvOrAdmin = Boolean(req.user?.roles?.some((r) => r.tier === "DV" || r.tier === "ADMIN"));
      const newStatus = String((updates.status ?? existing.status) as string);

      // Once verified, deposit core fields become immutable.
      if (existing.status === "Verified") {
        const forbiddenAfterVerify = ["checkPostId", "depositDate", "bankName", "amount", "accountNumber", "voucherDetails", "narration"];
        const tried = forbiddenAfterVerify.some((k) => body[k] !== undefined);
        if (tried) {
          return sendApiError(
            res,
            400,
            "CHECKPOST_DEPOSIT_VERIFIED_IMMUTABLE",
            "Verified deposits are immutable; only status metadata can be updated.",
          );
        }
      }

      // Only DV/Admin can move Recorded -> Verified; do not allow downgrade.
      if (newStatus === "Verified" && existing.status !== "Verified" && !isDvOrAdmin) {
        return sendApiError(
          res,
          403,
          "CHECKPOST_DEPOSIT_VERIFY_DENIED",
          "Only DV or Admin can mark bank deposits as Verified",
        );
      }
      if (existing.status === "Verified" && newStatus !== "Verified") {
        return sendApiError(
          res,
          400,
          "CHECKPOST_DEPOSIT_NO_REVERT_FROM_VERIFIED",
          "Verified deposits cannot be moved back to Recorded",
        );
      }

      if (updates.checkPostId && !isScopedCheckPost(req, String(updates.checkPostId))) {
        return sendApiError(res, 403, "CHECKPOST_ACCESS_DENIED", "You do not have access to this check post");
      }
      if (updates.amount != null && (Number.isNaN(Number(updates.amount)) || Number(updates.amount) < 0)) {
        return sendApiError(res, 400, "CHECKPOST_DEPOSIT_AMOUNT_INVALID", "amount must be a non-negative number");
      }
      if (updates.status != null && !isValidStatus(String(updates.status), ["Recorded", "Verified"])) {
        return sendApiError(res, 400, "CHECKPOST_DEPOSIT_STATUS_INVALID", "Invalid status. Allowed: Recorded, Verified");
      }
      if (newStatus === "Verified") {
        updates.verifiedBy = req.user?.id ?? existing.verifiedBy ?? null;
      }
      await db.update(checkPostBankDeposits).set(updates as Record<string, string | number | null>).where(eq(checkPostBankDeposits.id, id));
      const [row] = await db.select().from(checkPostBankDeposits).where(eq(checkPostBankDeposits.id, id));
      if (!row) return sendApiError(res, 404, "CHECKPOST_DEPOSIT_NOT_FOUND", "Not found");
      writeAuditLog(req, { module: "CheckPost", action: "Update", recordId: id, beforeValue: existing, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to update bank deposit");
    }
  });
}
