/**
 * M-03: after a cheque/DD dishonour (prior Reversed receipt for the same invoice), the replacement
 * receipt may show simple arrears interest from invoice period end to receipt date (disclosure only).
 */
import { and, eq, ne, sql, type InferSelectModel } from "drizzle-orm";
import { db } from "./db";
import { iomsReceipts, rentInvoices } from "@shared/db-schema";
import { getMergedSystemConfig, parseSystemConfigNumber } from "./system-config";
import { computeRentArrearsSimpleInterest, rentPeriodMonthEndIso } from "./rent-interest";

type ReceiptRow = InferSelectModel<typeof iomsReceipts>;

export type RentReceiptArrearsDisclosure = {
  /** Simple interest from invoice period end to receipt date (INR, not added to receipt total). */
  approxInterestInr: number;
  overdueDays: number;
  dueDateIso: string;
  asOfIso: string;
  principalInr: number;
  ratePercentPerAnnum: number;
  note: string;
};

function isM03RentLikeReceipt(r: ReceiptRow): boolean {
  return (
    r.sourceModule === "M-03" &&
    Boolean(r.sourceRecordId) &&
    (r.revenueHead === "Rent" || r.revenueHead === "GSTInvoice")
  );
}

/** Disclosure line for PDF / GET receipt when a prior dishonoured receipt exists for the same M-03 invoice. */
export async function getM03RentReceiptArrearsDisclosure(
  receipt: ReceiptRow,
): Promise<RentReceiptArrearsDisclosure | null> {
  if (!isM03RentLikeReceipt(receipt) || receipt.status === "Reversed") return null;
  const invoiceId = receipt.sourceRecordId!;
  const [priorDishonourCount] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(iomsReceipts)
    .where(
      and(
        eq(iomsReceipts.sourceModule, "M-03"),
        eq(iomsReceipts.sourceRecordId, invoiceId),
        eq(iomsReceipts.status, "Reversed"),
        ne(iomsReceipts.id, receipt.id),
        sql`${iomsReceipts.createdAt} < ${receipt.createdAt}`,
      ),
    );
  if (!priorDishonourCount || Number(priorDishonourCount.c ?? 0) < 1) return null;

  const [inv] = await db.select().from(rentInvoices).where(eq(rentInvoices.id, invoiceId)).limit(1);
  if (!inv) return null;

  const cfg = await getMergedSystemConfig();
  const rate = parseSystemConfigNumber(cfg, "rent_arrears_interest_percent_per_annum");
  const due = rentPeriodMonthEndIso(inv.periodMonth);
  const principal =
    Number(inv.rentAmount ?? 0) || Number(inv.totalAmount ?? 0) || Number(receipt.totalAmount ?? 0);
  if (!due || principal <= 0) return null;

  const asOfIso = String(receipt.createdAt ?? "").trim().slice(0, 10) || new Date().toISOString().slice(0, 10);
  const { days, interest } = computeRentArrearsSimpleInterest({
    principal,
    percentPerAnnum: rate,
    dueDateIso: due,
    asOfDateIso: asOfIso,
  });

  return {
    approxInterestInr: interest,
    overdueDays: days,
    dueDateIso: due,
    asOfIso,
    principalInr: principal,
    ratePercentPerAnnum: rate,
    note:
      "Arrears interest (simple daily, after prior cheque/DD dishonour for this invoice): indicative only — not included in receipt total; post per finance.",
  };
}
