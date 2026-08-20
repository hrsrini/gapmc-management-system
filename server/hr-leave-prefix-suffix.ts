import { db } from "./db";
import { hrHolidays } from "@shared/db-schema";
import { eq, and } from "drizzle-orm";
import { getMergedSystemConfig } from "./system-config";

interface WeeklyOffsMap {
  default: number[];
  [locationType: string]: number[];
}

function parseDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d.getTime());
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}

function getDayOfWeek(d: Date): number {
  return d.getUTCDay(); // 0=Sun..6=Sat
}

/**
 * Get weekly offs for a given location type from system config.
 */
async function getWeeklyOffs(locationType?: string): Promise<number[]> {
  const cfg = await getMergedSystemConfig();
  let map: WeeklyOffsMap;
  try {
    map = JSON.parse(cfg.leave_weekly_offs_json);
  } catch {
    map = { default: [0, 6] };
  }
  if (locationType && map[locationType] !== undefined) {
    return map[locationType];
  }
  return map.default ?? [0, 6];
}

/**
 * Get public holiday dates for a given year from hr_holidays table.
 */
async function getPublicHolidayDates(year: number): Promise<Set<string>> {
  const rows = await db
    .select({ date: hrHolidays.date })
    .from(hrHolidays)
    .where(and(eq(hrHolidays.year, year), eq(hrHolidays.category, "Public")));
  return new Set(rows.map((r) => r.date));
}

function isNonWorkingDay(d: Date, weeklyOffs: number[], publicHolidays: Set<string>): boolean {
  if (weeklyOffs.includes(getDayOfWeek(d))) return true;
  if (publicHolidays.has(isoDate(d))) return true;
  return false;
}

export interface PrefixSuffixResult {
  prefixDays: number;
  suffixDays: number;
  prefixFromDate: string | null;
  suffixToDate: string | null;
}

/**
 * Calculate prefix (non-working days immediately before fromDate) and
 * suffix (non-working days immediately after toDate).
 * For Checkpost employees (no weekly offs), this returns 0/0.
 */
export async function calculatePrefixSuffix(
  fromDate: string,
  toDate: string,
  locationType?: string,
): Promise<PrefixSuffixResult> {
  const weeklyOffs = await getWeeklyOffs(locationType);
  if (weeklyOffs.length === 0) {
    return { prefixDays: 0, suffixDays: 0, prefixFromDate: null, suffixToDate: null };
  }

  const fromYear = Number(fromDate.slice(0, 4));
  const toYear = Number(toDate.slice(0, 4));
  const yearsToFetch = new Set([fromYear, toYear]);
  if (fromYear !== toYear) yearsToFetch.add(fromYear).add(toYear);

  const allPublicHolidays = new Set<string>();
  const yearArr = Array.from(yearsToFetch);
  for (let i = 0; i < yearArr.length; i++) {
    const holidays = await getPublicHolidayDates(yearArr[i]);
    Array.from(holidays).forEach((h) => allPublicHolidays.add(h));
  }

  // Prefix: walk backwards from day before fromDate
  let prefixDays = 0;
  let prefixFromDate: string | null = null;
  let cursor = addDays(parseDate(fromDate), -1);
  while (isNonWorkingDay(cursor, weeklyOffs, allPublicHolidays)) {
    prefixDays++;
    prefixFromDate = isoDate(cursor);
    cursor = addDays(cursor, -1);
  }

  // Suffix: walk forwards from day after toDate
  let suffixDays = 0;
  let suffixToDate: string | null = null;
  cursor = addDays(parseDate(toDate), 1);
  while (isNonWorkingDay(cursor, weeklyOffs, allPublicHolidays)) {
    suffixDays++;
    suffixToDate = isoDate(cursor);
    cursor = addDays(cursor, 1);
  }

  return { prefixDays, suffixDays, prefixFromDate, suffixToDate };
}

/**
 * Calculate debit days based on leave type and request parameters.
 */
export function calculateDebitDays(params: {
  leaveType: string;
  fromDate: string;
  toDate: string;
  halfDay?: string | null;
}): number {
  const { leaveType, fromDate, toDate, halfDay } = params;

  // ML and PL: no balance debit
  if (leaveType === "ML" || leaveType === "PL") return 0;

  // EOL: no balance debit (manual record)
  if (leaveType === "EOL") return 0;

  // Half-day CL
  if (leaveType === "CL" && halfDay) return 0.5;

  // Commuted: 2x from HPL
  if (leaveType === "COMMUTED") {
    const calendarDays = inclusiveCalDays(fromDate, toDate);
    return calendarDays * 2;
  }

  // Default: 1:1 calendar days
  return inclusiveCalDays(fromDate, toDate);
}

function inclusiveCalDays(from: string, to: string): number {
  const d0 = parseDate(from).getTime();
  const d1 = parseDate(to).getTime();
  if (d1 < d0) return 0;
  return Math.round((d1 - d0) / 86400000) + 1;
}

/**
 * Validate a Restricted Holiday date is actually in the RH list for that year.
 */
export async function validateRhDate(date: string): Promise<boolean> {
  const year = Number(date.slice(0, 4));
  const rows = await db
    .select({ date: hrHolidays.date })
    .from(hrHolidays)
    .where(and(eq(hrHolidays.year, year), eq(hrHolidays.category, "Restricted")));
  return rows.some((r) => r.date === date);
}
