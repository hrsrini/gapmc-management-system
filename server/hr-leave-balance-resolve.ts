/**
 * Leave opening-balance import accepts either employees.id (PK) or empId (EMP-NNN).
 * Balance rows must always store the PK so UI selects and leave debit match leave requests.
 */
import { and, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./db";
import { employeeLeaveBalances, employees } from "@shared/db-schema";

/** Canonical leave-type codes used on balances / statements / debit. */
export const CANONICAL_LEAVE_BALANCE_TYPES = [
  "EL",
  "HPL",
  "COMMUTED",
  "CL",
  "RH",
  "SPL_H",
  "ML",
  "PL",
  "EOL",
  "CCL",
] as const;

export const LEAVE_BALANCE_TYPE_LABELS: Record<string, string> = {
  EL: "Earned Leave",
  HPL: "Half Pay Leave",
  COMMUTED: "Commuted Leave",
  CL: "Casual Leave",
  RH: "Restricted Holiday Leave",
  SPL_H: "Special Holiday Leave",
  ML: "Maternity Leave",
  PL: "Paternity Leave",
  EOL: "Extra Ordinary Leave",
  CCL: "Child Care Leave",
};

/**
 * Normalize imported / legacy leave-type labels to canonical codes.
 * Examples: "C.L" → CL, "E.L" → EL, "Casual Leave" → CL.
 */
export function normalizeLeaveBalanceType(raw: string | null | undefined): string {
  const t = String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
  if (!t) return "";

  const strippedDots = t.replace(/\./g, "");
  const aliases: Record<string, string> = {
    "CASUAL LEAVE": "CL",
    CL: "CL",
    "C L": "CL",
    "RESTRICTED HOLIDAY": "RH",
    "RISTRICTED HOLIDAY": "RH",
    RH: "RH",
    "SPECIAL HOLIDAY": "SPL_H",
    SH: "SPL_H",
    SPLH: "SPL_H",
    "SPL H": "SPL_H",
    "HALF PAY LEAVE": "HPL",
    HPL: "HPL",
    "EARNED LEAVE": "EL",
    EL: "EL",
    "E L": "EL",
    "COMMUTED LEAVE": "COMMUTED",
    COMMUTED: "COMMUTED",
    "MATERNITY LEAVE": "ML",
    ML: "ML",
    "PATERNITY LEAVE": "PL",
    PL: "PL",
    "EXTRAORDINARY LEAVE": "EOL",
    EOL: "EOL",
    "CHILD CARE LEAVE": "CCL",
    CCL: "CCL",
  };
  if (aliases[t]) return aliases[t];
  if (aliases[strippedDots]) return aliases[strippedDots];
  if ((CANONICAL_LEAVE_BALANCE_TYPES as readonly string[]).includes(t)) return t;
  if ((CANONICAL_LEAVE_BALANCE_TYPES as readonly string[]).includes(strippedDots)) return strippedDots;
  return t;
}

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

/**
 * Merge legacy alias leave-type rows (e.g. C.L, E.L) into canonical codes (CL, EL).
 * When both alias and canonical exist for an employee, keep the canonical row's balances
 * (unless canonical balance is 0 and alias has a positive balance).
 */
export async function healLeaveBalanceTypeAliases(): Promise<{ renamed: number; merged: number }> {
  const rows = await db.select().from(employeeLeaveBalances);
  let renamed = 0;
  let merged = 0;
  const now = new Date().toISOString();

  for (const row of rows) {
    const canonical = normalizeLeaveBalanceType(row.leaveType);
    const raw = String(row.leaveType ?? "").trim();
    if (!canonical || canonical === raw) continue;

    const [clash] = await db
      .select()
      .from(employeeLeaveBalances)
      .where(
        and(eq(employeeLeaveBalances.employeeId, row.employeeId), eq(employeeLeaveBalances.leaveType, canonical)),
      )
      .limit(1);

    if (clash && clash.id !== row.id) {
      const clashBal = Number(clash.balanceDays ?? 0);
      const aliasBal = Number(row.balanceDays ?? 0);
      const clashSetOff = Number(clash.setOffDays ?? 0);
      const aliasSetOff = Number(row.setOffDays ?? 0);
      const preferAliasBalance = clashBal === 0 && aliasBal > 0;
      const preferAliasSetOff = clashSetOff === 0 && aliasSetOff > 0;
      await db
        .update(employeeLeaveBalances)
        .set({
          balanceDays: preferAliasBalance ? aliasBal : clashBal,
          setOffDays: preferAliasSetOff ? aliasSetOff : clashSetOff,
          setOffExpiryDate:
            preferAliasSetOff && row.setOffExpiryDate
              ? row.setOffExpiryDate
              : clash.setOffExpiryDate ?? row.setOffExpiryDate ?? null,
          updatedAt: now,
        })
        .where(eq(employeeLeaveBalances.id, clash.id));
      await db.delete(employeeLeaveBalances).where(eq(employeeLeaveBalances.id, row.id));
      merged++;
    } else {
      await db
        .update(employeeLeaveBalances)
        .set({ leaveType: canonical, updatedAt: now })
        .where(eq(employeeLeaveBalances.id, row.id));
      renamed++;
    }
  }

  return { renamed, merged };
}

/** Individual Leave Balance Statement order (matches board specimen PDF). */
export const LEAVE_BALANCE_STATEMENT_ORDER = [
  "EL",
  "HPL",
  "PL",
  "ML",
  "CCL",
  "EOL",
  "CL",
  "RH",
  "SPL_H",
] as const;

export type NormalizedBalanceLine = {
  leaveType: string;
  label: string;
  balanceDays: number;
  setOffDays: number;
  setOffExpiryDate: string | null;
};

/** Collapse raw balance rows to one line per canonical leave type. */
export function collapseBalancesByCanonicalType(
  rows: Array<{
    leaveType: string;
    balanceDays?: number | null;
    setOffDays?: number | null;
    setOffExpiryDate?: string | null;
  }>,
): NormalizedBalanceLine[] {
  const map = new Map<string, NormalizedBalanceLine>();
  for (const r of rows) {
    const code = normalizeLeaveBalanceType(r.leaveType);
    if (!code) continue;
    const bal = Number(r.balanceDays ?? 0);
    const setOff = Number(r.setOffDays ?? 0);
    const expiry = r.setOffExpiryDate ? String(r.setOffExpiryDate).slice(0, 10) : null;
    const prev = map.get(code);
    if (!prev) {
      map.set(code, {
        leaveType: code,
        label: LEAVE_BALANCE_TYPE_LABELS[code] ?? code,
        balanceDays: bal,
        setOffDays: setOff,
        setOffExpiryDate: expiry,
      });
      continue;
    }
    // Prefer non-zero / larger values when duplicates collapsed in-memory.
    if (bal > prev.balanceDays) prev.balanceDays = bal;
    if (setOff > prev.setOffDays) {
      prev.setOffDays = setOff;
      prev.setOffExpiryDate = expiry ?? prev.setOffExpiryDate;
    }
  }

  const ordered: NormalizedBalanceLine[] = [];
  for (const code of LEAVE_BALANCE_STATEMENT_ORDER) {
    const line = map.get(code);
    if (line) ordered.push(line);
  }
  for (const [code, line] of map) {
    if (!(LEAVE_BALANCE_STATEMENT_ORDER as readonly string[]).includes(code)) ordered.push(line);
  }
  return ordered;
}

/**
 * Specimen statement lines: always emit the fixed leave-type list (0 when absent).
 * Omits COMMUTED (not on the individual statement specimen).
 */
export function buildLeaveBalanceStatementLines(
  rows: Array<{
    leaveType: string;
    balanceDays?: number | null;
    setOffDays?: number | null;
    setOffExpiryDate?: string | null;
  }>,
): NormalizedBalanceLine[] {
  const collapsed = collapseBalancesByCanonicalType(rows);
  const byCode = new Map(collapsed.map((l) => [l.leaveType, l]));
  return LEAVE_BALANCE_STATEMENT_ORDER.map((code) => {
    const existing = byCode.get(code);
    if (existing) return existing;
    return {
      leaveType: code,
      label: LEAVE_BALANCE_TYPE_LABELS[code] ?? code,
      balanceDays: 0,
      setOffDays: 0,
      setOffExpiryDate: null,
    };
  });
}

/**
 * Default EL set-off expiry = end of current half-year (matches accrual cron):
 * Jan–Jun → YYYY-06-30; Jul–Dec → YYYY-12-31.
 */
export function defaultElSetOffExpiryDate(asOfYmd = new Date().toISOString().slice(0, 10)): string {
  const raw = String(asOfYmd).trim().slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  const y = m ? m[1]! : String(new Date().getFullYear());
  const month = m ? Number(m[2]) : new Date().getMonth() + 1;
  return month <= 6 ? `${y}-06-30` : `${y}-12-31`;
}

/** When set-off days exist but expiry was never stored (manual/import), fill the half-year end. */
export function resolveElSetOffExpiryDate(
  setOffDays: number,
  setOffExpiryDate: string | null | undefined,
  asOfYmd?: string,
): string | null {
  if (!(Number(setOffDays) > 0)) return null;
  const raw = setOffExpiryDate != null ? String(setOffExpiryDate).trim().slice(0, 10) : "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return defaultElSetOffExpiryDate(asOfYmd);
}

/** Persist missing EL set-off expiry dates (rows with set_off_days > 0 and null expiry). */
export async function healMissingElSetOffExpiryDates(employeeId?: string): Promise<number> {
  const asOf = new Date().toISOString().slice(0, 10);
  const defaultExpiry = defaultElSetOffExpiryDate(asOf);
  const rows = employeeId
    ? await db
        .select()
        .from(employeeLeaveBalances)
        .where(and(eq(employeeLeaveBalances.employeeId, employeeId), eq(employeeLeaveBalances.leaveType, "EL")))
    : await db.select().from(employeeLeaveBalances).where(eq(employeeLeaveBalances.leaveType, "EL"));

  let healed = 0;
  const now = new Date().toISOString();
  for (const row of rows) {
    const setOff = Number(row.setOffDays ?? 0);
    if (setOff <= 0) continue;
    const expiry = row.setOffExpiryDate ? String(row.setOffExpiryDate).trim().slice(0, 10) : "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(expiry)) continue;
    await db
      .update(employeeLeaveBalances)
      .set({ setOffExpiryDate: defaultExpiry, updatedAt: now })
      .where(eq(employeeLeaveBalances.id, row.id));
    healed += 1;
  }
  return healed;
}

/** Ensure a placeholder row exists (used rarely); kept for heal tooling. */
export async function ensureCanonicalBalanceRow(
  employeeId: string,
  leaveType: string,
  balanceDays = 0,
): Promise<void> {
  const code = normalizeLeaveBalanceType(leaveType);
  if (!code) return;
  const [existing] = await db
    .select()
    .from(employeeLeaveBalances)
    .where(and(eq(employeeLeaveBalances.employeeId, employeeId), eq(employeeLeaveBalances.leaveType, code)))
    .limit(1);
  if (existing) return;
  await db.insert(employeeLeaveBalances).values({
    id: nanoid(),
    employeeId,
    leaveType: code,
    balanceDays,
    setOffDays: 0,
    setOffExpiryDate: null,
    updatedAt: new Date().toISOString(),
  });
}
