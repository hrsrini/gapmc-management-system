/** US-M02-003: Premises Allocation Record helpers (entity / Track B). */

import { isTrackBGovtSubType } from "./track-b-entity";

export const AGREEMENT_TYPES = ["RentalAgreement", "LeaseAgreement"] as const;
export type AgreementType = (typeof AGREEMENT_TYPES)[number];

export const RENT_REVISION_MODES = ["StandardConsecutiveRenewal", "PwdCertificate"] as const;
export type RentRevisionMode = (typeof RENT_REVISION_MODES)[number];

export const ENTITY_ALLOTMENT_APPROVAL = ["Draft", "Verified", "Approved", "Rejected"] as const;
export type EntityAllotmentApprovalStatus = (typeof ENTITY_ALLOTMENT_APPROVAL)[number];

export const PREMISES_STATUS_VALUES = [
  "Vacant",
  "Vacating",
  "Allocated",
  "UnsafeForOccupation",
  "Demolished",
] as const;
export type PremisesStatus = (typeof PREMISES_STATUS_VALUES)[number];

const PREMISES_STATUS_LABELS: Record<PremisesStatus, string> = {
  Vacant: "Vacant",
  Vacating: "Vacating",
  Allocated: "Allocated",
  UnsafeForOccupation: "Unsafe for Occupation",
  Demolished: "Demolished",
};

export function premisesStatusLabel(status: string | null | undefined): string {
  const s = String(status ?? "").trim();
  if (s === "Active") return PREMISES_STATUS_LABELS.Vacant;
  if ((PREMISES_STATUS_VALUES as readonly string[]).includes(s)) {
    return PREMISES_STATUS_LABELS[s as PremisesStatus];
  }
  return s || "—";
}

/** True when a new allotment may be created on this premises. */
export function isPremisesVacantForAllotment(status: string | null | undefined): boolean {
  const s = String(status ?? "").trim();
  if (s === "Active") return true;
  return s === "Vacant";
}

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
  if (s === "Active") return "Vacant";
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

/** Local calendar YYYY-MM-DD (runtime default timezone). */
export function localCalendarYmd(d = new Date()): string {
  const y = d.getFullYear();
  return `${y}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Vacated-on (agreement end) must be on or before `todayYmd` (lexicographic YYYY-MM-DD compare). */
export function assertVacatedToDateNotFuture(toYmd: string, todayYmd = todayYmdUtc()): string | null {
  const s = String(toYmd ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "Vacated on must be a valid date (YYYY-MM-DD).";
  if (s > String(todayYmd).trim()) return "Vacated on cannot be later than today.";
  return null;
}

/** Cap vacated-on display/storage to today when agreement `toDate` is still in the future. */
export function capVacatedOnYmd(toYmd: string, todayYmd = todayYmdUtc()): string {
  const s = String(toYmd ?? "").trim().slice(0, 10);
  const today = String(todayYmd).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return today;
  return s > today ? today : s;
}

/** Vacated date for Shop Vacant register: latest Vacated/Vacating row only (not future agreement end). */
export function resolveVacatedDisplayYmd(
  allotments: ReadonlyArray<{ status: string; toDate: string }>,
  todayYmd = todayYmdUtc(),
): string | null {
  const ended = allotments.filter((a) => {
    const st = String(a.status ?? "").trim();
    return st === "Vacated" || st === "Vacating";
  });
  if (ended.length === 0) return null;
  const pick = [...ended].sort((a, b) => String(b.toDate).localeCompare(String(a.toDate)))[0]!;
  return capVacatedOnYmd(pick.toDate, todayYmd);
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
