import { eq, desc, and, lte, or, isNull } from "drizzle-orm";
import { db } from "./db";
import { assetAllotments, entityAllotments, rentInvoices, rentRevisionOverrides } from "@shared/db-schema";

async function allotmentConfiguredMonthlyRent(allotmentId: string): Promise<number> {
  const [ea] = await db
    .select({ monthlyRent: entityAllotments.monthlyRent })
    .from(entityAllotments)
    .where(eq(entityAllotments.id, allotmentId))
    .limit(1);
  if (ea?.monthlyRent != null && Number.isFinite(Number(ea.monthlyRent))) {
    return Number(ea.monthlyRent);
  }
  const [aa] = await db
    .select({ monthlyRent: assetAllotments.monthlyRent })
    .from(assetAllotments)
    .where(eq(assetAllotments.id, allotmentId))
    .limit(1);
  if (aa?.monthlyRent != null && Number.isFinite(Number(aa.monthlyRent))) {
    return Number(aa.monthlyRent);
  }
  return 0;
}

/**
 * Monthly rent **base** for billing (₹/month), not a prior invoice's prorated amount.
 * Order: approved revision for period → allotment monthly rent → last invoice baseMonthlyRent.
 */
export async function resolveRentForAllotmentPeriodMonth(
  allotmentId: string,
  periodMonth: string,
): Promise<{
  rentAmount: number;
  source: "revision" | "allotment" | "invoice_base" | "none";
  matchedRevisionId: string | null;
  matchedInvoiceId: string | null;
}> {
  const [rev] = await db
    .select()
    .from(rentRevisionOverrides)
    .where(
      and(
        eq(rentRevisionOverrides.allotmentId, allotmentId),
        lte(rentRevisionOverrides.effectiveMonth, periodMonth),
        or(eq(rentRevisionOverrides.status, "Approved"), isNull(rentRevisionOverrides.status)),
      ),
    )
    .orderBy(desc(rentRevisionOverrides.effectiveMonth))
    .limit(1);

  const allotmentRent = await allotmentConfiguredMonthlyRent(allotmentId);

  const [lastInvoice] = await db
    .select({
      id: rentInvoices.id,
      baseMonthlyRent: rentInvoices.baseMonthlyRent,
    })
    .from(rentInvoices)
    .where(eq(rentInvoices.allotmentId, allotmentId))
    .orderBy(desc(rentInvoices.periodMonth))
    .limit(1);

  if (rev?.rentAmount != null && Number.isFinite(Number(rev.rentAmount)) && Number(rev.rentAmount) > 0) {
    return {
      rentAmount: Number(rev.rentAmount),
      source: "revision",
      matchedRevisionId: rev.id,
      matchedInvoiceId: null,
    };
  }

  if (allotmentRent > 0) {
    return {
      rentAmount: allotmentRent,
      source: "allotment",
      matchedRevisionId: null,
      matchedInvoiceId: null,
    };
  }

  const base = lastInvoice?.baseMonthlyRent != null ? Number(lastInvoice.baseMonthlyRent) : NaN;
  if (Number.isFinite(base) && base > 0) {
    return {
      rentAmount: base,
      source: "invoice_base",
      matchedInvoiceId: lastInvoice!.id,
      matchedRevisionId: null,
    };
  }

  return {
    rentAmount: 0,
    source: "none",
    matchedRevisionId: null,
    matchedInvoiceId: null,
  };
}
