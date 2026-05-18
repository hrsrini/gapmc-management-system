/**
 * M-03: At most one non-Cancelled rent invoice per premises (asset) per billing month (`period_month` YYYY-MM).
 */
import { and, eq, inArray, ne, or } from "drizzle-orm";
import { db } from "./db";
import { assets, rentInvoices } from "@shared/db-schema";

export const RENT_INVOICE_PREMISES_MONTH_DUPLICATE_MESSAGE =
  "A rent invoice already exists for this premises and billing month. Cancel the existing invoice before creating or moving another invoice to this month.";

/** All `rent_invoices.asset_id` values that refer to the same physical premises (PK + legacy premises code). */
export async function assetIdKeysForPremisesLookup(assetId: string): Promise<string[]> {
  const raw = String(assetId ?? "").trim();
  if (!raw) return [];
  const [row] = await db
    .select({ id: assets.id, assetId: assets.assetId })
    .from(assets)
    .where(or(eq(assets.id, raw), eq(assets.assetId, raw)))
    .limit(1);
  if (!row) return [raw];
  const pk = String(row.id).trim();
  const code = String(row.assetId ?? "").trim();
  return Array.from(new Set([pk, code].filter(Boolean)));
}

/** Canonical `assets.id` for storing on new/updated rent invoices. */
export async function normalizeRentInvoiceAssetId(assetId: string): Promise<string | null> {
  const raw = String(assetId ?? "").trim();
  if (!raw) return null;
  const [row] = await db
    .select({ id: assets.id })
    .from(assets)
    .where(or(eq(assets.id, raw), eq(assets.assetId, raw)))
    .limit(1);
  return row?.id ?? raw;
}

export async function findBlockingRentInvoiceForPremisesMonth(
  assetId: string,
  periodMonth: string,
  excludeInvoiceId?: string | null,
): Promise<{ id: string; invoiceNo: string | null } | null> {
  const pm = String(periodMonth ?? "").trim();
  const keys = await assetIdKeysForPremisesLookup(assetId);
  if (!keys.length || !pm) return null;
  const parts = [
    inArray(rentInvoices.assetId, keys),
    eq(rentInvoices.periodMonth, pm),
    ne(rentInvoices.status, "Cancelled"),
  ];
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
