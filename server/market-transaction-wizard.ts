/**
 * M-04 unified market transaction wizard — calculate, validate, persist, finalize + receipt.
 */
import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";
import {
  commodities,
  iomsReceipts,
  marketFeeLedger,
  marketTransactionCommodities,
  marketTransactions,
  traderLicences,
  users,
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
import {
  CASE_E_SD_ACCOUNTING_HEAD,
  CASE_E_SD_REFUND_REVENUE_HEAD,
  CASE_E_SD_REVENUE_HEAD,
  CASE_E_SDEP_BREAKDOWN_KIND,
  CASE_E_SDRF_BREAKDOWN_KIND,
  buildCaseESdepBreakdownJson,
  buildCaseESdrfBreakdownJson,
  latestExitInstantIso,
  parseCaseESdConfig,
  type CaseECommodityPdfLine,
  type CaseESdConfig,
  type CaseESdDepositStatus,
} from "@shared/case-e-security-deposit";
import { db, pool } from "./db";
import { financialYearFromIsoTransactionDate } from "./market-purchase-transaction-no";
import { assertIsoTransactionDate, resolveMarketFeePercentForPurchase } from "./market-fee-resolve";
import { resolvePurchaseTransactionTraderRef } from "./market-purchase-trader-resolve";
import { createIomsReceipt } from "./routes-receipts-ioms";
import { getMergedSystemConfig } from "./system-config";
import { unifiedEntityIdFromTrackA } from "@shared/unified-entity-id";
import { assertLmLicenceAllowsOperation, LmLicenceGuardError } from "@shared/lm-licence-guard";
import { todayYmdIst } from "@shared/premises-allocation";
import { writeAuditLogSystem } from "./audit";

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

function licenceIsExpired(
  validTo: string | null | undefined,
  transactionDate: string,
  status?: string | null,
): boolean {
  if (String(status ?? "").trim() === "Expired") return true;
  const vt = String(validTo ?? "").trim().slice(0, 10);
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

  const caseECfg = caseType === "E" ? await getCaseESdConfig() : null;
  return computeMarketTransactionTotals(caseType, lines, {
    fineAmount: input.fineAmount,
    // Case E: SD/admin always from market fee + system_config (ignore client amounts).
    securityDepositAmount: caseType === "E" ? undefined : input.securityDepositAmount,
    adminChargesAmount: caseType === "E" ? undefined : input.adminChargesAmount,
    caseESdCeiling: caseECfg?.sdCeiling,
    caseEAdminCharges: caseECfg?.adminCharges,
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
  // Business calendar is IST — UTC "today" is wrong between 00:00–05:29 IST.
  const today = todayYmdIst();
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
    const expired = licenceIsExpired(licRow.licence.validTo, txDate, licRow.licence.status);
    if (caseType === "B") {
      if (!expired) {
        return { ok: false, code: "MKT_TX_LICENCE_NOT_EXPIRED", message: "Case B requires an expired licence holder" };
      }
    } else if (!meta.allowsExpiredLicence && expired) {
      return { ok: false, code: "MKT_TX_LICENCE_EXPIRED", message: "Trader licence is expired" };
    }
    // Case B: cron often marks expired licences blocked — allow those; still block other cases.
    if (licRow.licence.isBlocked && !(caseType === "B" && expired)) {
      return { ok: false, code: "MKT_TX_LICENCE_BLOCKED", message: "Trader licence is blocked" };
    }
    try {
      const lmOpts = caseType === "B" && expired ? { allowExpiredHolder: true } : undefined;
      const lineIds = Array.from(
        new Set(
          (input.commodities ?? [])
            .map((c) => String(c.commodityId ?? "").trim())
            .filter(Boolean),
        ),
      );
      if (lineIds.length === 0) {
        assertLmLicenceAllowsOperation(licRow.licence, undefined, lmOpts);
      } else {
        const names =
          lineIds.length > 0
            ? await db
                .select({ id: commodities.id, name: commodities.name })
                .from(commodities)
                .where(inArray(commodities.id, lineIds))
            : [];
        const nameById = Object.fromEntries(names.map((n) => [n.id, String(n.name ?? "").trim()]));
        for (const cid of lineIds) {
          const name = nameById[cid];
          if (name) assertLmLicenceAllowsOperation(licRow.licence, name, lmOpts);
          else assertLmLicenceAllowsOperation(licRow.licence, undefined, lmOpts);
        }
      }
    } catch (e) {
      if (e instanceof LmLicenceGuardError) {
        return { ok: false, code: e.code, message: e.message };
      }
      throw e;
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

  const caseType = tx.caseType as MarketTransactionCaseId;
  const lineRows = await db
    .select({
      line: marketTransactionCommodities,
      commodityName: commodities.name,
    })
    .from(marketTransactionCommodities)
    .leftJoin(commodities, eq(marketTransactionCommodities.commodityId, commodities.id))
    .where(eq(marketTransactionCommodities.transactionId, tx.id));

  const caseECfg = caseType === "E" ? await getCaseESdConfig() : null;
  const mappedLines = lineRows.map((r) => ({
    commodityId: r.line.commodityId,
    quantity: Number(r.line.quantity),
    unit: r.line.unit,
    ratePerUnit: Number(r.line.ratePerUnit),
    commodityValue: Number(r.line.commodityValue),
    marketFeePercent: Number(r.line.marketFeePercent),
    marketFeeAmount: Number(r.line.marketFeeAmount),
  }));
  const calc = computeMarketTransactionTotals(caseType, mappedLines, {
    fineAmount: Number(tx.fineAmount ?? 0),
    securityDepositAmount: caseType === "E" ? undefined : Number(tx.securityDepositAmount ?? 0),
    adminChargesAmount: caseType === "E" ? undefined : Number(tx.adminChargesAmount ?? 0),
    caseESdCeiling: caseECfg?.sdCeiling,
    caseEAdminCharges: caseECfg?.adminCharges,
    collectFine: Number(tx.fineAmount ?? 0) > 0,
  });

  // Prefer recomputed totals (config / formula) over stale draft amounts.
  const totalPayable = Number(calc.totalPayable ?? 0);
  const paid = args.paidAmount != null ? Number(args.paidAmount) : totalPayable;
  if (!Number.isFinite(paid) || Math.abs(paid - totalPayable) > 0.02) {
    throw Object.assign(new Error(`Paid amount must equal total payable (${totalPayable.toFixed(2)})`), {
      code: "MKT_TX_PAID_AMOUNT",
    });
  }

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

  let m03BreakdownJson: string | undefined;
  if (caseType === "E" && caseECfg) {
    const [entryYard] = await db
      .select({ name: yards.name })
      .from(yards)
      .where(eq(yards.id, tx.entryLocationId))
      .limit(1);
    const sd = Math.round(Number(calc.securityDepositAmount) * 100) / 100;
    const admin = Math.round(Number(calc.adminChargesAmount) * 100) / 100;
    const commodityLines: CaseECommodityPdfLine[] = lineRows.map((r) => ({
      commodityName: (r.commodityName ?? "").trim() || r.line.commodityId,
      unit: r.line.unit,
      quantity: Number(r.line.quantity),
      ratePerUnit: Number(r.line.ratePerUnit),
      commodityValue: Number(r.line.commodityValue),
      marketFee: Number(r.line.marketFeeAmount),
    }));
    m03BreakdownJson = buildCaseESdepBreakdownJson({
      kind: CASE_E_SDEP_BREAKDOWN_KIND,
      checkPostName: entryYard?.name ?? tx.entryLocationId,
      vehicleNumber: tx.vehicleNumber,
      vehicleType: tx.vehicleMake,
      fromLabel: tx.originatingState,
      toLabel: tx.destinationState,
      securityDepositAmount: sd,
      adminChargesAmount: admin,
      totalCollected: Math.round((sd + admin) * 100) / 100,
      validityLabel: caseECfg.validityLabel,
      latestExitAtIso: latestExitInstantIso(new Date(now), caseECfg.validityMs),
      commodities: commodityLines,
    });
  }

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
    m03BreakdownJson,
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
      totalCommodityValue: calc.totalCommodityValue,
      totalMarketFee: calc.totalMarketFee,
      fineAmount: calc.fineAmount,
      securityDepositAmount: calc.securityDepositAmount,
      adminChargesAmount: calc.adminChargesAmount,
      totalPayable: calc.totalPayable,
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

export type WizardTransactionReportRow = {
  sNo: number;
  id: string;
  lineId: string | null;
  transactionNo: string;
  caseType: string;
  caseLabel: string;
  transactionDate: string;
  transactionTime: string | null;
  entryLocationId: string;
  entryLocationName: string;
  status: string;
  vehicleNumber: string | null;
  vehicleMake: string | null;
  traderLicenceId: string | null;
  traderName: string;
  licenceNo: string;
  receiverTraderLicenceId: string | null;
  feePayer: string | null;
  sellerType: string | null;
  farmerType: string | null;
  farmerName: string | null;
  farmerKrishiCard: string | null;
  farmerContact: string | null;
  farmerAddress: string | null;
  commoditySource: string | null;
  placeOfOrigin: string | null;
  originatingState: string | null;
  destinationState: string | null;
  exitCheckposts: string;
  commodityId: string | null;
  commodityName: string;
  quantity: number | null;
  unit: string | null;
  ratePerUnit: number | null;
  commodityValue: number | null;
  marketFeePercent: number | null;
  lineMarketFee: number | null;
  totalCommodityValue: number;
  totalMarketFee: number;
  fineAmount: number;
  securityDepositAmount: number;
  adminChargesAmount: number;
  totalPayable: number;
  paymentMode: string | null;
  receiptId: string | null;
  sdRefundCheckPostId: string | null;
  sdRefundCheckPostName: string | null;
  sdRefundTxnRef: string | null;
  sdRefundDate: string | null;
  sdRefundAmount: number | null;
};

export async function buildWizardTransactionReport(args: {
  from: string;
  to: string;
  scopedYardIds?: string[];
  caseType?: string;
  status?: string;
  commodityId?: string;
}): Promise<{ from: string; to: string; count: number; rows: WizardTransactionReportRow[] }> {
  const conds = [
    gte(marketTransactions.transactionDate, args.from),
    lte(marketTransactions.transactionDate, args.to),
  ];
  if (args.scopedYardIds && args.scopedYardIds.length > 0) {
    conds.push(inArray(marketTransactions.entryLocationId, args.scopedYardIds));
  }
  if (args.caseType && args.caseType !== "all") {
    conds.push(eq(marketTransactions.caseType, args.caseType));
  }
  if (args.status && args.status !== "all") {
    conds.push(eq(marketTransactions.status, args.status));
  }
  if (args.commodityId) {
    conds.push(eq(marketTransactionCommodities.commodityId, args.commodityId));
  }

  const entryYard = alias(yards, "entry_yard");
  const refundYard = alias(yards, "refund_yard");

  const raw = await db
    .select({
      tx: marketTransactions,
      line: marketTransactionCommodities,
      commodityName: commodities.name,
      entryLocationName: entryYard.name,
      entryLocationCode: entryYard.code,
      traderFirmName: traderLicences.firmName,
      traderLicenceNo: traderLicences.licenceNo,
      traderProvisionalNo: traderLicences.provisionalLicenceNo,
      sdRefundCheckPostName: refundYard.name,
    })
    .from(marketTransactions)
    .leftJoin(marketTransactionCommodities, eq(marketTransactionCommodities.transactionId, marketTransactions.id))
    .leftJoin(commodities, eq(commodities.id, marketTransactionCommodities.commodityId))
    .leftJoin(entryYard, eq(entryYard.id, marketTransactions.entryLocationId))
    .leftJoin(refundYard, eq(refundYard.id, marketTransactions.sdRefundCheckPostId))
    .leftJoin(traderLicences, eq(traderLicences.id, marketTransactions.traderLicenceId))
    .where(and(...conds))
    .orderBy(desc(marketTransactions.transactionDate), desc(marketTransactions.createdAt), asc(marketTransactionCommodities.sortOrder))
    .limit(8000);

  const caseLabel = (id: string) => {
    const meta = isMarketTransactionCaseId(id) ? MARKET_TRANSACTION_CASES[id] : undefined;
    return meta ? `Case ${meta.id} — ${meta.title}` : `Case ${id}`;
  };

  const yardNameById = new Map<string, string>();
  for (const r of raw) {
    if (r.entryLocationName && r.tx.entryLocationId) {
      yardNameById.set(r.tx.entryLocationId, r.entryLocationName);
    }
    if (r.sdRefundCheckPostName && r.tx.sdRefundCheckPostId) {
      yardNameById.set(r.tx.sdRefundCheckPostId, r.sdRefundCheckPostName);
    }
  }
  const exitIds = new Set<string>();
  for (const r of raw) {
    if (!r.tx.exitCheckpostsJson) continue;
    try {
      const ids = JSON.parse(r.tx.exitCheckpostsJson) as unknown;
      if (Array.isArray(ids)) for (const id of ids) if (id) exitIds.add(String(id));
    } catch {
      /* ignore */
    }
  }
  const missingExitIds = [...exitIds].filter((id) => !yardNameById.has(id));
  if (missingExitIds.length > 0) {
    const exitYards = await db
      .select({ id: yards.id, name: yards.name })
      .from(yards)
      .where(inArray(yards.id, missingExitIds));
    for (const y of exitYards) yardNameById.set(y.id, y.name);
  }

  const rows: WizardTransactionReportRow[] = raw.map((r, idx) => {
    const tx = r.tx;
    const line = r.line;
    let exitCheckposts = "";
    if (tx.exitCheckpostsJson) {
      try {
        const ids = JSON.parse(tx.exitCheckpostsJson) as unknown;
        if (Array.isArray(ids)) {
          exitCheckposts = ids
            .map((id) => yardNameById.get(String(id)) ?? String(id))
            .join(", ");
        }
      } catch {
        exitCheckposts = tx.exitCheckpostsJson;
      }
    } else if (tx.anyExitCheckpost) {
      exitCheckposts = "Any exit check post";
    }
    const traderName =
      (r.traderFirmName ?? tx.traderManualName ?? "").trim() || "—";
    const licenceNo =
      (r.traderLicenceNo ?? r.traderProvisionalNo ?? "").trim() || "—";
    return {
      sNo: idx + 1,
      id: tx.id,
      lineId: line?.id ?? null,
      transactionNo: tx.transactionNo ?? tx.id,
      caseType: tx.caseType,
      caseLabel: caseLabel(tx.caseType),
      transactionDate: tx.transactionDate,
      transactionTime: tx.transactionTime ?? null,
      entryLocationId: tx.entryLocationId,
      entryLocationName: (r.entryLocationName ?? tx.entryLocationId).trim() || tx.entryLocationId,
      status: tx.status,
      vehicleNumber: tx.vehicleNumber ?? null,
      vehicleMake: tx.vehicleMake ?? null,
      traderLicenceId: tx.traderLicenceId ?? null,
      traderName,
      licenceNo,
      receiverTraderLicenceId: tx.receiverTraderLicenceId ?? null,
      feePayer: tx.feePayer ?? null,
      sellerType: tx.sellerType ?? null,
      farmerType: tx.farmerType ?? null,
      farmerName: tx.farmerName ?? null,
      farmerKrishiCard: tx.farmerKrishiCard ?? null,
      farmerContact: tx.farmerContact ?? null,
      farmerAddress: tx.farmerAddress ?? null,
      commoditySource: tx.commoditySource ?? null,
      placeOfOrigin: tx.placeOfOrigin ?? null,
      originatingState: tx.originatingState ?? null,
      destinationState: tx.destinationState ?? null,
      exitCheckposts,
      commodityId: line?.commodityId ?? null,
      commodityName: (r.commodityName ?? "").trim() || (line ? line.commodityId : "—"),
      quantity: line != null ? Number(line.quantity) : null,
      unit: line?.unit ?? null,
      ratePerUnit: line != null ? Number(line.ratePerUnit) : null,
      commodityValue: line != null ? Number(line.commodityValue) : null,
      marketFeePercent: line != null ? Number(line.marketFeePercent) : null,
      lineMarketFee: line != null ? Number(line.marketFeeAmount) : null,
      totalCommodityValue: Number(tx.totalCommodityValue ?? 0),
      totalMarketFee: Number(tx.totalMarketFee ?? 0),
      fineAmount: Number(tx.fineAmount ?? 0),
      securityDepositAmount: Number(tx.securityDepositAmount ?? 0),
      adminChargesAmount: Number(tx.adminChargesAmount ?? 0),
      totalPayable: Number(tx.totalPayable ?? 0),
      paymentMode: tx.paymentMode ?? null,
      receiptId: tx.receiptId ?? null,
      sdRefundCheckPostId: tx.sdRefundCheckPostId ?? null,
      sdRefundCheckPostName: r.sdRefundCheckPostName ?? null,
      sdRefundTxnRef: tx.sdRefundTxnRef ?? null,
      sdRefundDate: tx.sdRefundDate ?? null,
      sdRefundAmount: tx.sdRefundAmount != null ? Number(tx.sdRefundAmount) : null,
    };
  });

  return { from: args.from, to: args.to, count: rows.length, rows };
}

/** Sync fallback only — prefer getCaseESdConfig() (default 6h from system_config). */
export const CASE_E_REFUND_WINDOW_HOURS = 6;

export async function getCaseESdConfig(): Promise<CaseESdConfig> {
  return parseCaseESdConfig(await getMergedSystemConfig());
}

export async function getCaseERefundWindowMs(): Promise<number> {
  return (await getCaseESdConfig()).validityMs;
}

function caseERefundWindowHoursFractional(cfg: CaseESdConfig): number {
  return Math.round((cfg.validityHours + cfg.validityMinutes / 60) * 100) / 100;
}

function parseCaseEEntryInstant(tx: {
  transactionDate: string;
  transactionTime?: string | null;
  finalizedAt?: string | null;
  createdAt?: string | null;
}): Date | null {
  if (tx.finalizedAt) {
    const d = new Date(tx.finalizedAt);
    if (!Number.isNaN(d.getTime())) return d;
  }
  const date = String(tx.transactionDate ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const timeRaw = String(tx.transactionTime ?? "").trim();
  const hm = timeRaw.match(/(\d{1,2}):(\d{2})/);
  const hh = hm ? String(Number(hm[1])).padStart(2, "0") : "00";
  const mm = hm ? hm[2] : "00";
  // Treat counter time as IST (Asia/Kolkata, UTC+5:30)
  const d = new Date(`${date}T${hh}:${mm}:00+05:30`);
  if (!Number.isNaN(d.getTime())) return d;
  if (tx.createdAt) {
    const c = new Date(tx.createdAt);
    if (!Number.isNaN(c.getTime())) return c;
  }
  return null;
}

function formatTimeLeft(ms: number): string {
  if (ms <= 0) return "Expired";
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h <= 0) return `${m}m`;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

function formatElapsedLabel(ms: number): string {
  const totalMin = Math.floor(Math.max(0, ms) / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

function isCaseENotYetRefundedSql() {
  return and(
    eq(marketTransactions.caseType, "E"),
    eq(marketTransactions.status, "Finalized"),
    isNull(marketTransactions.sdRefundReceiptId),
    sql`coalesce(${marketTransactions.sdRefundTxnRef}, '') = ''`,
  )!;
}

/**
 * Mark Finalized Case E deposits past validity with no refund as expired / forfeited.
 * Books the unrefunded Security Deposit under accounting head
 * "Security Deposit (Market Fee)" (sdExpiredAt + sdExpiredBookedAt) for recon & audit.
 */
export async function markExpiredCaseESecurityDeposits(): Promise<number> {
  const cfg = await getCaseESdConfig();
  const windowMs = cfg.validityMs;
  const nowIso = new Date().toISOString();
  const nowMs = Date.now();

  const rows = await db
    .select({
      id: marketTransactions.id,
      transactionNo: marketTransactions.transactionNo,
      receiptId: marketTransactions.receiptId,
      securityDepositAmount: marketTransactions.securityDepositAmount,
      transactionDate: marketTransactions.transactionDate,
      transactionTime: marketTransactions.transactionTime,
      finalizedAt: marketTransactions.finalizedAt,
      createdAt: marketTransactions.createdAt,
    })
    .from(marketTransactions)
    .where(
      and(
        isCaseENotYetRefundedSql(),
        isNull(marketTransactions.sdExpiredAt),
      ),
    )
    .limit(8000);

  const expired: Array<{
    id: string;
    transactionNo: string | null;
    receiptId: string | null;
    securityDepositAmount: number;
  }> = [];
  for (const row of rows) {
    const entryAt = parseCaseEEntryInstant(row);
    if (!entryAt) continue;
    if (nowMs - entryAt.getTime() <= windowMs) continue;
    expired.push({
      id: row.id,
      transactionNo: row.transactionNo,
      receiptId: row.receiptId,
      securityDepositAmount: Number(row.securityDepositAmount ?? 0),
    });
  }
  if (expired.length === 0) return 0;

  const expiredIds = expired.map((e) => e.id);
  // Chunk updates to avoid oversized IN lists
  const chunkSize = 200;
  for (let i = 0; i < expiredIds.length; i += chunkSize) {
    const chunk = expiredIds.slice(i, i + chunkSize);
    await db
      .update(marketTransactions)
      .set({ sdExpiredAt: nowIso, sdExpiredBookedAt: nowIso })
      .where(inArray(marketTransactions.id, chunk));
  }

  const totalForfeited = Math.round(
    expired.reduce((s, e) => s + e.securityDepositAmount, 0) * 100,
  ) / 100;
  await writeAuditLogSystem({
    module: "M-04",
    action: "CaseE_SD_Forfeit_Book",
    recordId: expiredIds.length === 1 ? expiredIds[0] : undefined,
    afterValue: {
      accountingHead: CASE_E_SD_ACCOUNTING_HEAD,
      revenueHead: CASE_E_SD_REVENUE_HEAD,
      bookedAt: nowIso,
      count: expired.length,
      totalForfeitedInr: totalForfeited,
      validityLabel: cfg.validityLabel,
      note:
        "Unrefunded Check Post Security Deposit retained under accounting head Security Deposit (Market Fee).",
      sample: expired.slice(0, 25).map((e) => ({
        id: e.id,
        transactionNo: e.transactionNo,
        receiptId: e.receiptId,
        securityDepositAmount: e.securityDepositAmount,
      })),
    },
  }).catch((err) => console.error("Case E SD forfeit audit failed:", err));

  return expired.length;
}

export type CaseEEligibleRefundRow = {
  id: string;
  transactionNo: string | null;
  receiptId: string | null;
  receiptNo: string | null;
  transactionDate: string;
  transactionTime: string | null;
  finalizedAt: string | null;
  entryLocationId: string;
  entryLocationName: string;
  entryLocationCode: string | null;
  vehicleNumber: string | null;
  vehicleMake: string | null;
  traderName: string;
  traderContact: string | null;
  licenceNo: string | null;
  originatingState: string | null;
  destinationState: string | null;
  anyExitCheckpost: boolean;
  exitCheckpostsJson: string | null;
  securityDepositAmount: number;
  adminChargesAmount: number;
  totalCommodityValue: number;
  totalMarketFee: number;
  totalPayable: number;
  paymentMode: string | null;
  generatedAt: string | null;
  elapsedHours: number;
  remainingMs: number;
  timeLeft: string;
  expiringWithinOneHour: boolean;
  /** Fractional hours from config (hours + minutes/60). */
  refundWindowHours: number;
  refundWindowLabel: string;
  withinWindow: true;
};

/** Eligible Case E receipts only: not refunded and still within configured validity from generation. */
export async function listEligibleCaseEForRefund(args: {
  q?: string;
  vehicleNumber?: string;
  paymentMode?: string;
  limit?: number;
}): Promise<CaseEEligibleRefundRow[]> {
  await markExpiredCaseESecurityDeposits();
  const cfg = await getCaseESdConfig();
  const windowMs = cfg.validityMs;
  const windowHours = caseERefundWindowHoursFractional(cfg);

  const conds = [isCaseENotYetRefundedSql(), isNull(marketTransactions.sdExpiredAt)];
  const q = (args.q ?? "").trim();
  if (q.length >= 2) {
    const pattern = `%${q}%`;
    conds.push(
      or(
        ilike(marketTransactions.transactionNo, pattern),
        ilike(marketTransactions.vehicleNumber, pattern),
        ilike(marketTransactions.traderManualName, pattern),
        ilike(marketTransactions.traderManualContact, pattern),
        ilike(iomsReceipts.receiptNo, pattern),
        ilike(traderLicences.firmName, pattern),
        ilike(traderLicences.licenceNo, pattern),
      )!,
    );
  }
  const vehicleNumber = (args.vehicleNumber ?? "").trim();
  if (vehicleNumber) {
    conds.push(ilike(marketTransactions.vehicleNumber, `%${vehicleNumber}%`));
  }
  const paymentMode = (args.paymentMode ?? "").trim();
  if (paymentMode && paymentMode !== "all") {
    conds.push(eq(marketTransactions.paymentMode, paymentMode));
  }

  const rows = await db
    .select({
      tx: marketTransactions,
      receiptNo: iomsReceipts.receiptNo,
      entryLocationName: yards.name,
      entryLocationCode: yards.code,
      traderFirmName: traderLicences.firmName,
      traderLicenceNo: traderLicences.licenceNo,
      traderMobile: traderLicences.mobile,
    })
    .from(marketTransactions)
    .leftJoin(iomsReceipts, eq(iomsReceipts.id, marketTransactions.receiptId))
    .leftJoin(yards, eq(yards.id, marketTransactions.entryLocationId))
    .leftJoin(traderLicences, eq(traderLicences.id, marketTransactions.traderLicenceId))
    .where(and(...conds))
    .orderBy(desc(marketTransactions.finalizedAt), desc(marketTransactions.createdAt))
    .limit(Math.min(args.limit ?? 200, 500));

  const now = Date.now();
  const mapped: CaseEEligibleRefundRow[] = [];
  for (const r of rows) {
    const generatedAt = parseCaseEEntryInstant(r.tx);
    if (!generatedAt) continue;
    const elapsedMs = now - generatedAt.getTime();
    if (elapsedMs < 0) continue;
    const remainingMs = windowMs - elapsedMs;
    if (remainingMs <= 0) continue; // expired — not selectable
    const elapsedHours = elapsedMs / (1000 * 60 * 60);
    mapped.push({
      id: r.tx.id,
      transactionNo: r.tx.transactionNo,
      receiptId: r.tx.receiptId,
      receiptNo: r.receiptNo ?? null,
      transactionDate: r.tx.transactionDate,
      transactionTime: r.tx.transactionTime,
      finalizedAt: r.tx.finalizedAt,
      entryLocationId: r.tx.entryLocationId,
      entryLocationName: r.entryLocationName ?? r.tx.entryLocationId,
      entryLocationCode: r.entryLocationCode ?? null,
      vehicleNumber: r.tx.vehicleNumber,
      vehicleMake: r.tx.vehicleMake,
      traderName: (r.traderFirmName ?? r.tx.traderManualName ?? "").trim() || "—",
      traderContact: (r.tx.traderManualContact ?? r.traderMobile ?? "").trim() || null,
      licenceNo: (r.traderLicenceNo ?? "").trim() || null,
      originatingState: r.tx.originatingState,
      destinationState: r.tx.destinationState,
      anyExitCheckpost: Boolean(r.tx.anyExitCheckpost),
      exitCheckpostsJson: r.tx.exitCheckpostsJson,
      securityDepositAmount: Number(r.tx.securityDepositAmount ?? 0),
      adminChargesAmount: Number(r.tx.adminChargesAmount ?? 0),
      totalCommodityValue: Number(r.tx.totalCommodityValue ?? 0),
      totalMarketFee: Number(r.tx.totalMarketFee ?? 0),
      totalPayable: Number(r.tx.totalPayable ?? 0),
      paymentMode: r.tx.paymentMode,
      generatedAt: generatedAt.toISOString(),
      elapsedHours: Math.round(elapsedHours * 100) / 100,
      remainingMs,
      timeLeft: formatTimeLeft(remainingMs),
      expiringWithinOneHour: remainingMs <= 60 * 60 * 1000,
      refundWindowHours: windowHours,
      refundWindowLabel: cfg.validityLabel,
      withinWindow: true,
    });
  }
  mapped.sort((a, b) => a.remainingMs - b.remainingMs);
  return mapped;
}

/** Keep old name as alias for callers. */
export async function searchRefundableCaseETransactions(args: {
  q: string;
  scopedYardIds?: string[];
  limit?: number;
}) {
  void args.scopedYardIds;
  return listEligibleCaseEForRefund({ q: args.q, limit: args.limit });
}

export async function getCaseESdRefundDashboard(args: { checkPostId?: string; todayYmd: string }) {
  const cfg = await getCaseESdConfig();
  const eligible = await listEligibleCaseEForRefund({ limit: 500 });
  const refundConds = [
    eq(marketTransactions.caseType, "E"),
    eq(marketTransactions.sdRefundDate, args.todayYmd),
    sql`coalesce(${marketTransactions.sdRefundReceiptId}, ${marketTransactions.sdRefundTxnRef}, '') <> ''`,
  ];
  if (args.checkPostId) {
    refundConds.push(eq(marketTransactions.sdRefundCheckPostId, args.checkPostId));
  }
  const todayRefunds = await db
    .select({
      amount: marketTransactions.sdRefundAmount,
      id: marketTransactions.id,
    })
    .from(marketTransactions)
    .where(and(...refundConds));
  const amountRefundedToday = todayRefunds.reduce((s, r) => s + Number(r.amount ?? 0), 0);
  return {
    refundWindowHours: caseERefundWindowHoursFractional(cfg),
    refundWindowLabel: cfg.validityLabel,
    eligibleCount: eligible.length,
    expiringWithinOneHour: eligible.filter((e) => e.expiringWithinOneHour).length,
    refundsTodayCount: todayRefunds.length,
    amountRefundedToday: Math.round(amountRefundedToday * 100) / 100,
    checkPostId: args.checkPostId ?? null,
    todayYmd: args.todayYmd,
  };
}

export async function listCaseESecurityDepositRefunds(args: {
  from: string;
  to: string;
  checkPostId?: string;
  scopedYardIds?: string[];
  processedBy?: string;
  q?: string;
}) {
  await markExpiredCaseESecurityDeposits();
  const conds = [
    eq(marketTransactions.caseType, "E"),
    sql`coalesce(${marketTransactions.sdRefundDate}, '') <> ''`,
    gte(marketTransactions.sdRefundDate, args.from),
    lte(marketTransactions.sdRefundDate, args.to),
  ];
  if (args.checkPostId) {
    conds.push(eq(marketTransactions.sdRefundCheckPostId, args.checkPostId));
  } else if (args.scopedYardIds && args.scopedYardIds.length > 0) {
    conds.push(inArray(marketTransactions.sdRefundCheckPostId, args.scopedYardIds));
  }
  if (args.processedBy) {
    conds.push(eq(marketTransactions.sdRefundRecordedBy, args.processedBy));
  }
  const q = (args.q ?? "").trim();
  const entryYard = alias(yards, "entry_yard_refund_list");
  const refundYard = alias(yards, "refund_yard_refund_list");
  const originalReceipt = alias(iomsReceipts, "orig_receipt");
  const refundReceipt = alias(iomsReceipts, "refund_receipt");
  const processedByUser = alias(users, "sd_refund_user");

  if (q.length >= 2) {
    const pattern = `%${q}%`;
    conds.push(
      or(
        ilike(marketTransactions.transactionNo, pattern),
        ilike(marketTransactions.vehicleNumber, pattern),
        ilike(marketTransactions.sdRefundTxnRef, pattern),
        ilike(originalReceipt.receiptNo, pattern),
        ilike(refundReceipt.receiptNo, pattern),
      )!,
    );
  }

  const rows = await db
    .select({
      tx: marketTransactions,
      entryLocationName: entryYard.name,
      refundCheckPostName: refundYard.name,
      originalReceiptNo: originalReceipt.receiptNo,
      refundReceiptNo: refundReceipt.receiptNo,
      traderFirmName: traderLicences.firmName,
      processedByName: processedByUser.name,
      processedByEmail: processedByUser.email,
      processedByUsername: processedByUser.username,
    })
    .from(marketTransactions)
    .leftJoin(entryYard, eq(entryYard.id, marketTransactions.entryLocationId))
    .leftJoin(refundYard, eq(refundYard.id, marketTransactions.sdRefundCheckPostId))
    .leftJoin(originalReceipt, eq(originalReceipt.id, marketTransactions.receiptId))
    .leftJoin(refundReceipt, eq(refundReceipt.id, marketTransactions.sdRefundReceiptId))
    .leftJoin(traderLicences, eq(traderLicences.id, marketTransactions.traderLicenceId))
    .leftJoin(processedByUser, eq(processedByUser.id, marketTransactions.sdRefundRecordedBy))
    .where(and(...conds))
    .orderBy(desc(marketTransactions.sdRefundDate), desc(marketTransactions.sdRefundRecordedAt))
    .limit(2000);

  return rows.map((r, idx) => ({
    sNo: idx + 1,
    id: r.tx.id,
    transactionNo: r.tx.transactionNo,
    vehicleNumber: r.tx.vehicleNumber,
    vehicleMake: r.tx.vehicleMake,
    traderName: (r.traderFirmName ?? r.tx.traderManualName ?? "").trim() || "—",
    paymentMode: r.tx.paymentMode,
    entryLocationId: r.tx.entryLocationId,
    entryLocationName: r.entryLocationName ?? r.tx.entryLocationId,
    originalReceiptId: r.tx.receiptId,
    originalReceiptNo: r.originalReceiptNo ?? null,
    refundCheckPostId: r.tx.sdRefundCheckPostId,
    refundCheckPostName: r.refundCheckPostName ?? r.tx.sdRefundCheckPostId,
    refundReceiptId: r.tx.sdRefundReceiptId,
    refundReceiptNo: r.refundReceiptNo ?? r.tx.sdRefundTxnRef,
    refundDate: r.tx.sdRefundDate,
    refundAmount: Number(r.tx.sdRefundAmount ?? 0),
    securityDepositAmount: Number(r.tx.securityDepositAmount ?? 0),
    adminChargesAmount: Number(r.tx.adminChargesAmount ?? 0),
    recordedAt: r.tx.sdRefundRecordedAt,
    processedById: r.tx.sdRefundRecordedBy,
    processedByName:
      (r.processedByName ?? r.processedByUsername ?? r.processedByEmail ?? r.tx.sdRefundRecordedBy ?? "").trim() ||
      "—",
    status: "Refunded" as const,
  }));
}

export async function buildCaseESdRefundReconciliation(args: {
  from: string;
  to: string;
  scopedYardIds?: string[];
}) {
  await markExpiredCaseESecurityDeposits();
  const cfg = await getCaseESdConfig();
  const windowMs = cfg.validityMs;
  const windowHours = caseERefundWindowHoursFractional(cfg);
  const now = Date.now();

  const collectedConds = [
    eq(marketTransactions.caseType, "E"),
    eq(marketTransactions.status, "Finalized"),
    gte(marketTransactions.transactionDate, args.from),
    lte(marketTransactions.transactionDate, args.to),
  ];
  if (args.scopedYardIds && args.scopedYardIds.length > 0) {
    collectedConds.push(inArray(marketTransactions.entryLocationId, args.scopedYardIds));
  }

  const collected = await db
    .select({
      tx: marketTransactions,
      locationName: yards.name,
      receiptNo: iomsReceipts.receiptNo,
    })
    .from(marketTransactions)
    .leftJoin(yards, eq(yards.id, marketTransactions.entryLocationId))
    .leftJoin(iomsReceipts, eq(iomsReceipts.id, marketTransactions.receiptId))
    .where(and(...collectedConds))
    .limit(8000);

  type Agg = {
    checkPostId: string;
    checkPostName: string;
    receipts: number;
    collected: number;
    refunded: number;
    refundedCount: number;
    notRefunded: number;
    notRefundedCount: number;
    expiredNotRefunded: number;
    expiredNotRefundedCount: number;
  };
  const byCp = new Map<string, Agg>();
  const expiredRows: Array<{
    id: string;
    receiptNo: string | null;
    transactionNo: string | null;
    vehicleNumber: string | null;
    checkPostName: string;
    securityDepositAmount: number;
    expiredAt: string | null;
    bookedAt: string | null;
    accountingHead: typeof CASE_E_SD_ACCOUNTING_HEAD;
    revenueHead: typeof CASE_E_SD_REVENUE_HEAD;
    status: "Forfeited";
  }> = [];

  for (const r of collected) {
    const cpId = r.tx.entryLocationId;
    const name = r.locationName ?? cpId;
    let agg = byCp.get(cpId);
    if (!agg) {
      agg = {
        checkPostId: cpId,
        checkPostName: name,
        receipts: 0,
        collected: 0,
        refunded: 0,
        refundedCount: 0,
        notRefunded: 0,
        notRefundedCount: 0,
        expiredNotRefunded: 0,
        expiredNotRefundedCount: 0,
      };
      byCp.set(cpId, agg);
    }
    const sd = Number(r.tx.securityDepositAmount ?? 0);
    agg.receipts += 1;
    agg.collected += sd;
    const refunded =
      Boolean(r.tx.sdRefundReceiptId) ||
      (r.tx.sdRefundTxnRef != null && String(r.tx.sdRefundTxnRef).trim() !== "");
    if (refunded) {
      agg.refunded += Number(r.tx.sdRefundAmount ?? sd);
      agg.refundedCount += 1;
    } else {
      agg.notRefunded += sd;
      agg.notRefundedCount += 1;
      const generatedAt = parseCaseEEntryInstant(r.tx);
      const pastWindow = Boolean(generatedAt && now - generatedAt.getTime() > windowMs);
      const markedExpired = Boolean(r.tx.sdExpiredAt);
      if (pastWindow || markedExpired) {
        agg.expiredNotRefunded += sd;
        agg.expiredNotRefundedCount += 1;
        const windowEndIso = generatedAt
          ? new Date(generatedAt.getTime() + windowMs).toISOString()
          : null;
        expiredRows.push({
          id: r.tx.id,
          receiptNo: r.receiptNo,
          transactionNo: r.tx.transactionNo,
          vehicleNumber: r.tx.vehicleNumber,
          checkPostName: name,
          securityDepositAmount: sd,
          expiredAt: r.tx.sdExpiredAt ?? windowEndIso,
          bookedAt: r.tx.sdExpiredBookedAt ?? r.tx.sdExpiredAt ?? null,
          accountingHead: CASE_E_SD_ACCOUNTING_HEAD,
          revenueHead: CASE_E_SD_REVENUE_HEAD,
          status: "Forfeited",
        });
      }
    }
  }

  const byCheckPost = [...byCp.values()].map((a) => ({
    ...a,
    collected: Math.round(a.collected * 100) / 100,
    refunded: Math.round(a.refunded * 100) / 100,
    notRefunded: Math.round(a.notRefunded * 100) / 100,
    expiredNotRefunded: Math.round(a.expiredNotRefunded * 100) / 100,
    refundPct: a.collected > 0 ? Math.round((a.refunded / a.collected) * 100) : 0,
    duplicates: "None" as const,
  }));

  const totals = byCheckPost.reduce(
    (s, a) => ({
      receipts: s.receipts + a.receipts,
      collected: s.collected + a.collected,
      refunded: s.refunded + a.refunded,
      notRefunded: s.notRefunded + a.notRefunded,
      expiredNotRefunded: s.expiredNotRefunded + a.expiredNotRefunded,
      expiredNotRefundedCount: s.expiredNotRefundedCount + a.expiredNotRefundedCount,
      refundedCount: s.refundedCount + a.refundedCount,
    }),
    {
      receipts: 0,
      collected: 0,
      refunded: 0,
      notRefunded: 0,
      expiredNotRefunded: 0,
      expiredNotRefundedCount: 0,
      refundedCount: 0,
    },
  );

  return {
    from: args.from,
    to: args.to,
    refundWindowHours: windowHours,
    refundWindowLabel: cfg.validityLabel,
    accountingHead: CASE_E_SD_ACCOUNTING_HEAD,
    revenueHead: CASE_E_SD_REVENUE_HEAD,
    byCheckPost,
    totals: {
      ...totals,
      collected: Math.round(totals.collected * 100) / 100,
      refunded: Math.round(totals.refunded * 100) / 100,
      notRefunded: Math.round(totals.notRefunded * 100) / 100,
      expiredNotRefunded: Math.round(totals.expiredNotRefunded * 100) / 100,
      refundPct: totals.collected > 0 ? Math.round((totals.refunded / totals.collected) * 100) : 0,
    },
    /** Unrefunded SD past validity — booked under Security Deposit (Market Fee). */
    expiredNotRefunded: expiredRows.slice(0, 100),
  };
}

export async function getCaseESdRefundAudit(transactionId: string) {
  const loaded = await loadMarketTransactionWithLines(transactionId);
  if (!loaded || loaded.transaction.caseType !== "E") return null;
  const cfg = await getCaseESdConfig();
  const windowHours = caseERefundWindowHoursFractional(cfg);
  const tx = loaded.transaction;
  const [origReceipt] = tx.receiptId
    ? await db.select().from(iomsReceipts).where(eq(iomsReceipts.id, tx.receiptId)).limit(1)
    : [];
  const [refundReceipt] = tx.sdRefundReceiptId
    ? await db.select().from(iomsReceipts).where(eq(iomsReceipts.id, tx.sdRefundReceiptId)).limit(1)
    : [];
  const [entryYard] = await db
    .select({ id: yards.id, name: yards.name, code: yards.code })
    .from(yards)
    .where(eq(yards.id, tx.entryLocationId))
    .limit(1);
  const [refundYard] = tx.sdRefundCheckPostId
    ? await db
        .select({ id: yards.id, name: yards.name, code: yards.code })
        .from(yards)
        .where(eq(yards.id, tx.sdRefundCheckPostId))
        .limit(1)
    : [];
  const [collector] = tx.createdBy
    ? await db
        .select({ id: users.id, name: users.name, email: users.email, username: users.username })
        .from(users)
        .where(eq(users.id, tx.createdBy))
        .limit(1)
    : [];
  const [processor] = tx.sdRefundRecordedBy
    ? await db
        .select({ id: users.id, name: users.name, email: users.email, username: users.username })
        .from(users)
        .where(eq(users.id, tx.sdRefundRecordedBy))
        .limit(1)
    : [];
  const [trader] = tx.traderLicenceId
    ? await db
        .select({ firmName: traderLicences.firmName, licenceNo: traderLicences.licenceNo })
        .from(traderLicences)
        .where(eq(traderLicences.id, tx.traderLicenceId))
        .limit(1)
    : [];

  const generatedAt = parseCaseEEntryInstant(tx);
  const refundedAt = tx.sdRefundRecordedAt ? new Date(tx.sdRefundRecordedAt) : null;
  let elapsedAtRefundHours: number | null = null;
  let elapsedAtRefundMs: number | null = null;
  if (generatedAt && refundedAt && !Number.isNaN(refundedAt.getTime())) {
    elapsedAtRefundMs = refundedAt.getTime() - generatedAt.getTime();
    elapsedAtRefundHours = elapsedAtRefundMs / (1000 * 60 * 60);
  }
  const collected = Number(tx.securityDepositAmount ?? 0);
  const refunded = Number(tx.sdRefundAmount ?? 0);
  const alreadyRefunded =
    Boolean(tx.sdRefundReceiptId) || (tx.sdRefundTxnRef != null && String(tx.sdRefundTxnRef).trim() !== "");
  const pastWindow =
    Boolean(generatedAt) && Date.now() - (generatedAt as Date).getTime() > cfg.validityMs;
  const forfeited = !alreadyRefunded && (Boolean(tx.sdExpiredAt) || pastWindow);
  const depositStatus: CaseESdDepositStatus = alreadyRefunded
    ? "Refunded"
    : forfeited
      ? "Forfeited"
      : "Open";

  return {
    id: tx.id,
    caseType: tx.caseType,
    caseLabel: "Case E – Transit through Goa",
    transactionNo: tx.transactionNo,
    vehicleNumber: tx.vehicleNumber,
    vehicleMake: tx.vehicleMake,
    traderName: (trader?.firmName ?? tx.traderManualName ?? "").trim() || "—",
    traderContact: tx.traderManualContact,
    licenceNo: trader?.licenceNo ?? null,
    originatingState: tx.originatingState,
    destinationState: tx.destinationState,
    paymentMode: tx.paymentMode,
    totalCommodityValue: Number(tx.totalCommodityValue ?? 0),
    totalMarketFee: Number(tx.totalMarketFee ?? 0),
    securityDepositAmount: collected,
    adminChargesAmount: Number(tx.adminChargesAmount ?? 0),
    totalPayable: Number(tx.totalPayable ?? 0),
    depositStatus,
    accounting: {
      head: CASE_E_SD_ACCOUNTING_HEAD,
      revenueHead: CASE_E_SD_REVENUE_HEAD,
      /** Unrefunded / forfeited SD remains classified under Security Deposit (Market Fee). */
      classification:
        depositStatus === "Forfeited"
          ? `Forfeited — retained under ${CASE_E_SD_ACCOUNTING_HEAD}`
          : depositStatus === "Refunded"
            ? `Refunded via ${CASE_E_SD_REFUND_REVENUE_HEAD} against ${CASE_E_SD_ACCOUNTING_HEAD}`
            : `Held under ${CASE_E_SD_ACCOUNTING_HEAD} pending exit within ${cfg.validityLabel}`,
      expiredAt: tx.sdExpiredAt,
      bookedAt: tx.sdExpiredBookedAt,
    },
    lines: loaded.lines.map((l) => ({
      commodityName: l.commodityName,
      quantity: Number(l.line.quantity),
      unit: l.line.unit,
      ratePerUnit: Number(l.line.ratePerUnit),
      commodityValue: Number(l.line.commodityValue),
      marketFeeAmount: Number(l.line.marketFeeAmount),
    })),
    originalReceipt: {
      id: origReceipt?.id ?? tx.receiptId,
      receiptNo: origReceipt?.receiptNo ?? null,
      generatedAt: generatedAt?.toISOString() ?? tx.finalizedAt,
      collectedAt: entryYard?.name ?? tx.entryLocationId,
      collectedBy: collector?.name ?? collector?.username ?? tx.createdBy,
      paymentMode: origReceipt?.paymentMode ?? tx.paymentMode,
      amount: collected,
      revenueHead: origReceipt?.revenueHead ?? CASE_E_SD_REVENUE_HEAD,
      accountingHead: CASE_E_SD_ACCOUNTING_HEAD,
    },
    refund: alreadyRefunded
      ? {
          receiptId: tx.sdRefundReceiptId,
          receiptNo: refundReceipt?.receiptNo ?? tx.sdRefundTxnRef,
          amount: refunded,
          date: tx.sdRefundDate,
          recordedAt: tx.sdRefundRecordedAt,
          checkPostId: tx.sdRefundCheckPostId,
          checkPostName: refundYard?.name ?? tx.sdRefundCheckPostId,
          processedById: tx.sdRefundRecordedBy,
          processedByName: processor?.name ?? processor?.username ?? tx.sdRefundRecordedBy,
          paymentMode: refundReceipt?.paymentMode ?? tx.paymentMode,
          elapsedHours: elapsedAtRefundHours != null ? Math.round(elapsedAtRefundHours * 100) / 100 : null,
          timeSinceReceipt:
            elapsedAtRefundHours != null
              ? `${Math.floor(elapsedAtRefundHours)}h ${String(Math.round((elapsedAtRefundHours % 1) * 60)).padStart(2, "0")}m (limit ${cfg.validityLabel})`
              : null,
          netPosition: Math.round((collected - refunded) * 100) / 100,
          status: "Refunded" as const,
          revenueHead: refundReceipt?.revenueHead ?? CASE_E_SD_REFUND_REVENUE_HEAD,
          accountingHead: CASE_E_SD_ACCOUNTING_HEAD,
        }
      : null,
    refundWindowHours: windowHours,
    refundWindowLabel: cfg.validityLabel,
    validations: {
      isCaseE: tx.caseType === "E",
      withinWindowAtRefund:
        elapsedAtRefundMs == null ? null : elapsedAtRefundMs <= cfg.validityMs + 1e-6,
      noDuplicate: alreadyRefunded,
      amountNotExceedingDeposit: !alreadyRefunded || refunded <= collected + 0.01,
      forfeitedBookedUnderAccountingHead: depositStatus === "Forfeited",
    },
  };
}

export async function recordSecurityDepositRefund(args: {
  transactionId: string;
  checkPostId: string;
  /** Optional external ref; defaults to generated refund receipt no. */
  refundTxnRef?: string;
  refundDate: string;
  refundAmount?: number;
  paymentMode?: string;
  recordedBy: string;
}) {
  const [tx] = await db
    .select()
    .from(marketTransactions)
    .where(eq(marketTransactions.id, args.transactionId))
    .limit(1);
  if (!tx) throw Object.assign(new Error("Transaction not found"), { code: "MKT_TX_NOT_FOUND" });
  if (tx.caseType !== "E") {
    throw Object.assign(new Error("Security deposit refund applies only to Case E (transit) transactions"), {
      code: "MKT_TX_SD_REFUND_CASE",
    });
  }
  if (tx.status !== "Finalized") {
    throw Object.assign(new Error("Only finalized Case E transactions can record a security deposit refund"), {
      code: "MKT_TX_SD_REFUND_STATUS",
    });
  }
  if (tx.sdRefundReceiptId || (tx.sdRefundTxnRef && String(tx.sdRefundTxnRef).trim() !== "")) {
    throw Object.assign(new Error("Security deposit already refunded for this transaction"), {
      code: "MKT_TX_SD_ALREADY_REFUNDED",
    });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.refundDate)) {
    throw Object.assign(new Error("Refund date must be YYYY-MM-DD"), { code: "MKT_TX_SD_REFUND_DATE" });
  }
  if (args.checkPostId === tx.entryLocationId) {
    throw Object.assign(
      new Error("Exit check post must be different from the entry check post for Case E transit"),
      { code: "MKT_TX_SD_REFUND_SAME_CP" },
    );
  }
  const [cp] = await db
    .select({ id: yards.id, name: yards.name, code: yards.code })
    .from(yards)
    .where(eq(yards.id, args.checkPostId))
    .limit(1);
  if (!cp) {
    throw Object.assign(new Error("Refund check post not found"), { code: "MKT_TX_SD_REFUND_CHECKPOST" });
  }

  if (!tx.anyExitCheckpost && tx.exitCheckpostsJson) {
    try {
      const ids = JSON.parse(tx.exitCheckpostsJson) as unknown;
      if (Array.isArray(ids) && ids.length > 0) {
        const allowed = new Set(ids.map(String));
        if (!allowed.has(args.checkPostId)) {
          throw Object.assign(
            new Error("This exit check post was not selected on the original transit receipt"),
            { code: "MKT_TX_SD_REFUND_EXIT_MISMATCH" },
          );
        }
      }
    } catch (e) {
      if ((e as { code?: string }).code) throw e;
    }
  }

  const cfg = await getCaseESdConfig();
  const windowHours = caseERefundWindowHoursFractional(cfg);
  const entryAt = parseCaseEEntryInstant(tx);
  const nowMs = Date.now();
  if (!entryAt) {
    throw Object.assign(new Error("Cannot determine receipt generation time for validity check"), {
      code: "MKT_TX_SD_REFUND_NO_GENERATED_AT",
    });
  }
  const elapsedMs = nowMs - entryAt.getTime();
  const elapsedHours = elapsedMs / (1000 * 60 * 60);
  if (elapsedMs > cfg.validityMs) {
    throw Object.assign(
      new Error(
        `This receipt is no longer available for refund. Validity is ${cfg.validityLabel} from receipt generation (elapsed ${elapsedHours.toFixed(2)} h).`,
      ),
      { code: "MKT_TX_SD_REFUND_WINDOW", elapsedHours },
    );
  }

  // SDRF refunds the full security deposit only (admin charges retained).
  const collectedSd = Math.round(Number(tx.securityDepositAmount ?? 0) * 100) / 100;
  const adminRetained = Math.round(Number(tx.adminChargesAmount ?? 0) * 100) / 100;
  const amount = collectedSd;
  if (!(amount > 0)) {
    throw Object.assign(new Error("Refund amount must be greater than zero"), { code: "MKT_TX_SD_REFUND_AMOUNT" });
  }
  if (args.refundAmount != null && Number.isFinite(Number(args.refundAmount))) {
    const requested = Math.round(Number(args.refundAmount) * 100) / 100;
    if (Math.abs(requested - collectedSd) > 0.01) {
      throw Object.assign(new Error("Case E security deposit refund must equal the full SD collected"), {
        code: "MKT_TX_SD_REFUND_FULL_ONLY",
      });
    }
  }

  const [origReceipt] = tx.receiptId
    ? await db.select().from(iomsReceipts).where(eq(iomsReceipts.id, tx.receiptId)).limit(1)
    : [];
  const payerName =
    (tx.traderManualName ?? "").trim() ||
    (tx.traderLicenceId
      ? ((await db.select({ firmName: traderLicences.firmName }).from(traderLicences).where(eq(traderLicences.id, tx.traderLicenceId)).limit(1))[0]
          ?.firmName ?? "Trader")
      : "Trader");

  const paymentMode = String(args.paymentMode ?? "Cash").trim() || "Cash";
  const [entryYard] = await db
    .select({ name: yards.name, code: yards.code })
    .from(yards)
    .where(eq(yards.id, tx.entryLocationId))
    .limit(1);
  const routeText = `From ${entryYard?.name ?? tx.entryLocationId} To ${cp.name}`;
  const exitAtIso = new Date(nowMs).toISOString();
  const narration = [
    "PAYMENT-REFUND MKT FEE / Security Deposit (Market Fee equivalent)",
    `Original receipt: ${origReceipt?.receiptNo ?? "—"}`,
    `Txn: ${tx.transactionNo ?? tx.id}`,
    tx.vehicleNumber ? `Vehicle: ${tx.vehicleNumber}` : null,
    routeText,
    `Elapsed: ${formatElapsedLabel(elapsedMs)} / ${cfg.validityLabel}`,
  ]
    .filter(Boolean)
    .join(" | ")
    .slice(0, 500);

  const lineRows = await db
    .select({
      line: marketTransactionCommodities,
      commodityName: commodities.name,
    })
    .from(marketTransactionCommodities)
    .leftJoin(commodities, eq(marketTransactionCommodities.commodityId, commodities.id))
    .where(eq(marketTransactionCommodities.transactionId, tx.id));
  const commodityLines: CaseECommodityPdfLine[] = lineRows.map((r) => ({
    commodityName: (r.commodityName ?? "").trim() || r.line.commodityId,
    unit: r.line.unit,
    quantity: Number(r.line.quantity),
    ratePerUnit: Number(r.line.ratePerUnit),
    commodityValue: Number(r.line.commodityValue),
    marketFee: Number(r.line.marketFeeAmount),
  }));
  const m03BreakdownJson = buildCaseESdrfBreakdownJson({
    kind: CASE_E_SDRF_BREAKDOWN_KIND,
    refundCheckPostName: cp.name,
    originalReceiptNo: origReceipt?.receiptNo ?? tx.transactionNo ?? tx.id,
    entryCheckPostName: entryYard?.name ?? tx.entryLocationId,
    entryAtIso: entryAt.toISOString(),
    exitAtIso,
    timeTakenLabel: formatElapsedLabel(elapsedMs),
    validityLabel: cfg.validityLabel,
    eligible: true,
    securityDepositCollected: collectedSd,
    securityDepositRefunded: amount,
    adminChargesRetained: adminRetained,
    totalCollected: Math.round((collectedSd + adminRetained) * 100) / 100,
    commodities: commodityLines,
  });

  const refundReceipt = await createIomsReceipt({
    yardId: args.checkPostId,
    revenueHead: CASE_E_SD_REFUND_REVENUE_HEAD,
    payerName: String(payerName),
    payerType: tx.traderLicenceId ? "TraderLicence" : "WalkIn",
    payerRefId: tx.traderLicenceId ?? undefined,
    amount,
    paymentMode,
    sourceModule: "M-04",
    sourceRecordId: `case_e_sd_refund:${tx.id}`,
    unifiedEntityId: tx.traderLicenceId ? unifiedEntityIdFromTrackA(tx.traderLicenceId) : undefined,
    createdBy: args.recordedBy,
    paymentDateYmd: args.refundDate,
    applicationRef: origReceipt?.receiptNo ?? tx.transactionNo ?? tx.id,
    narration,
    m03BreakdownJson,
  });
  // Keep refund receipt as Paid (not Reversed) — SDRF is a positive refund document.
  await db
    .update(iomsReceipts)
    .set({ status: "Paid", gatewayRef: "CaseESdRefund" })
    .where(eq(iomsReceipts.id, refundReceipt.id));

  const refundTxnRef = (args.refundTxnRef ?? "").trim() || refundReceipt.receiptNo;
  const now = new Date().toISOString();
  await db
    .update(marketTransactions)
    .set({
      sdRefundCheckPostId: args.checkPostId,
      sdRefundTxnRef: refundTxnRef,
      sdRefundReceiptId: refundReceipt.id,
      sdRefundDate: args.refundDate,
      sdRefundAmount: amount,
      sdRefundRecordedAt: now,
      sdRefundRecordedBy: args.recordedBy,
    })
    .where(eq(marketTransactions.id, args.transactionId));

  const [processor] = await db
    .select({ name: users.name, username: users.username })
    .from(users)
    .where(eq(users.id, args.recordedBy))
    .limit(1);

  return {
    id: args.transactionId,
    transactionNo: tx.transactionNo,
    originalReceiptId: tx.receiptId,
    originalReceiptNo: origReceipt?.receiptNo ?? null,
    sdRefundCheckPostId: args.checkPostId,
    sdRefundCheckPostName: cp.name,
    sdRefundTxnRef: refundTxnRef,
    sdRefundReceiptId: refundReceipt.id,
    sdRefundReceiptNo: refundReceipt.receiptNo,
    sdRefundDate: args.refundDate,
    sdRefundAmount: amount,
    securityDepositCollected: collectedSd,
    withinWindow: true,
    elapsedHours,
    routeText,
    processedById: args.recordedBy,
    processedByName: processor?.name ?? processor?.username ?? args.recordedBy,
    refundWindowHours: windowHours,
    refundWindowLabel: cfg.validityLabel,
  };
}
