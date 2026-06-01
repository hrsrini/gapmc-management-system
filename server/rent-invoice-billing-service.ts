import { and, desc, eq, ne } from "drizzle-orm";
import { db } from "./db";
import {
  assetAllotments,
  entityAllotments,
  rentBillingConfig,
  rentInvoices,
} from "@shared/db-schema";
import {
  calculateRentBillingAmount,
  dateRangesOverlap,
  DEFAULT_RENT_BILLING_CONFIG,
  type RentBillingConfigSnapshot,
  type RentBillingType,
  validateRentBillingInput,
} from "@shared/rent-invoice-billing";
import { resolveRentForAllotmentPeriodMonth } from "./rent-allotment-rent-resolve";
import {
  defaultOccupancyForBillingType,
  inferBillingTypeForMonth,
} from "@shared/rent-invoice-billing";

export async function resolveRentBillingConfigForDate(asOfYmd: string): Promise<RentBillingConfigSnapshot> {
  const asOf = String(asOfYmd).trim().slice(0, 10);
  try {
    const rows = await db
      .select()
      .from(rentBillingConfig)
      .where(and(ne(rentBillingConfig.effectiveFrom, "")))
      .orderBy(desc(rentBillingConfig.effectiveFrom));
    const row = rows.find((r) => String(r.effectiveFrom).slice(0, 10) <= asOf) ?? rows[rows.length - 1];
    if (!row) return DEFAULT_RENT_BILLING_CONFIG;
    return {
      effectiveFrom: String(row.effectiveFrom).slice(0, 10),
      prorataFactor: Number(row.prorataFactor ?? 1),
      prorataDaysBasis: String(row.prorataDaysBasis) === "Fixed" ? "Fixed" : "Calendar",
      prorataFixedDays: row.prorataFixedDays ?? null,
      overstayFactor: Number(row.overstayFactor ?? 2),
      overstayDaysBasis: String(row.overstayDaysBasis) === "Fixed" ? "Fixed" : "Calendar",
      overstayFixedDays: row.overstayFixedDays ?? null,
    };
  } catch {
    return DEFAULT_RENT_BILLING_CONFIG;
  }
}

export async function fetchAllotmentAgreement(
  allotmentId: string,
): Promise<{ fromDate: string; toDate: string; monthlyRent: number } | null> {
  const [aa] = await db.select().from(assetAllotments).where(eq(assetAllotments.id, allotmentId)).limit(1);
  if (aa) {
    return {
      fromDate: String(aa.fromDate),
      toDate: String(aa.toDate),
      monthlyRent: Number(aa.monthlyRent ?? 0),
    };
  }
  const [ea] = await db.select().from(entityAllotments).where(eq(entityAllotments.id, allotmentId)).limit(1);
  if (ea) {
    return {
      fromDate: String(ea.fromDate),
      toDate: String(ea.toDate),
      monthlyRent: Number(ea.monthlyRent ?? 0),
    };
  }
  return null;
}

export async function findOverlappingRentInvoiceForAllotment(args: {
  allotmentId: string;
  periodMonth: string;
  occupancyFrom: string;
  occupancyTo: string;
  excludeInvoiceId?: string;
}): Promise<{ id: string; invoiceNo: string | null } | null> {
  const pm = args.periodMonth.trim().slice(0, 7);
  const occFrom = args.occupancyFrom.slice(0, 10);
  const occTo = args.occupancyTo.slice(0, 10);
  const rows = await db
    .select({
      id: rentInvoices.id,
      invoiceNo: rentInvoices.invoiceNo,
      occupancyFrom: rentInvoices.occupancyFrom,
      occupancyTo: rentInvoices.occupancyTo,
    })
    .from(rentInvoices)
    .where(
      and(
        eq(rentInvoices.allotmentId, args.allotmentId),
        eq(rentInvoices.periodMonth, pm),
        ne(rentInvoices.status, "Cancelled"),
      ),
    );
  for (const r of rows) {
    if (args.excludeInvoiceId && r.id === args.excludeInvoiceId) continue;
    const existingFrom = r.occupancyFrom?.slice(0, 10);
    const existingTo = r.occupancyTo?.slice(0, 10);
    if (!existingFrom || !existingTo) {
      return { id: r.id, invoiceNo: r.invoiceNo };
    }
    if (dateRangesOverlap(occFrom, occTo, existingFrom, existingTo)) {
      return { id: r.id, invoiceNo: r.invoiceNo };
    }
  }
  return null;
}

export async function buildRentInvoiceBillingCalculation(args: {
  allotmentId: string;
  periodMonth: string;
  billingType: RentBillingType;
  occupancyFrom?: string | null;
  occupancyTo?: string | null;
}): Promise<
  | {
      ok: true;
      calculation: ReturnType<typeof calculateRentBillingAmount>;
      monthlyRent: number;
      agreementFrom: string;
      agreementTo: string;
    }
  | { ok: false; error: string }
> {
  const agreement = await fetchAllotmentAgreement(args.allotmentId);
  if (!agreement) return { ok: false, error: "Allotment not found." };

  const resolved = await resolveRentForAllotmentPeriodMonth(args.allotmentId, args.periodMonth);
  const monthlyRent =
    Number.isFinite(resolved.rentAmount) && resolved.rentAmount > 0
      ? resolved.rentAmount
      : agreement.monthlyRent;
  if (!Number.isFinite(monthlyRent) || monthlyRent <= 0) {
    return { ok: false, error: "Monthly rent is not configured for this allotment." };
  }

  const validationErr = validateRentBillingInput({
    billingType: args.billingType,
    periodMonth: args.periodMonth,
    agreementFrom: agreement.fromDate,
    agreementTo: agreement.toDate,
    occupancyFrom: args.occupancyFrom,
    occupancyTo: args.occupancyTo,
  });
  if (validationErr) return { ok: false, error: validationErr };

  const config = await resolveRentBillingConfigForDate(
    args.occupancyFrom?.slice(0, 10) ?? `${args.periodMonth}-01`,
  );

  const calculation = calculateRentBillingAmount({
    billingType: args.billingType,
    periodMonth: args.periodMonth,
    monthlyRent,
    agreementFrom: agreement.fromDate,
    agreementTo: agreement.toDate,
    occupancyFrom: args.occupancyFrom,
    occupancyTo: args.occupancyTo,
    config,
  });

  if (calculation.rentAmount <= 0) {
    return { ok: false, error: "Calculated rent amount must be greater than zero." };
  }

  return {
    ok: true,
    calculation,
    monthlyRent,
    agreementFrom: agreement.fromDate,
    agreementTo: agreement.toDate,
  };
}

/** Infer billing type + occupancy and calculate rent for monthly draft generation (cron / API). */
export async function buildMonthlyDraftRentBilling(
  allotmentId: string,
  periodMonth: string,
): Promise<
  | {
      ok: true;
      calculation: ReturnType<typeof calculateRentBillingAmount>;
      monthlyRent: number;
      agreementFrom: string;
      agreementTo: string;
    }
  | { ok: false; error: string }
> {
  const agreement = await fetchAllotmentAgreement(allotmentId);
  if (!agreement) return { ok: false, error: "Allotment not found." };

  const billingType = inferBillingTypeForMonth({
    periodMonth,
    agreementFrom: agreement.fromDate,
    agreementTo: agreement.toDate,
  });
  const defaults = defaultOccupancyForBillingType({
    billingType,
    periodMonth,
    agreementFrom: agreement.fromDate,
    agreementTo: agreement.toDate,
  });
  if (!defaults) {
    return { ok: false, error: "Cannot derive occupancy dates for this billing month." };
  }

  return buildRentInvoiceBillingCalculation({
    allotmentId,
    periodMonth,
    billingType,
    occupancyFrom: defaults.occupancyFrom,
    occupancyTo: defaults.occupancyTo,
  });
}
