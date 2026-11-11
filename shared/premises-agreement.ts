/**
 * Multi-premises allotment / renewal / notice helpers (Agreement Renewal + Multi-Premises FRD).
 */

export const AGREEMENT_RENEWAL_STATUSES = [
  "Active",
  "RenewalDue",
  "NoticeGenerated",
  "RenewalInitiated",
  "RenewalPending",
  "Renewed",
  "Expired",
  "PenaltyApplicable",
  "RentRevisionPending",
] as const;
export type AgreementRenewalStatus = (typeof AGREEMENT_RENEWAL_STATUSES)[number];

export const AGREEMENT_RENEWAL_STATUS_LABELS: Record<AgreementRenewalStatus, string> = {
  Active: "Active",
  RenewalDue: "Renewal Due",
  NoticeGenerated: "Notice Generated",
  RenewalInitiated: "Renewal Initiated",
  RenewalPending: "Renewal Pending",
  Renewed: "Renewed",
  Expired: "Expired",
  PenaltyApplicable: "Penalty Applicable",
  RentRevisionPending: "Rent Revision Pending",
};

export const AGREEMENT_APPROVAL_STATUSES = ["Draft", "Verified", "Approved", "Rejected"] as const;
export type AgreementApprovalStatus = (typeof AGREEMENT_APPROVAL_STATUSES)[number];

export const LINE_TENANCY_STATUSES = ["Pending", "Active", "Vacating", "Vacated"] as const;
export type LineTenancyStatus = (typeof LINE_TENANCY_STATUSES)[number];

export const PENALTY_METHODS = [
  "FixedPerDay",
  "FixedAmountPerDay",
  "Flat",
  "PercentOfMonthlyRent",
  "PerDayOfRent",
] as const;
export type PenaltyMethod = (typeof PENALTY_METHODS)[number];

/** True when Renew / Notice may open (from 2 months before expiry, and after expiry). */
export function isRenewalWindowOpen(daysToExpiry: number | null | undefined): boolean {
  return daysToExpiry != null && Number.isFinite(daysToExpiry) && daysToExpiry <= RENEWAL_WINDOW_DAYS;
}

export const VACATION_CASES = ["PrematureIntimation", "EndDateVacation", "EvictionByOrder"] as const;
export type VacationCase = (typeof VACATION_CASES)[number];

/** Days before expiry when Renew / Notice become available (§2.3, §3.1). */
export const RENEWAL_WINDOW_DAYS = 60;

function parseYmd(ymd: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd ?? "").trim().slice(0, 10));
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { y, m: mo, d };
}

export function daysBetweenYmd(fromYmd: string, toYmd: string): number | null {
  const a = parseYmd(fromYmd);
  const b = parseYmd(toYmd);
  if (!a || !b) return null;
  const t0 = Date.UTC(a.y, a.m - 1, a.d);
  const t1 = Date.UTC(b.y, b.m - 1, b.d);
  return Math.round((t1 - t0) / 86_400_000);
}

export function addDaysYmd(ymd: string, days: number): string | null {
  const a = parseYmd(ymd);
  if (!a) return null;
  const dt = new Date(Date.UTC(a.y, a.m - 1, a.d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** Inclusive tenure days of prior agreement; used to propose next to-date. */
export function proposedRenewalToDate(fromYmd: string, priorFrom: string, priorTo: string): string | null {
  const span = daysBetweenYmd(priorFrom, priorTo);
  if (span == null || span < 0) return null;
  return addDaysYmd(fromYmd, span);
}

/**
 * Revision due at start of period (frequency + 1), then every `frequency` periods.
 * Examples: frequency 3 → periods 4, 7, 10…; frequency 5 → 6, 11, 16…
 */
export function isRentRevisionDueForPeriod(periodNumber: number, frequency: number): boolean {
  const p = Math.floor(Number(periodNumber) || 0);
  const f = Math.floor(Number(frequency) || 0);
  if (p < 1 || f < 1) return false;
  if (p < f + 1) return false;
  return (p - (f + 1)) % f === 0;
}

export function deriveComputedRenewalStatus(args: {
  agreementTo: string;
  asOfYmd: string;
  storedStatus?: string | null;
  approvalStatus?: string | null;
}): AgreementRenewalStatus {
  const stored = String(args.storedStatus ?? "").trim();
  // Workflow statuses that must not be overwritten by date derivation.
  if (
    stored === "NoticeGenerated" ||
    stored === "RenewalInitiated" ||
    stored === "RenewalPending" ||
    stored === "Renewed" ||
    stored === "RentRevisionPending" ||
    stored === "PenaltyApplicable"
  ) {
    return stored as AgreementRenewalStatus;
  }
  if (String(args.approvalStatus ?? "") !== "Approved") {
    return "Active";
  }
  const daysLeft = daysBetweenYmd(args.asOfYmd, args.agreementTo);
  if (daysLeft == null) return "Active";
  if (daysLeft < 0) return "Expired";
  if (daysLeft <= RENEWAL_WINDOW_DAYS) return "RenewalDue";
  return "Active";
}

export function canGenerateRenewalNotice(status: string): boolean {
  return status === "Active" || status === "RenewalDue" || status === "NoticeGenerated" || status === "Expired";
}

export function canStartRenewal(status: string): boolean {
  return (
    status === "Active" ||
    status === "RenewalDue" ||
    status === "NoticeGenerated" ||
    status === "Expired" ||
    status === "PenaltyApplicable" ||
    status === "RenewalInitiated" ||
    status === "RenewalPending" ||
    status === "RentRevisionPending"
  );
}

export function noticeDisabledByRenewal(status: string): boolean {
  return (
    status === "RenewalInitiated" ||
    status === "RenewalPending" ||
    status === "Renewed" ||
    status === "RentRevisionPending"
  );
}

/** Split total SD by area; last line absorbs rounding remainder. */
export function splitDepositByArea(
  totalDeposit: number,
  areas: number[],
): number[] {
  const total = Number(totalDeposit) || 0;
  const safeAreas = areas.map((a) => Math.max(0, Number(a) || 0));
  const sum = safeAreas.reduce((s, a) => s + a, 0);
  if (areas.length === 0) return [];
  if (sum <= 0) {
    const even = Math.round((total / areas.length) * 100) / 100;
    const out = areas.map(() => even);
    const drift = Math.round((total - out.reduce((s, x) => s + x, 0)) * 100) / 100;
    out[out.length - 1] = Math.round((out[out.length - 1]! + drift) * 100) / 100;
    return out;
  }
  const out = safeAreas.map((a) => Math.round(((total * a) / sum) * 100) / 100);
  const drift = Math.round((total - out.reduce((s, x) => s + x, 0)) * 100) / 100;
  out[out.length - 1] = Math.round((out[out.length - 1]! + drift) * 100) / 100;
  return out;
}

export function calculateDelayPenalty(args: {
  method: string;
  rate: number;
  daysOfDelay: number;
  monthlyRentTotal: number;
}): number {
  const rate = Number(args.rate) || 0;
  const days = Math.max(0, Math.floor(Number(args.daysOfDelay) || 0));
  const rent = Number(args.monthlyRentTotal) || 0;
  if (args.method === "Flat") return Math.round(rate * 100) / 100;
  if (args.method === "FixedPerDay" || args.method === "FixedAmountPerDay") {
    return Math.round(rate * days * 100) / 100;
  }
  if (args.method === "PercentOfMonthlyRent") return Math.round(rent * (rate / 100) * 100) / 100;
  if (args.method === "PerDayOfRent") {
    const perDay = rent / 30;
    return Math.round(perDay * rate * days * 100) / 100;
  }
  return 0;
}

export function normalizeAgreementRenewalStatus(v: unknown): AgreementRenewalStatus | null {
  const s = String(v ?? "").trim();
  return (AGREEMENT_RENEWAL_STATUSES as readonly string[]).includes(s)
    ? (s as AgreementRenewalStatus)
    : null;
}
