import { and, eq, gte, inArray, ne, sql } from "drizzle-orm";
import { db } from "./db";
import { rentInvoices, traderLicences } from "@shared/db-schema";
import type { SystemConfigKey } from "@shared/system-config-defaults";
import { getMergedSystemConfig, parseSystemConfigNumber } from "./system-config";
import { isValidYearMonthYm } from "./rent-gstr1";

const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

const THRESHOLD_KEY: SystemConfigKey = "rent_tds_annual_threshold_inr";
const RATE_KEY: SystemConfigKey = "rent_tds_rate_percent";

/** Indian FY starting month (April) as YYYY-MM for the FY that contains `periodMonth` (YYYY-MM). */
export function indianFyStartYmForPeriodMonth(periodMonth: string): string {
  const t = String(periodMonth ?? "").trim();
  const m = /^(\d{4})-(\d{2})$/.exec(t);
  if (!m) return "2000-04";
  const y = Number(m[1]);
  const mon = Number(m[2]);
  if (!Number.isFinite(y) || mon < 1 || mon > 12) return "2000-04";
  const fyStartYear = mon >= 4 ? y : y - 1;
  return `${fyStartYear}-04`;
}

/** Sum `rent_amount` for Approved/Paid invoices in the same Indian FY strictly before `periodMonth`. */
export async function sumApprovedPaidRentYtdBeforeMonth(args: {
  tenantLicenceId: string;
  fyStartYm: string;
  periodMonthExclusive: string;
  excludeInvoiceId?: string;
}): Promise<number> {
  if (!args.tenantLicenceId) return 0;
  const parts = [
    eq(rentInvoices.tenantLicenceId, args.tenantLicenceId),
    gte(rentInvoices.periodMonth, args.fyStartYm),
    sql`${rentInvoices.periodMonth} < ${args.periodMonthExclusive}`,
    inArray(rentInvoices.status, ["Approved", "Paid"]),
  ];
  if (args.excludeInvoiceId) parts.push(ne(rentInvoices.id, args.excludeInvoiceId));
  const [r] = await db
    .select({
      s: sql<number>`coalesce(sum(${rentInvoices.rentAmount}), 0)::double precision`,
    })
    .from(rentInvoices)
    .where(and(...parts));
  return Number(r?.s ?? 0);
}

export async function getTenantLicencePanNormalized(tenantLicenceId: string): Promise<string | null> {
  if (!tenantLicenceId) return null;
  const [row] = await db
    .select({ pan: traderLicences.pan })
    .from(traderLicences)
    .where(eq(traderLicences.id, tenantLicenceId))
    .limit(1);
  const p = row?.pan?.trim().toUpperCase();
  return p || null;
}

export function computeRentTdsForMonthlyInvoice(opts: {
  monthlyRent: number;
  priorYtdApprovedRentInFy: number;
  isGstExemptTenant: boolean;
  panFromLicence: string | null | undefined;
  annualThresholdInr: number;
  tdsRatePercent: number;
}): { ok: true; tdsApplicable: boolean; tdsAmount: number } | { ok: false; message: string } {
  if (opts.isGstExemptTenant) return { ok: true, tdsApplicable: false, tdsAmount: 0 };
  const rent = Number(opts.monthlyRent);
  if (!Number.isFinite(rent) || rent <= 0) return { ok: true, tdsApplicable: false, tdsAmount: 0 };

  const prior = Number(opts.priorYtdApprovedRentInFy);
  const safePrior = Number.isFinite(prior) && prior >= 0 ? prior : 0;
  const threshold = Number(opts.annualThresholdInr);
  const safeThreshold = Number.isFinite(threshold) && threshold > 0 ? threshold : 240_000;

  const annualizedSingleMonth = rent * 12;
  const withCurrent = safePrior + rent;
  const fyAlreadyAtOrOverThreshold = safePrior >= safeThreshold;
  const crossesWithCurrent = withCurrent > safeThreshold;
  const annualizedExceeds = annualizedSingleMonth > safeThreshold;

  const tdsTriggers = annualizedExceeds || crossesWithCurrent || fyAlreadyAtOrOverThreshold;
  if (!tdsTriggers) return { ok: true, tdsApplicable: false, tdsAmount: 0 };

  const pan = String(opts.panFromLicence ?? "")
    .trim()
    .toUpperCase();
  if (!PAN_REGEX.test(pan)) {
    return {
      ok: false,
      message:
        "Valid tenant PAN on the trader licence is required when annualized or FY-to-date rent exceeds the configured TDS threshold (Section 194-I).",
    };
  }
  const rate = Number(opts.tdsRatePercent);
  const safeRate = Number.isFinite(rate) && rate >= 0 ? rate : 10;
  const raw = (rent * safeRate) / 100;
  const tdsAmount = Math.round(raw * 100) / 100;
  return { ok: true, tdsApplicable: true, tdsAmount };
}

export async function resolveRentInvoiceTdsFields(args: {
  tenantLicenceId: string;
  rentAmount: number;
  periodMonth: string;
  isGstExemptTenant: boolean;
  /** When recomputing for an existing invoice, exclude it from YTD so prior months still count. */
  excludeInvoiceId?: string;
}): Promise<{ tdsApplicable: boolean; tdsAmount: number } | { error: string }> {
  if (!isValidYearMonthYm(args.periodMonth)) {
    return { error: "periodMonth must be YYYY-MM for rent TDS (Indian FY cumulative)." };
  }
  const cfg = await getMergedSystemConfig();
  const threshold = parseSystemConfigNumber(cfg, THRESHOLD_KEY);
  const rate = parseSystemConfigNumber(cfg, RATE_KEY);
  const pan = await getTenantLicencePanNormalized(args.tenantLicenceId);
  const fyStart = indianFyStartYmForPeriodMonth(args.periodMonth);
  const priorYtd = await sumApprovedPaidRentYtdBeforeMonth({
    tenantLicenceId: args.tenantLicenceId,
    fyStartYm: fyStart,
    periodMonthExclusive: args.periodMonth,
    excludeInvoiceId: args.excludeInvoiceId,
  });
  const r = computeRentTdsForMonthlyInvoice({
    monthlyRent: args.rentAmount,
    priorYtdApprovedRentInFy: priorYtd,
    isGstExemptTenant: args.isGstExemptTenant,
    panFromLicence: pan,
    annualThresholdInr: threshold,
    tdsRatePercent: rate,
  });
  if (!r.ok) return { error: r.message };
  return { tdsApplicable: r.tdsApplicable, tdsAmount: r.tdsAmount };
}
