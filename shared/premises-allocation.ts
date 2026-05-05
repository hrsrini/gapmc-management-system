/** US-M02-003: Premises Allocation Record helpers (entity / Track B). */

import { isTrackBGovtSubType } from "./track-b-entity";

export const AGREEMENT_TYPES = ["RentalAgreement", "LeaseAgreement"] as const;
export type AgreementType = (typeof AGREEMENT_TYPES)[number];

export const RENT_REVISION_MODES = ["StandardConsecutiveRenewal", "PwdCertificate"] as const;
export type RentRevisionMode = (typeof RENT_REVISION_MODES)[number];

export const ENTITY_ALLOTMENT_APPROVAL = ["Draft", "Verified", "Approved", "Rejected"] as const;
export type EntityAllotmentApprovalStatus = (typeof ENTITY_ALLOTMENT_APPROVAL)[number];

export const PREMISES_STATUS_VALUES = ["Active", "UnsafeForOccupation", "Demolished"] as const;
export type PremisesStatus = (typeof PREMISES_STATUS_VALUES)[number];

/** Tenancy row status (distinct from DO/DV/DA approval_status). */
export const ENTITY_TENANCY_STATUS = ["Pending", "Active", "Vacating", "Vacated"] as const;
export type EntityTenancyStatus = (typeof ENTITY_TENANCY_STATUS)[number];

export function normalizeAgreementType(v: unknown): AgreementType | null {
  const s = String(v ?? "").trim();
  if (s === "RentalAgreement" || s === "LeaseAgreement") return s;
  return null;
}

export function normalizeRentRevisionMode(v: unknown): RentRevisionMode | null {
  const s = String(v ?? "").trim();
  if (s === "StandardConsecutiveRenewal" || s === "PwdCertificate") return s;
  return null;
}

export function normalizePremisesStatus(v: unknown): PremisesStatus | null {
  const s = String(v ?? "").trim();
  if (PREMISES_STATUS_VALUES.includes(s as PremisesStatus)) return s as PremisesStatus;
  return null;
}

export function inferAgreementTypeFromDates(fromYmd: string, toYmd: string): AgreementType {
  const approximateMonthsInclusive = agreementMonthsApproxInclusive(fromYmd, toYmd);
  return approximateMonthsInclusive <= 11 + 1e-9 ? "RentalAgreement" : "LeaseAgreement";
}

/** Approximate calendar months inclusive (from … to inclusive) via day span / avg month length. */
export function agreementMonthsApproxInclusive(fromYmd: string, toYmd: string): number {
  const a = parseYmd(fromYmd);
  const b = parseYmd(toYmd);
  if (!a || !b) return 0;
  const t0 = Date.UTC(a.y, a.m - 1, a.d);
  const t1 = Date.UTC(b.y, b.m - 1, b.d);
  const inclusiveDays = Math.floor((t1 - t0) / 86400000) + 1;
  if (inclusiveDays <= 0) return 0;
  return inclusiveDays / (365.25 / 12);
}

function parseYmd(s: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s).trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  return { y, m: mo, d };
}

/** BR-AST-14–16a: Track B Govt exempt; Commercial / Ad hoc default GST on; Ad hoc may override at draft only in API. */
export function defaultGstApplicableTrackBEntity(subType: string | null | undefined): boolean {
  return !isTrackBGovtSubType(subType);
}

export function todayYmdUtc(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** True if `fromYmd` is strictly before `boundaryYmd` (YYYY-MM-DD). */
export function ymdBefore(a: string, b: string): boolean {
  return String(a).trim() < String(b).trim();
}

/** Calendar day after YMD (UTC date math). */
export function addCalendarDaysYmd(ymd: string, days: number): string | null {
  const p = parseYmd(ymd);
  if (!p) return null;
  const dt = new Date(Date.UTC(p.y, p.m - 1, p.d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

/**
 * Agreement gap vs immediately prior allotment on same premises (vacated chain).
 * Blocks when newFrom > prevTo + 1 day unless DA overrides (E-AST-004 style).
 */
export function hasAgreementCalendarGap(prevToYmd: string, newFromYmd: string): boolean {
  const next = addCalendarDaysYmd(prevToYmd, 1);
  if (!next) return true;
  return newFromYmd > next;
}

export function roundedMoney2(n: number): number {
  return Math.round(n * 100) / 100;
}
