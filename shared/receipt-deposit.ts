/**
 * M-05 §8.4 — Receipt deposit and settlement workflow (FR-RCP-010–014).
 */

export const RECEIPT_DEPOSIT_STATUSES = [
  "Undeposited",
  "DepositedPendingVerification",
  "DepositVerified",
  "DepositSettled",
  "AutoSettled",
  "NotCleared",
] as const;

export type ReceiptDepositStatus = (typeof RECEIPT_DEPOSIT_STATUSES)[number];

export const DEPOSIT_RECORD_STATUSES = [
  "DepositedPendingVerification",
  "VerifiedPendingApproval",
  "ApprovedSettled",
  "Rejected",
  "Reversed",
] as const;

export type DepositRecordStatus = (typeof DEPOSIT_RECORD_STATUSES)[number];

/** Cash and cheque (and DD) require physical bank deposit per BR-RCP-34. */
export function isPhysicalDepositPaymentMode(paymentMode: string | null | undefined): boolean {
  const m = String(paymentMode ?? "").trim();
  return m === "Cash" || m === "Cheque" || m === "DD";
}

/** Initial deposit status when a counter receipt becomes Paid. */
export function initialDepositStatusForPaymentMode(paymentMode: string | null | undefined): ReceiptDepositStatus {
  return isPhysicalDepositPaymentMode(paymentMode) ? "Undeposited" : "AutoSettled";
}

/** Ledger / invoice settlement applies only after bank deposit is cleared (or auto-settled online). */
export function depositStatusAllowsLedgerPosting(
  depositStatus: string | null | undefined,
): boolean {
  const s = String(depositStatus ?? "").trim();
  if (!s) return true; // legacy rows before migration
  return s === "AutoSettled" || s === "DepositSettled";
}

export function daysSinceIssueYmd(createdAt: string | null | undefined, asOf = new Date()): number {
  const d = String(createdAt ?? "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return 0;
  const t0 = Date.UTC(
    Number(d.slice(0, 4)),
    Number(d.slice(5, 7)) - 1,
    Number(d.slice(8, 10)),
  );
  const t1 = Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate());
  return Math.max(0, Math.floor((t1 - t0) / 86400000));
}
