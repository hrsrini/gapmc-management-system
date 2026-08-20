/**
 * US-M01-005: scheduled leave credits + EL cap warning + EL set-off settlement.
 * EL rule (client): ceiling 300; when balance > 285 and < 300, half-year credit is kept
 * separately and set off against EL availed; remainder credited at half-year end (≤300).
 */
import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { employees, employeeLeaveBalances } from "@shared/db-schema";
import { getMergedSystemConfig } from "./system-config";
import { parseSystemConfigNumber } from "./system-config";
import { sendNotificationStub } from "./notify";
import { writeAuditLogSystem } from "./audit";
import { proRataFactorForPeriod } from "./hr-leave-validation";

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
  return `lb_${Math.random().toString(16).slice(2)}${Math.random().toString(16).slice(2)}`;
}

function halfYearEndForCreditStart(monthDay: string, year: string): string {
  // Credit on 01-01 applies to Jan–Jun → set-off expires / settles 06-30
  // Credit on 07-01 applies to Jul–Dec → settles 12-31
  return monthDay === "01-01" ? `${year}-06-30` : `${year}-12-31`;
}

export async function runHrLeaveAccrual(): Promise<{ credited: number; warnings: number; settled: number }> {
  const today = new Date().toISOString().slice(0, 10);
  const monthDay = today.slice(5); // MM-DD
  const year = today.slice(0, 4);
  const cfg = await getMergedSystemConfig();
  const elHalf = parseSystemConfigNumber(cfg, "leave_el_credit_half_year_days");
  const clYear = parseSystemConfigNumber(cfg, "leave_cl_credit_year_days");
  const hplYear = parseSystemConfigNumber(cfg, "leave_hpl_credit_year_days");
  const elCap = parseSystemConfigNumber(cfg, "leave_el_cap_days") || 300;
  const elSetOffThreshold = parseSystemConfigNumber(cfg, "leave_el_setoff_threshold_days") || 285;

  const list = await db.select().from(employees).where(eq(employees.status, "Active"));
  let credited = 0;
  let warnings = 0;
  let settled = 0;

  const doElHalf = monthDay === "01-01" || monthDay === "07-01";
  const doClYear = monthDay === "01-01";
  const doHplYear = monthDay === "01-01";
  const doElSetOffSettle = monthDay === "06-30" || monthDay === "12-31";

  // End-of-half-year: credit remaining set-off into balance (≤300), then clear set-off
  if (doElSetOffSettle) {
    for (const e of list) {
      const [elBal] = await db
        .select()
        .from(employeeLeaveBalances)
        .where(and(eq(employeeLeaveBalances.employeeId, e.id), eq(employeeLeaveBalances.leaveType, "EL")))
        .limit(1);
      if (!elBal) continue;
      const setOff = Number(elBal.setOffDays ?? 0);
      if (setOff <= 0) continue;
      const expiry = elBal.setOffExpiryDate ? String(elBal.setOffExpiryDate).trim() : "";
      if (expiry && expiry !== today) continue;

      const currentEl = Number(elBal.balanceDays ?? 0);
      const room = Math.max(0, elCap - currentEl);
      const toCredit = Math.min(setOff, room);
      await db
        .update(employeeLeaveBalances)
        .set({
          balanceDays: currentEl + toCredit,
          setOffDays: 0,
          setOffExpiryDate: null,
          updatedAt: nowIso(),
        })
        .where(eq(employeeLeaveBalances.id, elBal.id));
      settled += 1;
      await writeAuditLogSystem({
        module: "M-01",
        action: "LeaveSetOffSettle",
        recordId: `setoff_settle:${e.id}:EL:${today}`,
        afterValue: {
          employeeId: e.id,
          setOffBefore: setOff,
          creditedToBalance: toCredit,
          lapsedOrNotAdded: setOff - toCredit,
          balanceAfter: currentEl + toCredit,
          date: today,
        },
      });
    }
  }

  if (doElHalf || doClYear || doHplYear) {
    for (const e of list) {
      if (doElHalf && elHalf > 0) {
        const periodStart = monthDay === "01-01" ? `${year}-01-01` : `${year}-07-01`;
        const periodEnd = monthDay === "01-01" ? `${year}-06-30` : `${year}-12-31`;
        const elCreditRaw = elHalf * proRataFactorForPeriod(e.joiningDate, periodStart, periodEnd);
        const elCredit = Math.round(elCreditRaw * 100) / 100;
        if (elCredit <= 0) continue;

        const [elBal] = await db
          .select()
          .from(employeeLeaveBalances)
          .where(and(eq(employeeLeaveBalances.employeeId, e.id), eq(employeeLeaveBalances.leaveType, "EL")))
          .limit(1);
        const currentEl = elBal ? Number(elBal.balanceDays ?? 0) : 0;
        const setOffExpiry = halfYearEndForCreditStart(monthDay, year);

        // Clear any stale set-off from prior period before new credit
        if (elBal && Number(elBal.setOffDays ?? 0) > 0) {
          const expiry = elBal.setOffExpiryDate ?? "";
          if (expiry && expiry < today) {
            await db
              .update(employeeLeaveBalances)
              .set({ setOffDays: 0, setOffExpiryDate: null, updatedAt: nowIso() })
              .where(eq(employeeLeaveBalances.id, elBal.id));
            await writeAuditLogSystem({
              module: "M-01",
              action: "LeaveSetOffLapse",
              recordId: `setoff_lapse:${e.id}:EL:${today}`,
              afterValue: { employeeId: e.id, lapsedDays: elBal.setOffDays, expiryDate: expiry },
            });
          }
        }

        if (currentEl > elSetOffThreshold) {
          // Keep advance credit separately (incl. when at/near 300). Not a 315-day permanent accumulation.
          if (elBal) {
            await db
              .update(employeeLeaveBalances)
              .set({ setOffDays: elCredit, setOffExpiryDate: setOffExpiry, updatedAt: nowIso() })
              .where(eq(employeeLeaveBalances.id, elBal.id));
          } else {
            await db.insert(employeeLeaveBalances).values({
              id: cryptoId(),
              employeeId: e.id,
              leaveType: "EL",
              balanceDays: currentEl,
              setOffDays: elCredit,
              setOffExpiryDate: setOffExpiry,
              updatedAt: nowIso(),
            });
          }
          credited += 1;
          await writeAuditLogSystem({
            module: "M-01",
            action: "LeaveCredit",
            recordId: `leave_credit:${e.id}:EL:${today}`,
            afterValue: {
              employeeId: e.id,
              leaveType: "EL",
              creditedDays: 0,
              setOffDays: elCredit,
              setOffExpiry,
              before: currentEl,
              after: currentEl,
              date: today,
              rule: `balance>${elSetOffThreshold}: set-off bucket`,
            },
          });
        } else {
          const room = Math.max(0, elCap - currentEl);
          const toAdd = Math.min(elCredit, room);
          if (toAdd > 0) {
            const { before, after } = await upsertBalance(e.id, "EL", toAdd);
            credited += 1;
            await writeAuditLogSystem({
              module: "M-01",
              action: "LeaveCredit",
              recordId: `leave_credit:${e.id}:EL:${today}`,
              afterValue: { employeeId: e.id, leaveType: "EL", creditedDays: toAdd, before, after, date: today },
            });
          }
        }
      }
      if (doClYear && clYear > 0) {
        const periodStart = `${year}-01-01`;
        const periodEnd = `${year}-12-31`;
        const clCredit = Math.round(clYear * proRataFactorForPeriod(e.joiningDate, periodStart, periodEnd) * 100) / 100;
        if (clCredit <= 0) continue;
        const { before, after } = await upsertBalance(e.id, "CL", clCredit);
        credited += 1;
        await writeAuditLogSystem({
          module: "M-01",
          action: "LeaveCredit",
          recordId: `leave_credit:${e.id}:CL:${today}`,
          afterValue: { employeeId: e.id, leaveType: "CL", creditedDays: clCredit, before, after, date: today },
        });
      }
      if (doHplYear && hplYear > 0) {
        const periodStart = `${year}-01-01`;
        const periodEnd = `${year}-12-31`;
        const hplCredit = Math.round(hplYear * proRataFactorForPeriod(e.joiningDate, periodStart, periodEnd) * 100) / 100;
        if (hplCredit <= 0) continue;
        const { before, after } = await upsertBalance(e.id, "HPL", hplCredit);
        credited += 1;
        await writeAuditLogSystem({
          module: "M-01",
          action: "LeaveCredit",
          recordId: `leave_credit:${e.id}:HPL:${today}`,
          afterValue: { employeeId: e.id, leaveType: "HPL", creditedDays: hplCredit, before, after, date: today },
        });
      }
    }
  }

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

  return { credited, warnings, settled };
}
