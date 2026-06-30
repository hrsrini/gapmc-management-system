/**
 * One-time / idempotent backfill: move in-flight M-04 commodity transactions to
 * immediate-effective state (no verification/approval queue).
 */
import { eq, inArray } from "drizzle-orm";
import { db } from "./db";
import { marketTransactions, purchaseTransactions } from "@shared/db-schema";
import { issueMarketFeeReceiptForPurchaseTransaction } from "./market-purchase-receipt-issue";
import { finalizeMarketTransaction } from "./market-transaction-wizard";

export type M04ImmediateBackfillResult = {
  purchaseScanned: number;
  purchaseApproved: number;
  purchaseReceiptsLinked: number;
  wizardScanned: number;
  wizardFinalized: number;
  wizardSkipped: number;
  errors: Array<{ id: string; kind: "purchase" | "wizard"; message: string }>;
};

const PURCHASE_PENDING_STATUSES = ["Draft", "Verified", "Submitted"] as const;

export async function backfillM04ImmediateCommodityTransactions(args?: {
  createdBy?: string;
  dryRun?: boolean;
}): Promise<M04ImmediateBackfillResult> {
  const createdBy = args?.createdBy ?? "system-m04-immediate-backfill";
  const dryRun = Boolean(args?.dryRun);
  const result: M04ImmediateBackfillResult = {
    purchaseScanned: 0,
    purchaseApproved: 0,
    purchaseReceiptsLinked: 0,
    wizardScanned: 0,
    wizardFinalized: 0,
    wizardSkipped: 0,
    errors: [],
  };

  const pendingPurchases = await db
    .select()
    .from(purchaseTransactions)
    .where(inArray(purchaseTransactions.status, [...PURCHASE_PENDING_STATUSES]));
  result.purchaseScanned = pendingPurchases.length;

  for (const row of pendingPurchases) {
    try {
      if (!dryRun) {
        await db
          .update(purchaseTransactions)
          .set({
            status: "Approved",
            daUser: row.daUser ?? row.doUser ?? createdBy,
          })
          .where(eq(purchaseTransactions.id, row.id));

        const hadReceipt = row.receiptId != null && String(row.receiptId).trim() !== "";
        const { receiptId } = await issueMarketFeeReceiptForPurchaseTransaction({
          purchaseId: row.id,
          createdBy,
        });
        result.purchaseApproved += 1;
        if (!hadReceipt && receiptId) result.purchaseReceiptsLinked += 1;
      } else {
        result.purchaseApproved += 1;
      }
    } catch (e) {
      result.errors.push({
        id: row.id,
        kind: "purchase",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const pendingWizard = await db
    .select()
    .from(marketTransactions)
    .where(eq(marketTransactions.status, "Draft"));
  result.wizardScanned = pendingWizard.length;

  for (const row of pendingWizard) {
    if (row.receiptId != null && String(row.receiptId).trim() !== "") {
      if (!dryRun) {
        await db
          .update(marketTransactions)
          .set({ status: "Finalized", finalizedAt: row.finalizedAt ?? new Date().toISOString() })
          .where(eq(marketTransactions.id, row.id));
      }
      result.wizardFinalized += 1;
      continue;
    }

    const paymentMode = String(row.paymentMode ?? "Cash").trim() || "Cash";
    const safePaymentMode =
      paymentMode === "AdvanceDeposit" || paymentMode === "Advance" ? "Cash" : paymentMode;

    let paymentDetail: Record<string, unknown> | undefined;
    if (row.paymentDetailJson) {
      try {
        paymentDetail = JSON.parse(row.paymentDetailJson) as Record<string, unknown>;
      } catch {
        paymentDetail = undefined;
      }
    }

    try {
      if (!dryRun) {
        await finalizeMarketTransaction({
          transactionId: row.id,
          paymentMode: safePaymentMode,
          paymentDetail,
          paidAmount: Number(row.totalPayable ?? 0),
          createdBy,
        });
      }
      result.wizardFinalized += 1;
    } catch (e) {
      result.wizardSkipped += 1;
      result.errors.push({
        id: row.id,
        kind: "wizard",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return result;
}

let backfillOncePromise: Promise<M04ImmediateBackfillResult> | null = null;

/** Runs backfill at most once per server process (idempotent). */
export function ensureM04ImmediateCommodityBackfill(): Promise<M04ImmediateBackfillResult> {
  if (!backfillOncePromise) {
    backfillOncePromise = backfillM04ImmediateCommodityTransactions().catch((e) => {
      backfillOncePromise = null;
      throw e;
    });
  }
  return backfillOncePromise;
}
