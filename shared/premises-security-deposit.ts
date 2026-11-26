/** M-02 godown premises security deposit + refund shared helpers. */

export const SD_DEPOSIT_STATUSES = ["Held", "Reserved", "Refunded"] as const;
export type SdDepositStatus = (typeof SD_DEPOSIT_STATUSES)[number];

export const SD_REFUND_PROPOSAL_STATUSES = [
  "Draft",
  "PendingVerification",
  "PendingApproval",
  "Approved",
  "ReturnedToDO",
  "Rejected",
  "Completed",
] as const;
export type SdRefundProposalStatus = (typeof SD_REFUND_PROPOSAL_STATUSES)[number];

export const M02_SECDEP_CONSOLIDATED_KIND = "M02_SECDEP_CONSOLIDATED" as const;

export type M02SecdepConsolidatedLine = {
  depositId: string;
  assetId: string;
  premisesLabel: string;
  amount: number;
};

export type M02SecdepConsolidatedBreakdown = {
  kind: typeof M02_SECDEP_CONSOLIDATED_KIND;
  lines: M02SecdepConsolidatedLine[];
};

export const M02_SECREF_KIND = "M02_SECREF" as const;

export type M02SecrefBreakdown = {
  kind: typeof M02_SECREF_KIND;
  proposalId: string;
  proposalNo: string;
  deposits: Array<{
    depositId: string;
    premisesLabel: string;
    depositReceiptNo: string | null;
    depositReceiptDate: string | null;
    amount: number;
  }>;
  deductions: Array<{ reason: string; amount: number }>;
  selectedDepositTotal: number;
  deductionsTotal: number;
  netPayable: number;
};

export function parseM02SecdepBreakdown(json: string | null | undefined): M02SecdepConsolidatedBreakdown | null {
  if (!json?.trim()) return null;
  try {
    const o = JSON.parse(json) as Record<string, unknown>;
    if (o.kind !== M02_SECDEP_CONSOLIDATED_KIND) return null;
    const lines = Array.isArray(o.lines) ? o.lines : [];
    return {
      kind: M02_SECDEP_CONSOLIDATED_KIND,
      lines: lines
        .map((row) => {
          const r = row as Record<string, unknown>;
          return {
            depositId: String(r.depositId ?? ""),
            assetId: String(r.assetId ?? ""),
            premisesLabel: String(r.premisesLabel ?? ""),
            amount: Number(r.amount ?? 0),
          };
        })
        .filter((l) => l.depositId && Number.isFinite(l.amount) && l.amount > 0),
    };
  } catch {
    return null;
  }
}

export function parseM02SecrefBreakdown(json: string | null | undefined): M02SecrefBreakdown | null {
  if (!json?.trim()) return null;
  try {
    const o = JSON.parse(json) as Record<string, unknown>;
    if (o.kind !== M02_SECREF_KIND) return null;
    return o as unknown as M02SecrefBreakdown;
  } catch {
    return null;
  }
}

export function computeSdRefundNet(selectedTotal: number, deductionsTotal: number): number {
  const sel = Math.round(Math.max(0, Number(selectedTotal) || 0) * 100) / 100;
  const ded = Math.round(Math.max(0, Number(deductionsTotal) || 0) * 100) / 100;
  return Math.round((sel - ded) * 100) / 100;
}

export function financialYearLabel(d = new Date()): string {
  const y = d.getFullYear();
  const m = d.getMonth();
  if (m >= 3) return `${y}-${String(y + 1).slice(-2)}`;
  return `${y - 1}-${String(y).slice(-2)}`;
}
