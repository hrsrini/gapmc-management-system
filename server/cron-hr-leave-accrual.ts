/**
 * US-M01-005: scheduled leave credits + EL cap warning (stub notify).
 * Run daily via CRON_HR_LEAVE_ACCRUAL=true or manual HTTP cron if wired.
 */
import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { employees, employeeLeaveBalances } from "@shared/db-schema";
import { getMergedSystemConfig } from "./system-config";
import { parseSystemConfigNumber } from "./system-config";
import { sendNotificationStub } from "./notify";
import { writeAuditLogSystem } from "./audit";

const nowIso = () => new Date().toISOString();

async function upsertBalance(
  employeeId: string,
  leaveType: string,
  deltaDays: number,
): Promise<{ before: number; after: number }> {
  const [existing] = await db
    .select()
    .from(employeeLeaveBalances)
    .where(and(eq(employeeLeaveBalances.employeeId, employeeId), eq(employeeLeaveBalances.leaveType, leaveType)))
    .limit(1);
  const before = existing ? Number(existing.balanceDays ?? 0) : 0;
  const after = before + deltaDays;
  const ts = nowIso();
  if (existing) {
    await db
      .update(employeeLeaveBalances)
      .set({ balanceDays: after, updatedAt: ts })
      .where(eq(employeeLeaveBalances.id, existing.id));
  } else {
    await db.insert(employeeLeaveBalances).values({
      id: cryptoId(),
      employeeId,
      leaveType,
      balanceDays: after,
      updatedAt: ts,
    });
  }
  return { before, after };
}

function cryptoId(): string {
  // avoid importing nanoid in cron file; stable enough for internal rows
  return `lb_${Math.random().toString(16).slice(2)}${Math.random().toString(16).slice(2)}`;
}

export async function runHrLeaveAccrual(): Promise<{ credited: number; warnings: number }> {
  const today = new Date().toISOString().slice(0, 10);
  const monthDay = today.slice(5); // MM-DD
  const cfg = await getMergedSystemConfig();
  const elHalf = parseSystemConfigNumber(cfg, "leave_el_credit_half_year_days");
  const clYear = parseSystemConfigNumber(cfg, "leave_cl_credit_year_days");
  const hplYear = parseSystemConfigNumber(cfg, "leave_hpl_credit_year_days");
  const elCap = parseSystemConfigNumber(cfg, "leave_el_cap_days");

  const list = await db.select().from(employees).where(eq(employees.status, "Active"));
  let credited = 0;
  let warnings = 0;

  // Credits
  const doElHalf = monthDay === "01-01" || monthDay === "07-01";
  const doClYear = monthDay === "01-01";
  const doHplYear = monthDay === "01-01";

  if (doElHalf || doClYear || doHplYear) {
    for (const e of list) {
      if (doElHalf && elHalf > 0) {
        const { before, after } = await upsertBalance(e.id, "EL", elHalf);
        credited += 1;
        await writeAuditLogSystem({
          module: "M-01",
          action: "LeaveCredit",
          recordId: `leave_credit:${e.id}:EL:${today}`,
          afterValue: { employeeId: e.id, leaveType: "EL", creditedDays: elHalf, before, after, date: today },
        });
      }
      if (doClYear && clYear > 0) {
        const { before, after } = await upsertBalance(e.id, "CL", clYear);
        credited += 1;
        await writeAuditLogSystem({
          module: "M-01",
          action: "LeaveCredit",
          recordId: `leave_credit:${e.id}:CL:${today}`,
          afterValue: { employeeId: e.id, leaveType: "CL", creditedDays: clYear, before, after, date: today },
        });
      }
      if (doHplYear && hplYear > 0) {
        const { before, after } = await upsertBalance(e.id, "HPL", hplYear);
        credited += 1;
        await writeAuditLogSystem({
          module: "M-01",
          action: "LeaveCredit",
          recordId: `leave_credit:${e.id}:HPL:${today}`,
          afterValue: { employeeId: e.id, leaveType: "HPL", creditedDays: hplYear, before, after, date: today },
        });
      }
    }
  }

  // Cap warning (BR-LVE-06 / AC: warning on 1 Nov)
  if (monthDay === "11-01" && elCap > 0) {
    for (const e of list) {
      const [bal] = await db
        .select()
        .from(employeeLeaveBalances)
        .where(and(eq(employeeLeaveBalances.employeeId, e.id), eq(employeeLeaveBalances.leaveType, "EL")))
        .limit(1);
      const el = bal ? Number(bal.balanceDays ?? 0) : 0;
      if (el > elCap + 1e-9) {
        sendNotificationStub({
          kind: "leave_el_cap_warning",
          employeeId: e.id,
          empId: e.empId ?? e.id,
          name: `${e.firstName} ${e.surname}`.trim(),
          leaveType: "EL",
          balanceDays: el,
          capDays: elCap,
          date: today,
        });
        warnings += 1;
        await writeAuditLogSystem({
          module: "M-01",
          action: "LeaveCapWarning",
          recordId: `leave_cap_warning:${e.id}:EL:${today}`,
          afterValue: { employeeId: e.id, leaveType: "EL", balanceDays: el, capDays: elCap, date: today },
        });
      }
    }
  }

  return { credited, warnings };
}

