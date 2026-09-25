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

/** Normalize employee gender for honorifics / pronouns. */
export function normalizeEmployeeGender(
  gender: string | null | undefined,
): "male" | "female" | null {
  const g = String(gender ?? "").trim().toLowerCase();
  if (!g) return null;
  if (g === "male" || g === "m" || g === "man" || g.startsWith("male")) return "male";
  if (g === "female" || g === "f" || g === "woman" || g.startsWith("female")) return "female";
  return null;
}

/** Shri. / Smt. from employee gender (Male → Shri., Female → Smt.). */
export function employeeHonorific(gender: string | null | undefined): string {
  const g = normalizeEmployeeGender(gender);
  if (g === "male") return "Shri.";
  if (g === "female") return "Smt.";
  return "Shri./Smt.";
}

/** Mr. / Ms. for sanction-order body from employee gender. */
export function employeeMrHonorific(gender: string | null | undefined): string {
  const g = normalizeEmployeeGender(gender);
  if (g === "male") return "Mr.";
  if (g === "female") return "Ms.";
  return "Mr./Ms.";
}

/** He / She (sentence start). */
export function employeeSubjectPronoun(gender: string | null | undefined): string {
  const g = normalizeEmployeeGender(gender);
  if (g === "male") return "He";
  if (g === "female") return "She";
  return "He/She";
}

/** he / she (mid-sentence). */
export function employeeSubjectPronounLower(gender: string | null | undefined): string {
  const g = normalizeEmployeeGender(gender);
  if (g === "male") return "he";
  if (g === "female") return "she";
  return "he/she";
}

/** his / her (possessive). */
export function employeePossessivePronoun(gender: string | null | undefined): string {
  const g = normalizeEmployeeGender(gender);
  if (g === "male") return "his";
  if (g === "female") return "her";
  return "his/her";
}

/** him / her (object). */
export function employeeObjectPronoun(gender: string | null | undefined): string {
  const g = normalizeEmployeeGender(gender);
  if (g === "male") return "him";
  if (g === "female") return "her";
  return "him/her";
}

/** Debit days on orders: whole days zero-padded (02), halves as-is (0.5). */
export function formatSanctionDebitDays(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "01";
  if (Number.isInteger(n)) return String(n).padStart(2, "0");
  return String(n);
}

/** "Earned Leave" → "Earned leave" for sanction wording. */
export function leaveTypeSanctionLabel(label: string): string {
  const t = String(label ?? "").trim();
  if (!t) return t;
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

function parseIsoYmdUtc(isoYmd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoYmd ?? "").trim().slice(0, 10));
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function isoYmdUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addUtcDays(d: Date, n: number): Date {
  const r = new Date(d.getTime());
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}

function enumerateIsoDatesInclusive(fromIso: string, toIso: string): string[] {
  const start = parseIsoYmdUtc(fromIso);
  const end = parseIsoYmdUtc(toIso);
  if (!start || !end || start.getTime() > end.getTime()) return [];
  const out: string[] = [];
  let cur = start;
  while (cur.getTime() <= end.getTime()) {
    out.push(isoYmdUtc(cur));
    cur = addUtcDays(cur, 1);
  }
  return out;
}

function joinWithAnd(parts: string[]): string {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0]!;
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

function joinWithAmpersand(parts: string[]): string {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0]!;
  if (parts.length === 2) return `${parts[0]} & ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")} & ${parts[parts.length - 1]}`;
}

function formatNonWorkingSpanPhrase(fromIso: string, toIso: string): string | null {
  const dates = enumerateIsoDatesInclusive(fromIso, toIso);
  if (!dates.length) return null;
  const dateDisp = dates.map((d) => formatLeaveOrderDateDisplay(d));
  const weekdays = dates.map((d) => {
    const parsed = parseIsoYmdUtc(d);
    return parsed ? WEEKDAY_NAMES[parsed.getUTCDay()]! : "";
  }).filter(Boolean);
  return `on ${joinWithAnd(dateDisp)} being ${joinWithAmpersand(weekdays)}`;
}

/**
 * "with permission to suffix on 26/09/2026 and 27/09/2026 being Saturday & Sunday"
 * (and optional prefix span).
 */
export function formatSanctionPrefixSuffixPermission(opts: {
  fromDate: string;
  toDate: string;
  prefixDays?: number | null;
  suffixDays?: number | null;
  prefixFromDate?: string | null;
  suffixToDate?: string | null;
  prefixSuffixDisallowed?: boolean | null;
}): string | null {
  if (opts.prefixSuffixDisallowed) return null;
  const parts: string[] = [];
  const prefixDays = Number(opts.prefixDays ?? 0);
  const suffixDays = Number(opts.suffixDays ?? 0);
  if (prefixDays > 0 && opts.prefixFromDate) {
    const from = parseIsoYmdUtc(opts.fromDate);
    if (from) {
      const prefixTo = isoYmdUtc(addUtcDays(from, -1));
      const phrase = formatNonWorkingSpanPhrase(String(opts.prefixFromDate).slice(0, 10), prefixTo);
      if (phrase) parts.push(`to prefix ${phrase}`);
    }
  }
  if (suffixDays > 0 && opts.suffixToDate) {
    const to = parseIsoYmdUtc(opts.toDate);
    if (to) {
      const suffixFrom = isoYmdUtc(addUtcDays(to, 1));
      const phrase = formatNonWorkingSpanPhrase(suffixFrom, String(opts.suffixToDate).slice(0, 10));
      if (phrase) parts.push(`to suffix ${phrase}`);
    }
  }
  if (!parts.length) return null;
  return `with permission ${parts.join(" and ")}`;
}

/** Year-end balance certificate date: 31/12/YYYY from leave end date. */
export function formatSanctionBalanceAsOnDate(toDateIso: string | null | undefined): string {
  const raw = String(toDateIso ?? "").trim().slice(0, 10);
  const y = /^(\d{4})-/.exec(raw)?.[1] ?? String(new Date().getFullYear());
  return `31/12/${y}`;
}

export function buildSanctionReadLine(opts: {
  gender?: string | null;
  empName: string;
  designation?: string | null;
  primaryLocation?: string | null;
  section?: string | null;
  yardIsHo?: boolean;
  applicationDated: string;
}): string {
  const honorific = employeeHonorific(opts.gender);
  const bits = [
    `${honorific} ${opts.empName}`.replace(/\s+/g, " ").trim(),
    opts.designation?.trim() || null,
    opts.yardIsHo && opts.section?.trim() ? opts.section.trim() : null,
    opts.primaryLocation?.trim() || null,
  ].filter(Boolean);
  return `READ: - Leave application of ${bits.join(", ")}, dated ${formatLeaveOrderDateDisplay(opts.applicationDated)}.`;
}

export function buildSanctionGrantParagraph(opts: {
  gender?: string | null;
  empName: string;
  designation?: string | null;
  primaryLocation?: string | null;
  leaveTypeLabel: string;
  debitDays: number;
  fromDate: string;
  toDate: string;
  isExPostFacto?: boolean | null;
  leaveHq?: string | null;
  prefixDays?: number | null;
  suffixDays?: number | null;
  prefixFromDate?: string | null;
  suffixToDate?: string | null;
  prefixSuffixDisallowed?: boolean | null;
}): string {
  const mr = employeeMrHonorific(opts.gender);
  const desig = opts.designation?.trim() || "";
  const nameDesig = desig ? `${mr} ${opts.empName}, ${desig}` : `${mr} ${opts.empName}`;
  const location = opts.primaryLocation?.trim() || "________";
  const days = formatSanctionDebitDays(opts.debitDays);
  const leaveLabel = leaveTypeSanctionLabel(opts.leaveTypeLabel);
  const fromDisp = formatLeaveOrderDateDisplay(opts.fromDate);
  const toDisp = formatLeaveOrderDateDisplay(opts.toDate);
  const prefix = opts.isExPostFacto
    ? "Ex-post facto sanction is hereby accorded"
    : "Sanction is hereby accorded";
  let text =
    `${prefix} for grant of ${days} days ${leaveLabel} w.e.f. ${fromDisp} to ${toDisp} ` +
    `to ${nameDesig}, of this Marketing Board, working at ${location}`;
  const perm = formatSanctionPrefixSuffixPermission(opts);
  if (perm) text += `, ${perm}`;
  text += ".";
  const hq = opts.leaveHq?.trim();
  if (hq) {
    text +=
      ` ${employeeSubjectPronoun(opts.gender)} is allowed to leave the headquarters to proceed to ${hq}` +
      ` during the above leave period.`;
  }
  return text;
}

export function buildSanctionContinuationBalanceParagraph(opts: {
  gender?: string | null;
  empName: string;
  designation?: string | null;
  leaveTypeLabel: string;
  balanceAfter: number;
  toDate: string;
}): string {
  const mr = employeeMrHonorific(opts.gender);
  const desig = opts.designation?.trim() || "";
  const nameDesig = desig ? `${mr} ${opts.empName}, ${desig}` : `${mr} ${opts.empName}`;
  const leaveLower = leaveTypeSanctionLabel(opts.leaveTypeLabel).toLowerCase();
  const bal = Number.isFinite(opts.balanceAfter) ? opts.balanceAfter : 0;
  const asOn = formatSanctionBalanceAsOnDate(opts.toDate);
  return (
    `${nameDesig}, would have continued in the same post but for ${employeePossessivePronoun(opts.gender)} proceeding on leave. ` +
    `On expiry of leave, ${nameDesig}, is posted in the same post and station from which ${employeeSubjectPronounLower(opts.gender)} proceeds on leave. ` +
    `Certified that the balance ${leaveLower} after sanctioning the above leave is ${bal} days as on ${asOn}.`
  );
}

/** Copy-to line: omit redundant "(Employee)" suffix. */
export function formatLeaveCopyToLine(item: string): string {
  return String(item ?? "").replace(/\s*\(Employee\)\s*$/i, "").trim();
}
