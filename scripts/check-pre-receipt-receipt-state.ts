/**
 * Diagnostic: list pre-receipt settlement receipts that still need Rent head or RENT segment.
 * Usage: npm run db:check-pre-receipt-receipt-state
 */
import "dotenv/config";
import { eq, like, or } from "drizzle-orm";
import { db } from "../server/db";
import { iomsReceipts, preReceipts } from "@shared/db-schema";

async function main() {
  const stale = await db
    .select({
      id: iomsReceipts.id,
      receiptNo: iomsReceipts.receiptNo,
      revenueHead: iomsReceipts.revenueHead,
      sourceModule: iomsReceipts.sourceModule,
    })
    .from(iomsReceipts)
    .where(
      or(
        like(iomsReceipts.receiptNo, "%/MISC/%"),
        eq(iomsReceipts.revenueHead, "M-02-PRE-RECEIPT"),
      ),
    );

  const settled = await db
    .select({
      preId: preReceipts.id,
      preNo: preReceipts.preReceiptNo,
      receiptId: preReceipts.settledReceiptId,
    })
    .from(preReceipts)
    .where(eq(preReceipts.status, "Settled"));

  console.log(`Receipts with MISC segment or M-02-PRE-RECEIPT head: ${stale.length}`);
  for (const r of stale) {
    console.log(`  ${r.receiptNo} | head=${r.revenueHead} | module=${r.sourceModule} | ${r.id}`);
  }

  console.log(`\nSettled pre-receipts: ${settled.length}`);
  for (const p of settled) {
    if (!p.receiptId) continue;
    const [rec] = await db
      .select({
        receiptNo: iomsReceipts.receiptNo,
        revenueHead: iomsReceipts.revenueHead,
      })
      .from(iomsReceipts)
      .where(eq(iomsReceipts.id, p.receiptId))
      .limit(1);
    console.log(`  ${p.preNo ?? p.preId} → ${rec?.receiptNo ?? "?"} (${rec?.revenueHead ?? "?"})`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
