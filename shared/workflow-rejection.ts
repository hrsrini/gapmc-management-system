/**
 * CC-03: DA rejection and DV return — reason codes and minimum remarks (SRS-aligned stub set).
 * Expose codes to clients for dropdowns.
 */
export const REJECTION_REASON_CODES = [
  "INSUFFICIENT_DOCUMENTATION",
  "POLICY_VIOLATION",
  "AMOUNT_OR_BUDGET",
  "TIMING",
  "OTHER",
] as const;

export type RejectionReasonCode = (typeof REJECTION_REASON_CODES)[number];

export const MIN_WORKFLOW_REMARKS_LENGTH = 10;

const CODE_SET = new Set<string>(REJECTION_REASON_CODES);

export function validateDaRejection(body: Record<string, unknown>): { ok: true; code: string; remarks: string } | { ok: false; error: string } {
  const code = String(body.rejectionReasonCode ?? "").trim();
  const remarks = String(body.rejectionRemarks ?? "").trim();
  if (!CODE_SET.has(code)) {
    return {
      ok: false,
      error: `rejectionReasonCode must be one of: ${REJECTION_REASON_CODES.join(", ")}`,
    };
  }
  if (remarks.length < MIN_WORKFLOW_REMARKS_LENGTH) {
    return {
      ok: false,
      error: `rejectionRemarks must be at least ${MIN_WORKFLOW_REMARKS_LENGTH} characters`,
    };
  }
  return { ok: true, code, remarks };
}

export function validateDvReturnToDraft(body: Record<string, unknown>): { ok: true; remarks: string } | { ok: false; error: string } {
  const remarks = String(body.returnRemarks ?? "").trim();
  if (remarks.length < MIN_WORKFLOW_REMARKS_LENGTH) {
    return {
      ok: false,
      error: `returnRemarks must be at least ${MIN_WORKFLOW_REMARKS_LENGTH} characters when moving back to Draft`,
    };
  }
  return { ok: true, remarks };
}
