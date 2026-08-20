/**
 * M-08 Works Work-Order business rules (confirmed client decisions).
 */
export const WORKS_ADVANCE_CAP_PERCENT = 10;

export function woAmountBaseExclGst(work: {
  woAmountExclGst?: number | null;
  tenderValue?: number | null;
  estimateAmount?: number | null;
}): number {
  const wo = Number(work.woAmountExclGst ?? 0);
  if (wo > 0) return wo;
  const tender = Number(work.tenderValue ?? 0);
  if (tender > 0) return tender;
  return Number(work.estimateAmount ?? 0);
}

export function maxMobilizationAdvance(work: {
  woAmountExclGst?: number | null;
  tenderValue?: number | null;
  estimateAmount?: number | null;
}): number {
  return (woAmountBaseExclGst(work) * WORKS_ADVANCE_CAP_PERCENT) / 100;
}

/** Bill total = taxable + GST (single GST amount in v1). */
export function computeBillGst(params: {
  taxableAmount: number;
  gstPercent: number;
}): { gstAmount: number; total: number } {
  const taxable = Math.max(0, Number(params.taxableAmount) || 0);
  const pct = Math.max(0, Number(params.gstPercent) || 0);
  const gstAmount = Math.round(taxable * pct) / 100;
  return { gstAmount, total: Math.round((taxable + gstAmount) * 100) / 100 };
}

export function isWorkAmendable(status: string): boolean {
  return status === "Draft" || status === "Verified";
}

export function isWorkApprovedForChildDocs(status: string): boolean {
  return status === "Approved" || status === "Completed" || status === "Closed";
}

export function isBillLocked(status: string, lockedAt?: string | null): boolean {
  return status === "Locked" || Boolean(lockedAt);
}
