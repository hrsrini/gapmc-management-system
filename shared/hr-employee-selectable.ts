/**
 * Designations that must not appear in employee pickers / selection lists
 * (leave, reporting officer, substitute, inward marked-to, reports, etc.).
 * Codes match designation_master; names cover legacy free-text designations.
 */
export const NON_SELECTABLE_DESIGNATION_CODES = ["STAFF", "ADMIN"] as const;

const NON_SELECTABLE_CODE_SET = new Set<string>(
  NON_SELECTABLE_DESIGNATION_CODES.map((c) => c.toUpperCase()),
);

/**
 * True when this employee must be hidden from employee selection UIs.
 * Prefer designation master code when available; fall back to designation label.
 * Matches STAFF / ADMIN only (not SYSADM / System Administrator).
 */
export function isNonSelectableEmployeeDesignation(opts: {
  designation?: string | null;
  designationCode?: string | null;
}): boolean {
  const code = String(opts.designationCode ?? "")
    .trim()
    .toUpperCase();
  if (code && NON_SELECTABLE_CODE_SET.has(code)) return true;

  const name = String(opts.designation ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  if (!name) return false;
  return name === "staff" || name === "admin" || name === "administrator";
}

export function filterSelectableEmployees<
  T extends { designation?: string | null; designationCode?: string | null },
>(rows: T[]): T[] {
  return rows.filter((r) => !isNonSelectableEmployeeDesignation(r));
}
