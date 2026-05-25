/**
 * Track B govt pre-receipt settlements were stored with revenue_head M-02-PRE-RECEIPT.
 * Normalize to Rent for reporting and legacy All Receipts merge.
 *
 * Usage: npm run db:backfill-pre-receipt-settlement-revenue-head
 *
 * Note: receipt_no segments (e.g. …/MISC/…) are not rewritten; only revenue_head is updated.
 */
import { eq } from "drizzle-orm";
import { db } from "../server/db";
import { iomsReceipts } from "@shared/db-schema";

async function main() {
  const updated = await db
    .update(iomsReceipts)
    .set({ revenueHead: "Rent" })
    .where(eq(iomsReceipts.revenueHead, "M-02-PRE-RECEIPT"))
    .returning({ id: iomsReceipts.id, receiptNo: iomsReceipts.receiptNo });
  if (updated.length === 0) {
    console.log("No receipts with revenue_head M-02-PRE-RECEIPT — already Rent.");
    console.log("Run: npm run db:check-pre-receipt-receipt-state");
    return;
  }
  console.log(`Updated ${updated.length} receipt(s) to revenue_head Rent.`);
  for (const r of updated) {
    console.log(`  ${r.receiptNo} (${r.id})`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
