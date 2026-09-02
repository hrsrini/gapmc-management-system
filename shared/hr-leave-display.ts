/** M-01 leave document display (Sanction Order PDF + UI preview). */

/** Calendar date on leave orders: DD/MM/YYYY (e.g. 04/09/2026). */
export function formatLeaveOrderDateDisplay(isoYmd: string | null | undefined): string {
  const raw = String(isoYmd ?? "").trim().slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return raw;
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
