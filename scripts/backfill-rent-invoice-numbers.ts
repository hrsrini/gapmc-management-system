/**
 * Reassign all rent_invoices.invoice_no to M03/{yardCode}/{YYYY-MM}/NNNNN (per yard + month).
 * Syncs gapmc.m03_rent_invoice_counters from assigned sequences.
 *
 * Usage: npm run db:backfill-rent-invoice-numbers
 */
import "dotenv/config";
import { asc, eq } from "drizzle-orm";
import { db } from "../server/db";
import { rentInvoices, yards } from "../shared/db-schema";
import { formatRentInvoiceNo, syncRentInvoiceCounter } from "../server/rent-invoice-number";

type InvRow = {
  id: string;
  yardId: string;
  periodMonth: string;
  generatedAt: string | null;
  approvedAt: string | null;
};

function sortKey(r: InvRow): string {
  const g = r.generatedAt?.trim() || "";
  const a = r.approvedAt?.trim() || "";
  return `${g || a || "0000-01-01T00:00:00.000Z"}\t${r.id}`;
}

async function main() {
  const yardRows = await db.select({ id: yards.id, code: yards.code }).from(yards);
  const codeById = new Map(yardRows.map((y) => [y.id, y.code]));

  const all = await db
    .select({
      id: rentInvoices.id,
      yardId: rentInvoices.yardId,
      periodMonth: rentInvoices.periodMonth,
      generatedAt: rentInvoices.generatedAt,
      approvedAt: rentInvoices.approvedAt,
    })
    .from(rentInvoices)
    .orderBy(asc(rentInvoices.yardId), asc(rentInvoices.periodMonth), asc(rentInvoices.id));

  const byGroup = new Map<string, InvRow[]>();
  for (const inv of all) {
    const key = `${inv.yardId}\t${inv.periodMonth}`;
    const list = byGroup.get(key) ?? [];
    list.push(inv);
    byGroup.set(key, list);
  }

  let updated = 0;
  for (const [key, rows] of byGroup) {
    const [yardId, periodMonth] = key.split("\t");
    const sorted = [...rows].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
    const yardCode = codeById.get(yardId) ?? "YARD";
    let seq = 0;
    for (const inv of sorted) {
      seq += 1;
      const invoiceNo = formatRentInvoiceNo(yardCode, periodMonth, seq);
      await db.update(rentInvoices).set({ invoiceNo }).where(eq(rentInvoices.id, inv.id));
      updated += 1;
    }
    await syncRentInvoiceCounter(yardId, periodMonth, seq);
    console.log(`  ${yardCode} ${periodMonth}: ${seq} invoice(s)`);
  }

  console.log(`\nReassigned sequential invoice_no on ${updated} rent invoice(s).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
