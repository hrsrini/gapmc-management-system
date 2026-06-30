/**
 * M-04 unified market transaction wizard — calculate, validate, persist, finalize + receipt.
 */
import { desc, eq, inArray, asc } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  commodities,
  iomsReceipts,
  marketFeeLedger,
  marketTransactionCommodities,
  marketTransactions,
  traderLicences,
  yards,
} from "@shared/db-schema";
import {
  computeMarketTransactionTotals,
  isMarketTransactionCaseId,
  MARKET_TRANSACTION_CASES,
  type MarketTransactionCalculation,
  type MarketTransactionCaseId,
  type MarketTransactionWizardInput,
} from "@shared/market-transaction-cases";
import { db, pool } from "./db";
import { financialYearFromIsoTransactionDate } from "./market-purchase-transaction-no";
import { assertIsoTransactionDate, resolveMarketFeePercentForPurchase } from "./market-fee-resolve";
import { resolvePurchaseTransactionTraderRef } from "./market-purchase-trader-resolve";
import { createIomsReceipt } from "./routes-receipts-ioms";
import { unifiedEntityIdFromTrackA } from "@shared/unified-entity-id";

export async function generateNextMarketTransactionNo(params: {
  yardId: string;
  transactionDateIso: string;
}): Promise<string> {
  const fy = financialYearFromIsoTransactionDate(params.transactionDateIso);
  const [yard] = await db.select({ code: yards.code }).from(yards).where(eq(yards.id, params.yardId)).limit(1);
  const locRaw = yard?.code != null && String(yard.code).trim() !== "" ? String(yard.code).trim() : "LOC";
  const loc = locRaw.replace(/[^\w-]+/g, "").toUpperCase() || "LOC";

  const { rows } = await pool.query<{ last_seq: number }>(
    `INSERT INTO gapmc.purchase_transaction_sequence (yard_id, financial_year, last_seq)
     VALUES ($1::text, $2::text, 1)
     ON CONFLICT (yard_id, financial_year)
     DO UPDATE SET last_seq = gapmc.purchase_transaction_sequence.last_seq + 1
     RETURNING last_seq`,
    [params.yardId, fy],
  );
  const nextSeq = rows[0]?.last_seq;
  if (nextSeq == null || !Number.isFinite(Number(nextSeq))) {
    throw new Error("M-04: sequence allocation failed for market transaction number");
  }
  return `GAPLMB/${loc}/${fy}/MT/${String(nextSeq).padStart(5, "0")}`;
}

function licenceIsExpired(validTo: string | null | undefined, transactionDate: string): boolean {
  const vt = String(validTo ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(vt)) return false;
  return transactionDate > vt;
}

async function resolveLicence(id: string) {
  const resolved = await resolvePurchaseTransactionTraderRef(id);
  if (!resolved) return null;
  const [lic] = await db.select().from(traderLicences).where(eq(traderLicences.id, resolved.id)).limit(1);
  return lic ? { resolved, licence: lic } : null;
}

export async function calculateMarketTransactionWizard(
  input: MarketTransactionWizardInput,
): Promise<MarketTransactionCalculation> {
  const caseType = input.caseType;
  if (!isMarketTransactionCaseId(caseType)) throw new Error("Invalid case type");
  const txDate = assertIsoTransactionDate(input.transactionDate);
  const yardId = String(input.entryLocationId ?? "").trim();
  if (!yardId) throw new Error("Entry location is required");

  const lines: MarketTransactionCalculation["lines"] = [];
  for (const row of input.commodities ?? []) {
    const commodityId = String(row.commodityId ?? "").trim();
    const quantity = Number(row.quantity);
    const ratePerUnit = Number(row.ratePerUnit);
    const unit = String(row.unit ?? "").trim() || "Kg";
    if (!commodityId || !Number.isFinite(quantity) || quantity <= 0) continue;
    if (!Number.isFinite(ratePerUnit) || ratePerUnit < 0) continue;

    const resolved =
      row.marketFeePercent != null && Number.isFinite(Number(row.marketFeePercent))
        ? { feePercent: Number(row.marketFeePercent), source: "override" as const, rateId: null }
        : await resolveMarketFeePercentForPurchase({ yardId, commodityId, transactionDate: txDate });

    const commodityValue = Math.round(quantity * ratePerUnit * 100) / 100;
    const marketFeeAmount = Math.round((commodityValue * resolved.feePercent) / 100 * 100) / 100;
    lines.push({
      commodityId,
      quantity,
      unit,
      ratePerUnit,
      commodityValue,
      marketFeePercent: resolved.feePercent,
      marketFeeAmount,
    });
  }

  if (lines.length === 0) throw new Error("At least one commodity line is required");

  return computeMarketTransactionTotals(caseType, lines, {
    fineAmount: input.fineAmount,
    securityDepositAmount: input.securityDepositAmount,
    adminChargesAmount: input.adminChargesAmount,
    collectFine:
      input.collectFine === true ||
      caseType === "B" ||
      caseType === "C" ||
      (caseType === "G" && Number(input.fineAmount ?? 0) > 0),
  });
}

export async function validateMarketTransactionWizard(
  input: MarketTransactionWizardInput,
): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  const caseType = input.caseType;
  if (!isMarketTransactionCaseId(caseType)) {
    return { ok: false, code: "MKT_TX_CASE_INVALID", message: "Invalid transaction case" };
  }
  const meta = MARKET_TRANSACTION_CASES[caseType];
  let txDate: string;
  try {
    txDate = assertIsoTransactionDate(input.transactionDate);
  } catch {
    return { ok: false, code: "MKT_TX_DATE_INVALID", message: "transactionDate must be YYYY-MM-DD" };
  }
  const today = new Date().toISOString().slice(0, 10);
  if (txDate > today) {
    return { ok: false, code: "MKT_TX_FUTURE_DATE", message: "Future-dated transactions are not allowed" };
  }
  if (!String(input.entryLocationId ?? "").trim()) {
    return { ok: false, code: "MKT_TX_LOCATION_REQUIRED", message: "Entry location (yard/checkpost) is required" };
  }
  if (!input.commodities?.length) {
    return { ok: false, code: "MKT_TX_COMMODITIES_REQUIRED", message: "At least one commodity line is required" };
  }

  if (meta.requiresManualTrader && !String(input.traderManualName ?? "").trim()) {
    return { ok: false, code: "MKT_TX_TRADER_NAME_REQUIRED", message: "Trader name is required for unregistered traders" };
  }

  if (meta.requiresTraderLicence) {
    const tid = String(input.traderLicenceId ?? "").trim();
    if (!tid) return { ok: false, code: "MKT_TX_LICENCE_REQUIRED", message: "Trader licence is required" };
    const licRow = await resolveLicence(tid);
    if (!licRow) return { ok: false, code: "MKT_TX_LICENCE_NOT_FOUND", message: "Trader licence not found" };
    const expired = licenceIsExpired(licRow.licence.validTo, txDate);
    if (caseType === "B") {
      if (!expired) {
        return { ok: false, code: "MKT_TX_LICENCE_NOT_EXPIRED", message: "Case B requires an expired licence holder" };
      }
    } else if (!meta.allowsExpiredLicence && expired) {
      return { ok: false, code: "MKT_TX_LICENCE_EXPIRED", message: "Trader licence is expired" };
    }
    if (licRow.licence.isBlocked) {
      return { ok: false, code: "MKT_TX_LICENCE_BLOCKED", message: "Trader licence is blocked" };
    }
  }

  if (meta.requiresReceiverTrader) {
    const rid = String(input.receiverTraderLicenceId ?? "").trim();
    if (!rid) return { ok: false, code: "MKT_TX_RECEIVER_REQUIRED", message: "Receiver trader is required" };
    const recv = await resolveLicence(rid);
    if (!recv) return { ok: false, code: "MKT_TX_RECEIVER_NOT_FOUND", message: "Receiver trader licence not found" };
    if (input.feePayer !== "Originator" && input.feePayer !== "Receiver") {
      return { ok: false, code: "MKT_TX_FEE_PAYER_REQUIRED", message: "Select who pays the market fee" };
    }
  }

  if (meta.requiresTransitFields) {
    if (!String(input.originatingState ?? "").trim() || !String(input.destinationState ?? "").trim()) {
      return { ok: false, code: "MKT_TX_TRANSIT_STATES", message: "Originating and destination state are required" };
    }
  }

  if (meta.allowsFine && (caseType === "B" || caseType === "C")) {
    const fine = Number(input.fineAmount ?? 0);
    if (!Number.isFinite(fine) || fine <= 0) {
      return { ok: false, code: "MKT_TX_FINE_REQUIRED", message: "Fine amount is required for this case" };
    }
  }

  return { ok: true };
}

async function getMarketFeeAdvanceBalance(traderLicenceId: string): Promise<number> {
  const rows = await db
    .select({ amountInr: marketFeeLedger.amountInr })
    .from(marketFeeLedger)
    .where(eq(marketFeeLedger.traderLicenceId, traderLicenceId));
  return Math.round(rows.reduce((s, r) => s + Number(r.amountInr ?? 0), 0) * 100) / 100;
}

export async function createMarketTransactionDraft(args: {
  input: MarketTransactionWizardInput;
  createdBy: string;
}): Promise<{ id: string; transactionNo: string; calculation: MarketTransactionCalculation }> {
  const validation = await validateMarketTransactionWizard(args.input);
  if (!validation.ok) throw Object.assign(new Error(validation.message), { code: validation.code });

  const calculation = await calculateMarketTransactionWizard(args.input);
  const id = nanoid();
  const transactionNo = await generateNextMarketTransactionNo({
    yardId: args.input.entryLocationId,
    transactionDateIso: args.input.transactionDate,
  });
  const now = new Date().toISOString();

  await db.transaction(async (tx) => {
    await tx.insert(marketTransactions).values({
      id,
      transactionNo,
      caseType: args.input.caseType,
      entryLocationId: args.input.entryLocationId,
      transactionDate: args.input.transactionDate,
      transactionTime: args.input.transactionTime ?? null,
      captureMode: args.input.captureMode ?? "Normal",
      captureLocationText: args.input.captureLocationText ?? null,
      vehicleNumber: args.input.vehicleNumber ?? null,
      vehicleMake: args.input.vehicleMake ?? null,
      vehicleCapacityKg: args.input.vehicleCapacityKg ?? null,
      traderLicenceId: args.input.traderLicenceId ?? null,
      traderManualName: args.input.traderManualName ?? null,
      traderManualContact: args.input.traderManualContact ?? null,
      traderManualAddress: args.input.traderManualAddress ?? null,
      receiverTraderLicenceId: args.input.receiverTraderLicenceId ?? null,
      feePayer: args.input.feePayer ?? null,
      sellerType: args.input.sellerType ?? null,
      farmerType: args.input.farmerType ?? null,
      farmerName: args.input.farmerName ?? null,
      farmerKrishiCard: args.input.farmerKrishiCard ?? null,
      farmerContact: args.input.farmerContact ?? null,
      farmerAddress: args.input.farmerAddress ?? null,
      commoditySource: args.input.commoditySource ?? null,
      placeOfOrigin: args.input.placeOfOrigin ?? null,
      originatingState: args.input.originatingState ?? null,
      destinationState: args.input.destinationState ?? null,
      exitCheckpostsJson: args.input.exitCheckpostIds?.length ? JSON.stringify(args.input.exitCheckpostIds) : null,
      anyExitCheckpost: Boolean(args.input.anyExitCheckpost),
      totalCommodityValue: calculation.totalCommodityValue,
      totalMarketFee: calculation.totalMarketFee,
      fineAmount: calculation.fineAmount,
      securityDepositAmount: calculation.securityDepositAmount,
      adminChargesAmount: calculation.adminChargesAmount,
      totalPayable: calculation.totalPayable,
      status: "Draft",
      createdBy: args.createdBy,
      createdAt: now,
    });

    let sort = 0;
    for (const line of calculation.lines) {
      await tx.insert(marketTransactionCommodities).values({
        id: nanoid(),
        transactionId: id,
        sortOrder: sort++,
        commodityId: line.commodityId,
        quantity: line.quantity,
        unit: line.unit,
        ratePerUnit: line.ratePerUnit,
        commodityValue: line.commodityValue,
        marketFeePercent: line.marketFeePercent,
        marketFeeAmount: line.marketFeeAmount,
      });
    }
  });

  return { id, transactionNo, calculation };
}

export async function finalizeMarketTransaction(args: {
  transactionId: string;
  paymentMode: string;
  paymentDetail?: Record<string, unknown>;
  paidAmount?: number;
  createdBy: string;
}): Promise<{ receiptId: string; receiptNo: string }> {
  const [tx] = await db.select().from(marketTransactions).where(eq(marketTransactions.id, args.transactionId)).limit(1);
  if (!tx) throw Object.assign(new Error("Transaction not found"), { code: "MKT_TX_NOT_FOUND" });
  if (tx.status === "Finalized") {
    throw Object.assign(new Error("Transaction already finalized"), { code: "MKT_TX_ALREADY_FINALIZED" });
  }
  if (tx.status === "Voided") throw Object.assign(new Error("Transaction is voided"), { code: "MKT_TX_VOIDED" });

  const totalPayable = Number(tx.totalPayable ?? 0);
  const paid = args.paidAmount != null ? Number(args.paidAmount) : totalPayable;
  if (!Number.isFinite(paid) || Math.abs(paid - totalPayable) > 0.02) {
    throw Object.assign(new Error(`Paid amount must equal total payable (${totalPayable.toFixed(2)})`), {
      code: "MKT_TX_PAID_AMOUNT",
    });
  }

  const caseType = tx.caseType as MarketTransactionCaseId;
  const lineRows = await db
    .select()
    .from(marketTransactionCommodities)
    .where(eq(marketTransactionCommodities.transactionId, tx.id));

  const calc = computeMarketTransactionTotals(
    caseType,
    lineRows.map((l) => ({
      commodityId: l.commodityId,
      quantity: Number(l.quantity),
      unit: l.unit,
      ratePerUnit: Number(l.ratePerUnit),
      commodityValue: Number(l.commodityValue),
      marketFeePercent: Number(l.marketFeePercent),
      marketFeeAmount: Number(l.marketFeeAmount),
    })),
    {
      fineAmount: Number(tx.fineAmount ?? 0),
      securityDepositAmount: Number(tx.securityDepositAmount ?? 0),
      adminChargesAmount: Number(tx.adminChargesAmount ?? 0),
      collectFine: Number(tx.fineAmount ?? 0) > 0,
    },
  );

  const paymentMode = String(args.paymentMode ?? "Cash").trim() || "Cash";
  const isAdvancePay = paymentMode === "AdvanceDeposit" || paymentMode === "Advance";
  const isOnlinePay = paymentMode === "Online";

  let payerLicenceId = tx.traderLicenceId;
  if (caseType === "D" && tx.feePayer === "Receiver") {
    payerLicenceId = tx.receiverTraderLicenceId;
  }
  let canonicalPayerLicenceId: string | null = null;
  if (payerLicenceId) {
    const resolvedPayer = await resolveLicence(payerLicenceId);
    canonicalPayerLicenceId = resolvedPayer?.licence.id ?? payerLicenceId;
  }

  if (isAdvancePay) {
    if (!canonicalPayerLicenceId) {
      throw Object.assign(new Error("Advance deposit payment requires a trader licence"), {
        code: "MKT_TX_ADVANCE_NO_LICENCE",
      });
    }
    const bal = await getMarketFeeAdvanceBalance(canonicalPayerLicenceId);
    if (bal < totalPayable - 0.01) {
      throw Object.assign(new Error(`Insufficient advance balance (${bal.toFixed(2)})`), {
        code: "MKT_TX_ADVANCE_INSUFFICIENT",
      });
    }
  }

  const payerName =
    tx.traderManualName?.trim() ||
    (canonicalPayerLicenceId
      ? ((await resolveLicence(canonicalPayerLicenceId))?.licence.firmName ?? canonicalPayerLicenceId)
      : "Walk-in");

  const now = new Date().toISOString();
  const receiptPaymentMode = isAdvancePay ? "Cash" : paymentMode;

  const created = await createIomsReceipt({
    yardId: tx.entryLocationId,
    revenueHead: calc.receiptRevenueHead,
    payerName: String(payerName),
    payerType: canonicalPayerLicenceId ? "TraderLicence" : "WalkIn",
    payerRefId: canonicalPayerLicenceId ?? undefined,
    amount: totalPayable,
    paymentMode: receiptPaymentMode,
    counterDuesPayment: isOnlinePay,
    sourceModule: "M-04",
    sourceRecordId: tx.id,
    unifiedEntityId: canonicalPayerLicenceId ? unifiedEntityIdFromTrackA(canonicalPayerLicenceId) : undefined,
    createdBy: args.createdBy,
    paymentDateYmd: tx.transactionDate,
    chequeNo: args.paymentDetail?.chequeNo != null ? String(args.paymentDetail.chequeNo) : undefined,
    bankName: args.paymentDetail?.bankName != null ? String(args.paymentDetail.bankName) : undefined,
    chequeDate: args.paymentDetail?.chequeDate != null ? String(args.paymentDetail.chequeDate) : undefined,
    gatewayRef: args.paymentDetail?.utrNo != null ? String(args.paymentDetail.utrNo) : undefined,
  });

  if (isAdvancePay && canonicalPayerLicenceId) {
    await db.insert(marketFeeLedger).values({
      id: nanoid(),
      traderLicenceId: canonicalPayerLicenceId,
      yardId: tx.entryLocationId,
      entryDate: tx.transactionDate,
      entryType: "Adjustment",
      amountInr: -totalPayable,
      receiptId: created.id,
      sourceModule: "M-04",
      sourceRecordId: tx.id,
      createdBy: args.createdBy,
      createdAt: now,
    });
    await db
      .update(iomsReceipts)
      .set({ status: "Paid", gatewayRef: "AdvanceAdjust", paymentMode: "Cash" })
      .where(eq(iomsReceipts.id, created.id));
  } else {
    await db.update(iomsReceipts).set({ status: "Paid" }).where(eq(iomsReceipts.id, created.id));
  }

  await db
    .update(marketTransactions)
    .set({
      status: "Finalized",
      receiptId: created.id,
      paymentMode,
      paymentDetailJson: args.paymentDetail ? JSON.stringify(args.paymentDetail) : null,
      finalizedAt: now,
    })
    .where(eq(marketTransactions.id, tx.id));

  return { receiptId: created.id, receiptNo: created.receiptNo };
}

/** Single-step submit: persist + receipt — effective immediately (no verification/approval). */
export async function submitMarketTransactionWizard(args: {
  input: MarketTransactionWizardInput;
  paymentMode: string;
  paymentDetail?: Record<string, unknown>;
  paidAmount?: number;
  createdBy: string;
}): Promise<{
  id: string;
  transactionNo: string;
  receiptId: string;
  receiptNo: string;
  calculation: MarketTransactionCalculation;
}> {
  const draft = await createMarketTransactionDraft({ input: args.input, createdBy: args.createdBy });
  const fin = await finalizeMarketTransaction({
    transactionId: draft.id,
    paymentMode: args.paymentMode,
    paymentDetail: args.paymentDetail,
    paidAmount: args.paidAmount ?? draft.calculation.totalPayable,
    createdBy: args.createdBy,
  });
  return {
    id: draft.id,
    transactionNo: draft.transactionNo,
    receiptId: fin.receiptId,
    receiptNo: fin.receiptNo,
    calculation: draft.calculation,
  };
}

export async function loadMarketTransactionWithLines(id: string) {
  const [tx] = await db.select().from(marketTransactions).where(eq(marketTransactions.id, id)).limit(1);
  if (!tx) return null;
  const lines = await db
    .select({
      line: marketTransactionCommodities,
      commodityName: commodities.name,
    })
    .from(marketTransactionCommodities)
    .leftJoin(commodities, eq(marketTransactionCommodities.commodityId, commodities.id))
    .where(eq(marketTransactionCommodities.transactionId, id))
    .orderBy(asc(marketTransactionCommodities.sortOrder));
  return { transaction: tx, lines };
}

export async function listMarketTransactions(scopedYardIds: string[] | undefined) {
  if (scopedYardIds && scopedYardIds.length > 0) {
    return db
      .select()
      .from(marketTransactions)
      .where(inArray(marketTransactions.entryLocationId, scopedYardIds))
      .orderBy(desc(marketTransactions.createdAt));
  }
  return db.select().from(marketTransactions).orderBy(desc(marketTransactions.createdAt));
}
