/**
 * Leave visibility / routing by Reporting Officer mapping (not by role alone).
 *
 * Role = what the user can do (verify / approve).
 * Reporting Officer Mapping = whose leave the user can see / process.
 * Reporting Hierarchy = where the leave moves upward (Employee → RO → higher RO → … → Final Approving Authority).
 *
 * Primary posting / Additional Charge do not expand leave access by themselves —
 * they only matter when employees at those locations are mapped to the officer as Reporting Officer.
 */
import { eq, inArray } from "drizzle-orm";
import { db } from "./db";
import { employees, roles, userRoles, users } from "@shared/db-schema";

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

/** Immediate Reporting Officer (skip self-RO edge by walking one step). */
export function resolveImmediateReportingOfficerId(
  employeeId: string,
  index: Map<string, LeaveReportingEmp>,
): string | null {
  const emp = index.get(employeeId);
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
 * Upward reporting chain starting at the immediate RO (excludes the leave employee).
 * Caps length to avoid cycles.
 */
export function resolveLeaveReportingChain(
  leaveEmployeeId: string,
  index: Map<string, LeaveReportingEmp>,
  maxDepth = 12,
): string[] {
  const chain: string[] = [];
  const seen = new Set<string>([leaveEmployeeId]);
  let cursor = resolveImmediateReportingOfficerId(leaveEmployeeId, index);
  while (cursor && !seen.has(cursor) && chain.length < maxDepth) {
    chain.push(cursor);
    seen.add(cursor);
    cursor = resolveImmediateReportingOfficerId(cursor, index);
  }
  return chain;
}

/**
 * Effective Leave Verifying Officer (Pending → Verified): immediate Reporting Officer.
 */
export function resolveLeaveVerifierEmployeeId(
  leaveEmployeeId: string,
  index: Map<string, LeaveReportingEmp>,
): string | null {
  return resolveImmediateReportingOfficerId(leaveEmployeeId, index);
}

/**
 * Sync: next officer after verifier (legacy 1-hop approver).
 * Prefer resolveLeaveApproverEmployeeIdAsync which walks to Final Approving Authority (DA/ADMIN).
 */
export function resolveLeaveApproverEmployeeId(
  leaveEmployeeId: string,
  index: Map<string, LeaveReportingEmp>,
): string | null {
  const chain = resolveLeaveReportingChain(leaveEmployeeId, index);
  // chain[0] = verifier; chain[1] = next higher (default approver)
  return chain.length >= 2 ? chain[1]! : chain[0] ?? null;
}

/** Map employeeId → login user id via users.employee_id (canonical) with employees.user_id fallback. */
export async function resolveLinkedUserIdsForEmployees(
  employeeIds: string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(employeeIds.map((id) => String(id ?? "").trim()).filter(Boolean))];
  const out = new Map<string, string>();
  if (!unique.length) return out;

  const byEmployeeFk = await db
    .select({ employeeId: users.employeeId, userId: users.id })
    .from(users)
    .where(inArray(users.employeeId, unique));
  for (const row of byEmployeeFk) {
    if (row.employeeId) out.set(row.employeeId, row.userId);
  }

  const missing = unique.filter((id) => !out.has(id));
  if (missing.length) {
    const byEmpUserCol = await db
      .select({ employeeId: employees.id, userId: employees.userId })
      .from(employees)
      .where(inArray(employees.id, missing));
    for (const row of byEmpUserCol) {
      const uid = row.userId?.trim();
      if (uid) out.set(row.employeeId, uid);
    }
  }
  return out;
}

async function employeeIdsWithApproverTier(employeeIds: string[]): Promise<Set<string>> {
  const linked = await resolveLinkedUserIdsForEmployees(employeeIds);
  const userIds = [...new Set([...linked.values()])];
  const able = new Set<string>();
  if (!userIds.length) return able;

  const tierRows = await db
    .select({ userId: userRoles.userId, tier: roles.tier })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(inArray(userRoles.userId, userIds));

  const userHasApproverTier = new Set<string>();
  for (const row of tierRows) {
    const t = String(row.tier ?? "").toUpperCase();
    if (t === "DA" || t === "ADMIN") userHasApproverTier.add(row.userId);
  }

  for (const [empId, userId] of linked) {
    if (userHasApproverTier.has(userId)) able.add(empId);
  }
  return able;
}

/**
 * Final Approving Authority for Verified → Approved/Rejected:
 * walk upward from the officer above the verifier until an officer with DA/ADMIN role is found;
 * if none, use the immediate next officer after the verifier (then verifier as last resort).
 */
export async function resolveLeaveApproverEmployeeIdAsync(
  leaveEmployeeId: string,
  index?: Map<string, LeaveReportingEmp>,
): Promise<string | null> {
  const idx = index ?? (await loadLeaveReportingEmployeeIndex());
  const chain = resolveLeaveReportingChain(leaveEmployeeId, idx);
  if (!chain.length) return null;

  // Candidates above the verifier (Final Approving Authority search)
  const aboveVerifier = chain.slice(1);
  if (aboveVerifier.length) {
    const able = await employeeIdsWithApproverTier(aboveVerifier);
    for (const empId of aboveVerifier) {
      if (able.has(empId)) return empId;
    }
    return aboveVerifier[0]!;
  }

  // Chain has only the verifier — they cannot self-approve; return null unless they alone exist
  return null;
}

/** True when this employee reports immediately (effective) to officerEmployeeId. */
export function employeeReportsToOfficer(
  leaveEmployeeId: string,
  officerEmployeeId: string,
  index: Map<string, LeaveReportingEmp>,
): boolean {
  const verifierId = resolveLeaveVerifierEmployeeId(leaveEmployeeId, index);
  return Boolean(verifierId && verifierId === officerEmployeeId);
}

/** True when officer is the configured next/final approver for this leave employee (sync 1-hop / 2nd in chain). */
export function employeeApproverIsOfficer(
  leaveEmployeeId: string,
  officerEmployeeId: string,
  index: Map<string, LeaveReportingEmp>,
): boolean {
  const approverId = resolveLeaveApproverEmployeeId(leaveEmployeeId, index);
  return Boolean(approverId && approverId === officerEmployeeId);
}

/**
 * Team scope for a DV/DA officer:
 * - employees who report immediately to them (all statuses), and/or
 * - employees for whom they are the next/final approving officer in the hierarchy.
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

/**
 * Async team scope using Final Approving Authority (walk to DA/ADMIN) for the approver hop.
 */
export async function leaveEmployeeInOfficerScopeAsync(
  leaveEmployeeId: string,
  officerEmployeeId: string,
  index: Map<string, LeaveReportingEmp>,
): Promise<boolean> {
  if (employeeReportsToOfficer(leaveEmployeeId, officerEmployeeId, index)) return true;
  const approverId = await resolveLeaveApproverEmployeeIdAsync(leaveEmployeeId, index);
  return Boolean(approverId && approverId === officerEmployeeId);
}

/** Batch-resolve Final Approving Authority for many leave employees (one roles query). */
export async function resolveLeaveApproverEmployeeIdsBatch(
  leaveEmployeeIds: string[],
  index: Map<string, LeaveReportingEmp>,
): Promise<Map<string, string | null>> {
  const unique = [...new Set(leaveEmployeeIds.map((id) => String(id ?? "").trim()).filter(Boolean))];
  const out = new Map<string, string | null>();
  if (!unique.length) return out;

  const candidateSet = new Set<string>();
  const chains = new Map<string, string[]>();
  for (const empId of unique) {
    const chain = resolveLeaveReportingChain(empId, index);
    chains.set(empId, chain);
    for (const id of chain.slice(1)) candidateSet.add(id);
  }

  const able = await employeeIdsWithApproverTier([...candidateSet]);
  for (const empId of unique) {
    const chain = chains.get(empId) ?? [];
    const above = chain.slice(1);
    let picked: string | null = null;
    for (const id of above) {
      if (able.has(id)) {
        picked = id;
        break;
      }
    }
    if (!picked && above.length) picked = above[0]!;
    out.set(empId, picked);
  }
  return out;
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
