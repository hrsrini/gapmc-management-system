/**
 * Common invoice rounding: final payable to nearest whole rupee (0.50 rounds up).
 * Does not alter taxable value / CGST / SGST — apply only after all components are totalled.
 */

export type InvoiceRoundingType = "Addition" | "Discount" | "NoRounding";

export type InvoiceRoundingResult = {
  /** Invoice total before rounding (2-decimal INR). */
  originalAmount: number;
  /** Signed adjustment: + addition, − discount, 0 none. */
  roundingAmount: number;
  finalAmount: number;
  roundingType: InvoiceRoundingType;
};

/** Paise-safe 2-decimal INR. */
export function roundInr2(amount: number): number {
  const n = Number(amount);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

/**
 * Round final invoice amount to nearest rupee.
 * ₹0.01–0.49 → down; ₹0.50–0.99 → up (JS Math.round for non-negative amounts).
 */
export function applyInvoiceNearestRupeeRounding(originalInvoiceAmount: number): InvoiceRoundingResult {
  const originalAmount = roundInr2(originalInvoiceAmount);
  if (!(originalAmount > 0)) {
    return {
      originalAmount: originalAmount < 0 ? 0 : originalAmount,
      roundingAmount: 0,
      finalAmount: originalAmount < 0 ? 0 : originalAmount,
      roundingType: "NoRounding",
    };
  }
  const finalAmount = Math.round(originalAmount);
  const roundingAmount = roundInr2(finalAmount - originalAmount);
  let roundingType: InvoiceRoundingType = "NoRounding";
  if (roundingAmount > 0) roundingType = "Addition";
  else if (roundingAmount < 0) roundingType = "Discount";
  return { originalAmount, roundingAmount, finalAmount, roundingType };
}

/** Format Rounding Off cell: +0.20 / -0.10 / 0.00 */
export function formatInvoiceRoundingOffAmount(roundingAmount: number): string {
  const a = roundInr2(roundingAmount);
  const abs = Math.abs(a).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (a > 0) return `+${abs}`;
  if (a < 0) return `-${abs}`;
  return abs;
}
