import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { employeeLeaveBalances, leaveRequests } from "@shared/db-schema";
import { getMergedSystemConfig, parseSystemConfigNumber } from "./system-config";
import { inclusiveCalendarDays } from "./hr-leave-utils";
import { balanceLeaveTypeFor } from "./hr-leave-balance-debit";

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
