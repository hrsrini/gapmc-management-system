/**
 * Delayed rent interest (GAPLMB):
 * Simple interest at configured % p.a. (default 15%), on monthly rent R,
 * using slab months N (0 / 0.5 / 1), then round the total once **up** to a whole rupee.
 *
 * Interest = CEIL(R × rate × N / 1200)
 * Due date = 10th of the month after the rent period month.
 */

const DEFAULT_RATE_PERCENT = 15;

/** Normalize period to `YYYY-MM` (accepts YYYY-MM, YYYY-MM-DD, DD-MM-YYYY). */
export function normalizeRentPeriodMonth(periodMonth: string): string | null {
  const t = String(periodMonth ?? "").trim();
  if (/^\d{4}-\d{2}$/.test(t)) return t;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t.slice(0, 7);
  const dmy = /^(\d{2})-(\d{2})-(\d{4})$/.exec(t);
  if (dmy) return `${dmy[3]}-${dmy[2]}`;
  const dmySlash = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t);
  if (dmySlash) return `${dmySlash[3]}-${dmySlash[2]}`;
  return null;
}

/** Calendar date in local timezone as YYYY-MM-DD (avoids UTC day-shift for IST). */
export function todayIsoLocal(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Last day of month for `YYYY-MM` (UTC); null if not in that format. */
export function rentPeriodMonthEndIso(periodMonth: string): string | null {
  const ym = normalizeRentPeriodMonth(periodMonth);
  if (!ym) return null;
  const y = Number(ym.slice(0, 4));
  const mon = Number(ym.slice(5, 7));
  if (mon < 1 || mon > 12) return null;
  const last = new Date(Date.UTC(y, mon, 0));
  return last.toISOString().slice(0, 10);
}

/** Rent due date: 10th of the month following `periodMonth`. */
export function rentInterestDueDateIso(periodMonth: string): string | null {
  const ym = normalizeRentPeriodMonth(periodMonth);
  if (!ym) return null;
  let y = Number(ym.slice(0, 4));
  let mon = Number(ym.slice(5, 7)) + 1;
  if (mon > 12) {
    mon = 1;
    y += 1;
  }
  return `${y}-${String(mon).padStart(2, "0")}-10`;
}

function parseYm(periodMonth: string): { y: number; m: number } | null {
  const ym = normalizeRentPeriodMonth(periodMonth);
  if (!ym) return null;
  return { y: Number(ym.slice(0, 4)), m: Number(ym.slice(5, 7)) };
}

function parseIsoDate(iso: string): { y: number; m: number; d: number } | null {
  const raw = String(iso ?? "").trim();
  // YYYY-MM-DD or full ISO datetime
  let t = raw.slice(0, 10);
  const dmy = /^(\d{2})-(\d{2})-(\d{4})$/.exec(raw.slice(0, 10));
  if (dmy) t = `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  const re = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (!re) return null;
  const y = Number(re[1]);
  const m = Number(re[2]);
  const d = Number(re[3]);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return { y, m, d };
}

function addMonths(y: number, m: number, delta: number): { y: number; m: number } {
  const idx = y * 12 + (m - 1) + delta;
  return { y: Math.floor(idx / 12), m: (idx % 12) + 1 };
}

/** Inclusive month count from (y1,m1) through (y2,m2). */
function inclusiveMonthCount(y1: number, m1: number, y2: number, m2: number): number {
  return y2 * 12 + m2 - (y1 * 12 + m1) + 1;
}

/**
 * Interest months N for delayed rent.
 * First month after rent period: 1–10 → 0, 11–15 → 0.5, 16–end → 1.
 * Later months: full months from that first month through the month before payment,
 * plus payment-month slab (1–15 → 0.5, 16–end → 1).
 */
export function computeDelayedRentInterestMonthsN(
  periodMonth: string,
  paymentDateIso: string,
): number {
  const rent = parseYm(periodMonth);
  const pay = parseIsoDate(paymentDateIso);
  if (!rent || !pay) return 0;

  const first = addMonths(rent.y, rent.m, 1);
  const payIdx = pay.y * 12 + pay.m;
  const firstIdx = first.y * 12 + first.m;

  if (payIdx < firstIdx) return 0;

  if (payIdx === firstIdx) {
    if (pay.d <= 10) return 0;
    if (pay.d <= 15) return 0.5;
    return 1;
  }

  const prev = addMonths(pay.y, pay.m, -1);
  const fullMonths = inclusiveMonthCount(first.y, first.m, prev.y, prev.m);
  const slab = pay.d <= 15 ? 0.5 : 1;
  return fullMonths + slab;
}

/**
 * Round interest **up** to a whole rupee for accrual and Outstanding Dues collection.
 * Any positive paise fraction is collected as the next whole rupee (e.g. 166.84 → 167).
 */
export function roundInterestToNearestRupee(amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.ceil(amount - 1e-9);
}

export type DelayedRentInterestResult = {
  nMonths: number;
  interestExact: number;
  interestRounded: number;
  dueDateIso: string | null;
  monthlyInterestOnFullRent: number;
  totalPayable: number;
  ratePercentPerAnnum: number;
};

/**
 * Delayed rent interest: add slab months first, round the total once up to a whole rupee.
 * Compact form: CEIL(R × rate × N / 1200).
 */
export function computeDelayedRentInterest(params: {
  rentAmount: number;
  periodMonth: string;
  asOfDateIso: string;
  percentPerAnnum?: number;
}): DelayedRentInterestResult {
  const rate =
    params.percentPerAnnum != null && Number.isFinite(params.percentPerAnnum)
      ? Number(params.percentPerAnnum)
      : DEFAULT_RATE_PERCENT;
  const R = Number(params.rentAmount);
  const dueDateIso = rentInterestDueDateIso(params.periodMonth);
  const empty: DelayedRentInterestResult = {
    nMonths: 0,
    interestExact: 0,
    interestRounded: 0,
    dueDateIso,
    monthlyInterestOnFullRent: 0,
    totalPayable: Number.isFinite(R) && R > 0 ? R : 0,
    ratePercentPerAnnum: rate,
  };
  if (!Number.isFinite(R) || R <= 0 || rate < 0) return empty;
  if (!normalizeRentPeriodMonth(params.periodMonth)) return empty;

  const monthlyInterestOnFullRent = (R * rate) / 1200;
  const nMonths = computeDelayedRentInterestMonthsN(params.periodMonth, params.asOfDateIso);
  if (nMonths <= 0) {
    return { ...empty, monthlyInterestOnFullRent, totalPayable: R };
  }

  const interestExact = monthlyInterestOnFullRent * nMonths;
  const interestRounded = roundInterestToNearestRupee(interestExact);
  return {
    nMonths,
    interestExact,
    interestRounded,
    dueDateIso,
    monthlyInterestOnFullRent,
    totalPayable: R + interestRounded,
    ratePercentPerAnnum: rate,
  };
}

/**
 * Compatibility wrapper. Prefer {@link computeDelayedRentInterest} with periodMonth.
 * `days` = calendar days past due date (informational).
 */
export function computeRentArrearsSimpleInterest(params: {
  principal: number;
  percentPerAnnum: number;
  dueDateIso: string;
  asOfDateIso: string;
  periodMonth?: string;
}): { days: number; interest: number; nMonths: number } {
  const { principal, percentPerAnnum, dueDateIso, asOfDateIso, periodMonth } = params;
  const due = Date.parse(`${dueDateIso}T00:00:00.000Z`);
  const asOf = Date.parse(`${asOfDateIso}T00:00:00.000Z`);
  const days =
    Number.isFinite(due) && Number.isFinite(asOf)
      ? Math.max(0, Math.floor((asOf - due) / 86_400_000))
      : 0;

  if (periodMonth) {
    const r = computeDelayedRentInterest({
      rentAmount: principal,
      periodMonth,
      asOfDateIso,
      percentPerAnnum,
    });
    return { days, interest: r.interestRounded, nMonths: r.nMonths };
  }

  if (!Number.isFinite(due) || !Number.isFinite(asOf) || principal <= 0 || percentPerAnnum < 0) {
    return { days: 0, interest: 0, nMonths: 0 };
  }
  const raw = (principal * (percentPerAnnum / 100) / 365) * days;
  return { days, interest: roundInterestToNearestRupee(raw), nMonths: 0 };
}
