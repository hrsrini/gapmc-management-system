/** M-02 Premises Register — shared API types and date helpers. */

import type { PremisesStatus } from "./premises-allocation";

export const AGREEMENT_EXPIRY_FILTER_VALUES = ["all", "next60", "next30", "expired"] as const;
export type AgreementExpiryFilter = (typeof AGREEMENT_EXPIRY_FILTER_VALUES)[number];

export type PremisesAllotmentSource = "trader" | "entity";

export interface PremisesRegisterRow {
  id: string;
  assetId: string;
  yardId: string;
  yardName: string;
  assetType: string;
  area: string | null;
  premisesStatus: PremisesStatus;
  currentAllottee: string | null;
  agreementFrom: string | null;
  agreementTo: string | null;
  monthlyRent: number | null;
  renewalCount: number | null;
  allotmentId: string | null;
  allotmentSource: PremisesAllotmentSource | null;
}

export interface PremisesRegisterAlert {
  id: string;
  assetId: string;
  yardId: string;
  yardName: string;
  assetType: string;
  currentAllottee: string;
  agreementTo: string;
  daysLeft: number;
  monthlyRent: number | null;
  allotmentId: string | null;
}

export interface PremisesRegisterResponse {
  rows: PremisesRegisterRow[];
  alerts: PremisesRegisterAlert[];
  allotteeOptions: string[];
}

function parseYmd(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? "").trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo, d));
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}

export function daysBetweenYmd(fromYmd: string, toYmd: string): number | null {
  const a = parseYmd(fromYmd);
  const b = parseYmd(toYmd);
  if (!a || !b) return null;
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

export function addDaysYmd(ymd: string, days: number): string | null {
  const d = parseYmd(ymd);
  if (!d) return null;
  d.setUTCDate(d.getUTCDate() + days);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export function normalizeAgreementExpiryFilter(v: unknown): AgreementExpiryFilter {
  const s = String(v ?? "").trim();
  return (AGREEMENT_EXPIRY_FILTER_VALUES as readonly string[]).includes(s)
    ? (s as AgreementExpiryFilter)
    : "all";
}
