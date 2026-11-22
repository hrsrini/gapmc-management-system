/**
 * Backfill M-05 manual receipts: set revenue_head to Tally ledger name (not Miscellaneous).
 * Usage: npm run db:backfill-manual-receipt-revenue-head-dry
 *        npm run db:backfill-manual-receipt-revenue-head
 */
import "dotenv/config";
import { eq } from "drizzle-orm";
import { db, pool } from "../server/db";
import { iomsReceipts, manualReceiptTypes } from "../shared/db-schema";
import { isM05ConsolidatedReceipt } from "../shared/manual-consolidated-receipt";
import { manualReceiptPostingHead } from "../shared/manual-receipt-types";

const dryRun = process.argv.includes("--dry-run");

async function main(): Promise<void> {
  const rows = await db
    .select({
      id: iomsReceipts.id,
      receiptNo: iomsReceipts.receiptNo,
      revenueHead: iomsReceipts.revenueHead,
      sourceRecordId: iomsReceipts.sourceRecordId,
      m03BreakdownJson: iomsReceipts.m03BreakdownJson,
      ledgerName: manualReceiptTypes.ledgerName,
    })
    .from(iomsReceipts)
    .innerJoin(manualReceiptTypes, eq(iomsReceipts.manualReceiptTypeId, manualReceiptTypes.id))
    .where(eq(iomsReceipts.sourceModule, "M-05-MANUAL"));

  let updated = 0;
  for (const r of rows) {
    // Multi-head CONS receipts must stay under Consolidated — never first-line ledger.
    if (isM05ConsolidatedReceipt(r)) {
      if (r.revenueHead !== "Consolidated") {
        console.log(
          `${dryRun ? "[dry-run] " : ""}${r.receiptNo ?? r.id}: "${r.revenueHead}" → "Consolidated"`,
        );
        if (!dryRun) {
          await db.update(iomsReceipts).set({ revenueHead: "Consolidated" }).where(eq(iomsReceipts.id, r.id));
        }
        updated += 1;
      }
      continue;
    }
    const postingHead = manualReceiptPostingHead(r.ledgerName);
    if (r.revenueHead === postingHead) continue;
    console.log(
      `${dryRun ? "[dry-run] " : ""}${r.receiptNo ?? r.id}: "${r.revenueHead}" → "${postingHead}"`,
    );
    if (!dryRun) {
      await db.update(iomsReceipts).set({ revenueHead: postingHead }).where(eq(iomsReceipts.id, r.id));
    }
    updated += 1;
  }
  console.log(`${dryRun ? "Would update" : "Updated"} ${updated} manual receipt(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
