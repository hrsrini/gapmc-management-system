/**
 * M-03 rent invoice: CGST/SGST on taxable rent (pre-GST base), 2 decimal INR.
 * Percents come from system_config (Admin → Default Values).
 */

/** CGST and SGST in INR from rent base; rounded to 2 decimals each. */
export function computeRentInvoiceGstInr(
  rentAmount: number,
  gstExempt: boolean,
  cgstPercent: number,
  sgstPercent: number,
): { cgst: number; sgst: number } {
  const r = Number(rentAmount);
  if (!Number.isFinite(r) || r <= 0 || gstExempt) return { cgst: 0, sgst: 0 };
  const pc = Number(cgstPercent);
  const ps = Number(sgstPercent);
  const cgstP = Number.isFinite(pc) && pc >= 0 ? pc : 0;
  const sgstP = Number.isFinite(ps) && ps >= 0 ? ps : 0;
  const cgst = Math.round(((r * cgstP) / 100) * 100) / 100;
  const sgst = Math.round(((r * sgstP) / 100) * 100) / 100;
  return { cgst, sgst };
}

export function rentInvoiceTotalInr(rentAmount: number, nonGstSum: number, cgst: number, sgst: number): number {
  const t = Number(rentAmount) + Number(nonGstSum) + Number(cgst) + Number(sgst);
  if (!Number.isFinite(t) || t < 0) return 0;
  return Math.round(t * 100) / 100;
}
