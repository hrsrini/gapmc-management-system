/**
 * M-02 Track B pre-receipt issue: resolve premises/rent from active entity allotment.
 */
import { and, desc, eq } from "drizzle-orm";
import { db } from "./db";
import { assets, entityAllotments, preReceipts } from "@shared/db-schema";
import {
  calculateRentBillingAmount,
  DEFAULT_RENT_BILLING_CONFIG,
  defaultOccupancyForBillingType,
  monthCalendarBoundsYm,
  type RentBillingConfigSnapshot,
} from "@shared/rent-invoice-billing";
import { resolveRentBillingConfigForDate } from "./rent-invoice-billing-service";

export type PreReceiptPrintFields = {
  allotmentId: string;
  rentPremisesType: string;
  /** Human-readable premises id (`assets.asset_id`), e.g. VAL/SHOP-S1 — printed as Shop/Godown No. */
  rentPremisesId: string;
  /** Formal allotment reference, e.g. VAL/SHOP-S1-Y-VAL-01. */
  rentAllotmentReferenceNo: string;
  amount: number;
  yardId: string;
  agreementFrom: string;
  agreementTo: string;
};

export type PreReceiptIssueContext = PreReceiptPrintFields & {
  monthlyRent: number;
  billingType?: "FullMonth" | "Prorated";
  billableDays?: number;
  daysInMonth?: number;
};

export type PreReceiptRentCalculation = {
  amount: number;
  billingType: "FullMonth" | "Prorated";
  billableDays: number;
  daysInMonth: number;
  occupancyFrom: string | null;
  occupancyTo: string | null;
};

export function currentYearMonthYm(asOf = new Date()): string {
  return `${asOf.getUTCFullYear()}-${String(asOf.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function yearMonthFromIsoTimestamp(ts: string | null | undefined): string | null {
  const t = String(ts ?? "").trim();
  if (!t) return null;
  const m = /^(\d{4})-(\d{2})/.exec(t);
  return m ? `${m[1]}-${m[2]}` : null;
}

export function isFutureBillingMonth(ym: string, asOfYm = currentYearMonthYm()): boolean {
  const month = ym.trim().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) return false;
  return month > asOfYm.trim().slice(0, 7);
}

/** True when billing month is after the calendar month in which the pre-receipt was issued. */
export function isFutureBillingMonthAtIssue(ym: string, issuedAt: string | null | undefined): boolean {
  const month = ym.trim().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) return false;
  const issueYm = yearMonthFromIsoTimestamp(issuedAt) ?? currentYearMonthYm();
  return month > issueYm;
}

export function billingMonthWithinAllotment(ym: string, fromDate: string, toDate: string): boolean {
  const month = ym.trim().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) return false;
  const start = String(fromDate).trim().slice(0, 7);
  const end = String(toDate).trim().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(start) || !/^\d{4}-\d{2}$/.test(end)) return false;
  return month >= start && month <= end;
}

/** Pre-receipts bill full or prorated rent only (no overstay / fine rent). */
export function inferPreReceiptBillingTypeForMonth(args: {
  periodMonth: string;
  agreementFrom: string;
  agreementTo: string;
}): "FullMonth" | "Prorated" {
  const bounds = monthCalendarBoundsYm(args.periodMonth);
  if (!bounds) return "FullMonth";
  const agrFrom = args.agreementFrom.slice(0, 10);
  const agrTo = args.agreementTo.slice(0, 10);
  if (agrFrom > bounds.from || agrTo < bounds.to) return "Prorated";
  return "FullMonth";
}

export function calculatePreReceiptRentForMonth(args: {
  rentBillingMonth: string;
  monthlyRent: number;
  agreementFrom: string;
  agreementTo: string;
  config?: RentBillingConfigSnapshot;
}): PreReceiptRentCalculation | null {
  const ym = args.rentBillingMonth.trim().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(ym)) return null;
  const billingType = inferPreReceiptBillingTypeForMonth({
    periodMonth: ym,
    agreementFrom: args.agreementFrom,
    agreementTo: args.agreementTo,
  });
  const occ = defaultOccupancyForBillingType({
    billingType,
    periodMonth: ym,
    agreementFrom: args.agreementFrom,
    agreementTo: args.agreementTo,
  });
  if (!occ) return null;
  const config = args.config ?? DEFAULT_RENT_BILLING_CONFIG;
  const result = calculateRentBillingAmount({
    billingType,
    periodMonth: ym,
    monthlyRent: args.monthlyRent,
    agreementFrom: args.agreementFrom,
    agreementTo: args.agreementTo,
    occupancyFrom: occ.occupancyFrom,
    occupancyTo: occ.occupancyTo,
    config,
  });
  return {
    amount: result.rentAmount,
    billingType,
    billableDays: result.billableDays,
    daysInMonth: result.daysInMonth,
    occupancyFrom: result.occupancyFrom,
    occupancyTo: result.occupancyTo,
  };
}

export async function resolveEntityAllotmentForBillingMonth(
  entityId: string,
  rentBillingMonth: string,
): Promise<{
  fromDate: string;
  toDate: string;
  monthlyRent: number;
} | null> {
  const ym = rentBillingMonth.trim().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(ym)) return null;
  const allotments = await db
    .select({
      fromDate: entityAllotments.fromDate,
      toDate: entityAllotments.toDate,
      monthlyRent: entityAllotments.monthlyRent,
    })
    .from(entityAllotments)
    .where(
      and(eq(entityAllotments.entityId, entityId), eq(entityAllotments.approvalStatus, "Approved")),
    )
    .orderBy(desc(entityAllotments.toDate));
  for (const row of allotments) {
    if (billingMonthWithinAllotment(ym, row.fromDate, row.toDate)) {
      const monthlyRent = Number(row.monthlyRent ?? 0);
      if (!Number.isFinite(monthlyRent) || monthlyRent <= 0) return null;
      return {
        fromDate: String(row.fromDate),
        toDate: String(row.toDate),
        monthlyRent,
      };
    }
  }
  return null;
}

export async function resolvePreReceiptRentForBillingMonth(
  entityId: string,
  rentBillingMonth: string,
): Promise<PreReceiptRentCalculation | null> {
  const allot = await resolveEntityAllotmentForBillingMonth(entityId, rentBillingMonth);
  if (!allot) {
    const fields = await resolvePreReceiptPrintFields(entityId);
    if (!fields) return null;
    const bounds = monthCalendarBoundsYm(rentBillingMonth.trim().slice(0, 7));
    const config = await resolveRentBillingConfigForDate(bounds?.from ?? `${rentBillingMonth.trim().slice(0, 7)}-01`);
    return calculatePreReceiptRentForMonth({
      rentBillingMonth,
      monthlyRent: fields.amount,
      agreementFrom: fields.agreementFrom,
      agreementTo: fields.agreementTo,
      config,
    });
  }
  const bounds = monthCalendarBoundsYm(rentBillingMonth.trim().slice(0, 7));
  const config = await resolveRentBillingConfigForDate(bounds?.from ?? `${rentBillingMonth.trim().slice(0, 7)}-01`);
  return calculatePreReceiptRentForMonth({
    rentBillingMonth,
    monthlyRent: allot.monthlyRent,
    agreementFrom: allot.fromDate,
    agreementTo: allot.toDate,
    config,
  });
}

export async function resolvePreReceiptPrintFields(entityId: string): Promise<PreReceiptPrintFields | null> {
  const allotments = await db
    .select()
    .from(entityAllotments)
    .where(
      and(
        eq(entityAllotments.entityId, entityId),
        eq(entityAllotments.status, "Active"),
        eq(entityAllotments.approvalStatus, "Approved"),
      ),
    )
    .orderBy(desc(entityAllotments.toDate));
  const allot = allotments[0];
  if (!allot) return null;

  const [asset] = await db.select().from(assets).where(eq(assets.id, allot.assetId)).limit(1);
  const premisesType = String(asset?.assetType ?? "").trim() || "Premises";
  const premisesId = String(asset?.assetId ?? "").trim() || allot.assetId;
  const allotmentRef = String(allot.premisesRefNo ?? "").trim() || premisesId;
  const amount = Number(allot.monthlyRent ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  return {
    allotmentId: allot.id,
    rentPremisesType: premisesType,
    rentPremisesId: premisesId,
    rentAllotmentReferenceNo: allotmentRef,
    amount,
    yardId: String(asset?.yardId ?? "").trim(),
    agreementFrom: allot.fromDate,
    agreementTo: allot.toDate,
  };
}

export async function resolvePreReceiptIssueContext(
  entityId: string,
  rentBillingMonth?: string | null,
): Promise<PreReceiptIssueContext | null> {
  const fields = await resolvePreReceiptPrintFields(entityId);
  if (!fields) return null;
  const monthlyRent = fields.amount;
  const ym = rentBillingMonth?.trim().slice(0, 7) ?? "";
  if (!/^\d{4}-\d{2}$/.test(ym)) {
    return { ...fields, monthlyRent, amount: monthlyRent };
  }
  const calc = await resolvePreReceiptRentForBillingMonth(entityId, ym);
  if (!calc) {
    return { ...fields, monthlyRent, amount: monthlyRent };
  }
  return {
    ...fields,
    monthlyRent,
    amount: calc.amount,
    billingType: calc.billingType,
    billableDays: calc.billableDays,
    daysInMonth: calc.daysInMonth,
  };
}

export async function findDuplicatePreReceiptForMonth(
  entityId: string,
  rentBillingMonth: string,
  excludeId?: string,
): Promise<{ id: string; preReceiptNo: string | null } | null> {
  const ym = rentBillingMonth.trim().slice(0, 7);
  const rows = await db
    .select({
      id: preReceipts.id,
      preReceiptNo: preReceipts.preReceiptNo,
      status: preReceipts.status,
    })
    .from(preReceipts)
    .where(and(eq(preReceipts.entityId, entityId), eq(preReceipts.rentBillingMonth, ym)));
  for (const r of rows) {
    if (excludeId && r.id === excludeId) continue;
    if (String(r.status ?? "") === "Cancelled") continue;
    return { id: r.id, preReceiptNo: r.preReceiptNo };
  }
  return null;
}
