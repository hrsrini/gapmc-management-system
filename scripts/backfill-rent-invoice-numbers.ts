/**
 * Set rent_invoices.invoice_no for rows where it is null or empty (M-03 display / receipts).
 * Usage: npm run db:backfill-rent-invoice-numbers
 */
import "dotenv/config";
import { eq, isNull, or } from "drizzle-orm";
import { db } from "../server/db";
import { rentInvoices, yards } from "../shared/db-schema";
import { formatRentInvoiceNo } from "../server/rent-invoice-number";

async function main() {
  const yardRows = await db.select({ id: yards.id, code: yards.code }).from(yards);
  const codeById = new Map(yardRows.map((y) => [y.id, y.code]));

  const missing = await db
    .select()
    .from(rentInvoices)
    .where(or(isNull(rentInvoices.invoiceNo), eq(rentInvoices.invoiceNo, "")));

  let n = 0;
  for (const inv of missing) {
    const no = formatRentInvoiceNo(codeById.get(inv.yardId), inv.periodMonth, inv.id);
    await db.update(rentInvoices).set({ invoiceNo: no }).where(eq(rentInvoices.id, inv.id));
    n += 1;
  }
  console.log(`Backfilled invoice_no on ${n} rent invoice(s).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
