/**
 * M-03: Rent invoices must have positive rent and positive total (aligned with cron allotment gate).
 */

/** Same threshold as cron `configuredRent` / `baseRentNum` checks (exclude negligible / zero). */
export const MIN_RENT_INVOICE_AMOUNT_INR = 0.01;

export const RENT_INVOICE_ZERO_RENT_MSG =
  "Rent amount must be greater than zero. Invoices with zero rent cannot be created.";

export const RENT_INVOICE_ZERO_TOTAL_MSG =
  "Invoice total must be greater than zero. Invoices with zero value cannot be created.";

export function rentInvoiceAmountsInvalid(rentAmount: number, totalAmount: number): boolean {
  const r = Number(rentAmount);
  const t = Number(totalAmount);
  return (
    !Number.isFinite(r) ||
    r <= MIN_RENT_INVOICE_AMOUNT_INR ||
    !Number.isFinite(t) ||
    t <= MIN_RENT_INVOICE_AMOUNT_INR
  );
}

/** First failing rule only (for API error message). */
export function rentInvoiceValidationErrorMessage(rentAmount: number, totalAmount: number): string | null {
  const r = Number(rentAmount);
  const t = Number(totalAmount);
  if (!Number.isFinite(r) || r <= MIN_RENT_INVOICE_AMOUNT_INR) return RENT_INVOICE_ZERO_RENT_MSG;
  if (!Number.isFinite(t) || t <= MIN_RENT_INVOICE_AMOUNT_INR) return RENT_INVOICE_ZERO_TOTAL_MSG;
  return null;
}
