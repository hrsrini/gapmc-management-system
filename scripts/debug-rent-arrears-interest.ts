/**
 * Diagnose M-03 delayed-rent interest ledger alignment.
 * Usage: dotenv -e .env -- tsx scripts/debug-rent-arrears-interest.ts
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../server/db";
import { iomsReceipts, rentDepositLedger, rentInvoices } from "@shared/db-schema";
import { getMergedSystemConfig, parseSystemConfigNumber } from "../server/system-config";
import {
  computeDelayedRentInterest,
  rentInterestDueDateIso,
  todayIsoLocal,
} from "../server/rent-interest";
import { m03ReceiptPrincipalTowardInvoice } from "@shared/m03-receipt-breakdown";
import { runM03RentArrearsInterest } from "../server/cron-m03-rent-arrears-interest";

async function sumPaid(invoiceId: string): Promise<number> {
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

async function sumInterestNet(invoiceId: string): Promise<number> {
  const [r] = await db
    .select({
      s: sql<number>`coalesce(sum(${rentDepositLedger.debit}) - sum(${rentDepositLedger.credit}), 0)::double precision`,
    })
    .from(rentDepositLedger)
    .where(and(eq(rentDepositLedger.invoiceId, invoiceId), eq(rentDepositLedger.entryType, "Interest")));
  return Math.round(Number(r?.s ?? 0) * 100) / 100;
}

async function main() {
  const asOf = todayIsoLocal();
  const cfg = await getMergedSystemConfig();
  const rateRaw = parseSystemConfigNumber(cfg, "rent_arrears_interest_percent_per_annum");
  const rate = rateRaw > 0 ? rateRaw : 15;
  console.log({ asOf, rate, configValue: cfg.rent_arrears_interest_percent_per_annum });

  console.log("Re-run arrears (expect mostly skips if already aligned)…");
  const second = await runM03RentArrearsInterest();
  console.log("secondRun", second);

  const candidates = await db
    .select()
    .from(rentInvoices)
    .where(inArray(rentInvoices.status, ["Approved", "Overdue"]));

  let mismatch = 0;
  let checked = 0;
  let dueSkipped = 0;
  let paidSkipped = 0;
  const samples: unknown[] = [];

  for (const inv of candidates) {
    const due = rentInterestDueDateIso(inv.periodMonth);
    if (!due || due >= asOf) {
      dueSkipped += 1;
      continue;
    }
    const paid = await sumPaid(inv.id);
    const outstanding = Number(inv.totalAmount ?? 0) - paid;
    if (outstanding <= 0.01) {
      paidSkipped += 1;
      continue;
    }
    const rent = Number(inv.rentAmount ?? 0);
    const principal = rent > 0 ? Math.min(rent, Math.max(0, outstanding)) : 0;
    if (principal <= 0) continue;

    const computed = computeDelayedRentInterest({
      rentAmount: principal,
      periodMonth: String(inv.periodMonth),
      asOfDateIso: asOf,
      percentPerAnnum: rate,
    });
    const posted = await sumInterestNet(inv.id);
    checked += 1;
    const diff = Math.round((computed.interestRounded - posted) * 100) / 100;
    if (Math.abs(diff) >= 0.01) {
      mismatch += 1;
      if (samples.length < 8) {
        samples.push({
          invoiceNo: inv.invoiceNo,
          periodMonth: inv.periodMonth,
          status: inv.status,
          rent,
          outstanding: Math.round(outstanding * 100) / 100,
          principal,
          nMonths: computed.nMonths,
          expected: computed.interestRounded,
          posted,
          diff,
        });
      }
    }
  }

  console.log({
    candidates: candidates.length,
    checked,
    dueSkipped,
    paidSkipped,
    mismatch,
    samples,
  });

  if (mismatch > 0) {
    console.error(`FAIL: ${mismatch} invoice(s) misaligned with slab interest`);
    process.exit(1);
  }
  if (second.interestRows > 0) {
    console.warn(
      `WARN: second run still posted ${second.interestRows} row(s) — may be float noise or late updates`,
    );
  }
  console.log("OK: ledger net interest matches rounded slab totals for all live overdue invoices");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
