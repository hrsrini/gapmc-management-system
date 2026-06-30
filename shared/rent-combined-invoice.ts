/**
 * M-03 combined tax invoice bundle (multiple premises, same billing month).
 */
export const RENT_COMBINED_INVOICE_NO_SUFFIX = "-CMB";

export type RentCombinedInvoiceAllocation = {
  invoiceId: string;
  amount: number;
};

export type M03CombinedBundleReceiptBreakdown = {
  combinedBundleId: string;
  invoiceAllocations: RentCombinedInvoiceAllocation[];
};

export function parseM03CombinedBundleBreakdown(
  json: string | null | undefined,
): M03CombinedBundleReceiptBreakdown | null {
  if (json == null || String(json).trim() === "") return null;
  try {
    const o = JSON.parse(String(json)) as Record<string, unknown>;
    const bundleId = String(o.combinedBundleId ?? "").trim();
    const raw = o.invoiceAllocations;
    if (!bundleId || !Array.isArray(raw)) return null;
    const invoiceAllocations = raw
      .map((row) => {
        const r = row as Record<string, unknown>;
        const invoiceId = String(r.invoiceId ?? "").trim();
        const amount = Number(r.amount);
        if (!invoiceId || !Number.isFinite(amount) || amount <= 0) return null;
        return { invoiceId, amount: Math.round(amount * 100) / 100 };
      })
      .filter((x): x is RentCombinedInvoiceAllocation => x != null);
    if (invoiceAllocations.length === 0) return null;
    return { combinedBundleId: bundleId, invoiceAllocations };
  } catch {
    return null;
  }
}

export function stringifyM03CombinedBundleBreakdown(b: M03CombinedBundleReceiptBreakdown): string {
  return JSON.stringify(b);
}
