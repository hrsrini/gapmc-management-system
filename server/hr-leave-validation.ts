import { and, asc, eq, gte, lte } from "drizzle-orm";
import {
  leaveTypeSkipsBalanceDebit,
  LEAVE_PUBLIC_HOLIDAY_MESSAGE,
  isSingleDayLeavePeriod,
} from "@shared/hr-leave-display";
import { db } from "./db";
import { employeeLeaveBalances, hrHolidays, leaveRequests } from "@shared/db-schema";
import { getMergedSystemConfig, parseSystemConfigNumber } from "./system-config";
import { inclusiveCalendarDays } from "./hr-leave-utils";
import { balanceLeaveTypeFor } from "./hr-leave-balance-debit";

export { LEAVE_PUBLIC_HOLIDAY_MESSAGE };

/** Public holidays in Holiday Master that fall within [fromDate, toDate] inclusive (covers consecutive days). */
export async function findPublicHolidaysInRange(
  fromDate: string,
  toDate: string,
): Promise<Array<{ date: string; name: string }>> {
  const from = String(fromDate ?? "").trim().slice(0, 10);
  const to = String(toDate ?? "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) return [];
  return db
    .select({ date: hrHolidays.date, name: hrHolidays.name })
    .from(hrHolidays)
    .where(and(eq(hrHolidays.category, "Public"), gte(hrHolidays.date, from), lte(hrHolidays.date, to)))
    .orderBy(asc(hrHolidays.date));
}

/**
 * Block leave only when the entire period is a single day that is a Public Holiday.
 * Multi-day periods may include Public Holidays (listed in the UI for reference).
 */
export async function validateLeaveDatesNotPublicHoliday(
  fromDate: string,
  toDate: string,
): Promise<string | null> {
  if (!isSingleDayLeavePeriod(fromDate, toDate)) return null;
  const hits = await findPublicHolidaysInRange(fromDate, toDate);
  return hits.length > 0 ? LEAVE_PUBLIC_HOLIDAY_MESSAGE : null;
}

export async function validateLeaveDurationCaps(leaveType: string, fromDate: string, toDate: string): Promise<string | null> {
  const upper = leaveType.trim().toUpperCase();
  const days = inclusiveCalendarDays(fromDate, toDate);
  if (days <= 0) return "fromDate must be <= toDate";

  const cfg = await getMergedSystemConfig();
  if (upper === "ML") {
    const max = parseSystemConfigNumber(cfg, "leave_ml_default_days");
    if (max > 0 && days > max) return `Maternity Leave cannot exceed ${max} day(s) per application.`;
  }
  if (upper === "PL") {
    const max = parseSystemConfigNumber(cfg, "leave_pl_default_days");
    if (max > 0 && days > max) return `Paternity Leave cannot exceed ${max} day(s) per application.`;
  }
  return null;
}

export async function validateCclLifetimeCap(
  employeeId: string,
  fromDate: string,
  toDate: string,
  excludeLeaveId?: string,
): Promise<string | null> {
  const cfg = await getMergedSystemConfig();
  const cap = parseSystemConfigNumber(cfg, "leave_ccl_lifetime_cap_days");
  if (cap <= 0) return null;

  const newDays = inclusiveCalendarDays(fromDate, toDate);
  const rows = await db.select().from(leaveRequests).where(
    and(eq(leaveRequests.employeeId, employeeId), eq(leaveRequests.leaveType, "CCL")),
  );
  let used = 0;
  for (const r of rows) {
    if (excludeLeaveId && r.id === excludeLeaveId) continue;
    if (!["Approved"].includes(String(r.status))) continue;
    used += Number(r.debitDays ?? inclusiveCalendarDays(String(r.fromDate), String(r.toDate)));
  }
  if (used + newDays > cap + 1e-9) {
    return `Child Care Leave lifetime cap (${cap} days) would be exceeded (already used ${used}, requesting ${newDays}).`;
  }
  return null;
}

export async function assertSufficientBalanceForApproval(
  employeeId: string,
  leaveType: string,
  debitDays: number,
): Promise<void> {
  if (debitDays <= 0) return;
  if (leaveTypeSkipsBalanceDebit(leaveType)) return;
  const balLeaveType = balanceLeaveTypeFor(leaveType);
  const [bal] = await db
    .select()
    .from(employeeLeaveBalances)
    .where(and(eq(employeeLeaveBalances.employeeId, employeeId), eq(employeeLeaveBalances.leaveType, balLeaveType)))
    .limit(1);
  if (!bal) throw new Error("LEAVE_INSUFFICIENT_BALANCE");

  const asOf = new Date().toISOString().slice(0, 10);
  let available = Number(bal.balanceDays ?? 0);
  if (balLeaveType === "EL") {
    const setOff = Number(bal.setOffDays ?? 0);
    const expiry = bal.setOffExpiryDate ? String(bal.setOffExpiryDate).trim() : "";
    if (setOff > 0 && (!expiry || expiry >= asOf)) available += setOff;
  }
  if (available + 1e-9 < debitDays) throw new Error("LEAVE_INSUFFICIENT_BALANCE");
}

/** Calendar-day pro-rata for mid-year joiners within an accrual period. */
export function proRataFactorForPeriod(joiningDate: string | null | undefined, periodStart: string, periodEnd: string): number {
  const join = String(joiningDate ?? "").slice(0, 10);
  if (!join || join <= periodStart) return 1;
  if (join > periodEnd) return 0;
  const total = inclusiveCalendarDays(periodStart, periodEnd);
  const eligible = inclusiveCalendarDays(join, periodEnd);
  if (total <= 0) return 0;
  return eligible / total;
}
