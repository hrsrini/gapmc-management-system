/**
 * M-02: Issue Security Deposit IOMS receipt when a premises allocation draft is created.
 */
import type { Request } from "express";
import { and, eq } from "drizzle-orm";
import { iomsReceipts } from "@shared/db-schema";
import { initialDepositStatusForPaymentMode } from "@shared/receipt-deposit";
import { roundedMoney2 } from "@shared/premises-allocation";
import { db } from "./db";
import { writeAuditLog } from "./audit";
import {
  counterPaymentCreateParams,
  counterPaymentPaidUpdate,
  DuesCounterPaymentError,
  parseCounterDuesPaymentBody,
} from "./dues-counter-payment";
import { createIomsReceipt } from "./routes-receipts-ioms";

export class SecurityDepositReceiptError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SecurityDepositReceiptError";
  }
}

export async function issueSecurityDepositReceiptOnAllotmentDraft(opts: {
  req: Request;
  allotmentId: string;
  yardId: string;
  securityDepositAmount: number;
  payerName: string;
  payerType: string;
  payerRefId: string;
  unifiedEntityId: string;
  premisesAssetId?: string | null;
  paymentBody: Record<string, unknown>;
}): Promise<{ receiptId: string; receiptNo: string } | null> {
  const amount = roundedMoney2(opts.securityDepositAmount);
  if (amount <= 0) return null;

  const [existing] = await db
    .select({ id: iomsReceipts.id, receiptNo: iomsReceipts.receiptNo })
    .from(iomsReceipts)
    .where(
      and(
        eq(iomsReceipts.sourceModule, "M-02"),
        eq(iomsReceipts.sourceRecordId, opts.allotmentId),
        eq(iomsReceipts.revenueHead, "SecurityDeposit"),
      ),
    )
    .limit(1);
  if (existing) {
    return { receiptId: existing.id, receiptNo: existing.receiptNo };
  }

  const hasPaymentHint =
    opts.paymentBody.paymentMode != null ||
    opts.paymentBody.paymentType != null ||
    opts.paymentBody.securityDepositPaymentMode != null;
  if (!hasPaymentHint) {
    throw new SecurityDepositReceiptError(
      "SEC_DEP_PAYMENT",
      "Payment mode (Cash, Cheque, or NEFT/RTGS) is required when security deposit is collected.",
    );
  }

  let counterPay;
  try {
    counterPay = parseCounterDuesPaymentBody({
      ...opts.paymentBody,
      amount,
      paymentMode:
        opts.paymentBody.securityDepositPaymentMode ??
        opts.paymentBody.paymentMode ??
        opts.paymentBody.paymentType ??
        "Cash",
    });
  } catch (e) {
    if (e instanceof DuesCounterPaymentError) {
      throw new SecurityDepositReceiptError(e.code, e.message);
    }
    throw e;
  }

  const paidAmt = Number(opts.paymentBody.amount ?? opts.paymentBody.paidAmount ?? amount);
  if (Number.isFinite(paidAmt) && Math.abs(paidAmt - amount) > 0.02) {
    throw new SecurityDepositReceiptError(
      "SEC_DEP_AMOUNT",
      "Paid amount must match the security deposit amount.",
    );
  }

  const createdBy = opts.req.user?.id ?? "system";
  const created = await createIomsReceipt({
    yardId: opts.yardId,
    revenueHead: "SecurityDeposit",
    payerName: opts.payerName,
    payerType: opts.payerType,
    payerRefId: opts.payerRefId,
    amount,
    cgst: 0,
    sgst: 0,
    sourceModule: "M-02",
    sourceRecordId: opts.allotmentId,
    unifiedEntityId: opts.unifiedEntityId,
    premisesAssetId: opts.premisesAssetId ?? null,
    narration: "Being amount received towards Security Deposit.",
    createdBy,
    ...counterPaymentCreateParams(counterPay),
  });

  await db
    .update(iomsReceipts)
    .set({
      ...counterPaymentPaidUpdate(counterPay),
      depositStatus: initialDepositStatusForPaymentMode(counterPay.paymentMode),
    })
    .where(eq(iomsReceipts.id, created.id));

  const [paidRow] = await db.select().from(iomsReceipts).where(eq(iomsReceipts.id, created.id)).limit(1);
  if (paidRow) {
    writeAuditLog(opts.req, {
      module: "Receipts",
      action: "Create",
      recordId: paidRow.id,
      afterValue: paidRow,
    }).catch((e) => console.error("Audit log failed:", e));
  }

  return { receiptId: created.id, receiptNo: created.receiptNo };
}
