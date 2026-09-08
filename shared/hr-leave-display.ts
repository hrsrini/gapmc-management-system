/** M-01 leave document display (Sanction Order PDF + UI preview). */

/** Calendar date on leave orders: DD/MM/YYYY (e.g. 04/09/2026). */
export function formatLeaveOrderDateDisplay(isoYmd: string | null | undefined): string {
  const raw = String(isoYmd ?? "").trim().slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return raw;
}

/** Small cardinals for sanction-order wording (1–10). */
export function leaveDaysInWords(n: number): string {
  const map: Record<number, string> = {
    0.5: "Half",
    1: "One",
    2: "Two",
    3: "Three",
    4: "Four",
    5: "Five",
    6: "Six",
    7: "Seven",
    8: "Eight",
    9: "Nine",
    10: "Ten",
  };
  if (Object.prototype.hasOwnProperty.call(map, n)) return map[n]!;
  if (Number.isFinite(n) && n > 0) return String(n);
  return "One";
}

/** Leave types that show balance on orders but do not debit / enforce balance. */
export const LEAVE_TYPES_SKIP_BALANCE_DEBIT = ["CCL", "PL", "ML", "EOL"] as const;

export function leaveTypeSkipsBalanceDebit(leaveType: string | null | undefined): boolean {
  const t = String(leaveType ?? "").trim().toUpperCase();
  return (LEAVE_TYPES_SKIP_BALANCE_DEBIT as readonly string[]).includes(t);
}

/** Medical / supporting PDF required when leave spans more than 3 calendar days. */
export function leaveSupportingDocRequired(
  leaveType: string | null | undefined,
  calendarDays: number,
): boolean {
  const lt = String(leaveType ?? "").trim().toUpperCase();
  if (!["ML", "PL", "COMMUTED", "HPL"].includes(lt)) return false;
  return calendarDays > 3;
}

/** Shri / Smt. from employee gender (Male → Shri, Female → Smt.). */
export function employeeHonorific(gender: string | null | undefined): string {
  const g = String(gender ?? "").trim().toLowerCase();
  if (g === "male") return "Shri";
  if (g === "female") return "Smt.";
  return "Shri/Smt.";
}

/** Copy-to line: omit redundant "(Employee)" suffix. */
export function formatLeaveCopyToLine(item: string): string {
  return String(item ?? "").replace(/\s*\(Employee\)\s*$/i, "").trim();
}
