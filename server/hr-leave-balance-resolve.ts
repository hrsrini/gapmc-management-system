/**
 * Leave opening-balance import accepts either employees.id (PK) or empId (EMP-NNN).
 * Balance rows must always store the PK so UI selects and leave debit match leave requests.
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { employeeLeaveBalances, employees } from "@shared/db-schema";

export async function resolveEmployeePkForLeaveBalance(raw: string): Promise<string | null> {
  const key = String(raw ?? "").trim();
  if (!key) return null;

  const [byPk] = await db.select({ id: employees.id }).from(employees).where(eq(employees.id, key)).limit(1);
  if (byPk) return byPk.id;

  const [byEmpId] = await db
    .select({ id: employees.id })
    .from(employees)
    .where(sql`upper(coalesce(${employees.empId}, '')) = ${key.toUpperCase()}`)
    .limit(1);
  return byEmpId?.id ?? null;
}

/**
 * Remap balance rows that were incorrectly saved with EMP-NNN in employee_id.
 * Merges into an existing PK row for the same leave type when present.
 */
export async function healLeaveBalanceEmployeeIds(): Promise<{ healed: number; merged: number }> {
  const empRows = await db.select({ id: employees.id, empId: employees.empId }).from(employees);
  const knownIds = new Set(empRows.map((e) => e.id));
  const empIdToPk = new Map<string, string>();
  for (const e of empRows) {
    if (e.empId?.trim()) empIdToPk.set(e.empId.trim().toUpperCase(), e.id);
  }

  const balances = await db.select().from(employeeLeaveBalances);
  let healed = 0;
  let merged = 0;
  const now = new Date().toISOString();

  for (const row of balances) {
    if (knownIds.has(row.employeeId)) continue;
    const pk = empIdToPk.get(row.employeeId.trim().toUpperCase());
    if (!pk) continue;

    const [clash] = await db
      .select()
      .from(employeeLeaveBalances)
      .where(and(eq(employeeLeaveBalances.employeeId, pk), eq(employeeLeaveBalances.leaveType, row.leaveType)))
      .limit(1);

    if (clash && clash.id !== row.id) {
      await db
        .update(employeeLeaveBalances)
        .set({
          balanceDays: row.balanceDays,
          setOffDays: row.setOffDays,
          setOffExpiryDate: row.setOffExpiryDate,
          updatedAt: now,
        })
        .where(eq(employeeLeaveBalances.id, clash.id));
      await db.delete(employeeLeaveBalances).where(eq(employeeLeaveBalances.id, row.id));
      merged++;
    } else {
      await db
        .update(employeeLeaveBalances)
        .set({ employeeId: pk, updatedAt: now })
        .where(eq(employeeLeaveBalances.id, row.id));
      healed++;
    }
  }

  return { healed, merged };
}
