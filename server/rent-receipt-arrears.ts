/**
 * M-03: after a cheque/DD dishonour (prior Reversed receipt for the same invoice), the replacement
 * receipt may show delayed-rent slab interest to receipt date (disclosure only).
 */
import { and, eq, ne, sql, type InferSelectModel } from "drizzle-orm";
import { db } from "./db";
import { iomsReceipts, rentInvoices } from "@shared/db-schema";
import { getMergedSystemConfig, parseSystemConfigNumber } from "./system-config";
import {
  computeDelayedRentInterest,
  rentInterestDueDateIso,
  todayIsoLocal,
} from "./rent-interest";

type ReceiptRow = InferSelectModel<typeof iomsReceipts>;

export type RentReceiptArrearsDisclosure = {
  /** Rounded delayed-rent interest to receipt date (INR, not added to receipt total). */
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
  const rateRaw = parseSystemConfigNumber(cfg, "rent_arrears_interest_percent_per_annum");
  const rate = rateRaw > 0 ? rateRaw : 15;
  const due = rentInterestDueDateIso(inv.periodMonth);
  // Interest base = rent only (GAPLMB); fall back only if rent missing.
  const principal =
    Number(inv.rentAmount ?? 0) || Number(inv.totalAmount ?? 0) || Number(receipt.totalAmount ?? 0);
  if (!due || principal <= 0) return null;

  const asOfIso =
    String(receipt.createdAt ?? "").trim().slice(0, 10) || todayIsoLocal();
  const computed = computeDelayedRentInterest({
    rentAmount: principal,
    periodMonth: String(inv.periodMonth),
    asOfDateIso: asOfIso,
    percentPerAnnum: rate,
  });
  const dueMs = Date.parse(`${due}T00:00:00.000Z`);
  const asMs = Date.parse(`${asOfIso}T00:00:00.000Z`);
  const days =
    Number.isFinite(dueMs) && Number.isFinite(asMs)
      ? Math.max(0, Math.floor((asMs - dueMs) / 86_400_000))
      : 0;

  return {
    approxInterestInr: computed.interestRounded,
    overdueDays: days,
    dueDateIso: due,
    asOfIso,
    principalInr: principal,
    ratePercentPerAnnum: rate,
    note: `Arrears interest (${rate}% p.a. simple, monthly 50%/100% slabs; rounded once — after prior cheque/DD dishonour): indicative only — not included in receipt total; post per finance.`,
  };
}
