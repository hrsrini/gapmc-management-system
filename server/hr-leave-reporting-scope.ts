/**
 * Leave visibility / routing by Reporting Officer mapping (not by role alone).
 * Role = what you can do; Reporting Officer Mapping = whose leave you can see/process.
 */
import { eq } from "drizzle-orm";
import { db } from "./db";
import { employees } from "@shared/db-schema";

export type LeaveReportingEmp = {
  id: string;
  reportingOfficerEmployeeId: string | null;
  userId: string | null;
};

export async function loadLeaveReportingEmployeeIndex(): Promise<Map<string, LeaveReportingEmp>> {
  const rows = await db
    .select({
      id: employees.id,
      reportingOfficerEmployeeId: employees.reportingOfficerEmployeeId,
      userId: employees.userId,
    })
    .from(employees);
  return new Map(rows.map((r) => [r.id, r]));
}

/**
 * Effective Leave Verifying Officer (DV stage): immediate Reporting Officer.
 * If the employee is mapped to themselves, walk one step up (self-RO edge case).
 */
export function resolveLeaveVerifierEmployeeId(
  leaveEmployeeId: string,
  index: Map<string, LeaveReportingEmp>,
): string | null {
  const emp = index.get(leaveEmployeeId);
  if (!emp) return null;
  const roId = emp.reportingOfficerEmployeeId?.trim() || null;
  if (!roId) return null;
  if (roId === emp.id) {
    const self = index.get(roId);
    return self?.reportingOfficerEmployeeId?.trim() || null;
  }
  return roId;
}

/**
 * Next officer after verifier (DA stage): Reporting Officer of the verifier.
 */
export function resolveLeaveApproverEmployeeId(
  leaveEmployeeId: string,
  index: Map<string, LeaveReportingEmp>,
): string | null {
  const verifierId = resolveLeaveVerifierEmployeeId(leaveEmployeeId, index);
  if (!verifierId) return null;
  const verifier = index.get(verifierId);
  return verifier?.reportingOfficerEmployeeId?.trim() || null;
}

/** True when this employee reports (immediately, effective) to officerEmployeeId. */
export function employeeReportsToOfficer(
  leaveEmployeeId: string,
  officerEmployeeId: string,
  index: Map<string, LeaveReportingEmp>,
): boolean {
  const verifierId = resolveLeaveVerifierEmployeeId(leaveEmployeeId, index);
  return Boolean(verifierId && verifierId === officerEmployeeId);
}

/** True when officer is the configured approver for this leave employee. */
export function employeeApproverIsOfficer(
  leaveEmployeeId: string,
  officerEmployeeId: string,
  index: Map<string, LeaveReportingEmp>,
): boolean {
  const approverId = resolveLeaveApproverEmployeeId(leaveEmployeeId, index);
  return Boolean(approverId && approverId === officerEmployeeId);
}

/**
 * Team scope for a DV/DA officer: leaves of employees who report to them,
 * plus (for DA) leaves they are the next-higher approver for.
 * Location / additional charge does not expand access by itself — RO mapping does.
 */
export function leaveEmployeeInOfficerScope(
  leaveEmployeeId: string,
  officerEmployeeId: string,
  index: Map<string, LeaveReportingEmp>,
): boolean {
  if (employeeReportsToOfficer(leaveEmployeeId, officerEmployeeId, index)) return true;
  if (employeeApproverIsOfficer(leaveEmployeeId, officerEmployeeId, index)) return true;
  return false;
}

export async function getEmployeeReportingRow(employeeId: string): Promise<LeaveReportingEmp | null> {
  const [row] = await db
    .select({
      id: employees.id,
      reportingOfficerEmployeeId: employees.reportingOfficerEmployeeId,
      userId: employees.userId,
    })
    .from(employees)
    .where(eq(employees.id, employeeId))
    .limit(1);
  return row ?? null;
}
