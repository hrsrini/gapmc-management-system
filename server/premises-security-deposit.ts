/**
 * M-02 godown premises security deposit collection, refund workflow, ledger.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { Request } from "express";
import {
  assetAllotments,
  assets,
  entityAllotments,
  iomsReceipts,
  premisesSdLedgerEntries,
  premisesSecurityDeposits,
  sdRefundProposalDeposits,
  sdRefundProposalDeductions,
  sdRefundProposals,
  sdRefundProposalSequence,
} from "@shared/db-schema";
import { initialDepositStatusForPaymentMode } from "@shared/receipt-deposit";
import { roundedMoney2 } from "@shared/premises-allocation";
import {
  computeSdRefundNet,
  financialYearLabel,
  M02_SECDEP_CONSOLIDATED_KIND,
  M02_SECREF_KIND,
  type M02SecdepConsolidatedLine,
} from "@shared/premises-security-deposit";
import { db } from "./db";
import { writeAuditLog } from "./audit";
import {
  counterPaymentCreateParams,
  counterPaymentPaidUpdate,
  DuesCounterPaymentError,
  parseCounterDuesPaymentBody,
} from "./dues-counter-payment";
import { createIomsReceipt } from "./routes-receipts-ioms";
import { SecurityDepositReceiptError } from "./allotment-security-deposit-receipt";

const nowIso = () => new Date().toISOString();
const todayYmd = () => nowIso().slice(0, 10);

export async function ensurePremisesDepositRow(opts: {
  yardId: string;
  assetId: string;
  premisesLabel?: string | null;
  payerType: "TraderLicence" | "Entity";
  payerRefId: string;
  payerName?: string | null;
  unifiedEntityId?: string | null;
  assetAllotmentId?: string | null;
  entityAllotmentId?: string | null;
  premisesAgreementId?: string | null;
  agreementLineId?: string | null;
  amount: number;
  depositReceiptId?: string | null;
  depositReceiptNo?: string | null;
  depositReceiptDate?: string | null;
  vacatedOn?: string | null;
}): Promise<string> {
  const amount = roundedMoney2(opts.amount);
  if (amount <= 0) throw new SecurityDepositReceiptError("SEC_DEP_AMOUNT", "Deposit amount must be greater than zero.");

  if (opts.assetAllotmentId) {
    const [ex] = await db
      .select({ id: premisesSecurityDeposits.id })
      .from(premisesSecurityDeposits)
      .where(eq(premisesSecurityDeposits.assetAllotmentId, opts.assetAllotmentId))
      .limit(1);
    if (ex) {
      await db
        .update(premisesSecurityDeposits)
        .set({
          amount,
          depositReceiptId: opts.depositReceiptId ?? undefined,
          depositReceiptNo: opts.depositReceiptNo ?? undefined,
          depositReceiptDate: opts.depositReceiptDate ?? undefined,
          updatedAt: nowIso(),
        })
        .where(eq(premisesSecurityDeposits.id, ex.id));
      return ex.id;
    }
  }
  if (opts.entityAllotmentId) {
    const [ex] = await db
      .select({ id: premisesSecurityDeposits.id })
      .from(premisesSecurityDeposits)
      .where(eq(premisesSecurityDeposits.entityAllotmentId, opts.entityAllotmentId))
      .limit(1);
    if (ex) {
      await db
        .update(premisesSecurityDeposits)
        .set({
          amount,
          depositReceiptId: opts.depositReceiptId ?? undefined,
          depositReceiptNo: opts.depositReceiptNo ?? undefined,
          depositReceiptDate: opts.depositReceiptDate ?? undefined,
          updatedAt: nowIso(),
        })
        .where(eq(premisesSecurityDeposits.id, ex.id));
      return ex.id;
    }
  }

  const id = nanoid();
  const ts = nowIso();
  await db.insert(premisesSecurityDeposits).values({
    id,
    yardId: opts.yardId,
    assetId: opts.assetId,
    premisesLabel: opts.premisesLabel ?? null,
    payerType: opts.payerType,
    payerRefId: opts.payerRefId,
    payerName: opts.payerName ?? null,
    unifiedEntityId: opts.unifiedEntityId ?? null,
    assetAllotmentId: opts.assetAllotmentId ?? null,
    entityAllotmentId: opts.entityAllotmentId ?? null,
    premisesAgreementId: opts.premisesAgreementId ?? null,
    agreementLineId: opts.agreementLineId ?? null,
    amount,
    status: opts.depositReceiptId ? "Held" : "Held",
    depositReceiptId: opts.depositReceiptId ?? null,
    depositReceiptNo: opts.depositReceiptNo ?? null,
    depositReceiptDate: opts.depositReceiptDate ?? null,
    vacatedOn: opts.vacatedOn ?? null,
    createdAt: ts,
    updatedAt: ts,
  });

  if (opts.depositReceiptId && opts.depositReceiptNo) {
    await postSdLedgerCredit({
      yardId: opts.yardId,
      payerType: opts.payerType,
      payerRefId: opts.payerRefId,
      unifiedEntityId: opts.unifiedEntityId ?? null,
      entryDate: opts.depositReceiptDate ?? todayYmd(),
      premisesLabel: opts.premisesLabel ?? null,
      assetId: opts.assetId,
      amount,
      receiptId: opts.depositReceiptId,
      receiptNo: opts.depositReceiptNo,
    });
  }
  return id;
}

async function postSdLedgerCredit(opts: {
  yardId: string;
  payerType: string;
  payerRefId: string;
  unifiedEntityId?: string | null;
  entryDate: string;
  premisesLabel?: string | null;
  assetId?: string | null;
  amount: number;
  receiptId: string;
  receiptNo: string;
}) {
  await db.insert(premisesSdLedgerEntries).values({
    id: nanoid(),
    yardId: opts.yardId,
    payerType: opts.payerType,
    payerRefId: opts.payerRefId,
    unifiedEntityId: opts.unifiedEntityId ?? null,
    entryDate: opts.entryDate,
    particulars: `Security deposit received`,
    linkedDocType: "SECDEP",
    linkedDocId: opts.receiptId,
    linkedDocNo: opts.receiptNo,
    premisesLabel: opts.premisesLabel ?? null,
    assetId: opts.assetId ?? null,
    creditAmount: roundedMoney2(opts.amount),
    debitAmount: 0,
    createdAt: nowIso(),
  });
}

/** After allotment draft SD receipt: ensure deposit row + ledger. */
export async function syncDepositAfterAllotmentReceipt(opts: {
  yardId: string;
  assetId: string;
  premisesLabel?: string | null;
  payerType: "TraderLicence" | "Entity";
  payerRefId: string;
  payerName?: string | null;
  unifiedEntityId?: string | null;
  assetAllotmentId?: string | null;
  entityAllotmentId?: string | null;
  amount: number;
  receiptId: string;
  receiptNo: string;
}) {
  const depositId = await ensurePremisesDepositRow({
    ...opts,
    depositReceiptId: opts.receiptId,
    depositReceiptNo: opts.receiptNo,
    depositReceiptDate: todayYmd(),
  });
  // Ledger may already exist from ensure when receipt was set; avoid duplicate by checking.
  const [led] = await db
    .select({ id: premisesSdLedgerEntries.id })
    .from(premisesSdLedgerEntries)
    .where(
      and(
        eq(premisesSdLedgerEntries.linkedDocId, opts.receiptId),
        eq(premisesSdLedgerEntries.assetId, opts.assetId),
      ),
    )
    .limit(1);
  if (!led) {
    await postSdLedgerCredit({
      yardId: opts.yardId,
      payerType: opts.payerType,
      payerRefId: opts.payerRefId,
      unifiedEntityId: opts.unifiedEntityId,
      entryDate: todayYmd(),
      premisesLabel: opts.premisesLabel,
      assetId: opts.assetId,
      amount: opts.amount,
      receiptId: opts.receiptId,
      receiptNo: opts.receiptNo,
    });
  }
  return depositId;
}

export async function listDepositsForPayer(opts: {
  payerType: string;
  payerRefId: string;
  status?: string;
}) {
  const conds = [
    eq(premisesSecurityDeposits.payerType, opts.payerType),
    eq(premisesSecurityDeposits.payerRefId, opts.payerRefId),
  ];
  if (opts.status) conds.push(eq(premisesSecurityDeposits.status, opts.status));
  return db
    .select()
    .from(premisesSecurityDeposits)
    .where(and(...conds))
    .orderBy(desc(premisesSecurityDeposits.createdAt));
}

/** Vacated premises with Held deposits (for refund form). Includes Refunded greyed. */
export async function listRefundableDepositsForPayer(opts: {
  payerType: string;
  payerRefId: string;
}) {
  const rows = await listDepositsForPayer(opts);
  const out = [];
  for (const d of rows) {
    let vacated = Boolean(d.vacatedOn);
    if (!vacated && d.assetAllotmentId) {
      const [a] = await db
        .select({ status: assetAllotments.status, toDate: assetAllotments.toDate })
        .from(assetAllotments)
        .where(eq(assetAllotments.id, d.assetAllotmentId))
        .limit(1);
      if (a?.status === "Vacated") {
        vacated = true;
        if (!d.vacatedOn && a.toDate) {
          await db
            .update(premisesSecurityDeposits)
            .set({ vacatedOn: a.toDate, updatedAt: nowIso() })
            .where(eq(premisesSecurityDeposits.id, d.id));
          d.vacatedOn = a.toDate;
        }
      }
    }
    if (!vacated && d.entityAllotmentId) {
      const [a] = await db
        .select({ status: entityAllotments.status, toDate: entityAllotments.toDate })
        .from(entityAllotments)
        .where(eq(entityAllotments.id, d.entityAllotmentId))
        .limit(1);
      if (a?.status === "Vacated") {
        vacated = true;
        if (!d.vacatedOn && a.toDate) {
          await db
            .update(premisesSecurityDeposits)
            .set({ vacatedOn: a.toDate, updatedAt: nowIso() })
            .where(eq(premisesSecurityDeposits.id, d.id));
          d.vacatedOn = a.toDate;
        }
      }
    }
    // Show vacated Held/Reserved/Refunded; hide active allotment Held without vacation.
    if (vacated || d.status === "Refunded" || d.status === "Reserved") {
      out.push(d);
    }
  }
  return out;
}

export async function generateConsolidatedSecdepReceipt(opts: {
  req: Request;
  depositIds: string[];
  paymentBody: Record<string, unknown>;
}): Promise<{ receiptId: string; receiptNo: string }> {
  const ids = [...new Set(opts.depositIds.map((x) => String(x).trim()).filter(Boolean))];
  if (ids.length === 0) {
    throw new SecurityDepositReceiptError("SEC_DEP_SELECT", "Select at least one premises deposit.");
  }
  const rows = await db
    .select()
    .from(premisesSecurityDeposits)
    .where(inArray(premisesSecurityDeposits.id, ids));
  if (rows.length !== ids.length) {
    throw new SecurityDepositReceiptError("SEC_DEP_NOT_FOUND", "One or more deposits were not found.");
  }
  for (const r of rows) {
    if (r.depositReceiptId) {
      throw new SecurityDepositReceiptError(
        "SEC_DEP_ALREADY_RECEIPTED",
        `Premises ${r.premisesLabel || r.assetId} is already receipted (${r.depositReceiptNo}).`,
      );
    }
    if (r.status !== "Held") {
      throw new SecurityDepositReceiptError("SEC_DEP_STATUS", `Deposit ${r.premisesLabel} is not Held.`);
    }
  }
  const payerType = rows[0]!.payerType;
  const payerRefId = rows[0]!.payerRefId;
  const yardId = rows[0]!.yardId;
  if (rows.some((r) => r.payerType !== payerType || r.payerRefId !== payerRefId || r.yardId !== yardId)) {
    throw new SecurityDepositReceiptError(
      "SEC_DEP_MIXED",
      "Selected deposits must belong to the same trader/entity and yard.",
    );
  }
  const total = roundedMoney2(rows.reduce((s, r) => s + Number(r.amount), 0));
  if (total <= 0) throw new SecurityDepositReceiptError("SEC_DEP_AMOUNT", "Total deposit must be greater than zero.");

  let counterPay;
  try {
    counterPay = parseCounterDuesPaymentBody({
      ...opts.paymentBody,
      amount: total,
      paymentMode:
        opts.paymentBody.securityDepositPaymentMode ??
        opts.paymentBody.paymentMode ??
        opts.paymentBody.paymentType ??
        "Cash",
    });
  } catch (e) {
    if (e instanceof DuesCounterPaymentError) {
      throw new SecurityDepositReceiptError(e.code, e.message);
    }
    throw e;
  }

  const lines: M02SecdepConsolidatedLine[] = rows.map((r) => ({
    depositId: r.id,
    assetId: r.assetId,
    premisesLabel: r.premisesLabel || r.assetId,
    amount: roundedMoney2(r.amount),
  }));
  const breakdown = JSON.stringify({ kind: M02_SECDEP_CONSOLIDATED_KIND, lines });

  const createdBy = opts.req.user?.id ?? "system";
  const created = await createIomsReceipt({
    yardId,
    revenueHead: "SecurityDeposit",
    payerName: rows[0]!.payerName ?? undefined,
    payerType,
    payerRefId,
    amount: total,
    cgst: 0,
    sgst: 0,
    sourceModule: "M-02",
    sourceRecordId: `SECDEP:${ids.join(",")}`,
    unifiedEntityId: rows[0]!.unifiedEntityId ?? null,
    premisesAssetId: rows.length === 1 ? rows[0]!.assetId : null,
    narration: `Being amount received towards Security Deposit (${rows.length} premises).`,
    createdBy,
    ...counterPaymentCreateParams(counterPay),
  });

  await db
    .update(iomsReceipts)
    .set({
      ...counterPaymentPaidUpdate(counterPay),
      depositStatus: initialDepositStatusForPaymentMode(counterPay.paymentMode),
      m03BreakdownJson: breakdown,
    })
    .where(eq(iomsReceipts.id, created.id));

  const receiptDate = todayYmd();
  for (const r of rows) {
    await db
      .update(premisesSecurityDeposits)
      .set({
        depositReceiptId: created.id,
        depositReceiptNo: created.receiptNo,
        depositReceiptDate: receiptDate,
        status: "Held",
        updatedAt: nowIso(),
      })
      .where(eq(premisesSecurityDeposits.id, r.id));
    await postSdLedgerCredit({
      yardId,
      payerType,
      payerRefId,
      unifiedEntityId: r.unifiedEntityId,
      entryDate: receiptDate,
      premisesLabel: r.premisesLabel,
      assetId: r.assetId,
      amount: r.amount,
      receiptId: created.id,
      receiptNo: created.receiptNo,
    });
  }

  writeAuditLog(opts.req, {
    module: "Assets",
    action: "GenerateSecdepReceipt",
    recordId: created.id,
    afterValue: { receiptNo: created.receiptNo, depositIds: ids, total },
  }).catch((e) => console.error("Audit log failed:", e));

  return { receiptId: created.id, receiptNo: created.receiptNo };
}

async function nextSdRefundProposalNo(): Promise<string> {
  const fy = financialYearLabel();
  const seqId = `sdref_${fy}`;
  const next = await db.transaction(async (tx) => {
    await tx
      .insert(sdRefundProposalSequence)
      .values({ id: seqId, financialYear: fy, lastSeq: 0 })
      .onConflictDoNothing();
    const [updated] = await tx
      .update(sdRefundProposalSequence)
      .set({ lastSeq: sql`${sdRefundProposalSequence.lastSeq} + 1` })
      .where(eq(sdRefundProposalSequence.financialYear, fy))
      .returning({ lastSeq: sdRefundProposalSequence.lastSeq });
    return updated?.lastSeq ?? 1;
  });
  return `SECREF-PRO/${fy}/${String(next).padStart(4, "0")}`;
}

export async function createOrUpdateSdRefundProposal(opts: {
  req: Request;
  id?: string;
  payerType: string;
  payerRefId: string;
  payerName?: string;
  unifiedEntityId?: string | null;
  yardId: string;
  proposalDate: string;
  depositIds: string[];
  deductions: Array<{ reason: string; amount: number }>;
  payment: {
    paymentMode: string;
    paymentDate: string;
    chequeNo?: string | null;
    bankName?: string | null;
    chequeDate?: string | null;
    utrRef?: string | null;
    paymentRemarks?: string | null;
  };
  submit?: boolean;
}) {
  const depositIds = [...new Set(opts.depositIds)];
  if (depositIds.length === 0) {
    throw new SecurityDepositReceiptError("SD_REFUND_SELECT", "Select at least one vacated deposit.");
  }
  const deposits = await db
    .select()
    .from(premisesSecurityDeposits)
    .where(inArray(premisesSecurityDeposits.id, depositIds));
  if (deposits.length !== depositIds.length) {
    throw new SecurityDepositReceiptError("SD_REFUND_NOT_FOUND", "One or more deposits were not found.");
  }
  for (const d of deposits) {
    if (d.payerType !== opts.payerType || d.payerRefId !== opts.payerRefId) {
      throw new SecurityDepositReceiptError("SD_REFUND_PAYER", "Deposit does not belong to selected trader/entity.");
    }
    if (d.status === "Refunded") {
      throw new SecurityDepositReceiptError("SD_REFUND_ALREADY", `Deposit ${d.premisesLabel} is already Refunded.`);
    }
    if (d.status === "Reserved" && (!opts.id || d.refundProposalId !== opts.id)) {
      throw new SecurityDepositReceiptError(
        "SD_REFUND_RESERVED",
        `Deposit ${d.premisesLabel} is reserved on another proposal.`,
      );
    }
    if (!d.depositReceiptId) {
      throw new SecurityDepositReceiptError("SD_REFUND_NO_RECEIPT", `Deposit ${d.premisesLabel} has no deposit receipt.`);
    }
  }

  const selectedTotal = roundedMoney2(deposits.reduce((s, d) => s + Number(d.amount), 0));
  const deductions = opts.deductions
    .map((x, i) => ({
      reason: String(x.reason ?? "").trim(),
      amount: roundedMoney2(x.amount),
      sortOrder: i,
    }))
    .filter((x) => x.reason && x.amount > 0);
  const deductionsTotal = roundedMoney2(deductions.reduce((s, x) => s + x.amount, 0));
  if (deductionsTotal > selectedTotal + 0.001) {
    throw new SecurityDepositReceiptError(
      "SD_REFUND_DEDUCTIONS",
      "Total deductions cannot exceed selected security deposits.",
    );
  }
  const netPayable = computeSdRefundNet(selectedTotal, deductionsTotal);
  if (netPayable < 0) {
    throw new SecurityDepositReceiptError("SD_REFUND_NET", "Net payable cannot be negative.");
  }

  const mode = String(opts.payment.paymentMode ?? "").trim();
  const paymentMode =
    mode === "NEFT" || mode === "RTGS" || mode === "NEFT/RTGS" ? "Online" : mode || "Cash";
  if (!["Cash", "Cheque", "Online", "DD"].includes(paymentMode)) {
    throw new SecurityDepositReceiptError("SD_REFUND_PAYMENT_MODE", "Payment mode must be Cash, Cheque, or NEFT/RTGS.");
  }
  if (!opts.payment.paymentDate) {
    throw new SecurityDepositReceiptError("SD_REFUND_PAYMENT_DATE", "Payment date is required.");
  }
  if (opts.payment.paymentDate > todayYmd()) {
    throw new SecurityDepositReceiptError("SD_REFUND_PAYMENT_DATE", "Payment date cannot be later than today.");
  }
  if (paymentMode === "Cheque" && (!opts.payment.chequeNo || !opts.payment.chequeDate || !opts.payment.bankName)) {
    throw new SecurityDepositReceiptError("SD_REFUND_CHEQUE", "Cheque number, date and bank are required.");
  }
  if (paymentMode === "Online" && (!opts.payment.utrRef || !opts.payment.paymentDate)) {
    throw new SecurityDepositReceiptError("SD_REFUND_UTR", "UTR / transaction reference and date are required.");
  }

  const ts = nowIso();
  let proposalId = opts.id;
  let proposalNo: string;

  if (proposalId) {
    const [existing] = await db
      .select()
      .from(sdRefundProposals)
      .where(eq(sdRefundProposals.id, proposalId))
      .limit(1);
    if (!existing) throw new SecurityDepositReceiptError("SD_REFUND_NOT_FOUND", "Proposal not found.");
    if (!["Draft", "ReturnedToDO", "Rejected"].includes(existing.status)) {
      throw new SecurityDepositReceiptError("SD_REFUND_LOCKED", "Proposal cannot be edited in the current status.");
    }
    // Release previous reservations
    await db
      .update(premisesSecurityDeposits)
      .set({ status: "Held", refundProposalId: null, updatedAt: ts })
      .where(eq(premisesSecurityDeposits.refundProposalId, proposalId));
    await db.delete(sdRefundProposalDeposits).where(eq(sdRefundProposalDeposits.proposalId, proposalId));
    await db.delete(sdRefundProposalDeductions).where(eq(sdRefundProposalDeductions.proposalId, proposalId));
    proposalNo = existing.proposalNo;
    await db
      .update(sdRefundProposals)
      .set({
        yardId: opts.yardId,
        payerName: opts.payerName ?? existing.payerName,
        unifiedEntityId: opts.unifiedEntityId ?? existing.unifiedEntityId,
        proposalDate: opts.proposalDate,
        selectedDepositTotal: selectedTotal,
        deductionsTotal,
        netPayable,
        paymentMode,
        paymentDate: opts.payment.paymentDate,
        chequeNo: opts.payment.chequeNo ?? null,
        bankName: opts.payment.bankName ?? null,
        chequeDate: opts.payment.chequeDate ?? null,
        utrRef: opts.payment.utrRef ?? null,
        paymentRemarks: opts.payment.paymentRemarks ?? null,
        status: opts.submit ? "PendingVerification" : existing.status === "Rejected" ? "Draft" : "Draft",
        doUser: opts.req.user?.id ?? existing.doUser,
        submittedAt: opts.submit ? ts : existing.submittedAt,
        returnOrRejectRemarks: opts.submit ? null : existing.returnOrRejectRemarks,
        updatedAt: ts,
      })
      .where(eq(sdRefundProposals.id, proposalId));
  } else {
    proposalId = nanoid();
    proposalNo = await nextSdRefundProposalNo();
    await db.insert(sdRefundProposals).values({
      id: proposalId,
      proposalNo,
      yardId: opts.yardId,
      payerType: opts.payerType,
      payerRefId: opts.payerRefId,
      payerName: opts.payerName ?? null,
      unifiedEntityId: opts.unifiedEntityId ?? null,
      proposalDate: opts.proposalDate,
      selectedDepositTotal: selectedTotal,
      deductionsTotal,
      netPayable,
      status: opts.submit ? "PendingVerification" : "Draft",
      paymentMode,
      paymentDate: opts.payment.paymentDate,
      chequeNo: opts.payment.chequeNo ?? null,
      bankName: opts.payment.bankName ?? null,
      chequeDate: opts.payment.chequeDate ?? null,
      utrRef: opts.payment.utrRef ?? null,
      paymentRemarks: opts.payment.paymentRemarks ?? null,
      doUser: opts.req.user?.id ?? null,
      submittedAt: opts.submit ? ts : null,
      createdAt: ts,
      updatedAt: ts,
    });
  }

  for (const d of deposits) {
    await db.insert(sdRefundProposalDeposits).values({
      id: nanoid(),
      proposalId: proposalId!,
      depositId: d.id,
      amount: roundedMoney2(d.amount),
    });
  }
  for (const ded of deductions) {
    await db.insert(sdRefundProposalDeductions).values({
      id: nanoid(),
      proposalId: proposalId!,
      sortOrder: ded.sortOrder,
      reason: ded.reason,
      amount: ded.amount,
    });
  }

  if (opts.submit) {
    await db
      .update(premisesSecurityDeposits)
      .set({ status: "Reserved", refundProposalId: proposalId!, updatedAt: ts })
      .where(inArray(premisesSecurityDeposits.id, depositIds));
  }

  return getSdRefundProposalDetail(proposalId!);
}

export async function getSdRefundProposalDetail(id: string) {
  const [row] = await db.select().from(sdRefundProposals).where(eq(sdRefundProposals.id, id)).limit(1);
  if (!row) return null;
  const depositLinks = await db
    .select()
    .from(sdRefundProposalDeposits)
    .where(eq(sdRefundProposalDeposits.proposalId, id));
  const depositIds = depositLinks.map((d) => d.depositId);
  const deposits =
    depositIds.length > 0
      ? await db.select().from(premisesSecurityDeposits).where(inArray(premisesSecurityDeposits.id, depositIds))
      : [];
  const deductions = await db
    .select()
    .from(sdRefundProposalDeductions)
    .where(eq(sdRefundProposalDeductions.proposalId, id))
    .orderBy(sdRefundProposalDeductions.sortOrder);
  return { ...row, deposits, deductions };
}

export async function verifySdRefundProposal(opts: { req: Request; id: string }) {
  const [row] = await db.select().from(sdRefundProposals).where(eq(sdRefundProposals.id, opts.id)).limit(1);
  if (!row) throw new SecurityDepositReceiptError("SD_REFUND_NOT_FOUND", "Proposal not found.");
  if (row.status !== "PendingVerification") {
    throw new SecurityDepositReceiptError("SD_REFUND_STATUS", "Proposal is not pending DV verification.");
  }
  const ts = nowIso();
  await db
    .update(sdRefundProposals)
    .set({
      status: "PendingApproval",
      dvUser: opts.req.user?.id ?? null,
      verifiedAt: ts,
      updatedAt: ts,
    })
    .where(eq(sdRefundProposals.id, opts.id));
  return getSdRefundProposalDetail(opts.id);
}

export async function returnSdRefundProposal(opts: { req: Request; id: string; remarks: string }) {
  const remarks = String(opts.remarks ?? "").trim();
  if (!remarks) throw new SecurityDepositReceiptError("SD_REFUND_REMARKS", "Remarks are required.");
  const [row] = await db.select().from(sdRefundProposals).where(eq(sdRefundProposals.id, opts.id)).limit(1);
  if (!row) throw new SecurityDepositReceiptError("SD_REFUND_NOT_FOUND", "Proposal not found.");
  if (!["PendingVerification", "PendingApproval"].includes(row.status)) {
    throw new SecurityDepositReceiptError("SD_REFUND_STATUS", "Proposal cannot be returned in this status.");
  }
  const ts = nowIso();
  const links = await db
    .select()
    .from(sdRefundProposalDeposits)
    .where(eq(sdRefundProposalDeposits.proposalId, opts.id));
  const ids = links.map((l) => l.depositId);
  if (ids.length) {
    await db
      .update(premisesSecurityDeposits)
      .set({ status: "Held", refundProposalId: null, updatedAt: ts })
      .where(inArray(premisesSecurityDeposits.id, ids));
  }
  await db
    .update(sdRefundProposals)
    .set({
      status: "ReturnedToDO",
      returnOrRejectRemarks: remarks,
      returnedAt: ts,
      workflowRevisionCount: (row.workflowRevisionCount ?? 0) + 1,
      updatedAt: ts,
    })
    .where(eq(sdRefundProposals.id, opts.id));
  return getSdRefundProposalDetail(opts.id);
}

export async function approveSdRefundProposal(opts: { req: Request; id: string }) {
  const detail = await getSdRefundProposalDetail(opts.id);
  if (!detail) throw new SecurityDepositReceiptError("SD_REFUND_NOT_FOUND", "Proposal not found.");
  if (detail.status !== "PendingApproval") {
    throw new SecurityDepositReceiptError("SD_REFUND_STATUS", "Proposal is not pending DA approval.");
  }

  const paymentMode = String(detail.paymentMode ?? "Cash");
  const createdBy = opts.req.user?.id ?? "system";
  const breakdown = JSON.stringify({
    kind: M02_SECREF_KIND,
    proposalId: detail.id,
    proposalNo: detail.proposalNo,
    deposits: detail.deposits.map((d) => ({
      depositId: d.id,
      premisesLabel: d.premisesLabel,
      depositReceiptNo: d.depositReceiptNo,
      depositReceiptDate: d.depositReceiptDate,
      amount: d.amount,
    })),
    deductions: detail.deductions.map((x) => ({ reason: x.reason, amount: x.amount })),
    selectedDepositTotal: detail.selectedDepositTotal,
    deductionsTotal: detail.deductionsTotal,
    netPayable: detail.netPayable,
  });

  const created = await createIomsReceipt({
    yardId: detail.yardId,
    revenueHead: "SecurityDepositRefund",
    payerName: detail.payerName ?? undefined,
    payerType: detail.payerType,
    payerRefId: detail.payerRefId,
    amount: roundedMoney2(detail.netPayable),
    cgst: 0,
    sgst: 0,
    sourceModule: "M-02",
    sourceRecordId: detail.id,
    unifiedEntityId: detail.unifiedEntityId ?? null,
    narration: `Refund of Security Deposit of Premises (${detail.proposalNo}).`,
    createdBy,
    paymentMode,
    counterDuesPayment: true,
    chequeNo: detail.chequeNo ?? undefined,
    bankName: detail.bankName ?? undefined,
    chequeDate: detail.chequeDate ?? undefined,
    gatewayRef: detail.utrRef ?? undefined,
    paymentDateYmd: detail.paymentDate ?? undefined,
  });

  await db
    .update(iomsReceipts)
    .set({
      status: "Paid",
      m03BreakdownJson: breakdown,
      depositStatus: null,
      gatewayRef: detail.utrRef ?? null,
    })
    .where(eq(iomsReceipts.id, created.id));

  const ts = nowIso();
  const refundDate = detail.paymentDate || todayYmd();

  for (const d of detail.deposits) {
    await db
      .update(premisesSecurityDeposits)
      .set({
        status: "Refunded",
        refundReceiptId: created.id,
        refundReceiptNo: created.receiptNo,
        refundedAt: refundDate,
        updatedAt: ts,
      })
      .where(eq(premisesSecurityDeposits.id, d.id));
  }

  for (const ded of detail.deductions) {
    await db.insert(premisesSdLedgerEntries).values({
      id: nanoid(),
      yardId: detail.yardId,
      payerType: detail.payerType,
      payerRefId: detail.payerRefId,
      unifiedEntityId: detail.unifiedEntityId,
      entryDate: refundDate,
      particulars: `Deduction: ${ded.reason}`,
      linkedDocType: "SECREF-PRO",
      linkedDocId: detail.id,
      linkedDocNo: detail.proposalNo,
      premisesLabel: null,
      assetId: null,
      creditAmount: 0,
      debitAmount: roundedMoney2(ded.amount),
      createdAt: ts,
    });
  }

  await db.insert(premisesSdLedgerEntries).values({
    id: nanoid(),
    yardId: detail.yardId,
    payerType: detail.payerType,
    payerRefId: detail.payerRefId,
    unifiedEntityId: detail.unifiedEntityId,
    entryDate: refundDate,
    particulars: `Refund paid by ${paymentMode}${detail.utrRef ? `, UTR ${detail.utrRef}` : detail.chequeNo ? `, Cheque ${detail.chequeNo}` : ""}`,
    linkedDocType: "SECREF",
    linkedDocId: created.id,
    linkedDocNo: created.receiptNo,
    premisesLabel: null,
    assetId: null,
    creditAmount: 0,
    debitAmount: roundedMoney2(detail.netPayable),
    createdAt: ts,
  });

  await db
    .update(sdRefundProposals)
    .set({
      status: "Completed",
      daUser: opts.req.user?.id ?? null,
      approvedAt: ts,
      refundReceiptId: created.id,
      refundReceiptNo: created.receiptNo,
      updatedAt: ts,
    })
    .where(eq(sdRefundProposals.id, opts.id));

  writeAuditLog(opts.req, {
    module: "Assets",
    action: "ApproveSdRefund",
    recordId: opts.id,
    afterValue: { receiptNo: created.receiptNo, netPayable: detail.netPayable },
  }).catch((e) => console.error("Audit log failed:", e));

  return getSdRefundProposalDetail(opts.id);
}

export async function rejectSdRefundProposal(opts: { req: Request; id: string; remarks: string }) {
  const remarks = String(opts.remarks ?? "").trim();
  if (!remarks) throw new SecurityDepositReceiptError("SD_REFUND_REMARKS", "Remarks are required.");
  const [row] = await db.select().from(sdRefundProposals).where(eq(sdRefundProposals.id, opts.id)).limit(1);
  if (!row) throw new SecurityDepositReceiptError("SD_REFUND_NOT_FOUND", "Proposal not found.");
  if (row.status !== "PendingApproval") {
    throw new SecurityDepositReceiptError("SD_REFUND_STATUS", "Only PendingApproval proposals can be rejected by DA.");
  }
  const ts = nowIso();
  const links = await db
    .select()
    .from(sdRefundProposalDeposits)
    .where(eq(sdRefundProposalDeposits.proposalId, opts.id));
  const ids = links.map((l) => l.depositId);
  if (ids.length) {
    await db
      .update(premisesSecurityDeposits)
      .set({ status: "Held", refundProposalId: null, updatedAt: ts })
      .where(inArray(premisesSecurityDeposits.id, ids));
  }
  await db
    .update(sdRefundProposals)
    .set({
      status: "Rejected",
      rejectedAt: ts,
      returnOrRejectRemarks: remarks,
      daUser: opts.req.user?.id ?? null,
      workflowRevisionCount: (row.workflowRevisionCount ?? 0) + 1,
      updatedAt: ts,
    })
    .where(eq(sdRefundProposals.id, opts.id));
  return getSdRefundProposalDetail(opts.id);
}

export async function listSdDepositRegister(opts?: { status?: string; yardId?: string }) {
  const conds = [];
  if (opts?.status === "Held") conds.push(eq(premisesSecurityDeposits.status, "Held"));
  if (opts?.status === "Refunded") conds.push(eq(premisesSecurityDeposits.status, "Refunded"));
  if (opts?.status === "RefundPending") {
    conds.push(inArray(premisesSecurityDeposits.status, ["Reserved"]));
  }
  if (opts?.yardId) conds.push(eq(premisesSecurityDeposits.yardId, opts.yardId));
  const q = db.select().from(premisesSecurityDeposits).orderBy(desc(premisesSecurityDeposits.createdAt));
  return conds.length ? q.where(and(...conds)) : q;
}

export async function getSdLedgerForPayer(opts: { payerType: string; payerRefId: string }) {
  const entries = await db
    .select()
    .from(premisesSdLedgerEntries)
    .where(
      and(
        eq(premisesSdLedgerEntries.payerType, opts.payerType),
        eq(premisesSdLedgerEntries.payerRefId, opts.payerRefId),
      ),
    )
    .orderBy(premisesSdLedgerEntries.entryDate, premisesSdLedgerEntries.createdAt);

  let balance = 0;
  const withBalance = entries.map((e) => {
    balance = roundedMoney2(balance + Number(e.creditAmount) - Number(e.debitAmount));
    return { ...e, runningBalance: balance };
  });

  const deposits = await listDepositsForPayer(opts);
  const byPremises = deposits.map((d) => ({
    depositId: d.id,
    premisesLabel: d.premisesLabel,
    assetId: d.assetId,
    depositReceiptNo: d.depositReceiptNo,
    depositReceiptId: d.depositReceiptId,
    refundReceiptNo: d.refundReceiptNo,
    refundReceiptId: d.refundReceiptId,
    amount: d.amount,
    status: d.status,
  }));

  return { entries: withBalance, balanceByPremises: byPremises, closingBalance: balance };
}

/** Resolve premises label from assets table. */
export async function premisesLabelForAsset(assetId: string): Promise<string> {
  const [a] = await db
    .select({ assetId: assets.assetId, id: assets.id })
    .from(assets)
    .where(eq(assets.id, assetId))
    .limit(1);
  return a?.assetId || assetId;
}
