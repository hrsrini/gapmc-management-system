/**
 * M-03 rent tax invoice numbers: stable, unique per `rent_invoices.id`, human-readable in UI/receipts.
 * Format: M03/{yardCode}/{YYYY-MM}/{invoiceId}
 */

function sanitizeYardCode(code: string | null | undefined): string {
  const t = String(code ?? "").trim().replace(/[^\w-]+/g, "");
  return (t || "YARD").slice(0, 12);
}

function sanitizePeriodMonth(periodMonth: string | null | undefined): string {
  const t = String(periodMonth ?? "").trim().replace(/[^\d-]/g, "");
  return t || "0000-00";
}

/** Build invoice number from yard code, accrual month, and primary key (guaranteed unique). */
export function formatRentInvoiceNo(
  yardCode: string | null | undefined,
  periodMonth: string | null | undefined,
  invoiceId: string,
): string {
  return `M03/${sanitizeYardCode(yardCode)}/${sanitizePeriodMonth(periodMonth)}/${invoiceId}`;
}
