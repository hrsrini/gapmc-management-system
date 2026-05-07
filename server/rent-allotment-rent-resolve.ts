import { eq, desc, and, lte, or, isNull } from "drizzle-orm";
import { db } from "./db";
import { assetAllotments, entityAllotments, rentInvoices, rentRevisionOverrides } from "@shared/db-schema";

/** Aligns with monthly Draft invoice generation: latest Approved revision for period, else last invoice rent. */
export async function resolveRentForAllotmentPeriodMonth(
  allotmentId: string,
  periodMonth: string,
): Promise<{
  rentAmount: number;
  source: "revision" | "invoice" | "none";
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

  const [lastInvoice] = await db
    .select()
    .from(rentInvoices)
    .where(eq(rentInvoices.allotmentId, allotmentId))
    .orderBy(desc(rentInvoices.periodMonth))
    .limit(1);

  // US-M02-003: If this is a premises allocation and no invoice/revision exists yet,
  // fallback to the allocation's configured monthly rent.
  let fallbackAllotmentRent = 0;
  if (!rev && !lastInvoice) {
    const [ea] = await db
      .select({ monthlyRent: entityAllotments.monthlyRent })
      .from(entityAllotments)
      .where(eq(entityAllotments.id, allotmentId))
      .limit(1);
    if (ea?.monthlyRent != null && Number.isFinite(Number(ea.monthlyRent))) {
      fallbackAllotmentRent = Number(ea.monthlyRent);
    } else {
      const [aa] = await db
        .select({ monthlyRent: assetAllotments.monthlyRent })
        .from(assetAllotments)
        .where(eq(assetAllotments.id, allotmentId))
        .limit(1);
      if (aa?.monthlyRent != null && Number.isFinite(Number(aa.monthlyRent))) {
        fallbackAllotmentRent = Number(aa.monthlyRent);
      }
    }
  }

  const rentAmount =
    rev?.rentAmount != null && Number.isFinite(Number(rev.rentAmount))
      ? Number(rev.rentAmount)
      : lastInvoice?.rentAmount != null && Number.isFinite(Number(lastInvoice.rentAmount))
        ? Number(lastInvoice.rentAmount)
        : fallbackAllotmentRent;
  const source: "revision" | "invoice" | "none" = rev ? "revision" : lastInvoice ? "invoice" : "none";
  return {
    rentAmount,
    source,
    matchedRevisionId: rev?.id ?? null,
    matchedInvoiceId: !rev && lastInvoice ? lastInvoice.id : null,
  };
}
