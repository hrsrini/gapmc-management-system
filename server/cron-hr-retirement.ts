/**
 * M-01: retirement date reminders (stub notify). Run daily via CRON_HR_RETIREMENT=true or HTTP cron.
 * Also disables login for users linked to employees in terminal HR statuses (idempotent).
 */
import { eq, and, inArray, isNotNull, lte, gte, lt } from "drizzle-orm";
import { db } from "./db";
import { employees, users, auditLog } from "@shared/db-schema";
import { sendNotificationStub } from "./notify";
import { writeAuditLogSystem } from "./audit";

const TERMINAL_EMPLOYEE_STATUSES = ["Inactive", "Retired", "Suspended", "Resigned"] as const;

/** Users stay disabled while employee is in a terminal status; safe to run daily. */
export async function disableUsersForSeparatedEmployees(): Promise<{ disabled: number }> {
  const separated = await db
    .select({ id: employees.id, userId: employees.userId })
    .from(employees)
    .where(inArray(employees.status, [...TERMINAL_EMPLOYEE_STATUSES]));
  const empIds = separated.map((r) => r.id);
  const userIds = new Set<string>();
  for (const r of separated) {
    if (r.userId) userIds.add(r.userId);
  }
  if (empIds.length > 0) {
    const linked = await db
      .select({ id: users.id })
      .from(users)
      .where(and(isNotNull(users.employeeId), inArray(users.employeeId, empIds)));
    for (const u of linked) userIds.add(u.id);
  }
  const ts = new Date().toISOString();
  let disabled = 0;
  for (const uid of Array.from(userIds)) {
    const [u] = await db.select().from(users).where(eq(users.id, uid)).limit(1);
    if (!u?.isActive) continue;
    await db.update(users).set({ isActive: false, disabledAt: ts, updatedAt: ts }).where(eq(users.id, uid));
    await writeAuditLogSystem({
      module: "M-01",
      action: "DisableUserOnSeparation",
      recordId: uid,
      beforeValue: { isActive: true },
      afterValue: { isActive: false },
    });
    disabled += 1;
  }
  return { disabled };
}

/** US-M01-002: auto-retire employees whose retirementDate is due (status Active → Retired) and disable login. */
export async function autoRetireDueEmployees(): Promise<{ retired: number }> {
  const today = new Date().toISOString().slice(0, 10);
  const due = await db
    .select({ id: employees.id, userId: employees.userId, retirementDate: employees.retirementDate })
    .from(employees)
    .where(and(eq(employees.status, "Active"), isNotNull(employees.retirementDate), lte(employees.retirementDate, today)));

  const ts = new Date().toISOString();
  let retired = 0;
  for (const e of due) {
    await db.transaction(async (tx) => {
      await tx.update(employees).set({ status: "Retired", updatedAt: ts }).where(eq(employees.id, e.id));
      // Disable linked user rows in the same transaction (SRS §1.4 coupling).
      await tx
        .update(users)
        .set({ isActive: false, disabledAt: ts, updatedAt: ts })
        .where(and(isNotNull(users.employeeId), eq(users.employeeId, e.id)));
    });
    await writeAuditLogSystem({
      module: "M-01",
      action: "AutoRetireEmployee",
      recordId: e.id,
      beforeValue: { status: "Active", retirementDate: e.retirementDate },
      afterValue: { status: "Retired", disabledUser: true },
    });
    retired += 1;
  }
  return { retired };
}

function daysUntil(dateYmd: string): number {
  const t = new Date(`${dateYmd}T12:00:00.000Z`).getTime();
  const now = Date.now();
  return Math.ceil((t - now) / 86400000);
}

const NOTIFY_DAYS: Array<{ days: number; band: "180" | "90" | "60" | "30" | "due" }> = [
  { days: 180, band: "180" },
  { days: 90, band: "90" },
  { days: 60, band: "60" },
  { days: 30, band: "30" },
  { days: 14, band: "30" },
  { days: 7, band: "30" },
  { days: 0, band: "due" },
];

async function wasRetirementReminderSentToday(employeeId: string, band: string): Promise<boolean> {
  const today = new Date().toISOString().slice(0, 10);
  const from = `${today}T00:00:00.000Z`;
  const to = `${today}T23:59:59.999Z`;
  const recordId = `retirement_reminder:${employeeId}:${band}`;
  const rows = await db
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.module, "M-01"),
        eq(auditLog.action, "RetirementReminderSent"),
        eq(auditLog.recordId, recordId),
        gte(auditLog.createdAt, from),
        lt(auditLog.createdAt, to),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export async function runHrRetirementReminders(): Promise<{ checked: number; notified: number; usersDisabled: number }> {
  const { disabled: usersDisabled } = await disableUsersForSeparatedEmployees();
  await autoRetireDueEmployees();
  const list = await db.select().from(employees).where(eq(employees.status, "Active"));
  let notified = 0;
  for (const e of list) {
    if (!e.retirementDate) continue;
    const d = daysUntil(e.retirementDate);
    const hit = NOTIFY_DAYS.find((x) => x.days === d);
    if (!hit) continue;
    if (await wasRetirementReminderSentToday(e.id, hit.band)) continue;
    const name = `${e.firstName} ${e.surname}`.trim();
    sendNotificationStub({
      kind: "retirement_reminder",
      employeeId: e.id,
      name,
      retirementDate: e.retirementDate,
      daysUntil: d,
      band: hit.band,
    });
    await writeAuditLogSystem({
      module: "M-01",
      action: "RetirementReminderSent",
      recordId: `retirement_reminder:${e.id}:${hit.band}`,
      afterValue: { employeeId: e.id, band: hit.band, daysUntil: d, retirementDate: e.retirementDate },
    });
    notified += 1;
  }
  return { checked: list.length, notified, usersDisabled };
}
