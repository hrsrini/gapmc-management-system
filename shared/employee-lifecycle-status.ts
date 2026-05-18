/**
 * M-01 employee lifecycle (stored `employees.status`): internal codes + transition rules.
 * Lower workflow: Draft → Submitted → Recommended → Active (Active + EMP-ID via approve-registration).
 */

export const EMPLOYEE_LIFECYCLE_STATUSES = [
  "Draft",
  "Submitted",
  "Recommended",
  "Active",
  "INA",
  "RET",
  "VRS",
  "SUS",
  "RES",
  "DEC",
  "TER",
] as const;

export type EmployeeLifecycleStatus = (typeof EMPLOYEE_LIFECYCLE_STATUSES)[number];

/** UI / reports: human-readable label for a stored status code. */
export const EMPLOYEE_STATUS_LABELS: Record<string, string> = {
  Draft: "Draft",
  Submitted: "Submitted",
  Recommended: "Recommended",
  Active: "Active",
  INA: "Inactive",
  RET: "Retired / Superannuated",
  VRS: "Voluntarily Retired (VRS)",
  SUS: "Suspended",
  RES: "Resigned",
  DEC: "Deceased",
  TER: "Terminated",
  // legacy (pre-migration) — still show sensibly if seen before migrate
  Inactive: "Inactive",
  Retired: "Retired / Superannuated",
  Resigned: "Resigned",
};

const LEGACY_TO_CANONICAL: Record<string, string> = {
  Inactive: "INA",
  Retired: "RET",
  Resigned: "RES",
};

const KNOWN = new Set<string>([...EMPLOYEE_LIFECYCLE_STATUSES, ...Object.keys(LEGACY_TO_CANONICAL)]);

/** Normalize legacy display values to canonical stored codes. */
export function canonicalizeEmployeeStatus(raw: string | null | undefined): string {
  const t = String(raw ?? "").trim();
  return LEGACY_TO_CANONICAL[t] ?? t;
}

export function employeeStatusDisplayLabel(raw: string | null | undefined): string {
  const c = canonicalizeEmployeeStatus(raw);
  return EMPLOYEE_STATUS_LABELS[c] ?? EMPLOYEE_STATUS_LABELS[raw ?? ""] ?? String(raw ?? "—");
}

/** RET, VRS, RES, DEC, TER — profile locked read-only (spec). */
export function isTerminalEmployeeLifecycleStatus(raw: string | null | undefined): boolean {
  const c = canonicalizeEmployeeStatus(raw);
  return c === "RET" || c === "VRS" || c === "RES" || c === "DEC" || c === "TER";
}

/** Statuses that should disable linked app login (operational / separation). */
export function employeeStatusesThatDisableAppLogin(): readonly string[] {
  return ["INA", "SUS", "RET", "VRS", "RES", "DEC", "TER"];
}

export function isKnownEmployeeLifecycleStatus(raw: string | null | undefined): boolean {
  return KNOWN.has(String(raw ?? "").trim());
}

const OFFICIAL_EMP_ID_RE = /^EMP-\d{3}$/i;

/** BR-EMP-01 / BR-EMP-06: official assigned id (EMP-NNN). */
export function hasOfficialEmployeeId(empId: string | null | undefined): boolean {
  if (empId == null || String(empId).trim() === "") return false;
  return OFFICIAL_EMP_ID_RE.test(String(empId).trim());
}

/** Pre-Active registration states where EMP-ID is not yet assigned. */
export function employeeRegistrationPendingEmpId(statusRaw: string | null | undefined): boolean {
  const s = canonicalizeEmployeeStatus(statusRaw);
  return s === "Draft" || s === "Submitted" || s === "Recommended";
}

/** List/detail display: never fall back to internal row id before DA approval. */
export function displayEmployeeEmpId(
  empId: string | null | undefined,
  statusRaw: string | null | undefined,
  internalId: string,
): string | null {
  if (empId != null && String(empId).trim() !== "") return String(empId).trim();
  if (employeeRegistrationPendingEmpId(statusRaw)) return null;
  return internalId;
}

/** UI + server: DA approval applies only after DV recommend (or legacy Active without EMP-ID). */
export function canApproveEmployeeRegistration(
  statusRaw: string | null | undefined,
  empId: string | null | undefined,
): boolean {
  const s = canonicalizeEmployeeStatus(statusRaw);
  if (s === "Recommended") return true;
  if (s === "Active" && !hasOfficialEmployeeId(empId)) return true;
  return false;
}

/**
 * Allowed transitions for PUT / employee form (excluding approve-registration EMP-ID path).
 * `from` / `to` may be legacy or canonical; compared after canonicalize.
 */
export function isAllowedEmployeeLifecycleTransition(fromRaw: string, toRaw: string): boolean {
  const from = canonicalizeEmployeeStatus(fromRaw);
  const to = canonicalizeEmployeeStatus(toRaw);
  if (from === to) return true;
  const map: Record<string, string[]> = {
    Draft: ["Submitted"],
    Submitted: ["Recommended", "Draft"],
    Recommended: [],
    Active: ["INA", "RET", "VRS", "SUS", "RES", "DEC", "TER"],
    SUS: ["Active", "TER"],
    INA: ["Active"],
  };
  const next = map[from];
  if (!next) return false;
  return next.includes(to);
}

/** Create employee: only these initial statuses. */
export const EMPLOYEE_CREATE_ALLOWED_STATUSES = ["Draft", "Submitted"] as const;

const DROPDOWN_ORDER = [
  "Draft",
  "Submitted",
  "Recommended",
  "Active",
  "INA",
  "SUS",
  "RET",
  "VRS",
  "RES",
  "DEC",
  "TER",
] as const;

/** Options for the Employee Form status dropdown (current value always included). */
export function listEmployeeStatusOptionsForDropdown(fromRaw: string, isCreate: boolean): Array<{ value: string; label: string }> {
  if (isCreate) {
    return EMPLOYEE_CREATE_ALLOWED_STATUSES.map((v) => ({ value: v, label: EMPLOYEE_STATUS_LABELS[v] ?? v }));
  }
  const from = canonicalizeEmployeeStatus(fromRaw);
  if (from === "Recommended") {
    return [{ value: "Recommended", label: EMPLOYEE_STATUS_LABELS.Recommended }];
  }
  const seen = new Set<string>();
  const out: Array<{ value: string; label: string }> = [];
  for (const cand of EMPLOYEE_LIFECYCLE_STATUSES) {
    if (cand === from || isAllowedEmployeeLifecycleTransition(from, cand)) {
      if (!seen.has(cand)) {
        seen.add(cand);
        out.push({ value: cand, label: EMPLOYEE_STATUS_LABELS[cand] ?? cand });
      }
    }
  }
  out.sort((a, b) => {
    const ia = DROPDOWN_ORDER.indexOf(a.value as (typeof DROPDOWN_ORDER)[number]);
    const ib = DROPDOWN_ORDER.indexOf(b.value as (typeof DROPDOWN_ORDER)[number]);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });
  return out;
}
