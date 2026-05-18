/**
 * M-01: capture date of occurrence when employee lifecycle status changes.
 */
import { canonicalizeEmployeeStatus } from "./employee-lifecycle-status";

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

export type StatusEffectiveDateMode = "auto_today" | "auto_retirement" | "required_input" | "none";

export function statusEffectiveDateMode(statusRaw: string | null | undefined): StatusEffectiveDateMode {
  const s = canonicalizeEmployeeStatus(statusRaw);
  if (s === "Active") return "auto_today";
  if (s === "RET") return "auto_retirement";
  if (s === "INA" || s === "SUS" || s === "VRS" || s === "RES" || s === "DEC" || s === "TER") return "required_input";
  return "none";
}

export function employeeStatusRequiresEffectiveDate(statusRaw: string | null | undefined): boolean {
  return statusEffectiveDateMode(statusRaw) !== "none";
}

export function statusEffectiveDateLabel(statusRaw: string | null | undefined): string | null {
  const s = canonicalizeEmployeeStatus(statusRaw);
  const labels: Record<string, string> = {
    Active: "Active from",
    INA: "Date of inactivation",
    SUS: "Date of suspension",
    RET: "Date of retirement",
    VRS: "Date of VRS",
    RES: "Date of resignation",
    DEC: "Date of death",
    TER: "Date of termination",
  };
  return labels[s] ?? null;
}

export function isValidStatusEffectiveDateYmd(raw: string | null | undefined): boolean {
  const t = String(raw ?? "").trim();
  if (!YMD_RE.test(t)) return false;
  const [y, m, d] = t.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m! - 1 && dt.getUTCDate() === d!;
}

export function localCalendarYmdUtc(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function resolveStatusEffectiveDate(args: {
  nextStatus: string;
  inputDate?: string | null;
  retirementDate?: string | null;
  todayYmd?: string;
}): { ok: true; date: string } | { ok: false; code: string; message: string } {
  const mode = statusEffectiveDateMode(args.nextStatus);
  const today = args.todayYmd?.trim() || localCalendarYmdUtc();

  if (mode === "none") {
    return { ok: true, date: "" };
  }

  if (mode === "auto_today") {
    return { ok: true, date: today };
  }

  if (mode === "auto_retirement") {
    const ret = String(args.retirementDate ?? "").trim();
    if (isValidStatusEffectiveDateYmd(ret)) return { ok: true, date: ret };
    const input = String(args.inputDate ?? "").trim();
    if (isValidStatusEffectiveDateYmd(input)) return { ok: true, date: input };
    return {
      ok: false,
      code: "HR_EMP_STATUS_DATE_RETIREMENT",
      message: "Retired / Superannuated requires Retirement date on the profile, or enter the date of retirement below.",
    };
  }

  const input = String(args.inputDate ?? "").trim();
  const label = statusEffectiveDateLabel(args.nextStatus) ?? "Date of occurrence";
  if (!input) {
    return { ok: false, code: "HR_EMP_STATUS_DATE_REQUIRED", message: `${label} is required when status is ${args.nextStatus}.` };
  }
  if (!isValidStatusEffectiveDateYmd(input)) {
    return { ok: false, code: "HR_EMP_STATUS_DATE_INVALID", message: `${label} must be a valid date (YYYY-MM-DD).` };
  }
  if (input > today) {
    return { ok: false, code: "HR_EMP_STATUS_DATE_FUTURE", message: `${label} cannot be in the future.` };
  }
  return { ok: true, date: input };
}

/** UI: show occurrence date field when status changes to one that records a date. */
export function shouldPromptStatusEffectiveDateOnSave(
  nextStatusRaw: string,
  previousStatusRaw: string | null | undefined,
): boolean {
  const next = canonicalizeEmployeeStatus(nextStatusRaw);
  const prev = canonicalizeEmployeeStatus(previousStatusRaw);
  if (next === prev) return false;
  return employeeStatusRequiresEffectiveDate(next);
}
