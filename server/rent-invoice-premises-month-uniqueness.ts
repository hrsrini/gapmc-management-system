/**
 * M-03: At most one non-Cancelled rent invoice per premises (asset) per billing month (`period_month` YYYY-MM).
 */
import { and, eq, ne } from "drizzle-orm";
import { db } from "./db";
import { rentInvoices } from "@shared/db-schema";

export const RENT_INVOICE_PREMISES_MONTH_DUPLICATE_MESSAGE =
  "A rent invoice already exists for this premises and billing month. Cancel the existing invoice before creating or moving another invoice to this month.";

export async function findBlockingRentInvoiceForPremisesMonth(
  assetId: string,
  periodMonth: string,
  excludeInvoiceId?: string | null,
): Promise<{ id: string; invoiceNo: string | null } | null> {
  const aid = String(assetId ?? "").trim();
  const pm = String(periodMonth ?? "").trim();
  if (!aid || !pm) return null;
  const parts = [eq(rentInvoices.assetId, aid), eq(rentInvoices.periodMonth, pm), ne(rentInvoices.status, "Cancelled")];
  if (excludeInvoiceId != null && String(excludeInvoiceId).trim() !== "") {
    parts.push(ne(rentInvoices.id, String(excludeInvoiceId).trim()));
  }
  const [row] = await db
    .select({ id: rentInvoices.id, invoiceNo: rentInvoices.invoiceNo })
    .from(rentInvoices)
    .where(and(...parts))
    .limit(1);
  return row ?? null;
}
