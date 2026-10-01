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

/**
 * Normalize marital status for salutation rules.
 * Accepts HR form values (Single/Married/Widowed/Divorced) and spreadsheet labels
 * (Unmarried/Divorcee/Not Specified).
 */
export function normalizeMaritalStatus(
  maritalStatus: string | null | undefined,
): "married" | "unmarried" | "widowed" | "divorcee" | "not_specified" {
  const s = String(maritalStatus ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ");
  if (!s || s === "not specified" || s === "n/a" || s === "na" || s === "none" || s === "unspecified") {
    return "not_specified";
  }
  if (s === "married" || s.startsWith("married")) return "married";
  if (
    s === "unmarried" ||
    s === "single" ||
    s === "bachelor" ||
    s === "spinster" ||
    s.startsWith("unmarried") ||
    s.startsWith("single")
  ) {
    return "unmarried";
  }
  if (s === "widowed" || s === "widow" || s === "widower" || s.startsWith("widow")) return "widowed";
  if (s === "divorcee" || s === "divorced" || s === "divorce" || s.startsWith("divor")) return "divorcee";
  return "not_specified";
}

/**
 * Salutation prefix from gender + marital status (mapping table):
 * Male → Mr.; Female Married → Mrs.; Unmarried → Miss.; Widowed/Divorcee/Not Specified → Ms.
 * Used on READ line and other honorific spots (replaces Shri./Smt.).
 */
export function employeeHonorific(
  gender: string | null | undefined,
  maritalStatus?: string | null,
): string {
  return employeeMrHonorific(gender, maritalStatus);
}

/**
 * Body/paragraph salutation from gender + marital status (same mapping as employeeHonorific):
 * Male → Mr.; Female Married → Mrs.; Unmarried → Miss.; Widowed/Divorcee/Not Specified → Ms.
 */
export function employeeMrHonorific(
  gender: string | null | undefined,
  maritalStatus?: string | null,
): string {
  const g = normalizeEmployeeGender(gender);
  const m = normalizeMaritalStatus(maritalStatus);
  if (g === "male") return "Mr.";
  if (g === "female") {
    if (m === "married") return "Mrs.";
    if (m === "unmarried") return "Miss.";
    return "Ms.";
  }
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
  maritalStatus?: string | null;
  empName: string;
  designation?: string | null;
  primaryLocation?: string | null;
  section?: string | null;
  yardIsHo?: boolean;
  applicationDated: string;
}): string {
  const honorific = employeeHonorific(opts.gender, opts.maritalStatus);
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
  maritalStatus?: string | null;
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
  const mr = employeeMrHonorific(opts.gender, opts.maritalStatus);
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

export function buildSanctionContinuationParagraph(opts: {
  gender?: string | null;
  maritalStatus?: string | null;
  empName: string;
  designation?: string | null;
}): string {
  const mr = employeeMrHonorific(opts.gender, opts.maritalStatus);
  const desig = opts.designation?.trim() || "";
  const nameDesig = desig ? `${mr} ${opts.empName}, ${desig}` : `${mr} ${opts.empName}`;
  return (
    `${nameDesig}, would have continued in the same post but for ${employeePossessivePronoun(opts.gender)} proceeding on leave. ` +
    `On expiry of leave, ${nameDesig}, is posted in the same post and station from which ${employeeSubjectPronounLower(opts.gender)} proceeds on leave.`
  );
}

export function buildSanctionBalanceCertificateParagraph(opts: {
  leaveTypeLabel: string;
  balanceAfter: number;
  toDate: string;
}): string {
  const leaveLower = leaveTypeSanctionLabel(opts.leaveTypeLabel).toLowerCase();
  const bal = Number.isFinite(opts.balanceAfter) ? opts.balanceAfter : 0;
  const asOn = formatSanctionBalanceAsOnDate(opts.toDate);
  return `Certified that the balance ${leaveLower} after sanctioning the above leave is ${bal} days as on ${asOn}.`;
}

/** @deprecated Prefer buildSanctionContinuationParagraph + buildSanctionBalanceCertificateParagraph. */
export function buildSanctionContinuationBalanceParagraph(opts: {
  gender?: string | null;
  maritalStatus?: string | null;
  empName: string;
  designation?: string | null;
  leaveTypeLabel: string;
  balanceAfter: number;
  toDate: string;
}): string {
  return (
    `${buildSanctionContinuationParagraph(opts)} ` +
    buildSanctionBalanceCertificateParagraph(opts)
  );
}

/**
 * Default sanction-order Copy to list (specimen + spreadsheet rules).
 * 1. Applicant location: Yard / Checkpost In-charge line, or "{Section}, HO"
 * 2. Substitute duty line (if selected) — substitute salutation + applicant pronouns
 * 3. Substitute location line only when substitute is from a different yard/section
 * 4–5. Accounts Section, Personal File
 * Never includes applicant name, Guard File, or service-book line.
 */
export type LeaveYardKind = "ho" | "yard" | "checkpost" | "unknown";

export function classifyLeaveYardKind(opts: {
  type?: string | null;
  name?: string | null;
  code?: string | null;
}): LeaveYardKind {
  const t = String(opts.type ?? "").trim().toUpperCase().replace(/[\s_-]+/g, "");
  const name = String(opts.name ?? "").toLowerCase();
  const code = String(opts.code ?? "").toLowerCase();
  if (t === "HO" || name.includes("head office") || code === "ho" || code.startsWith("ho-")) return "ho";
  if (
    t === "CHECKPOST" ||
    t === "CP" ||
    name.includes("checkpost") ||
    name.includes("check post") ||
    code.includes("cp")
  ) {
    return "checkpost";
  }
  if (t === "YARD" || name.includes("yard") || code.includes("yard")) return "yard";
  if (t) return "yard";
  return "unknown";
}

/** Copy-to location line for an employee posting (applicant or substitute). */
export function buildSanctionCopyLocationLine(opts: {
  yardKind: LeaveYardKind;
  section?: string | null;
  locationName?: string | null;
  forInformation?: boolean;
}): string {
  const loc = opts.locationName?.trim() || "—";
  const info = opts.forInformation ? " for information" : "";
  if (opts.yardKind === "ho") {
    const section = opts.section?.trim();
    return section ? `${section}, HO${info}` : `Head Office${info}`;
  }
  if (opts.yardKind === "checkpost") {
    return `Market Supervisor / Checkpost In-charge – ${loc}${info}`;
  }
  return `Market Supervisor / Yard In-charge – ${loc}${info}`;
}

function sameSanctionPosting(a: {
  yardKind: LeaveYardKind;
  section?: string | null;
  locationName?: string | null;
}, b: {
  yardKind: LeaveYardKind;
  section?: string | null;
  locationName?: string | null;
}): boolean {
  if (a.yardKind !== b.yardKind) return false;
  if (a.yardKind === "ho") {
    return String(a.section ?? "").trim().toLowerCase() === String(b.section ?? "").trim().toLowerCase();
  }
  return String(a.locationName ?? "").trim().toLowerCase() === String(b.locationName ?? "").trim().toLowerCase();
}

export function buildDefaultSanctionCopyTo(opts: {
  gender?: string | null;
  maritalStatus?: string | null;
  empName: string;
  section?: string | null;
  primaryLocation?: string | null;
  /** Preferred over yardIsHo when provided. */
  yardKind?: LeaveYardKind | null;
  /** @deprecated Prefer yardKind. */
  yardIsHo?: boolean;
  substituteName?: string | null;
  substituteGender?: string | null;
  substituteMaritalStatus?: string | null;
  substituteSection?: string | null;
  substitutePrimaryLocation?: string | null;
  substituteYardKind?: LeaveYardKind | null;
}): string[] {
  const applicantKind: LeaveYardKind =
    opts.yardKind ?? (opts.yardIsHo ? "ho" : opts.primaryLocation ? "yard" : "unknown");
  const applicantPosting = {
    yardKind: applicantKind,
    section: opts.section,
    locationName: opts.primaryLocation,
  };
  const rows: string[] = [buildSanctionCopyLocationLine(applicantPosting)];

  const sub = opts.substituteName?.trim();
  if (sub) {
    const subMr = employeeMrHonorific(opts.substituteGender, opts.substituteMaritalStatus);
    const appMr = employeeMrHonorific(opts.gender, opts.maritalStatus);
    const poss = employeePossessivePronoun(opts.gender);
    rows.push(
      `${subMr} ${sub}, will do the duties of ${appMr} ${opts.empName} during ${poss} leave period`,
    );

    const subKind = opts.substituteYardKind ?? "unknown";
    if (subKind !== "unknown") {
      const subPosting = {
        yardKind: subKind,
        section: opts.substituteSection,
        locationName: opts.substitutePrimaryLocation,
      };
      if (!sameSanctionPosting(applicantPosting, subPosting)) {
        rows.push(buildSanctionCopyLocationLine({ ...subPosting, forInformation: true }));
      }
    }
  }

  rows.push("Accounts Section", "Personal File");
  return rows;
}

/** Copy-to line: omit redundant "(Employee)" suffix. */
export function formatLeaveCopyToLine(item: string): string {
  return String(item ?? "").replace(/\s*\(Employee\)\s*$/i, "").trim();
}

const HONORIFIC_PREFIX_RE = /^(Mr\.|Mrs\.|Miss\.|Ms\.|Shri\.|Smt\.|Kum\.)\s+/i;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True when a copy-to line refers to this person (full or first+last), ignoring an existing honorific. */
export function copyToLineRefersToPerson(line: string, fullName: string): boolean {
  const bare = String(line ?? "").trim().replace(HONORIFIC_PREFIX_RE, "").trim();
  const n = String(fullName ?? "").trim();
  if (!bare || !n) return false;
  const b = bare.toLowerCase();
  const name = n.toLowerCase();
  if (b === name || b.startsWith(`${name} `) || b.startsWith(`${name},`)) return true;
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    const firstLast = `${parts[0]} ${parts[parts.length - 1]}`;
    if (b === firstLast || b.startsWith(`${firstLast} `) || b.startsWith(`${firstLast},`)) return true;
  }
  return false;
}

/**
 * Ensure any copy-to line that names a known person starts with the mapping-table salutation
 * (Mr. / Mrs. / Miss. / Ms.). Replaces legacy Shri./Smt. prefixes as well.
 */
export function applySalutationsToCopyToLines(
  lines: string[],
  people: Array<{ name: string; gender?: string | null; maritalStatus?: string | null }>,
): string[] {
  const known = people
    .map((p) => ({
      name: String(p.name ?? "").trim(),
      gender: p.gender,
      maritalStatus: p.maritalStatus,
    }))
    .filter((p) => p.name.length > 0)
    // Longer names first so "Sujit Jaiprakash Prabhudesai" wins over shorter matches.
    .sort((a, b) => b.name.length - a.name.length);

  return lines.map((raw) => {
    const line = formatLeaveCopyToLine(raw);
    if (!line) return line;
    for (const p of known) {
      if (!copyToLineRefersToPerson(line, p.name)) continue;
      const honorific = employeeMrHonorific(p.gender, p.maritalStatus);
      const bare = line.replace(HONORIFIC_PREFIX_RE, "").trim();
      // Prefer the canonical full name when the line uses a shortened form of the same person.
      const bareLower = bare.toLowerCase();
      const fullLower = p.name.toLowerCase();
      let rest = bare;
      if (bareLower === fullLower || bareLower.startsWith(`${fullLower} `) || bareLower.startsWith(`${fullLower},`)) {
        rest = bare;
      } else {
        const parts = p.name.split(/\s+/).filter(Boolean);
        if (parts.length >= 2) {
          const firstLast = `${parts[0]} ${parts[parts.length - 1]}`;
          const fl = firstLast.toLowerCase();
          if (bareLower === fl || bareLower.startsWith(`${fl} `) || bareLower.startsWith(`${fl},`)) {
            rest = bare.replace(new RegExp(`^${escapeRegExp(firstLast)}`, "i"), p.name);
          }
        }
      }
      return `${honorific} ${rest}`.replace(/\s+/g, " ").trim();
    }
    return line;
  });
}
