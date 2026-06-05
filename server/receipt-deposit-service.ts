import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./db";
import {
  gaplmbBankAccountRoles,
  gaplmbBankAccounts,
  gaplmbBankAccountVersions,
  gaplmbBankAccountYards,
  iomsReceipts,
  receiptDepositLines,
  receiptDeposits,
  receiptDepositSequence,
  rentInvoices,
  yards,
} from "@shared/db-schema";
import {
  daysSinceIssueYmd,
  depositStatusAllowsLedgerPosting,
  initialDepositStatusForPaymentMode,
  isPhysicalDepositPaymentMode,
  type DepositRecordStatus,
  type ReceiptDepositStatus,
} from "@shared/receipt-deposit";
import {
  applyM03ReceiptToRentDepositLedger,
  recordChequeDishonourLedgerForM03Receipt,
} from "./rent-deposit-ledger-from-receipt";
import { m03ReceiptPrincipalTowardInvoice } from "@shared/m03-receipt-breakdown";

function nowIso(): string {
  return new Date().toISOString();
}

export async function setReceiptDepositStatusOnPaid(
  receiptId: string,
  paymentMode: string,
): Promise<ReceiptDepositStatus> {
  const depositStatus = initialDepositStatusForPaymentMode(paymentMode);
  await db
    .update(iomsReceipts)
    .set({ depositStatus })
    .where(eq(iomsReceipts.id, receiptId));
  return depositStatus;
}

export async function applyM03ReceiptToRentDepositLedgerWhenSettled(
  r: typeof iomsReceipts.$inferSelect,
): Promise<{ messages: string[] }> {
  if (!depositStatusAllowsLedgerPosting(r.depositStatus)) {
    return { messages: [] };
  }
  return applyM03ReceiptToRentDepositLedger(r);
}

export async function maybeMarkM03InvoicePaidFromSettledReceipts(invoiceId: string): Promise<void> {
  const [inv] = await db.select().from(rentInvoices).where(eq(rentInvoices.id, invoiceId)).limit(1);
  if (!inv) return;
  const allRecs = await db
    .select()
    .from(iomsReceipts)
    .where(and(eq(iomsReceipts.sourceModule, "M-03"), eq(iomsReceipts.sourceRecordId, invoiceId)));
  const paidSum = allRecs
    .filter(
      (r) =>
        (String(r.status ?? "") === "Paid" || String(r.status ?? "") === "Reconciled") &&
        String(r.status ?? "") !== "Reversed" &&
        depositStatusAllowsLedgerPosting(r.depositStatus),
    )
    .reduce((s, r) => s + m03ReceiptPrincipalTowardInvoice(r), 0);
  const total = Number(inv.totalAmount ?? 0);
  if (paidSum >= total - 0.01) {
    await db.update(rentInvoices).set({ status: "Paid" }).where(eq(rentInvoices.id, invoiceId));
  }
}

/** Restore invoice outstanding after a settled receipt is dishonoured or deposit reversed. */
export async function revertM03InvoicePaidAfterReceiptUnsettled(
  invoiceId: string,
  excludeReceiptId?: string,
): Promise<void> {
  const [inv] = await db.select().from(rentInvoices).where(eq(rentInvoices.id, invoiceId)).limit(1);
  if (!inv || String(inv.status ?? "") !== "Paid") return;

  const allRecs = await db
    .select()
    .from(iomsReceipts)
    .where(and(eq(iomsReceipts.sourceModule, "M-03"), eq(iomsReceipts.sourceRecordId, invoiceId)));

  const paidSum = allRecs
    .filter((r) => {
      if (excludeReceiptId && r.id === excludeReceiptId) return false;
      if (String(r.status ?? "") === "Reversed") return false;
      return (
        (String(r.status ?? "") === "Paid" || String(r.status ?? "") === "Reconciled") &&
        depositStatusAllowsLedgerPosting(r.depositStatus)
      );
    })
    .reduce((s, r) => s + m03ReceiptPrincipalTowardInvoice(r), 0);

  const total = Number(inv.totalAmount ?? 0);
  if (paidSum < total - 0.01) {
    const today = new Date().toISOString().slice(0, 10);
    const periodEnd = String(inv.periodMonth ?? "").trim();
    const overdue =
      /^\d{4}-\d{2}$/.test(periodEnd) &&
      `${periodEnd}-01`.slice(0, 7) < today.slice(0, 7);
    await db
      .update(rentInvoices)
      .set({ status: overdue ? "Overdue" : "Approved" })
      .where(eq(rentInvoices.id, invoiceId));
  }
}

export async function finalizeDepositSettlementForReceipts(receiptIds: string[]): Promise<string[]> {
  const messages: string[] = [];
  for (const receiptId of receiptIds) {
    const [row] = await db.select().from(iomsReceipts).where(eq(iomsReceipts.id, receiptId)).limit(1);
    if (!row) continue;
    const coll = await applyM03ReceiptToRentDepositLedgerWhenSettled(row);
    messages.push(...coll.messages.filter(Boolean));
    if (row.sourceModule === "M-03" && row.sourceRecordId) {
      await maybeMarkM03InvoicePaidFromSettledReceipts(String(row.sourceRecordId));
    }
  }
  return messages;
}

export async function allocateDepositRefNo(yardId: string, depositDateYmd: string): Promise<string> {
  const [yard] = await db.select().from(yards).where(eq(yards.id, yardId)).limit(1);
  const loc = String(yard?.code ?? yardId).trim().replace(/[^\w-]+/g, "").slice(0, 12) || "LOC";
  const d = depositDateYmd.replace(/-/g, "");
  const key = d.slice(0, 8);

  const [existing] = await db
    .select()
    .from(receiptDepositSequence)
    .where(and(eq(receiptDepositSequence.yardId, yardId), eq(receiptDepositSequence.depositDateYmd, key)))
    .limit(1);
  const nextSeq = (existing?.lastSeq ?? 0) + 1;
  if (existing) {
    await db
      .update(receiptDepositSequence)
      .set({ lastSeq: nextSeq })
      .where(
        and(eq(receiptDepositSequence.yardId, yardId), eq(receiptDepositSequence.depositDateYmd, key)),
      );
  } else {
    await db.insert(receiptDepositSequence).values({ yardId, depositDateYmd: key, lastSeq: nextSeq });
  }
  return `DEP-${loc}-${key}-${String(nextSeq).padStart(3, "0")}`;
}

export async function listBankAccountsForUser(args: {
  yardIds: string[];
  roleTiers: string[];
  activeOnly?: boolean;
}) {
  const rows = await db.select().from(gaplmbBankAccounts).orderBy(desc(gaplmbBankAccounts.updatedAt));
  const yardLinks = await db.select().from(gaplmbBankAccountYards);
  const roleLinks = await db.select().from(gaplmbBankAccountRoles);
  const yardsByAccount = new Map<string, string[]>();
  for (const y of yardLinks) {
    const list = yardsByAccount.get(y.bankAccountId) ?? [];
    list.push(y.yardId);
    yardsByAccount.set(y.bankAccountId, list);
  }
  const rolesByAccount = new Map<string, string[]>();
  for (const r of roleLinks) {
    const list = rolesByAccount.get(r.bankAccountId) ?? [];
    list.push(r.roleTier);
    rolesByAccount.set(r.bankAccountId, list);
  }

  return rows
    .filter((a) => !args.activeOnly || a.isActive)
    .filter((a) => {
      const ys = yardsByAccount.get(a.id) ?? [];
      if (ys.length === 0) return true;
      return args.yardIds.some((y) => ys.includes(y));
    })
    .filter((a) => {
      const rs = rolesByAccount.get(a.id) ?? [];
      if (rs.length === 0) return true;
      return args.roleTiers.some((t) => rs.includes(t));
    })
    .map((a) => ({
      ...a,
      yardIds: yardsByAccount.get(a.id) ?? [],
      roleTiers: rolesByAccount.get(a.id) ?? [],
    }));
}

export type UndepositedReceiptRow = {
  id: string;
  receiptNo: string;
  createdAt: string;
  payerName: string | null;
  paymentMode: string;
  totalAmount: number;
  daysSinceIssue: number;
  yardId: string;
  depositDeferredUntil: string | null;
};

export async function listUndepositedReceipts(args: {
  yardIds: string[];
  fromYmd?: string;
  toYmd?: string;
}): Promise<UndepositedReceiptRow[]> {
  const today = new Date().toISOString().slice(0, 10);
  const conds = [
    inArray(iomsReceipts.status, ["Paid", "Reconciled"]),
    eq(iomsReceipts.depositStatus, "Undeposited"),
    inArray(iomsReceipts.paymentMode, ["Cash", "Cheque", "DD"]),
    sql`coalesce(${iomsReceipts.depositDeferredUntil}, '1900-01-01') <= ${today}`,
  ];
  if (args.yardIds.length > 0) conds.push(inArray(iomsReceipts.yardId, args.yardIds));
  if (args.fromYmd) conds.push(sql`${iomsReceipts.createdAt} >= ${args.fromYmd}`);
  if (args.toYmd) conds.push(sql`${iomsReceipts.createdAt} <= ${args.toYmd + "T23:59:59"}`);

  const rows = await db
    .select()
    .from(iomsReceipts)
    .where(and(...conds))
    .orderBy(iomsReceipts.createdAt);

  return rows.map((r) => ({
    id: r.id,
    receiptNo: r.receiptNo,
    createdAt: r.createdAt,
    payerName: r.payerName,
    paymentMode: r.paymentMode,
    totalAmount: Number(r.totalAmount ?? 0),
    daysSinceIssue: daysSinceIssueYmd(r.createdAt),
    yardId: r.yardId,
    depositDeferredUntil: r.depositDeferredUntil,
  }));
}

export async function computeCashInHandSummary(args: {
  yardIds: string[];
  asOfYmd?: string;
  maxCarryForwardDays?: number;
}) {
  const maxDays = args.maxCarryForwardDays ?? 2;
  const undeposited = await listUndepositedReceipts({ yardIds: args.yardIds });
  let hardCash = 0;
  let cheques = 0;
  let oldest: string | null = null;
  const details = undeposited.map((r) => {
    if (r.paymentMode === "Cash") hardCash += r.totalAmount;
    else cheques += r.totalAmount;
    const d = r.createdAt.slice(0, 10);
    if (!oldest || d < oldest) oldest = d;
    const overdue = r.daysSinceIssue > maxDays;
    return { ...r, depositOverdue: overdue };
  });
  return {
    hardCashBalance: Math.round(hardCash * 100) / 100,
    chequesPendingDeposit: Math.round(cheques * 100) / 100,
    totalUndeposited: Math.round((hardCash + cheques) * 100) / 100,
    oldestUndepositedDate: oldest,
    maxCarryForwardDays: maxDays,
    receipts: details,
  };
}

export async function createReceiptDepositBatch(args: {
  yardId: string;
  bankAccountId: string;
  depositDate: string;
  receiptIds: string[];
  createdBy: string;
}): Promise<{ id: string; depositRefNo: string }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.depositDate)) {
    throw new Error("depositDate must be YYYY-MM-DD");
  }
  const uniqueIds = Array.from(new Set(args.receiptIds.map((x) => String(x).trim()).filter(Boolean)));
  if (uniqueIds.length === 0) throw new Error("At least one receipt is required");

  const receipts = await db
    .select()
    .from(iomsReceipts)
    .where(inArray(iomsReceipts.id, uniqueIds));
  if (receipts.length !== uniqueIds.length) throw new Error("One or more receipts not found");

  for (const r of receipts) {
    if (r.yardId !== args.yardId) throw new Error(`Receipt ${r.receiptNo} is not for this yard`);
    if (r.depositStatus !== "Undeposited") {
      throw new Error(`Receipt ${r.receiptNo} is not undeposited (${r.depositStatus ?? "—"})`);
    }
    if (!isPhysicalDepositPaymentMode(r.paymentMode)) {
      throw new Error(`Receipt ${r.receiptNo} is not cash/cheque/DD`);
    }
  }

  const [bank] = await db
    .select()
    .from(gaplmbBankAccounts)
    .where(and(eq(gaplmbBankAccounts.id, args.bankAccountId), eq(gaplmbBankAccounts.isActive, true)))
    .limit(1);
  if (!bank) throw new Error("Bank account not found or inactive");

  const totalAmount = receipts.reduce((s, r) => s + Number(r.totalAmount ?? 0), 0);
  const depositRefNo = await allocateDepositRefNo(args.yardId, args.depositDate);
  const id = nanoid();
  const ts = nowIso();

  await db.insert(receiptDeposits).values({
    id,
    depositRefNo,
    yardId: args.yardId,
    bankAccountId: args.bankAccountId,
    depositDate: args.depositDate,
    totalAmount,
    status: "DepositedPendingVerification",
    createdBy: args.createdBy,
    createdAt: ts,
    updatedAt: ts,
  });

  for (const r of receipts) {
    await db.insert(receiptDepositLines).values({
      id: nanoid(),
      depositId: id,
      receiptId: r.id,
      amount: Number(r.totalAmount ?? 0),
    });
    await db
      .update(iomsReceipts)
      .set({ depositStatus: "DepositedPendingVerification", depositId: id })
      .where(eq(iomsReceipts.id, r.id));
  }

  return { id, depositRefNo };
}

export async function verifyReceiptDeposit(args: {
  depositId: string;
  passbookReference: string;
  passbookDate: string;
  verifiedBy: string;
}): Promise<void> {
  const ref = String(args.passbookReference ?? "").trim();
  if (!ref) throw new Error("Passbook / bank statement reference is required");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.passbookDate)) {
    throw new Error("passbookDate must be YYYY-MM-DD");
  }
  const [dep] = await db.select().from(receiptDeposits).where(eq(receiptDeposits.id, args.depositId)).limit(1);
  if (!dep) throw new Error("Deposit not found");
  if (dep.status !== "DepositedPendingVerification") {
    throw new Error(`Deposit must be DepositedPendingVerification (current: ${dep.status})`);
  }

  const lines = await db
    .select()
    .from(receiptDepositLines)
    .where(eq(receiptDepositLines.depositId, args.depositId));
  const ts = nowIso();
  await db
    .update(receiptDeposits)
    .set({
      status: "VerifiedPendingApproval",
      passbookReference: ref,
      passbookDate: args.passbookDate,
      verifiedBy: args.verifiedBy,
      verifiedAt: ts,
      updatedAt: ts,
    })
    .where(eq(receiptDeposits.id, args.depositId));

  for (const line of lines) {
    await db
      .update(iomsReceipts)
      .set({ depositStatus: "DepositVerified" })
      .where(eq(iomsReceipts.id, line.receiptId));
  }
}

export async function approveReceiptDeposit(args: {
  depositId: string;
  approvedBy: string;
}): Promise<{ ledgerMessages: string[] }> {
  const [dep] = await db.select().from(receiptDeposits).where(eq(receiptDeposits.id, args.depositId)).limit(1);
  if (!dep) throw new Error("Deposit not found");
  if (dep.status !== "VerifiedPendingApproval") {
    throw new Error(`Deposit must be VerifiedPendingApproval (current: ${dep.status})`);
  }

  const lines = await db
    .select()
    .from(receiptDepositLines)
    .where(eq(receiptDepositLines.depositId, args.depositId));
  const ts = nowIso();
  await db
    .update(receiptDeposits)
    .set({
      status: "ApprovedSettled",
      approvedBy: args.approvedBy,
      approvedAt: ts,
      updatedAt: ts,
    })
    .where(eq(receiptDeposits.id, args.depositId));

  const receiptIds = lines.map((l) => l.receiptId);
  for (const rid of receiptIds) {
    await db
      .update(iomsReceipts)
      .set({ depositStatus: "DepositSettled" })
      .where(eq(iomsReceipts.id, rid));
  }

  const ledgerMessages = await finalizeDepositSettlementForReceipts(receiptIds);
  return { ledgerMessages };
}

export async function rejectReceiptDeposit(args: {
  depositId: string;
  rejectionReason: string;
}): Promise<void> {
  const reason = String(args.rejectionReason ?? "").trim();
  if (!reason) throw new Error("Rejection reason is required");
  const [dep] = await db.select().from(receiptDeposits).where(eq(receiptDeposits.id, args.depositId)).limit(1);
  if (!dep) throw new Error("Deposit not found");
  if (dep.status !== "VerifiedPendingApproval") {
    throw new Error(`Only VerifiedPendingApproval deposits can be rejected`);
  }

  const lines = await db
    .select()
    .from(receiptDepositLines)
    .where(eq(receiptDepositLines.depositId, args.depositId));
  const ts = nowIso();
  await db
    .update(receiptDeposits)
    .set({
      status: "DepositedPendingVerification",
      rejectionReason: reason,
      verifiedBy: null,
      verifiedAt: null,
      passbookReference: null,
      passbookDate: null,
      updatedAt: ts,
    })
    .where(eq(receiptDeposits.id, args.depositId));

  for (const line of lines) {
    await db
      .update(iomsReceipts)
      .set({ depositStatus: "DepositedPendingVerification" })
      .where(eq(iomsReceipts.id, line.receiptId));
  }
}

export async function deferReceiptsToNextDay(receiptIds: string[], untilYmd: string): Promise<void> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(untilYmd)) throw new Error("untilYmd must be YYYY-MM-DD");
  await db
    .update(iomsReceipts)
    .set({ depositDeferredUntil: untilYmd })
    .where(
      and(
        inArray(iomsReceipts.id, receiptIds),
        eq(iomsReceipts.depositStatus, "Undeposited"),
      ),
    );
}

export async function enrichDepositRecord(dep: typeof receiptDeposits.$inferSelect) {
  const lines = await db
    .select({
      lineId: receiptDepositLines.id,
      receiptId: receiptDepositLines.receiptId,
      amount: receiptDepositLines.amount,
      receiptNo: iomsReceipts.receiptNo,
      payerName: iomsReceipts.payerName,
      paymentMode: iomsReceipts.paymentMode,
    })
    .from(receiptDepositLines)
    .innerJoin(iomsReceipts, eq(iomsReceipts.id, receiptDepositLines.receiptId))
    .where(eq(receiptDepositLines.depositId, dep.id));
  const [bank] = await db
    .select()
    .from(gaplmbBankAccounts)
    .where(eq(gaplmbBankAccounts.id, dep.bankAccountId))
    .limit(1);
  return { ...dep, bankAccount: bank ?? null, lines };
}

export function userRoleTiers(user: { roles?: Array<{ tier?: string }> } | undefined): string[] {
  const tiers = user?.roles?.map((r) => String(r.tier ?? "").trim()).filter(Boolean) ?? [];
  return tiers.length > 0 ? tiers : ["READ_ONLY"];
}

export function isDvOrDa(tiers: string[]): boolean {
  return tiers.includes("DV") || tiers.includes("DA") || tiers.includes("ADMIN");
}

const MIN_DEPOSIT_REVERSAL_REASON_LEN = 100;

export async function reverseApprovedReceiptDeposit(args: {
  depositId: string;
  reversalReason: string;
  reversedBy: string;
}): Promise<{ ledgerMessages: string[] }> {
  const reason = String(args.reversalReason ?? "").trim();
  if (reason.length < MIN_DEPOSIT_REVERSAL_REASON_LEN) {
    throw new Error(`Reversal reason must be at least ${MIN_DEPOSIT_REVERSAL_REASON_LEN} characters.`);
  }
  const [dep] = await db.select().from(receiptDeposits).where(eq(receiptDeposits.id, args.depositId)).limit(1);
  if (!dep) throw new Error("Deposit not found");
  if (dep.status !== "ApprovedSettled") {
    throw new Error("Only ApprovedSettled deposits can be reversed by DA.");
  }

  const lines = await db
    .select()
    .from(receiptDepositLines)
    .where(eq(receiptDepositLines.depositId, args.depositId));
  const ts = nowIso();
  const ledgerMessages: string[] = [];

  for (const line of lines) {
    const [receipt] = await db.select().from(iomsReceipts).where(eq(iomsReceipts.id, line.receiptId)).limit(1);
    if (!receipt) continue;
    const ledgerRes = await recordChequeDishonourLedgerForM03Receipt(receipt);
    if (ledgerRes.message) ledgerMessages.push(ledgerRes.message);
    await db
      .update(iomsReceipts)
      .set({ depositStatus: "Undeposited", depositId: null })
      .where(eq(iomsReceipts.id, line.receiptId));
    if (receipt.sourceModule === "M-03" && receipt.sourceRecordId) {
      await revertM03InvoicePaidAfterReceiptUnsettled(String(receipt.sourceRecordId), line.receiptId);
    }
  }

  await db
    .update(receiptDeposits)
    .set({
      status: "Reversed",
      reversalReason: reason,
      reversedBy: args.reversedBy,
      reversedAt: ts,
      updatedAt: ts,
    })
    .where(eq(receiptDeposits.id, args.depositId));

  return { ledgerMessages };
}

/** BR-RCP-34a: cheque dishonoured after bank deposit — flag deposit + Not Cleared receipt. */
export async function handleDepositedChequeNotCleared(
  receipt: typeof iomsReceipts.$inferSelect,
  dishonourDateYmd?: string,
): Promise<{ ledgerMessage?: string }> {
  const dishonourDate = (dishonourDateYmd ?? new Date().toISOString().slice(0, 10)).slice(0, 10);
  if (receipt.depositId) {
    await db
      .update(receiptDeposits)
      .set({
        hasDishonouredCheque: true,
        dishonourDate,
        updatedAt: nowIso(),
      })
      .where(eq(receiptDeposits.id, receipt.depositId));
  }
  const ledgerRes = await recordChequeDishonourLedgerForM03Receipt(receipt);
  if (receipt.sourceModule === "M-03" && receipt.sourceRecordId) {
    await revertM03InvoicePaidAfterReceiptUnsettled(String(receipt.sourceRecordId), receipt.id);
  }
  return { ledgerMessage: ledgerRes.message };
}

export async function saveBankAccountVersionSnapshot(args: {
  bankAccountId: string;
  snapshot: Record<string, unknown>;
  changedBy: string | null;
}): Promise<void> {
  await db.insert(gaplmbBankAccountVersions).values({
    id: nanoid(),
    bankAccountId: args.bankAccountId,
    snapshotJson: JSON.stringify(args.snapshot),
    changedBy: args.changedBy,
    changedAt: nowIso(),
  });
}

export async function listBankAccountVersions(bankAccountId: string) {
  return db
    .select()
    .from(gaplmbBankAccountVersions)
    .where(eq(gaplmbBankAccountVersions.bankAccountId, bankAccountId))
    .orderBy(desc(gaplmbBankAccountVersions.changedAt));
}

export type CashInHandLocationSummary = {
  yardId: string;
  yardName: string;
  hardCashBalance: number;
  chequesPendingDeposit: number;
  totalUndeposited: number;
  overdueCount: number;
};

export async function buildCashInHandEodDigest(maxCarryForwardDays = 2): Promise<{
  asOfDate: string;
  locations: CashInHandLocationSummary[];
  totals: { hardCash: number; cheques: number; total: number; overdueCount: number };
}> {
  const yardRows = await db.select({ id: yards.id, name: yards.name }).from(yards);
  const locations: CashInHandLocationSummary[] = [];
  let hardCash = 0;
  let cheques = 0;
  let overdueCount = 0;

  for (const y of yardRows) {
    const summary = await computeCashInHandSummary({
      yardIds: [y.id],
      maxCarryForwardDays,
    });
    const overdue = summary.receipts.filter((r) => r.depositOverdue).length;
    locations.push({
      yardId: y.id,
      yardName: String(y.name ?? y.id),
      hardCashBalance: summary.hardCashBalance,
      chequesPendingDeposit: summary.chequesPendingDeposit,
      totalUndeposited: summary.totalUndeposited,
      overdueCount: overdue,
    });
    hardCash += summary.hardCashBalance;
    cheques += summary.chequesPendingDeposit;
    overdueCount += overdue;
  }

  return {
    asOfDate: new Date().toISOString().slice(0, 10),
    locations,
    totals: {
      hardCash: Math.round(hardCash * 100) / 100,
      cheques: Math.round(cheques * 100) / 100,
      total: Math.round((hardCash + cheques) * 100) / 100,
      overdueCount,
    },
  };
}

export async function buildDepositOverdueAlert(maxCarryForwardDays = 2): Promise<{
  overdueReceiptCount: number;
  receipts: Array<{ receiptNo: string; yardId: string; daysSinceIssue: number; totalAmount: number }>;
}> {
  const summary = await computeCashInHandSummary({ yardIds: [], maxCarryForwardDays });
  const overdue = summary.receipts.filter((r) => r.depositOverdue);
  return {
    overdueReceiptCount: overdue.length,
    receipts: overdue.map((r) => ({
      receiptNo: r.receiptNo,
      yardId: r.yardId,
      daysSinceIssue: r.daysSinceIssue,
      totalAmount: r.totalAmount,
    })),
  };
}

export async function mapDepositRefByReceiptIds(
  receiptIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (receiptIds.length === 0) return out;
  const rows = await db
    .select({
      receiptId: receiptDepositLines.receiptId,
      depositRefNo: receiptDeposits.depositRefNo,
      depositStatus: receiptDeposits.status,
    })
    .from(receiptDepositLines)
    .innerJoin(receiptDeposits, eq(receiptDeposits.id, receiptDepositLines.depositId))
    .where(inArray(receiptDepositLines.receiptId, receiptIds));
  for (const r of rows) {
    if (r.depositStatus === "ApprovedSettled" || r.depositStatus === "Reversed") {
      out.set(r.receiptId, r.depositRefNo);
    }
  }
  return out;
}

export type { DepositRecordStatus, ReceiptDepositStatus };
