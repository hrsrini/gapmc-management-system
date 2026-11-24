/**
 * M-03 US-M03-002: Overdue rent + delayed-rent interest accrual on `rent_deposit_ledger`.
 * - Marks Approved invoices as Overdue when past due (10th of month after period) and still outstanding.
 * - Posts incremental Interest debits: cumulative slab interest(as-of today) minus prior Interest debits.
 * - If prior (e.g. daily) accruals exceed the slab total, posts a correcting Interest credit.
 * - Interest = ROUND(R × rate × N / 1200, 0) on rent amount R (GAPLMB slabs; see rent-interest.ts).
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./db";
import { iomsReceipts, rentDepositLedger, rentInvoices } from "@shared/db-schema";
import { writeAuditLogSystem } from "./audit";
import { getMergedSystemConfig, parseSystemConfigNumber } from "./system-config";
import { computeDelayedRentInterest, rentInterestDueDateIso, todayIsoLocal } from "./rent-interest";
import { latestRentDepositLedgerRowForInvoice, rentInvoiceLedgerScope } from "./rent-ledger-scope";
import { m03ReceiptPrincipalTowardInvoice } from "@shared/m03-receipt-breakdown";

type RentInvoiceRow = InferSelectModel<typeof rentInvoices>;

async function sumPaidOrReconciledOnInvoice(invoiceId: string): Promise<number> {
  const recs = await db
    .select({
      totalAmount: iomsReceipts.totalAmount,
      status: iomsReceipts.status,
      revenueHead: iomsReceipts.revenueHead,
      sourceModule: iomsReceipts.sourceModule,
      sourceRecordId: iomsReceipts.sourceRecordId,
      m03BreakdownJson: iomsReceipts.m03BreakdownJson,
    })
    .from(iomsReceipts)
    .where(and(eq(iomsReceipts.sourceModule, "M-03"), eq(iomsReceipts.sourceRecordId, invoiceId)));
  return recs
    .filter((r) => String(r.status ?? "") === "Paid" || String(r.status ?? "") === "Reconciled")
    .reduce((s, r) => s + m03ReceiptPrincipalTowardInvoice(r), 0);
}

async function sumInterestPostedForInvoice(invoiceId: string): Promise<number> {
  const [r] = await db
    .select({
      s: sql<number>`coalesce(sum(${rentDepositLedger.debit}) - sum(${rentDepositLedger.credit}), 0)::double precision`,
    })
    .from(rentDepositLedger)
    .where(and(eq(rentDepositLedger.invoiceId, invoiceId), eq(rentDepositLedger.entryType, "Interest")));
  return Math.round(Number(r?.s ?? 0) * 100) / 100;
}

/** GAPLMB interest base = monthly rent only (not GST); capped by outstanding. */
function interestPrincipal(inv: RentInvoiceRow, outstanding: number): number {
  const rent = Number(inv.rentAmount ?? 0);
  const out = Math.max(0, outstanding);
  if (rent > 0 && out > 0) return Math.min(rent, out);
  return 0;
}

export async function runM03RentArrearsInterest(): Promise<{
  asOfDate: string;
  markedOverdue: number;
  interestPosted: number;
  interestRows: number;
  skipped: number;
}> {
  const asOfDate = todayIsoLocal();
  const cfg = await getMergedSystemConfig();
  const rateRaw = parseSystemConfigNumber(cfg, "rent_arrears_interest_percent_per_annum");
  const rate = rateRaw > 0 ? rateRaw : 15;

  // Do not accrue on Reversed/Cancelled — only live receivables.
  const candidates = await db
    .select()
    .from(rentInvoices)
    .where(inArray(rentInvoices.status, ["Approved", "Overdue"]));

  let markedOverdue = 0;
  let interestPosted = 0;
  let interestRows = 0;
  let skipped = 0;

  for (const inv of candidates) {
    const due = rentInterestDueDateIso(inv.periodMonth);
    if (!due || due >= asOfDate) {
      skipped += 1;
      continue;
    }

    const paid = await sumPaidOrReconciledOnInvoice(inv.id);
    const outstanding = Number(inv.totalAmount ?? 0) - paid;
    if (outstanding <= 0.01) {
      skipped += 1;
      continue;
    }

    if (inv.status === "Approved") {
      await db.update(rentInvoices).set({ status: "Overdue" }).where(eq(rentInvoices.id, inv.id));
      markedOverdue += 1;
      writeAuditLogSystem({
        module: "Rent/Tax",
        action: "RentInvoiceMarkedOverdue",
        recordId: inv.id,
        afterValue: { asOfDate, periodMonth: inv.periodMonth, dueDateIso: due, outstanding },
      }).catch((e) => console.error("Audit log failed:", e));
    }

    const principal = interestPrincipal(inv, outstanding);
    if (principal <= 0 || rate <= 0) {
      skipped += 1;
      continue;
    }

    const computed = computeDelayedRentInterest({
      rentAmount: principal,
      periodMonth: String(inv.periodMonth),
      asOfDateIso: asOfDate,
      percentPerAnnum: rate,
    });
    const cumulativeInterest = computed.interestRounded;

    const already = Math.round(Number(await sumInterestPostedForInvoice(inv.id)) * 100) / 100;
    const delta = Math.round((cumulativeInterest - already) * 100) / 100;
    if (Math.abs(delta) < 0.01) {
      skipped += 1;
      continue;
    }

    const prev = await latestRentDepositLedgerRowForInvoice(inv);
    const prevBal = prev != null ? Number(prev.balance ?? 0) : 0;
    const balance = Math.round((prevBal + delta) * 100) / 100;
    const id = nanoid();
    const intScope = rentInvoiceLedgerScope(inv);

    const isCorrection = delta < 0;
    const debit = isCorrection ? 0 : delta;
    const credit = isCorrection ? Math.round((-delta) * 100) / 100 : 0;
    await db.insert(rentDepositLedger).values({
      id,
      tenantLicenceId: intScope.ledgerTenantLicenceId,
      unifiedEntityId: intScope.unifiedEntityId,
      assetId: inv.assetId,
      entryDate: asOfDate,
      entryType: "Interest",
      debit,
      credit,
      balance,
      invoiceId: inv.id,
      receiptId: null,
      interestPaymentStatus: "Unpaid",
      settledReceiptId: null,
    });

    interestPosted = Math.round((interestPosted + delta) * 100) / 100;
    interestRows += 1;

    writeAuditLogSystem({
      module: "Rent/Tax",
      action: isCorrection ? "RentArrearsInterestCorrected" : "RentArrearsInterestAccrued",
      recordId: id,
      afterValue: {
        asOfDate,
        invoiceId: inv.id,
        tenantLicenceId: inv.tenantLicenceId,
        assetId: inv.assetId,
        dueDateIso: due,
        principal,
        ratePercentPerAnnum: rate,
        nMonths: computed.nMonths,
        interestExact: computed.interestExact,
        interestRounded: cumulativeInterest,
        delta,
        already,
        cumulativeAfter: already + delta,
        balance,
        correction: isCorrection,
      },
    }).catch((e) => console.error("Audit log failed:", e));
  }

  return {
    asOfDate,
    markedOverdue,
    interestPosted: Math.round(interestPosted * 100) / 100,
    interestRows,
    skipped,
  };
}
