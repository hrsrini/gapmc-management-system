import type { InferSelectModel } from "drizzle-orm";
import { rentInvoices } from "@shared/db-schema";
import { computeRentInvoiceGstInr, rentInvoiceTotalInr } from "@shared/rent-invoice-gst";

type RentInvoiceRow = InferSelectModel<typeof rentInvoices>;

function parseNonGstSum(json: string | null | undefined): number {
  if (json == null || String(json).trim() === "") return 0;
  try {
    const arr = JSON.parse(String(json)) as unknown;
    if (!Array.isArray(arr)) return 0;
    return arr.reduce((s, o) => {
      const amt = Number((o as { amount?: unknown }).amount);
      return s + (Number.isFinite(amt) && amt > 0 ? amt : 0);
    }, 0);
  } catch {
    return 0;
  }
}

/** Fill CGST/SGST/total on read when invoice row omitted tax (non-exempt rent). */
export function withResolvedRentInvoiceGst<T extends RentInvoiceRow>(
  invoice: T,
  cgstPercent: number,
  sgstPercent: number,
): T {
  if (Boolean(invoice.isGovtEntity)) return invoice;
  const rent = Number(invoice.rentAmount ?? 0);
  const cgst = Number(invoice.cgst ?? 0);
  const sgst = Number(invoice.sgst ?? 0);
  if (rent < 0.005 || cgst >= 0.005 || sgst >= 0.005) return invoice;
  const g = computeRentInvoiceGstInr(rent, false, cgstPercent, sgstPercent);
  if (g.cgst < 0.005 && g.sgst < 0.005) return invoice;
  const nonGst = parseNonGstSum(invoice.nonGstChargesJson);
  const totalAmount = rentInvoiceTotalInr(rent, nonGst, g.cgst, g.sgst);
  return { ...invoice, cgst: g.cgst, sgst: g.sgst, totalAmount };
}
