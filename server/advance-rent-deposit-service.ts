/**
 * Advance rent deposits: collect, ledger, auto-adjust on rent invoice approval.
 */
import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./db";
import {
  advanceRentDepositEntries,
  advanceRentDeposits,
  assets,
  assetAllotments,
  iomsReceipts,
  paymentAdjustmentSeq,
  paymentAdjustments,
  rentInvoicePaymentAllocations,
  rentInvoices,
  traderLicences,
  yards,
} from "@shared/db-schema";
import { createIomsReceipt } from "./routes-receipts-ioms";
import { settledPrincipalPaidForInvoice } from "./m03-invoice-payment-sum";
import { maybeMarkM03InvoicePaidFromSettledReceipts } from "./receipt-deposit-service";
import { unifiedEntityIdFromTrackA } from "@shared/unified-entity-id";

function nowIso(): string {
  return new Date().toISOString();
}

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function monthKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabelShort(): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return months[new Date().getMonth()] ?? "Mon";
}

export async function nextPaymentAdjustmentNo(): Promise<string> {
  const key = monthKey();
  const mon = monthLabelShort();
  const next = await db.transaction(async (tx) => {
    await tx
      .insert(paymentAdjustmentSeq)
      .values({ yearMonthKey: key, lastSeq: 0 })
      .onConflictDoNothing();
    const [updated] = await tx
      .update(paymentAdjustmentSeq)
      .set({ lastSeq: sql`${paymentAdjustmentSeq.lastSeq} + 1` })
      .where(eq(paymentAdjustmentSeq.yearMonthKey, key))
      .returning({ lastSeq: paymentAdjustmentSeq.lastSeq });
    return Number(updated?.lastSeq ?? 1);
  });
  return `ADJ/${mon}/${String(next).padStart(3, "0")}`;
}

export type CollectAdvanceRentDepositInput = {
  yardId: string;
  traderLicenceId: string;
  assetId: string;
  allotmentId?: string | null;
  amountInr: number;
  depositDate?: string;
  periodFrom?: string | null;
  periodTo?: string | null;
  paymentMode: string;
  paymentRef?: string | null;
  chequeNo?: string | null;
  bankName?: string | null;
  receivedBy?: string | null;
  remarks?: string | null;
  createdBy: string;
};

export async function collectAdvanceRentDeposit(input: CollectAdvanceRentDepositInput) {
  const amount = round2(Number(input.amountInr));
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Deposit amount must be greater than zero.");
  const [lic] = await db
    .select()
    .from(traderLicences)
    .where(eq(traderLicences.id, input.traderLicenceId))
    .limit(1);
  if (!lic) throw new Error("Trader licence not found.");
  const [asset] = await db.select().from(assets).where(eq(assets.id, input.assetId)).limit(1);
  if (!asset) throw new Error("Premises not found.");
  if (asset.yardId !== input.yardId) throw new Error("Premises must belong to the selected yard.");

  let allotmentId = input.allotmentId?.trim() || null;
  if (!allotmentId) {
    const [active] = await db
      .select({ id: assetAllotments.id })
      .from(assetAllotments)
      .where(
        and(
          eq(assetAllotments.assetId, input.assetId),
          eq(assetAllotments.traderLicenceId, input.traderLicenceId),
          eq(assetAllotments.status, "Active"),
        ),
      )
      .limit(1);
    allotmentId = active?.id ?? null;
  }

  const unifiedEntityId = unifiedEntityIdFromTrackA(input.traderLicenceId);
  const depositDate = (input.depositDate || todayYmd()).slice(0, 10);
  const ts = nowIso();

  const receipt = await createIomsReceipt({
    yardId: input.yardId,
    revenueHead: "Rent",
    payerName: String(lic.firmName ?? "Trader").trim() || "Trader",
    payerType: "TraderLicence",
    payerRefId: input.traderLicenceId,
    amount,
    cgst: 0,
    sgst: 0,
    paymentMode: input.paymentMode || "Cash",
    chequeNo: input.chequeNo ?? undefined,
    bankName: input.bankName ?? undefined,
    gatewayRef: input.paymentRef ?? undefined,
    paymentDateYmd: input.depositDate ?? undefined,
    sourceModule: "M-03-ADV-DEPOSIT",
    sourceRecordId: undefined,
    unifiedEntityId,
    premisesAssetId: input.assetId,
    createdBy: input.createdBy,
    narration: "Advance rent deposit",
    // Allow Cash / Cheque / DD / Online (NEFT-UTR) like outstanding-dues counter pay.
    counterDuesPayment: true,
  });

  // AutoSettled so advance balance can adjust invoices immediately (FRD / mockup).
  await db
    .update(iomsReceipts)
    .set({
      status: "Paid",
      gatewayRef: input.paymentRef ?? input.paymentMode ?? "Counter",
      depositStatus: "AutoSettled",
    })
    .where(eq(iomsReceipts.id, receipt.id));

  const [paidReceipt] = await db.select().from(iomsReceipts).where(eq(iomsReceipts.id, receipt.id)).limit(1);
  const depositId = nanoid();
  const depositReceiptNo = String(paidReceipt?.receiptNo ?? receipt.receiptNo ?? `ADV-${depositId.slice(0, 8)}`);

  await db.insert(advanceRentDeposits).values({
    id: depositId,
    depositReceiptNo,
    yardId: input.yardId,
    traderLicenceId: input.traderLicenceId,
    unifiedEntityId,
    assetId: input.assetId,
    allotmentId,
    depositDate,
    periodFrom: input.periodFrom ?? null,
    periodTo: input.periodTo ?? null,
    depositAmount: amount,
    adjustedAmount: 0,
    balanceAmount: amount,
    status: "Active",
    receiptId: receipt.id,
    paymentMode: input.paymentMode || "Cash",
    paymentRef: input.paymentRef ?? null,
    receivedBy: input.receivedBy ?? input.createdBy,
    remarks: input.remarks ?? null,
    createdBy: input.createdBy,
    createdAt: ts,
    updatedAt: ts,
  });

  await db.update(iomsReceipts).set({ sourceRecordId: depositId }).where(eq(iomsReceipts.id, receipt.id));

  await db.insert(advanceRentDepositEntries).values({
    id: nanoid(),
    depositId,
    entryDate: depositDate,
    entryType: "Deposit",
    amountInr: amount,
    balanceAfter: amount,
    remarks: `Deposit received (${input.paymentMode || "Cash"})`,
    createdBy: input.createdBy,
    createdAt: ts,
  });

  return getAdvanceRentDepositDetail(depositId);
}

export async function listAdvanceRentDeposits(opts?: {
  yardId?: string;
  traderLicenceId?: string;
  status?: string;
  q?: string;
}) {
  const conditions = [];
  if (opts?.yardId) conditions.push(eq(advanceRentDeposits.yardId, opts.yardId));
  if (opts?.traderLicenceId) conditions.push(eq(advanceRentDeposits.traderLicenceId, opts.traderLicenceId));
  if (opts?.status && opts.status !== "All") {
    if (opts.status === "Active") conditions.push(eq(advanceRentDeposits.status, "Active"));
    else if (opts.status === "FullyAdjusted") conditions.push(eq(advanceRentDeposits.status, "FullyAdjusted"));
    else conditions.push(eq(advanceRentDeposits.status, opts.status));
  }
  const base = db
    .select({
      deposit: advanceRentDeposits,
      firmName: traderLicences.firmName,
      licenceNo: traderLicences.licenceNo,
      premisesCode: assets.assetId,
      yardName: yards.name,
      yardCode: yards.code,
    })
    .from(advanceRentDeposits)
    .leftJoin(traderLicences, eq(traderLicences.id, advanceRentDeposits.traderLicenceId))
    .leftJoin(assets, eq(assets.id, advanceRentDeposits.assetId))
    .leftJoin(yards, eq(yards.id, advanceRentDeposits.yardId))
    .orderBy(desc(advanceRentDeposits.depositDate), desc(advanceRentDeposits.createdAt));

  const rows = conditions.length ? await base.where(and(...conditions)) : await base;

  const depositIds = rows.map((r) => r.deposit.id);
  const lastAdjRows =
    depositIds.length === 0
      ? []
      : await db
          .select()
          .from(advanceRentDepositEntries)
          .where(
            and(
              inArray(advanceRentDepositEntries.depositId, depositIds),
              eq(advanceRentDepositEntries.entryType, "Adjustment"),
            ),
          )
          .orderBy(desc(advanceRentDepositEntries.createdAt));

  const lastAdjByDeposit = new Map<string, (typeof lastAdjRows)[0]>();
  for (const e of lastAdjRows) {
    if (!lastAdjByDeposit.has(e.depositId)) lastAdjByDeposit.set(e.depositId, e);
  }

  const q = String(opts?.q ?? "").trim().toLowerCase();
  const mapped = rows.map((r) => {
    const last = lastAdjByDeposit.get(r.deposit.id);
    return {
      ...r.deposit,
      traderName: r.firmName,
      licenceNo: r.licenceNo,
      premisesCode: r.premisesCode,
      yardName: r.yardName,
      yardCode: r.yardCode,
      lastAdjustment: last
        ? {
            invoiceNo: last.invoiceNo,
            amount: Math.abs(Number(last.amountInr ?? 0)),
            adjustmentRef: last.adjustmentRef,
            entryDate: last.entryDate,
            remarks: last.remarks,
          }
        : null,
    };
  });

  const filtered = q
    ? mapped.filter((d) => {
        const hay = [
          d.depositReceiptNo,
          d.traderName,
          d.licenceNo,
          d.premisesCode,
          d.yardName,
        ]
          .map((x) => String(x ?? "").toLowerCase())
          .join(" ");
        return hay.includes(q);
      })
    : mapped;

  const balanceHeld = round2(filtered.filter((d) => d.status === "Active").reduce((s, d) => s + Number(d.balanceAmount ?? 0), 0));
  const totalReceived = round2(filtered.reduce((s, d) => s + Number(d.depositAmount ?? 0), 0));
  const adjustedToDate = round2(filtered.reduce((s, d) => s + Number(d.adjustedAmount ?? 0), 0));
  const activeCount = filtered.filter((d) => d.status === "Active").length;

  return {
    rows: filtered,
    summary: {
      balanceHeld,
      totalReceived,
      adjustedToDate,
      activeCount,
      totalCount: filtered.length,
    },
  };
}

export async function getAdvanceRentDepositDetail(depositId: string) {
  const [row] = await db
    .select({
      deposit: advanceRentDeposits,
      firmName: traderLicences.firmName,
      licenceNo: traderLicences.licenceNo,
      premisesCode: assets.assetId,
      yardName: yards.name,
      yardCode: yards.code,
    })
    .from(advanceRentDeposits)
    .leftJoin(traderLicences, eq(traderLicences.id, advanceRentDeposits.traderLicenceId))
    .leftJoin(assets, eq(assets.id, advanceRentDeposits.assetId))
    .leftJoin(yards, eq(yards.id, advanceRentDeposits.yardId))
    .where(eq(advanceRentDeposits.id, depositId))
    .limit(1);
  if (!row) return null;
  const entries = await db
    .select()
    .from(advanceRentDepositEntries)
    .where(eq(advanceRentDepositEntries.depositId, depositId))
    .orderBy(asc(advanceRentDepositEntries.entryDate), asc(advanceRentDepositEntries.createdAt));
  return {
    ...row.deposit,
    traderName: row.firmName,
    licenceNo: row.licenceNo,
    premisesCode: row.premisesCode,
    yardName: row.yardName,
    yardCode: row.yardCode,
    entries,
  };
}

/**
 * On rent invoice Approve: FIFO-apply active advance deposits for the same trader + premises.
 * Creates Paid allocation via the deposit receipt, ADJ refs, and deposit ledger entries.
 */
export async function applyAdvanceRentDepositsOnInvoiceApprove(args: {
  invoiceId: string;
  userId?: string | null;
}): Promise<{
  adjustedTotal: number;
  adjustments: Array<{ depositId: string; amount: number; adjustmentRef: string }>;
}> {
  const [inv] = await db.select().from(rentInvoices).where(eq(rentInvoices.id, args.invoiceId)).limit(1);
  if (!inv) return { adjustedTotal: 0, adjustments: [] };
  if (!["Approved", "Overdue", "Paid"].includes(String(inv.status))) {
    return { adjustedTotal: 0, adjustments: [] };
  }

  const invoiceTotal = round2(Number(inv.totalAmount ?? 0));
  if (invoiceTotal <= 0) return { adjustedTotal: 0, adjustments: [] };

  const alreadyPaid = round2(await settledPrincipalPaidForInvoice(inv.id));
  let remainingDue = round2(Math.max(0, invoiceTotal - alreadyPaid));
  if (remainingDue <= 0.005) return { adjustedTotal: 0, adjustments: [] };

  const traderKey = String(inv.tenantLicenceId ?? "").trim();
  const licenceId = traderKey.startsWith("TA:") ? traderKey.slice(3) : traderKey.startsWith("TB:") ? "" : traderKey;
  if (!licenceId) return { adjustedTotal: 0, adjustments: [] };

  const deposits = await db
    .select()
    .from(advanceRentDeposits)
    .where(
      and(
        eq(advanceRentDeposits.traderLicenceId, licenceId),
        eq(advanceRentDeposits.assetId, inv.assetId),
        eq(advanceRentDeposits.status, "Active"),
        gt(advanceRentDeposits.balanceAmount, 0),
      ),
    )
    .orderBy(asc(advanceRentDeposits.depositDate), asc(advanceRentDeposits.createdAt));

  const results: Array<{ depositId: string; amount: number; adjustmentRef: string }> = [];
  let adjustedTotal = 0;
  const ts = nowIso();
  const entryDate = todayYmd();

  for (const dep of deposits) {
    if (remainingDue <= 0.005) break;
    const bal = round2(Number(dep.balanceAmount ?? 0));
    if (bal <= 0.005) continue;
    const applyAmt = round2(Math.min(bal, remainingDue));
    if (applyAmt <= 0.005) continue;

    const adjustmentRef = await nextPaymentAdjustmentNo();
    const newBal = round2(bal - applyAmt);
    const newAdjusted = round2(Number(dep.adjustedAmount ?? 0) + applyAmt);
    const newStatus = newBal <= 0.005 ? "FullyAdjusted" : "Active";

    await db
      .update(advanceRentDeposits)
      .set({
        balanceAmount: newBal <= 0.005 ? 0 : newBal,
        adjustedAmount: newAdjusted,
        status: newStatus,
        updatedAt: ts,
      })
      .where(eq(advanceRentDeposits.id, dep.id));

    if (dep.receiptId) {
      await db.insert(rentInvoicePaymentAllocations).values({
        id: nanoid(),
        receiptId: dep.receiptId,
        invoiceId: inv.id,
        amountInr: applyAmt,
        createdAt: ts,
      });
    }

    await db.insert(advanceRentDepositEntries).values({
      id: nanoid(),
      depositId: dep.id,
      entryDate,
      entryType: "Adjustment",
      amountInr: -applyAmt,
      balanceAfter: newBal <= 0.005 ? 0 : newBal,
      invoiceId: inv.id,
      invoiceNo: inv.invoiceNo,
      adjustmentRef,
      remarks: `Adjusted against invoice ${inv.invoiceNo ?? inv.id} (₹${invoiceTotal.toFixed(2)})`,
      createdBy: args.userId ?? null,
      createdAt: ts,
    });

    await db.insert(paymentAdjustments).values({
      id: nanoid(),
      adjustmentNo: adjustmentRef,
      yardId: inv.yardId,
      traderLicenceId: licenceId,
      unifiedEntityId: dep.unifiedEntityId ?? unifiedEntityIdFromTrackA(licenceId),
      againstInvoiceId: inv.id,
      againstReceiptId: dep.receiptId,
      advanceDepositId: dep.id,
      adjustmentType: "AdvanceDepositAutomatic",
      amountInr: applyAmt,
      reason: `Automatic advance rent deposit adjustment against ${inv.invoiceNo ?? inv.id}`,
      status: "Applied",
      dueBefore: remainingDue,
      dueAfter: round2(remainingDue - applyAmt),
      createdBy: args.userId ?? null,
      approvedBy: args.userId ?? null,
      createdAt: ts,
      approvedAt: ts,
      updatedAt: ts,
    });

    results.push({ depositId: dep.id, amount: applyAmt, adjustmentRef });
    adjustedTotal = round2(adjustedTotal + applyAmt);
    remainingDue = round2(remainingDue - applyAmt);
  }

  if (adjustedTotal > 0) {
    await maybeMarkM03InvoicePaidFromSettledReceipts(inv.id);

    // Shrink or cancel the provisional unpaid M-03 receipt created on approve (status Pending).
    const unpaidCandidates = await db
      .select()
      .from(iomsReceipts)
      .where(and(eq(iomsReceipts.sourceModule, "M-03"), eq(iomsReceipts.sourceRecordId, inv.id)));

    for (const r of unpaidCandidates) {
      const st = String(r.status ?? "");
      if (st === "Paid" || st === "Reconciled" || st === "Cancelled" || st === "Reversed") continue;
      const newTotal = round2(Math.max(0, Number(r.totalAmount ?? 0) - adjustedTotal));
      if (newTotal <= 0.005) {
        await db.update(iomsReceipts).set({ status: "Cancelled" }).where(eq(iomsReceipts.id, r.id));
      } else if (Number(r.totalAmount ?? 0) > newTotal + 0.005) {
        const rentShare = round2((Number(r.amount ?? 0) / Math.max(Number(r.totalAmount ?? 1), 0.01)) * newTotal);
        const cgstShare = round2((Number(r.cgst ?? 0) / Math.max(Number(r.totalAmount ?? 1), 0.01)) * newTotal);
        const sgstShare = round2(newTotal - rentShare - cgstShare);
        await db
          .update(iomsReceipts)
          .set({
            amount: rentShare,
            cgst: Math.max(0, cgstShare),
            sgst: Math.max(0, sgstShare),
            totalAmount: newTotal,
          })
          .where(eq(iomsReceipts.id, r.id));
      }
    }
  }

  return { adjustedTotal, adjustments: results };
}

export async function listPaymentAdjustments(opts?: {
  traderLicenceId?: string;
  status?: string;
}) {
  const conditions = [];
  if (opts?.traderLicenceId) conditions.push(eq(paymentAdjustments.traderLicenceId, opts.traderLicenceId));
  if (opts?.status && opts.status !== "All") {
    if (opts.status === "PendingApproval") conditions.push(eq(paymentAdjustments.status, "PendingApproval"));
    else if (opts.status === "Applied") conditions.push(eq(paymentAdjustments.status, "Applied"));
    else conditions.push(eq(paymentAdjustments.status, opts.status));
  }
  const base = db
    .select({
      adj: paymentAdjustments,
      firmName: traderLicences.firmName,
      invoiceNo: rentInvoices.invoiceNo,
    })
    .from(paymentAdjustments)
    .leftJoin(traderLicences, eq(traderLicences.id, paymentAdjustments.traderLicenceId))
    .leftJoin(rentInvoices, eq(rentInvoices.id, paymentAdjustments.againstInvoiceId))
    .orderBy(desc(paymentAdjustments.createdAt));
  const rows = conditions.length ? await base.where(and(...conditions)) : await base;
  return rows.map((r) => ({
    ...r.adj,
    traderName: r.firmName,
    againstInvoiceNo: r.invoiceNo,
  }));
}

export async function createPaymentAdjustment(args: {
  yardId: string;
  traderLicenceId: string;
  againstInvoiceId?: string | null;
  adjustmentType: string;
  amountInr: number;
  reason?: string | null;
  createdBy: string;
  submitForApproval?: boolean;
}) {
  const amount = round2(Number(args.amountInr));
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Amount must be greater than zero.");
  const allowed = [
    "AdvanceDepositRefund",
    "AdvanceDepositForfeiture",
    "ExcessPaymentCarryForward",
    "InterestWaiver",
    "GstRateRevision",
    "Correction",
  ];
  if (!allowed.includes(args.adjustmentType)) throw new Error("Invalid adjustment type.");

  let dueBefore: number | null = null;
  let dueAfter: number | null = null;
  if (args.againstInvoiceId) {
    const [inv] = await db.select().from(rentInvoices).where(eq(rentInvoices.id, args.againstInvoiceId)).limit(1);
    if (!inv) throw new Error("Invoice not found.");
    const paid = await settledPrincipalPaidForInvoice(inv.id);
    dueBefore = round2(Math.max(0, Number(inv.totalAmount ?? 0) - paid));
    dueAfter = round2(Math.max(0, dueBefore - amount));
  }

  const ts = nowIso();
  const id = nanoid();
  const adjustmentNo = await nextPaymentAdjustmentNo();
  const status = args.submitForApproval === false ? "Draft" : "PendingApproval";

  await db.insert(paymentAdjustments).values({
    id,
    adjustmentNo,
    yardId: args.yardId,
    traderLicenceId: args.traderLicenceId,
    unifiedEntityId: unifiedEntityIdFromTrackA(args.traderLicenceId),
    againstInvoiceId: args.againstInvoiceId ?? null,
    adjustmentType: args.adjustmentType,
    amountInr: amount,
    reason: args.reason ?? null,
    status,
    dueBefore,
    dueAfter,
    createdBy: args.createdBy,
    createdAt: ts,
    updatedAt: ts,
  });

  const [row] = await db.select().from(paymentAdjustments).where(eq(paymentAdjustments.id, id)).limit(1);
  return row;
}

export async function approvePaymentAdjustment(args: {
  id: string;
  approvedBy: string;
  apply: boolean;
}) {
  const [adj] = await db.select().from(paymentAdjustments).where(eq(paymentAdjustments.id, args.id)).limit(1);
  if (!adj) throw new Error("Adjustment not found.");
  if (adj.status !== "PendingApproval" && adj.status !== "Draft") {
    throw new Error("Only pending adjustments can be approved.");
  }
  const ts = nowIso();

  if (
    args.apply &&
    (adj.adjustmentType === "AdvanceDepositRefund" || adj.adjustmentType === "AdvanceDepositForfeiture") &&
    adj.advanceDepositId
  ) {
    const [dep] = await db
      .select()
      .from(advanceRentDeposits)
      .where(eq(advanceRentDeposits.id, adj.advanceDepositId))
      .limit(1);
    if (dep) {
      const bal = round2(Number(dep.balanceAmount ?? 0));
      const take = round2(Math.min(bal, Number(adj.amountInr)));
      const newBal = round2(bal - take);
      await db
        .update(advanceRentDeposits)
        .set({
          balanceAmount: newBal <= 0.005 ? 0 : newBal,
          status:
            adj.adjustmentType === "AdvanceDepositRefund"
              ? newBal <= 0.005
                ? "Refunded"
                : "Active"
              : newBal <= 0.005
                ? "Forfeited"
                : "Active",
          updatedAt: ts,
        })
        .where(eq(advanceRentDeposits.id, dep.id));
      await db.insert(advanceRentDepositEntries).values({
        id: nanoid(),
        depositId: dep.id,
        entryDate: todayYmd(),
        entryType: adj.adjustmentType === "AdvanceDepositRefund" ? "Refund" : "Forfeiture",
        amountInr: -take,
        balanceAfter: newBal <= 0.005 ? 0 : newBal,
        adjustmentRef: adj.adjustmentNo,
        remarks: adj.reason ?? adj.adjustmentType,
        createdBy: args.approvedBy,
        createdAt: ts,
      });
    }
  }

  await db
    .update(paymentAdjustments)
    .set({
      status: args.apply ? "Applied" : "Rejected",
      approvedBy: args.approvedBy,
      approvedAt: ts,
      updatedAt: ts,
    })
    .where(eq(paymentAdjustments.id, args.id));

  const [row] = await db.select().from(paymentAdjustments).where(eq(paymentAdjustments.id, args.id)).limit(1);
  return row;
}

/** Adjustments applied against an invoice (for dues / receipt PDF). */
export async function listAdvanceAdjustmentsForInvoice(invoiceId: string) {
  return db
    .select()
    .from(advanceRentDepositEntries)
    .where(
      and(eq(advanceRentDepositEntries.invoiceId, invoiceId), eq(advanceRentDepositEntries.entryType, "Adjustment")),
    )
    .orderBy(asc(advanceRentDepositEntries.createdAt));
}
