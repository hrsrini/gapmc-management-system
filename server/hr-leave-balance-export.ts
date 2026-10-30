/**
 * M-01 Leave Opening Balances — Excel export (Admin).
 * Layout matches specimen: "Employee Leave Balance Report as on date : DD/MM/YYYY."
 */
import { asc, eq } from "drizzle-orm";
import { formatLeaveOrderDateDisplay } from "@shared/hr-leave-display";
import { isNonSelectableEmployeeDesignation } from "@shared/hr-employee-selectable";
import { db } from "./db";
import { designationMaster, employeeLeaveBalances, employees } from "@shared/db-schema";
import { normalizeLeaveBalanceType } from "./hr-leave-balance-resolve";

const EXPORT_LEAVE_COLS = ["CL", "RH", "SPL_H", "HPL", "PL", "ML", "EOL", "CCL", "EL"] as const;

export const LEAVE_BALANCE_EXPORT_HEADERS = [
  "Sr. No.",
  "Emp ID - Employee Name",
  "CL",
  "RH",
  "SPL_H",
  "HPL",
  "PL",
  "ML",
  "EOL",
  "CCL",
  "EL",
  "EL (setoff)",
  "Set off Expiry Date",
] as const;

function empDisplayName(e: {
  firstName: string;
  middleName?: string | null;
  surname: string;
}): string {
  return [e.firstName, e.middleName, e.surname].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function localAsOnDateDdMmYyyy(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy}`;
}

export async function buildLeaveBalanceExportAoa(asOnDate?: string): Promise<{
  aoa: (string | number)[][];
  asOnDisplay: string;
  rowCount: number;
}> {
  const asOnDisplay = asOnDate?.trim()
    ? formatLeaveOrderDateDisplay(asOnDate) || asOnDate.trim()
    : localAsOnDateDdMmYyyy();

  const desigRows = await db
    .select({ id: designationMaster.id, code: designationMaster.code })
    .from(designationMaster);
  const codeById = new Map(desigRows.map((r) => [r.id, String(r.code ?? "").trim().toUpperCase()]));

  const empsRaw = await db
    .select({
      id: employees.id,
      empId: employees.empId,
      firstName: employees.firstName,
      middleName: employees.middleName,
      surname: employees.surname,
      designation: employees.designation,
      designationId: employees.designationId,
    })
    .from(employees)
    .where(eq(employees.status, "Active"))
    .orderBy(asc(employees.empId), asc(employees.surname), asc(employees.firstName));

  const emps = empsRaw.filter((e) => {
    const designationId = e.designationId ? String(e.designationId).trim() : "";
    return !isNonSelectableEmployeeDesignation({
      designation: e.designation,
      designationCode: designationId ? codeById.get(designationId) ?? null : null,
    });
  });

  const bals = await db.select().from(employeeLeaveBalances);
  const byEmp = new Map<
    string,
    Map<string, { balanceDays: number; setOffDays: number; setOffExpiryDate: string | null }>
  >();
  for (const b of bals) {
    const lt = normalizeLeaveBalanceType(b.leaveType);
    if (!lt) continue;
    let map = byEmp.get(b.employeeId);
    if (!map) {
      map = new Map();
      byEmp.set(b.employeeId, map);
    }
    const next = {
      balanceDays: Number(b.balanceDays ?? 0),
      setOffDays: Number(b.setOffDays ?? 0),
      setOffExpiryDate: b.setOffExpiryDate ? String(b.setOffExpiryDate).slice(0, 10) : null,
    };
    const prev = map.get(lt);
    if (!prev) {
      map.set(lt, next);
    } else {
      // Collapse aliases (e.g. C.L + CL) — prefer larger / non-zero values.
      map.set(lt, {
        balanceDays: Math.max(prev.balanceDays, next.balanceDays),
        setOffDays: Math.max(prev.setOffDays, next.setOffDays),
        setOffExpiryDate:
          next.setOffDays >= prev.setOffDays ? next.setOffExpiryDate : prev.setOffExpiryDate,
      });
    }
  }

  const dataRows: (string | number)[][] = emps.map((e, i) => {
    const code = (e.empId && String(e.empId).trim()) || e.id;
    const name = empDisplayName(e);
    const balMap = byEmp.get(e.id);
    const el = balMap?.get("EL");
    const cells: (string | number)[] = [
      i + 1,
      `${code} - ${name}`,
    ];
    for (const col of EXPORT_LEAVE_COLS) {
      cells.push(balMap?.get(col)?.balanceDays ?? 0);
    }
    cells.push(el?.setOffDays ?? 0);
    cells.push(el?.setOffExpiryDate ? formatLeaveOrderDateDisplay(el.setOffExpiryDate) : "");
    return cells;
  });

  const aoa: (string | number)[][] = [
    [`Employee Leave Balance Report as on date : ${asOnDisplay}.`],
    [...LEAVE_BALANCE_EXPORT_HEADERS],
    ...dataRows,
  ];

  return { aoa, asOnDisplay, rowCount: dataRows.length };
}
