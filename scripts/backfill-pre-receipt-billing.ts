/**
 * Audit and fix M-02 pre-receipts issued for future billing months or with incorrect full-month rent.
 *
 * - Future month: billing month after issue month → cancel open pre-receipts; flag settled ones in remarks.
 * - Proration: recalculate amount for open pre-receipts when agreement starts/ends mid-month.
 *
 * Usage:
 *   npm run db:backfill-pre-receipt-billing-dry
 *   npm run db:backfill-pre-receipt-billing
 */
import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "../server/db";
import { preReceipts } from "@shared/db-schema";
import {
  isFutureBillingMonthAtIssue,
  resolvePreReceiptRentForBillingMonth,
  yearMonthFromIsoTimestamp,
} from "../server/pre-receipt-issue";

const dryRun = process.argv.includes("--dry-run");
const FLAG = "[billing-backfill]";

type Action =
  | { kind: "cancel-future"; id: string; preReceiptNo: string | null; billingMonth: string; issueMonth: string }
  | { kind: "flag-future-settled"; id: string; preReceiptNo: string | null; billingMonth: string; issueMonth: string }
  | {
      kind: "fix-amount";
      id: string;
      preReceiptNo: string | null;
      billingMonth: string;
      from: number;
      to: number;
      billingType: string;
    }
  | { kind: "flag-amount-settled"; id: string; preReceiptNo: string | null; from: number; to: number }
  | { kind: "skip"; id: string; reason: string };

function amountsDiffer(a: number, b: number): boolean {
  return Math.abs(a - b) > 0.009;
}

function appendRemark(existing: string | null | undefined, note: string): string {
  const base = String(existing ?? "").trim();
  if (!base) return note;
  if (base.includes(note)) return base;
  return `${base} | ${note}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

async function main() {
  const rows = await db.select().from(preReceipts);
  const actions: Action[] = [];

  for (const row of rows) {
    const status = String(row.status ?? "");
    if (status === "Cancelled") {
      actions.push({ kind: "skip", id: row.id, reason: "already cancelled" });
      continue;
    }

    const billingMonth = String(row.rentBillingMonth ?? "").trim().slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(billingMonth)) {
      actions.push({ kind: "skip", id: row.id, reason: "missing billing month" });
      continue;
    }

    const issueMonth = yearMonthFromIsoTimestamp(row.issuedAt ?? row.updatedAt) ?? "unknown";
    const isFuture = isFutureBillingMonthAtIssue(billingMonth, row.issuedAt ?? row.updatedAt);

    if (isFuture) {
      if (status === "Settled") {
        actions.push({
          kind: "flag-future-settled",
          id: row.id,
          preReceiptNo: row.preReceiptNo,
          billingMonth,
          issueMonth,
        });
        continue;
      }
      actions.push({
        kind: "cancel-future",
        id: row.id,
        preReceiptNo: row.preReceiptNo,
        billingMonth,
        issueMonth,
      });
      continue;
    }

    const calc = await resolvePreReceiptRentForBillingMonth(row.entityId, billingMonth);
    if (!calc) {
      actions.push({ kind: "skip", id: row.id, reason: "could not resolve rent for billing month" });
      continue;
    }

    const stored = Number(row.amount ?? 0);
    if (!amountsDiffer(stored, calc.amount)) {
      actions.push({ kind: "skip", id: row.id, reason: "amount already correct" });
      continue;
    }

    if (status === "Settled") {
      actions.push({
        kind: "flag-amount-settled",
        id: row.id,
        preReceiptNo: row.preReceiptNo,
        from: stored,
        to: calc.amount,
      });
      continue;
    }

    actions.push({
      kind: "fix-amount",
      id: row.id,
      preReceiptNo: row.preReceiptNo,
      billingMonth,
      from: stored,
      to: calc.amount,
      billingType: calc.billingType,
    });
  }

  const cancelFuture = actions.filter((a) => a.kind === "cancel-future");
  const flagFutureSettled = actions.filter((a) => a.kind === "flag-future-settled");
  const fixAmount = actions.filter((a) => a.kind === "fix-amount");
  const flagAmountSettled = actions.filter((a) => a.kind === "flag-amount-settled");
  const skipped = actions.filter((a) => a.kind === "skip");

  console.log(`Pre-receipt billing backfill (${dryRun ? "DRY RUN" : "APPLY"})`);
  console.log(`Scanned: ${rows.length}`);
  console.log(`Cancel future-month (open): ${cancelFuture.length}`);
  console.log(`Flag future-month (settled): ${flagFutureSettled.length}`);
  console.log(`Fix prorated amount (open): ${fixAmount.length}`);
  console.log(`Flag amount mismatch (settled): ${flagAmountSettled.length}`);
  console.log(`Skipped: ${skipped.length}`);
  console.log("");

  for (const a of cancelFuture) {
    console.log(
      `  CANCEL ${a.preReceiptNo ?? a.id} | billing=${a.billingMonth} issued=${a.issueMonth} (future month)`,
    );
  }
  for (const a of flagFutureSettled) {
    console.log(
      `  FLAG   ${a.preReceiptNo ?? a.id} | billing=${a.billingMonth} issued=${a.issueMonth} (future month, settled)`,
    );
  }
  for (const a of fixAmount) {
    console.log(
      `  AMOUNT ${a.preReceiptNo ?? a.id} | ${a.billingMonth} ${a.billingType} ₹${a.from} → ₹${a.to}`,
    );
  }
  for (const a of flagAmountSettled) {
    console.log(`  FLAG   ${a.preReceiptNo ?? a.id} | amount ₹${a.from} should be ₹${a.to} (settled)`);
  }

  if (dryRun) {
    console.log("\nDry run only — no database changes. Re-run without --dry-run to apply.");
    return;
  }

  let applied = 0;
  for (const a of actions) {
    if (a.kind === "skip") continue;

    const [row] = await db.select().from(preReceipts).where(eq(preReceipts.id, a.id)).limit(1);
    if (!row) continue;

    if (a.kind === "cancel-future") {
      const note = `${FLAG} Cancelled: billing month ${a.billingMonth} is after issue month ${a.issueMonth}.`;
      await db
        .update(preReceipts)
        .set({
          status: "Cancelled",
          remarks: appendRemark(row.remarks, note),
          updatedAt: nowIso(),
        })
        .where(eq(preReceipts.id, a.id));
      applied++;
      continue;
    }

    if (a.kind === "flag-future-settled") {
      const note = `${FLAG} Review: billing month ${a.billingMonth} is after issue month ${a.issueMonth} (settled).`;
      await db
        .update(preReceipts)
        .set({
          remarks: appendRemark(row.remarks, note),
          updatedAt: nowIso(),
        })
        .where(eq(preReceipts.id, a.id));
      applied++;
      continue;
    }

    if (a.kind === "fix-amount") {
      const note = `${FLAG} Amount corrected ${a.from} → ${a.to} (${a.billingType}, ${a.billingMonth}).`;
      await db
        .update(preReceipts)
        .set({
          amount: a.to,
          remarks: appendRemark(row.remarks, note),
          updatedAt: nowIso(),
        })
        .where(eq(preReceipts.id, a.id));
      applied++;
      continue;
    }

    if (a.kind === "flag-amount-settled") {
      const note = `${FLAG} Review amount: stored ₹${a.from}, expected ₹${a.to} (settled).`;
      await db
        .update(preReceipts)
        .set({
          remarks: appendRemark(row.remarks, note),
          updatedAt: nowIso(),
        })
        .where(eq(preReceipts.id, a.id));
      applied++;
    }
  }

  console.log(`\nApplied ${applied} update(s).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
