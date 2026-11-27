/**
 * Case E (Transit through Goa) Security Deposit (Market Fee) — config helpers + receipt breakdown.
 * Distinct from premises godown SECDEP/SECREF.
 */

import { SYSTEM_CONFIG_DEFAULTS, type SystemConfigKey } from "./system-config-defaults";

export const CASE_E_SDEP_BREAKDOWN_KIND = "M04_CASE_E_SDEP" as const;
export const CASE_E_SDRF_BREAKDOWN_KIND = "M04_CASE_E_SDRF" as const;

/** Tally / books accounting head for Check Post Security Deposit (Market Fee). */
export const CASE_E_SD_ACCOUNTING_HEAD = "Security Deposit (Market Fee)" as const;
/** IOMS revenue head stored on SDEP receipts (maps to CASE_E_SD_ACCOUNTING_HEAD via Tally map). */
export const CASE_E_SD_REVENUE_HEAD = "CaseESecurityDeposit" as const;
/** IOMS revenue head for SDRF refund receipts. */
export const CASE_E_SD_REFUND_REVENUE_HEAD = "CaseESecurityDepositRefund" as const;

export type CaseESdDepositStatus = "Refunded" | "Forfeited" | "Open";

export type CaseESdConfig = {
  validityHours: number;
  validityMinutes: number;
  /** Total validity in milliseconds. */
  validityMs: number;
  /** Human label e.g. "6 hours 00 minutes". */
  validityLabel: string;
  sdCeiling: number;
  adminCharges: number;
};

function parseNonNegInt(raw: string | null | undefined, fallback: number, max?: number): number {
  const n = Number.parseInt(String(raw ?? "").trim(), 10);
  if (!Number.isFinite(n) || n < 0) return fallback;
  if (max != null && n > max) return max;
  return n;
}

function parseMoney(raw: string | null | undefined, fallback: number): number {
  const n = Number.parseFloat(String(raw ?? "").trim());
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.round(n * 100) / 100;
}

export function formatCaseEValidityLabel(hours: number, minutes: number): string {
  const h = Math.max(0, Math.floor(hours));
  const m = Math.max(0, Math.min(59, Math.floor(minutes)));
  return `${h} hour${h === 1 ? "" : "s"} ${String(m).padStart(2, "0")} minute${m === 1 ? "" : "s"}`;
}

export function parseCaseESdConfig(
  map: Partial<Record<SystemConfigKey, string>> | Record<string, string> | null | undefined,
): CaseESdConfig {
  const hours = parseNonNegInt(
    map?.case_e_sd_refund_validity_hours,
    Number.parseInt(SYSTEM_CONFIG_DEFAULTS.case_e_sd_refund_validity_hours, 10) || 6,
  );
  const minutes = parseNonNegInt(
    map?.case_e_sd_refund_validity_minutes,
    Number.parseInt(SYSTEM_CONFIG_DEFAULTS.case_e_sd_refund_validity_minutes, 10) || 0,
    59,
  );
  const sdCeiling = parseMoney(
    map?.case_e_sd_ceiling,
    Number.parseFloat(SYSTEM_CONFIG_DEFAULTS.case_e_sd_ceiling) || 1000,
  );
  const adminCharges = parseMoney(
    map?.case_e_admin_charges,
    Number.parseFloat(SYSTEM_CONFIG_DEFAULTS.case_e_admin_charges) || 100,
  );
  const validityMs = (hours * 60 + minutes) * 60 * 1000;
  return {
    validityHours: hours,
    validityMinutes: minutes,
    validityMs,
    validityLabel: formatCaseEValidityLabel(hours, minutes),
    sdCeiling,
    adminCharges,
  };
}

/**
 * Refundable SD = min(commodity market fee total, ceiling), then rounded **up** to a whole rupee.
 * Example: market fee ₹27.50 with ceiling ₹1,000 → SD ₹28.
 */
export function computeCaseESecurityDepositAmount(totalMarketFee: number, ceiling: number): number {
  const fee = Math.round(Math.max(0, Number(totalMarketFee) || 0) * 100) / 100;
  const cap = Math.round(Math.max(0, Number(ceiling) || 0) * 100) / 100;
  if (fee <= 0 || cap <= 0) return 0;
  const capped = Math.min(fee, cap);
  return Math.ceil(capped - 1e-9);
}

export function latestExitInstantIso(generatedAt: Date, validityMs: number): string {
  return new Date(generatedAt.getTime() + Math.max(0, validityMs)).toISOString();
}

export type CaseECommodityPdfLine = {
  commodityName: string;
  unit: string;
  quantity: number;
  ratePerUnit: number;
  commodityValue: number;
  marketFee: number;
};

export type CaseESdepBreakdown = {
  kind: typeof CASE_E_SDEP_BREAKDOWN_KIND;
  checkPostName: string;
  vehicleNumber?: string | null;
  vehicleType?: string | null;
  fromLabel?: string | null;
  toLabel?: string | null;
  securityDepositAmount: number;
  adminChargesAmount: number;
  totalCollected: number;
  validityLabel: string;
  latestExitAtIso: string;
  commodities: CaseECommodityPdfLine[];
};

export type CaseESdrfBreakdown = {
  kind: typeof CASE_E_SDRF_BREAKDOWN_KIND;
  refundCheckPostName: string;
  originalReceiptNo: string;
  entryCheckPostName: string;
  entryAtIso: string;
  exitAtIso: string;
  timeTakenLabel: string;
  validityLabel: string;
  eligible: boolean;
  securityDepositCollected: number;
  securityDepositRefunded: number;
  adminChargesRetained: number;
  totalCollected: number;
  commodities: CaseECommodityPdfLine[];
};

export function buildCaseESdepBreakdownJson(b: CaseESdepBreakdown): string {
  return JSON.stringify(b);
}

export function buildCaseESdrfBreakdownJson(b: CaseESdrfBreakdown): string {
  return JSON.stringify(b);
}

export function parseCaseESdepBreakdown(raw: string | null | undefined): CaseESdepBreakdown | null {
  if (!raw?.trim()) return null;
  try {
    const j = JSON.parse(raw) as CaseESdepBreakdown;
    if (j?.kind !== CASE_E_SDEP_BREAKDOWN_KIND) return null;
    return j;
  } catch {
    return null;
  }
}

export function parseCaseESdrfBreakdown(raw: string | null | undefined): CaseESdrfBreakdown | null {
  if (!raw?.trim()) return null;
  try {
    const j = JSON.parse(raw) as CaseESdrfBreakdown;
    if (j?.kind !== CASE_E_SDRF_BREAKDOWN_KIND) return null;
    return j;
  } catch {
    return null;
  }
}
