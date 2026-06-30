/**
 * M-04: Issue MarketFee receipt when a purchase transaction becomes effective (Approved).
 * Commodity counter entries use immediate submission — no DV/DA workflow.
 */
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./db";
import { iomsReceipts, marketFeeLedger, purchaseTransactions, traderLicences } from "@shared/db-schema";
import { createIomsReceipt } from "./routes-receipts-ioms";
import { unifiedEntityIdFromTrackA } from "@shared/unified-entity-id";

async function getMarketFeeAdvanceBalance(traderLicenceId: string): Promise<number> {
  const rows = await db
    .select({ amountInr: marketFeeLedger.amountInr })
    .from(marketFeeLedger)
    .where(eq(marketFeeLedger.traderLicenceId, traderLicenceId));
  return Math.round(rows.reduce((s, r) => s + Number(r.amountInr ?? 0), 0) * 100) / 100;
}

export async function issueMarketFeeReceiptForPurchaseTransaction(args: {
  purchaseId: string;
  createdBy: string;
}): Promise<{ receiptId: string | null }> {
  const [responseRow] = await db
    .select()
    .from(purchaseTransactions)
    .where(eq(purchaseTransactions.id, args.purchaseId))
    .limit(1);
  if (!responseRow) return { receiptId: null };

  const shouldCreateReceipt =
    (responseRow.receiptId == null || responseRow.receiptId === "") &&
    responseRow.marketFeeAmount != null &&
    Number(responseRow.marketFeeAmount) >= 0;

  if (!shouldCreateReceipt) {
    return { receiptId: responseRow.receiptId ?? null };
  }

  const [existingReceipt] = await db
    .select()
    .from(iomsReceipts)
    .where(and(eq(iomsReceipts.sourceModule, "M-04"), eq(iomsReceipts.sourceRecordId, responseRow.id)))
    .limit(1);

  let receiptRow = existingReceipt ?? null;
  if (!receiptRow) {
    const advBal = await getMarketFeeAdvanceBalance(String(responseRow.traderLicenceId));
    const feeDue = Number(responseRow.marketFeeAmount ?? 0) || 0;

    const [licence] = await db
      .select()
      .from(traderLicences)
      .where(eq(traderLicences.id, responseRow.traderLicenceId))
      .limit(1);
    const snapName =
      responseRow.traderFirmNameSnapshot != null && String(responseRow.traderFirmNameSnapshot).trim() !== ""
        ? String(responseRow.traderFirmNameSnapshot).trim()
        : null;

    const created = await createIomsReceipt({
      yardId: responseRow.yardId,
      revenueHead: "MarketFee",
      payerName: licence?.firmName ?? snapName ?? responseRow.traderLicenceId,
      payerType: "TraderLicence",
      payerRefId: responseRow.traderLicenceId,
      isGracePeriod: Boolean((responseRow as { isGracePeriod?: boolean | null }).isGracePeriod),
      amount: Number(responseRow.marketFeeAmount ?? 0),
      paymentMode: "Cash",
      sourceModule: "M-04",
      sourceRecordId: responseRow.id,
      unifiedEntityId: unifiedEntityIdFromTrackA(responseRow.traderLicenceId),
      createdBy: args.createdBy,
      paymentDateYmd: String(responseRow.transactionDate).slice(0, 10),
    });

    const [createdRow] = await db.select().from(iomsReceipts).where(eq(iomsReceipts.id, created.id)).limit(1);
    receiptRow = createdRow ?? null;

    if (feeDue > 0 && advBal >= feeDue - 0.01 && receiptRow?.id) {
      const now = new Date().toISOString();
      await db.insert(marketFeeLedger).values({
        id: nanoid(),
        traderLicenceId: String(responseRow.traderLicenceId),
        yardId: String(responseRow.yardId),
        entryDate: String(responseRow.transactionDate).slice(0, 10),
        entryType: "Adjustment",
        amountInr: Number((-feeDue).toFixed(2)),
        receiptId: receiptRow.id,
        sourceModule: "M-04",
        sourceRecordId: String(responseRow.id),
        createdBy: args.createdBy,
        createdAt: now,
      });
      await db
        .update(iomsReceipts)
        .set({ status: "Paid", gatewayRef: "AdvanceAdjust" })
        .where(eq(iomsReceipts.id, receiptRow.id));
      const [paidRow] = await db.select().from(iomsReceipts).where(eq(iomsReceipts.id, receiptRow.id)).limit(1);
      receiptRow = paidRow ?? receiptRow;
    } else if (receiptRow?.id) {
      await db.update(iomsReceipts).set({ status: "Paid" }).where(eq(iomsReceipts.id, receiptRow.id));
    }
  }

  if (receiptRow?.id) {
    await db
      .update(purchaseTransactions)
      .set({ receiptId: receiptRow.id })
      .where(eq(purchaseTransactions.id, responseRow.id));
    return { receiptId: receiptRow.id };
  }

  return { receiptId: null };
}
