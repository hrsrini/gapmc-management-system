/**
 * M-03 rent invoice billing: full month, prorated partial month, overstay / fine rent.
 */
import { roundedMoney2 } from "./premises-allocation";

export type RentBillingType = "FullMonth" | "Prorated" | "Overstay";

export type RentDaysBasis = "Calendar" | "Fixed";

export type RentBillingConfigSnapshot = {
  effectiveFrom: string;
  prorataFactor: number;
  prorataDaysBasis: RentDaysBasis;
  prorataFixedDays: number | null;
  overstayFactor: number;
  overstayDaysBasis: RentDaysBasis;
  overstayFixedDays: number | null;
};

export const DEFAULT_RENT_BILLING_CONFIG: RentBillingConfigSnapshot = {
  effectiveFrom: "2020-01-01",
  prorataFactor: 1,
  prorataDaysBasis: "Calendar",
  prorataFixedDays: 30,
  overstayFactor: 2,
  overstayDaysBasis: "Calendar",
  overstayFixedDays: 30,
};

export function isValidYearMonthYm(ym: string): boolean {
  const t = String(ym ?? "").trim();
  const m = /^(\d{4})-(\d{2})$/.exec(t);
  if (!m) return false;
  const mo = Number(m[2]);
  return mo >= 1 && mo <= 12;
}

export function monthCalendarBoundsYm(ym: string): { from: string; to: string; daysInMonth: number } | null {
  if (!isValidYearMonthYm(ym)) return null;
  const [yStr, moStr] = ym.trim().split("-");
  const y = Number(yStr);
  const mo = Number(moStr);
  const last = new Date(y, mo, 0).getDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    from: `${y}-${pad(mo)}-01`,
    to: `${y}-${pad(mo)}-${pad(last)}`,
    daysInMonth: last,
  };
}

export function daysInMonthForBilling(ym: string, basis: RentDaysBasis, fixedDays: number | null): number {
  if (basis === "Fixed" && fixedDays != null && fixedDays > 0) return fixedDays;
  const b = monthCalendarBoundsYm(ym);
  return b?.daysInMonth ?? 30;
}

/** Inclusive day count between two YYYY-MM-DD dates. */
export function inclusiveDaysBetweenYmd(fromYmd: string, toYmd: string): number {
  const from = String(fromYmd).trim().slice(0, 10);
  const to = String(toYmd).trim().slice(0, 10);
  const m1 = /^(\d{4})-(\d{2})-(\d{2})$/.exec(from);
  const m2 = /^(\d{4})-(\d{2})-(\d{2})$/.exec(to);
  if (!m1 || !m2) return 0;
  const d1 = Date.UTC(Number(m1[1]), Number(m1[2]) - 1, Number(m1[3]));
  const d2 = Date.UTC(Number(m2[1]), Number(m2[2]) - 1, Number(m2[3]));
  if (d2 < d1) return 0;
  return Math.floor((d2 - d1) / 86400000) + 1;
}

export function clampYmdToRange(ymd: string, minYmd: string, maxYmd: string): string {
  const v = ymd.slice(0, 10);
  if (v < minYmd) return minYmd;
  if (v > maxYmd) return maxYmd;
  return v;
}

export type RentBillingCalculationInput = {
  billingType: RentBillingType;
  periodMonth: string;
  monthlyRent: number;
  agreementFrom: string;
  agreementTo: string;
  occupancyFrom?: string | null;
  occupancyTo?: string | null;
  config: RentBillingConfigSnapshot;
};

export type RentBillingCalculationResult = {
  billingType: RentBillingType;
  periodMonth: string;
  baseMonthlyRent: number;
  daysInMonth: number;
  billableDays: number;
  billingFactor: number;
  rentAmount: number;
  occupancyFrom: string | null;
  occupancyTo: string | null;
  configSnapshot: RentBillingConfigSnapshot;
  summaryLines: Array<{ label: string; value: string }>;
};

export function calculateRentBillingAmount(input: RentBillingCalculationInput): RentBillingCalculationResult {
  const { billingType, periodMonth, monthlyRent, agreementFrom, agreementTo, config } = input;
  const bounds = monthCalendarBoundsYm(periodMonth);
  if (!bounds) throw new Error("Invalid billing month (YYYY-MM).");

  const monthFrom = bounds.from;
  const monthTo = bounds.to;

  let occupancyFrom: string | null = input.occupancyFrom?.trim().slice(0, 10) || null;
  let occupancyTo: string | null = input.occupancyTo?.trim().slice(0, 10) || null;
  let billableDays = bounds.daysInMonth;
  let billingFactor = 1;
  let rentAmount = monthlyRent;

  if (billingType === "FullMonth") {
    occupancyFrom = monthFrom;
    occupancyTo = monthTo;
    const daysInMonth = daysInMonthForBilling(
      periodMonth,
      config.prorataDaysBasis,
      config.prorataFixedDays,
    );
    billableDays = daysInMonth;
    billingFactor = config.prorataFactor;
    rentAmount = roundedMoney2((monthlyRent / daysInMonth) * daysInMonth * billingFactor);
    // Full month = full monthly rent (factor typically 1)
    rentAmount = roundedMoney2(monthlyRent * billingFactor);
  } else if (billingType === "Prorated") {
    occupancyFrom = occupancyFrom || monthFrom;
    occupancyTo = occupancyTo || monthTo;
    occupancyFrom = clampYmdToRange(occupancyFrom, monthFrom, monthTo);
    occupancyTo = clampYmdToRange(occupancyTo, monthFrom, monthTo);
    const daysInMonth = daysInMonthForBilling(
      periodMonth,
      config.prorataDaysBasis,
      config.prorataFixedDays,
    );
    billableDays = inclusiveDaysBetweenYmd(occupancyFrom, occupancyTo);
    billingFactor = config.prorataFactor;
    rentAmount = roundedMoney2((monthlyRent / daysInMonth) * billableDays * billingFactor);
  } else {
    // Overstay: days after agreement end within billing month
    const agreementEnd = agreementTo.slice(0, 10);
    const dayAfterEnd = addDaysYmd(agreementEnd, 1);
    occupancyFrom = occupancyFrom || (dayAfterEnd > monthFrom ? dayAfterEnd : monthFrom);
    occupancyTo = occupancyTo || monthTo;
    if (occupancyFrom < dayAfterEnd) occupancyFrom = dayAfterEnd;
    occupancyFrom = clampYmdToRange(occupancyFrom, monthFrom, monthTo);
    occupancyTo = clampYmdToRange(occupancyTo, monthFrom, monthTo);
    const daysInMonth = daysInMonthForBilling(
      periodMonth,
      config.overstayDaysBasis,
      config.overstayFixedDays,
    );
    billableDays = inclusiveDaysBetweenYmd(occupancyFrom, occupancyTo);
    billingFactor = config.overstayFactor;
    rentAmount = roundedMoney2((monthlyRent / daysInMonth) * billableDays * billingFactor);
  }

  const daysInMonthDisplay =
    billingType === "Overstay"
      ? daysInMonthForBilling(periodMonth, config.overstayDaysBasis, config.overstayFixedDays)
      : daysInMonthForBilling(periodMonth, config.prorataDaysBasis, config.prorataFixedDays);

  const summaryLines: Array<{ label: string; value: string }> = [
    { label: "Monthly rent", value: String(monthlyRent) },
    { label: "Days in month", value: String(daysInMonthDisplay) },
  ];
  if (billingType === "Prorated") {
    summaryLines.push(
      { label: "Occupied days", value: String(billableDays) },
      { label: "Prorata factor", value: String(billingFactor) },
      { label: "Prorated rent", value: String(rentAmount) },
    );
  } else if (billingType === "Overstay") {
    summaryLines.push(
      { label: "Overstay factor", value: String(billingFactor) },
      { label: "Overstay days", value: String(billableDays) },
      { label: "Fine rent", value: String(rentAmount) },
    );
  } else {
    summaryLines.push({ label: "Rent amount", value: String(rentAmount) });
  }

  return {
    billingType,
    periodMonth,
    baseMonthlyRent: monthlyRent,
    daysInMonth: daysInMonthDisplay,
    billableDays,
    billingFactor,
    rentAmount,
    occupancyFrom,
    occupancyTo,
    configSnapshot: config,
    summaryLines,
  };
}

function addDaysYmd(ymd: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.slice(0, 10));
  if (!m) return ymd;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Pick billing type from agreement vs billing month when user has not chosen. */
export function inferBillingTypeForMonth(args: {
  periodMonth: string;
  agreementFrom: string;
  agreementTo: string;
}): RentBillingType {
  const bounds = monthCalendarBoundsYm(args.periodMonth);
  if (!bounds) return "FullMonth";
  const agrFrom = args.agreementFrom.slice(0, 10);
  const agrTo = args.agreementTo.slice(0, 10);
  const monthEnd = bounds.to;
  const monthStart = bounds.from;
  if (monthEnd > agrTo) return "Overstay";
  if (monthStart < agrFrom || monthEnd > agrTo) return "Prorated";
  if (agrFrom > monthStart || agrTo < monthEnd) return "Prorated";
  return "FullMonth";
}

export function defaultOccupancyForBillingType(args: {
  billingType: RentBillingType;
  periodMonth: string;
  agreementFrom: string;
  agreementTo: string;
}): { occupancyFrom: string; occupancyTo: string } | null {
  const bounds = monthCalendarBoundsYm(args.periodMonth);
  if (!bounds) return null;
  const agrFrom = args.agreementFrom.slice(0, 10);
  const agrTo = args.agreementTo.slice(0, 10);
  if (args.billingType === "FullMonth") {
    return { occupancyFrom: bounds.from, occupancyTo: bounds.to };
  }
  if (args.billingType === "Overstay") {
    const dayAfter = addDaysYmd(agrTo, 1);
    if (dayAfter > bounds.to) return null;
    return {
      occupancyFrom: dayAfter > bounds.from ? dayAfter : bounds.from,
      occupancyTo: bounds.to,
    };
  }
  // Prorated: clip agreement to month
  const from = agrFrom > bounds.from ? agrFrom : bounds.from;
  const to = agrTo < bounds.to ? agrTo : bounds.to;
  if (from > to) return null;
  return { occupancyFrom: from, occupancyTo: to };
}

export function validateRentBillingInput(args: {
  billingType: RentBillingType;
  periodMonth: string;
  agreementFrom: string;
  agreementTo: string;
  occupancyFrom?: string | null;
  occupancyTo?: string | null;
}): string | null {
  const bounds = monthCalendarBoundsYm(args.periodMonth);
  if (!bounds) return "Billing month must be YYYY-MM.";
  const agrFrom = args.agreementFrom.slice(0, 10);
  const agrTo = args.agreementTo.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(agrFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(agrTo)) {
    return "Allotment agreement dates are invalid.";
  }
  if (bounds.to < agrFrom) {
    return "Invoice cannot be generated before the agreement start date.";
  }
  if (args.billingType === "FullMonth") {
    if (bounds.from < agrFrom) {
      return "Full-month billing is not allowed before the agreement starts. Use prorated billing.";
    }
    if (bounds.to > agrTo) {
      return "Full-month billing is not allowed after the agreement ends. Use overstay / fine rent.";
    }
  }
  if (args.billingType === "Prorated") {
    const occFrom = args.occupancyFrom?.slice(0, 10);
    const occTo = args.occupancyTo?.slice(0, 10);
    if (!occFrom || !occTo) return "Occupancy from and to dates are required for prorated billing.";
    if (occFrom > occTo) return "Occupancy to must be on or after occupancy from.";
    if (occFrom < bounds.from || occTo > bounds.to) {
      return "Occupancy dates must fall within the billing month.";
    }
    if (occTo > agrTo) {
      return "Prorated occupancy cannot extend past the agreement end. Use overstay billing for days after expiry.";
    }
    if (occFrom < agrFrom) {
      return "Occupancy cannot start before the agreement start date.";
    }
  }
  if (args.billingType === "Overstay") {
    const occFrom = args.occupancyFrom?.slice(0, 10);
    const occTo = args.occupancyTo?.slice(0, 10);
    if (!occFrom || !occTo) return "Overstay from and to dates are required.";
    if (occFrom <= agrTo) {
      return "Overstay billing applies only to days after the agreement end date.";
    }
    if (occFrom < bounds.from || occTo > bounds.to) {
      return "Overstay dates must fall within the billing month.";
    }
  }
  return null;
}

/** True if two inclusive YMD ranges overlap. */
export function dateRangesOverlap(aFrom: string, aTo: string, bFrom: string, bTo: string): boolean {
  return aFrom <= bTo && bFrom <= aTo;
}
