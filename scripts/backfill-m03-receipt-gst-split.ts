/**
 * Backfill M-03 rent receipts that stored full payment in amount with cgst/sgst = 0.
 *
 * Usage: dotenv -e .env -- tsx scripts/backfill-m03-receipt-gst-split.ts [--dry-run]
 */
import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "../server/db";
import { iomsReceipts, rentInvoices } from "@shared/db-schema";
import { resolveM03ReceiptGstAmounts } from "@shared/m03-receipt-breakdown";
import { invoiceGstSnapshot } from "../server/m03-receipt-gst-display";

const dryRun = process.argv.includes("--dry-run");

async function main(): Promise<void> {
  const rows = await db
    .select()
    .from(iomsReceipts)
    .where(
      and(
        eq(iomsReceipts.sourceModule, "M-03"),
        or(eq(iomsReceipts.revenueHead, "Rent"), eq(iomsReceipts.revenueHead, "GSTInvoice")),
      ),
    );

  const invoiceIds = Array.from(
    new Set(rows.map((r) => String(r.sourceRecordId ?? "").trim()).filter(Boolean)),
  );
  const invRows =
    invoiceIds.length > 0
      ? await db
          .select({
            id: rentInvoices.id,
            rentAmount: rentInvoices.rentAmount,
            cgst: rentInvoices.cgst,
            sgst: rentInvoices.sgst,
            totalAmount: rentInvoices.totalAmount,
          })
          .from(rentInvoices)
          .where(inArray(rentInvoices.id, invoiceIds))
      : [];
  const gstById = new Map(invRows.map((inv) => [inv.id, invoiceGstSnapshot(inv)]));

  let updated = 0;
  for (const row of rows) {
    const storedCgst = Number(row.cgst ?? 0);
    const storedSgst = Number(row.sgst ?? 0);
    if (storedCgst >= 0.005 || storedSgst >= 0.005) continue;
    const inv = row.sourceRecordId ? gstById.get(row.sourceRecordId) : null;
    const parts = resolveM03ReceiptGstAmounts(row, inv ?? null);
    if (parts.cgst < 0.005 && parts.sgst < 0.005) continue;
    if (
      Math.abs(Number(row.amount) - parts.amount) < 0.01 &&
      Math.abs(storedCgst - parts.cgst) < 0.01 &&
      Math.abs(storedSgst - parts.sgst) < 0.01
    ) {
      continue;
    }
    console.log(
      `${dryRun ? "[dry-run] " : ""}${row.receiptNo}: amount ${row.amount} -> ${parts.amount}, cgst ${storedCgst} -> ${parts.cgst}, sgst ${storedSgst} -> ${parts.sgst}`,
    );
    if (!dryRun) {
      await db
        .update(iomsReceipts)
        .set({ amount: parts.amount, cgst: parts.cgst, sgst: parts.sgst })
        .where(eq(iomsReceipts.id, row.id));
    }
    updated += 1;
  }
  console.log(`${dryRun ? "Would update" : "Updated"} ${updated} receipt(s).`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
