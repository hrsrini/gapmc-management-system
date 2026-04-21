import { eq } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import { db } from "./db";
import { iomsReceipts, paymentGatewayLog } from "@shared/db-schema";
import { recordRentCollectionForM03Receipt } from "./rent-deposit-ledger-from-receipt";

type IomsReceiptRow = InferSelectModel<typeof iomsReceipts>;
type PaymentGatewayLogRow = InferSelectModel<typeof paymentGatewayLog>;

export type ApplyPaymentGatewayCallbackError = {
  ok: false;
  httpStatus: number;
  code: string;
  message: string;
};

export type ApplyPaymentGatewayCallbackSuccess = {
  ok: true;
  receiptId: string;
  gatewayTxnId: string;
  status: string;
  receiptBefore: IomsReceiptRow;
  logBefore: PaymentGatewayLogRow;
  receiptAfter: IomsReceiptRow;
  logAfter: PaymentGatewayLogRow | null;
};

export type ApplyPaymentGatewayCallbackResult =
  | ApplyPaymentGatewayCallbackSuccess
  | ApplyPaymentGatewayCallbackError;

/**
 * Shared body for public webhook and authenticated dev simulate:
 * gatewayTxnId, status (Paid | Failed | Reconciled), optional gatewayRef.
 */
export async function applyPaymentGatewayCallback(params: {
  gatewayTxnId: string;
  status: string;
  gatewayRef?: string;
  /** Stored on `payment_gateway_log.gateway_response` (same as webhook: `gatewayResponse` key or full body). */
  rawBody: Record<string, unknown>;
  scopedLocationIds: string[] | undefined;
  /** When set (dev simulate), reject if the log is not for this receipt id — before any update. */
  expectedReceiptId?: string;
}): Promise<ApplyPaymentGatewayCallbackResult> {
  const { gatewayTxnId, status, gatewayRef, rawBody, scopedLocationIds, expectedReceiptId } = params;
  const storedResponse =
    rawBody.gatewayResponse !== undefined && rawBody.gatewayResponse !== null ? rawBody.gatewayResponse : rawBody;

  if (!["Paid", "Failed", "Reconciled"].includes(status)) {
    return {
      ok: false,
      httpStatus: 400,
      code: "RECEIPT_STATUS_INVALID",
      message: "status must be Paid, Failed, or Reconciled",
    };
  }

  const [log] = await db.select().from(paymentGatewayLog).where(eq(paymentGatewayLog.gatewayTxnId, gatewayTxnId)).limit(1);
  if (!log) {
    return { ok: false, httpStatus: 404, code: "PAYMENT_LOG_NOT_FOUND", message: "Payment log not found" };
  }

  if (expectedReceiptId != null && log.receiptId !== expectedReceiptId) {
    return {
      ok: false,
      httpStatus: 400,
      code: "PAYMENT_LOG_RECEIPT_MISMATCH",
      message: "gatewayTxnId does not belong to this receipt.",
    };
  }

  const [receipt] = await db.select().from(iomsReceipts).where(eq(iomsReceipts.id, log.receiptId)).limit(1);
  if (!receipt) {
    return { ok: false, httpStatus: 404, code: "RECEIPT_NOT_FOUND", message: "Receipt not found" };
  }

  if (scopedLocationIds && scopedLocationIds.length > 0 && !scopedLocationIds.includes(receipt.yardId)) {
    return { ok: false, httpStatus: 404, code: "RECEIPT_NOT_FOUND", message: "Receipt not found" };
  }

  await db
    .update(paymentGatewayLog)
    .set({
      status,
      gatewayResponse: storedResponse as unknown,
    })
    .where(eq(paymentGatewayLog.id, log.id));

  await db
    .update(iomsReceipts)
    .set({
      status,
      ...(gatewayRef != null && { gatewayRef }),
    })
    .where(eq(iomsReceipts.id, receipt.id));

  const [updatedLog] = await db.select().from(paymentGatewayLog).where(eq(paymentGatewayLog.id, log.id)).limit(1);
  const [updatedReceipt] = await db.select().from(iomsReceipts).where(eq(iomsReceipts.id, receipt.id)).limit(1);
  if (!updatedReceipt) {
    return { ok: false, httpStatus: 404, code: "RECEIPT_NOT_FOUND", message: "Receipt not found" };
  }

  if (status === "Paid" || status === "Reconciled") {
    try {
      await recordRentCollectionForM03Receipt(updatedReceipt);
    } catch (e) {
      console.error("[payment-gateway] rent deposit Collection hook failed:", e);
    }
  }

  return {
    ok: true,
    receiptId: receipt.id,
    gatewayTxnId,
    status,
    receiptBefore: receipt,
    logBefore: log,
    receiptAfter: updatedReceipt,
    logAfter: updatedLog ?? null,
  };
}
