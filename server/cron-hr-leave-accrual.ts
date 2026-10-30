/**
 * US-M01-005: scheduled leave credits + EL cap warning + EL set-off settlement.
 *
 * Credit calendar (Active employees):
 * - EL: 1 Jan & 1 Jul (half-year; set-off rules when balance > threshold)
 * - HPL: 1 Jan & 1 Jul (half-year credit)
 * - CL / RH / SPL_H: 1 Jan (fresh year credit); unused balance lapses on 31 Dec
 *
 * CL amount: standard config vs PwD/PwBD (employee.category).
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

/** PwD / PwBD category → higher CL entitlement. */
export function employeeIsPwdForCl(category: string | null | undefined): boolean {
  const c = String(category ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
  return c === "pwd" || c === "pwbd" || c === "pwd." || c.includes("pwbd") || c.includes("personswithdisabilit");
}

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

/** Absolute set (used for year-start CL/RH/SPL_H after lapse, or mid-year pro-rata). */
async function setBalanceAbsolute(
  employeeId: string,
  leaveType: string,
  days: number,
): Promise<{ before: number; after: number }> {
  const [existing] = await db
    .select()
    .from(employeeLeaveBalances)
    .where(and(eq(employeeLeaveBalances.employeeId, employeeId), eq(employeeLeaveBalances.leaveType, leaveType)))
    .limit(1);
  const before = existing ? Number(existing.balanceDays ?? 0) : 0;
  const after = Math.max(0, days);
  const ts = nowIso();
  if (existing) {
    await db
      .update(employeeLeaveBalances)
      .set({ balanceDays: after, updatedAt: ts })
      .where(eq(employeeLeaveBalances.id, existing.id));
  } else if (after > 0) {
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

const YEAR_LAPSE_TYPES = ["CL", "RH", "SPL_H"] as const;

export async function runHrLeaveAccrual(): Promise<{
  credited: number;
  warnings: number;
  settled: number;
  lapsed: number;
}> {
  const today = new Date().toISOString().slice(0, 10);
  const monthDay = today.slice(5); // MM-DD
  const year = today.slice(0, 4);
  const cfg = await getMergedSystemConfig();
  const elHalf = parseSystemConfigNumber(cfg, "leave_el_credit_half_year_days");
  const clYear = parseSystemConfigNumber(cfg, "leave_cl_credit_year_days");
  const clYearPwd = parseSystemConfigNumber(cfg, "leave_cl_credit_year_days_pwd");
  const hplHalf = parseSystemConfigNumber(cfg, "leave_hpl_credit_half_year_days");
  const rhYear = parseSystemConfigNumber(cfg, "leave_rh_entitlement_per_year");
  const splHYear = parseSystemConfigNumber(cfg, "leave_spl_h_credit_year_days");
  const elCap = parseSystemConfigNumber(cfg, "leave_el_cap_days") || 300;
  const elSetOffThreshold = parseSystemConfigNumber(cfg, "leave_el_setoff_threshold_days") || 285;

  const list = await db.select().from(employees).where(eq(employees.status, "Active"));
  let credited = 0;
  let warnings = 0;
  let settled = 0;
  let lapsed = 0;

  const doElHalf = monthDay === "01-01" || monthDay === "07-01";
  const doHplHalf = monthDay === "01-01" || monthDay === "07-01";
  const doYearStartCredit = monthDay === "01-01";
  const doYearEndLapse = monthDay === "12-31";
  const doElSetOffSettle = monthDay === "06-30" || monthDay === "12-31";

  // 31 Dec: unused CL / RH / Special Holiday lapse (do not carry forward).
  if (doYearEndLapse) {
    for (const e of list) {
      for (const leaveType of YEAR_LAPSE_TYPES) {
        const [bal] = await db
          .select()
          .from(employeeLeaveBalances)
          .where(and(eq(employeeLeaveBalances.employeeId, e.id), eq(employeeLeaveBalances.leaveType, leaveType)))
          .limit(1);
        if (!bal) continue;
        const before = Number(bal.balanceDays ?? 0);
        if (before <= 0) continue;
        await db
          .update(employeeLeaveBalances)
          .set({ balanceDays: 0, updatedAt: nowIso() })
          .where(eq(employeeLeaveBalances.id, bal.id));
        lapsed += 1;
        await writeAuditLogSystem({
          module: "M-01",
          action: "LeaveYearEndLapse",
          recordId: `leave_lapse:${e.id}:${leaveType}:${today}`,
          afterValue: {
            employeeId: e.id,
            leaveType,
            lapsedDays: before,
            after: 0,
            date: today,
            rule: "Unused balance does not carry forward to next calendar year",
          },
        });
      }
    }
  }

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

  if (doElHalf || doHplHalf || doYearStartCredit) {
    for (const e of list) {
      if (doElHalf && elHalf > 0) {
        const periodStart = monthDay === "01-01" ? `${year}-01-01` : `${year}-07-01`;
        const periodEnd = monthDay === "01-01" ? `${year}-06-30` : `${year}-12-31`;
        const elCreditRaw = elHalf * proRataFactorForPeriod(e.joiningDate, periodStart, periodEnd);
        const elCredit = Math.round(elCreditRaw * 100) / 100;
        if (elCredit > 0) {
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
      }

      if (doHplHalf && hplHalf > 0) {
        const periodStart = monthDay === "01-01" ? `${year}-01-01` : `${year}-07-01`;
        const periodEnd = monthDay === "01-01" ? `${year}-06-30` : `${year}-12-31`;
        const hplCredit =
          Math.round(hplHalf * proRataFactorForPeriod(e.joiningDate, periodStart, periodEnd) * 100) / 100;
        if (hplCredit > 0) {
          const { before, after } = await upsertBalance(e.id, "HPL", hplCredit);
          credited += 1;
          await writeAuditLogSystem({
            module: "M-01",
            action: "LeaveCredit",
            recordId: `leave_credit:${e.id}:HPL:${today}`,
            afterValue: {
              employeeId: e.id,
              leaveType: "HPL",
              creditedDays: hplCredit,
              before,
              after,
              date: today,
              rule: "half-year credit (1 Jan / 1 Jul)",
            },
          });
        }
      }

      if (doYearStartCredit) {
        const periodStart = `${year}-01-01`;
        const periodEnd = `${year}-12-31`;
        const factor = proRataFactorForPeriod(e.joiningDate, periodStart, periodEnd);

        const clBase = employeeIsPwdForCl(e.category) ? clYearPwd : clYear;
        if (clBase > 0) {
          const clCredit = Math.round(clBase * factor * 100) / 100;
          if (clCredit > 0) {
            const { before, after } = await setBalanceAbsolute(e.id, "CL", clCredit);
            credited += 1;
            await writeAuditLogSystem({
              module: "M-01",
              action: "LeaveCredit",
              recordId: `leave_credit:${e.id}:CL:${today}`,
              afterValue: {
                employeeId: e.id,
                leaveType: "CL",
                creditedDays: clCredit,
                before,
                after,
                date: today,
                pwd: employeeIsPwdForCl(e.category),
                rule: "calendar-year credit (1 Jan); prior unused already lapsed 31 Dec",
              },
            });
          }
        }

        if (rhYear > 0) {
          const rhCredit = Math.round(rhYear * factor * 100) / 100;
          if (rhCredit > 0) {
            const { before, after } = await setBalanceAbsolute(e.id, "RH", rhCredit);
            credited += 1;
            await writeAuditLogSystem({
              module: "M-01",
              action: "LeaveCredit",
              recordId: `leave_credit:${e.id}:RH:${today}`,
              afterValue: {
                employeeId: e.id,
                leaveType: "RH",
                creditedDays: rhCredit,
                before,
                after,
                date: today,
                rule: "calendar-year credit (1 Jan); unused lapses 31 Dec",
              },
            });
          }
        }

        if (splHYear > 0) {
          const splCredit = Math.round(splHYear * factor * 100) / 100;
          if (splCredit > 0) {
            const { before, after } = await setBalanceAbsolute(e.id, "SPL_H", splCredit);
            credited += 1;
            await writeAuditLogSystem({
              module: "M-01",
              action: "LeaveCredit",
              recordId: `leave_credit:${e.id}:SPL_H:${today}`,
              afterValue: {
                employeeId: e.id,
                leaveType: "SPL_H",
                creditedDays: splCredit,
                before,
                after,
                date: today,
                rule: "calendar-year credit (1 Jan); unused lapses 31 Dec",
              },
            });
          }
        }
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

  return { credited, warnings, settled, lapsed };
}
