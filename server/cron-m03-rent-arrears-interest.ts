/**
 * M-03 US-M03-002: Overdue rent + simple interest accrual on `rent_deposit_ledger`.
 * - Marks Approved invoices as Overdue when past period-month end and still outstanding.
 * - Posts incremental Interest debits: cumulative interest(due→today) minus sum of prior Interest debits for that invoice.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./db";
import { iomsReceipts, rentDepositLedger, rentInvoices } from "@shared/db-schema";
import { writeAuditLogSystem } from "./audit";
import { getMergedSystemConfig, parseSystemConfigNumber } from "./system-config";
import { computeRentArrearsSimpleInterest, rentPeriodMonthEndIso } from "./rent-interest";
import { unifiedEntityIdFromTrackA } from "@shared/unified-entity-id";

type RentInvoiceRow = InferSelectModel<typeof rentInvoices>;
type LedgerRow = InferSelectModel<typeof rentDepositLedger>;

function nonGstChargesSum(json: string | null | undefined): number {
  if (json == null || String(json).trim() === "") return 0;
  try {
    const arr = JSON.parse(String(json)) as unknown;
    if (!Array.isArray(arr)) return 0;
    let s = 0;
    for (const o of arr) {
      const x = o as { amount?: unknown };
      const a = Number(x?.amount);
      if (Number.isFinite(a) && a > 0) s += a;
    }
    return Math.round(s * 100) / 100;
  } catch {
    return 0;
  }
}

async function sumPaidOrReconciledOnInvoice(invoiceId: string): Promise<number> {
  const recs = await db
    .select({ totalAmount: iomsReceipts.totalAmount, status: iomsReceipts.status })
    .from(iomsReceipts)
    .where(and(eq(iomsReceipts.sourceModule, "M-03"), eq(iomsReceipts.sourceRecordId, invoiceId)));
  return recs
    .filter((r) => String(r.status ?? "") === "Paid" || String(r.status ?? "") === "Reconciled")
    .reduce((s, r) => s + Number(r.totalAmount ?? 0), 0);
}

async function sumInterestPostedForInvoice(invoiceId: string): Promise<number> {
  const [r] = await db
    .select({
      s: sql<number>`coalesce(sum(${rentDepositLedger.debit}), 0)::double precision`,
    })
    .from(rentDepositLedger)
    .where(and(eq(rentDepositLedger.invoiceId, invoiceId), eq(rentDepositLedger.entryType, "Interest")));
  return Number(r?.s ?? 0);
}

async function latestLedgerRow(tenantLicenceId: string, assetId: string): Promise<LedgerRow | undefined> {
  const rows = await db
    .select()
    .from(rentDepositLedger)
    .where(and(eq(rentDepositLedger.tenantLicenceId, tenantLicenceId), eq(rentDepositLedger.assetId, assetId)))
    .orderBy(desc(rentDepositLedger.entryDate), desc(rentDepositLedger.id))
    .limit(1);
  return rows[0];
}

function interestPrincipal(inv: RentInvoiceRow, outstanding: number): number {
  const rentLike = Number(inv.rentAmount ?? 0) + nonGstChargesSum(inv.nonGstChargesJson);
  const out = Math.max(0, outstanding);
  if (rentLike > 0 && out > 0) return Math.min(rentLike, out);
  return out;
}

export async function runM03RentArrearsInterest(): Promise<{
  asOfDate: string;
  markedOverdue: number;
  interestPosted: number;
  interestRows: number;
  skipped: number;
}> {
  const asOfDate = new Date().toISOString().slice(0, 10);
  const cfg = await getMergedSystemConfig();
  const rate = parseSystemConfigNumber(cfg, "rent_arrears_interest_percent_per_annum");

  const candidates = await db
    .select()
    .from(rentInvoices)
    .where(inArray(rentInvoices.status, ["Approved", "Overdue"]));

  let markedOverdue = 0;
  let interestPosted = 0;
  let interestRows = 0;
  let skipped = 0;

  for (const inv of candidates) {
    const due = rentPeriodMonthEndIso(inv.periodMonth);
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
        afterValue: { asOfDate, periodMonth: inv.periodMonth, outstanding },
      }).catch((e) => console.error("Audit log failed:", e));
    }

    const principal = interestPrincipal(inv, outstanding);
    if (principal <= 0 || rate <= 0) {
      skipped += 1;
      continue;
    }

    const { interest: cumulativeInterest } = computeRentArrearsSimpleInterest({
      principal,
      percentPerAnnum: rate,
      dueDateIso: due,
      asOfDateIso: asOfDate,
    });

    const already = await sumInterestPostedForInvoice(inv.id);
    const delta = Math.round((cumulativeInterest - already) * 100) / 100;
    if (delta < 0.01) {
      skipped += 1;
      continue;
    }

    const prev = await latestLedgerRow(inv.tenantLicenceId, inv.assetId);
    const prevBal = prev != null ? Number(prev.balance ?? 0) : 0;
    const balance = prevBal + delta;
    const id = nanoid();

    await db.insert(rentDepositLedger).values({
      id,
      tenantLicenceId: inv.tenantLicenceId,
      unifiedEntityId: unifiedEntityIdFromTrackA(inv.tenantLicenceId),
      assetId: inv.assetId,
      entryDate: asOfDate,
      entryType: "Interest",
      debit: delta,
      credit: 0,
      balance,
      invoiceId: inv.id,
      receiptId: null,
    });

    interestPosted += delta;
    interestRows += 1;

    writeAuditLogSystem({
      module: "Rent/Tax",
      action: "RentArrearsInterestAccrued",
      recordId: id,
      afterValue: {
        asOfDate,
        invoiceId: inv.id,
        tenantLicenceId: inv.tenantLicenceId,
        assetId: inv.assetId,
        dueDateIso: due,
        principal,
        ratePercentPerAnnum: rate,
        delta,
        cumulativeAfter: already + delta,
        balance,
      },
    }).catch((e) => console.error("Audit log failed:", e));
  }

  return { asOfDate, markedOverdue, interestPosted, interestRows, skipped };
}
