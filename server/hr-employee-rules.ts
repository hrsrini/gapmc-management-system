/**
 * M-01 BR-EMP-01 … BR-EMP-06: employee registration business rules (validation + EMP-ID allocation).
 */
import { and, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { db } from "./db";
import { employees } from "@shared/db-schema";
import { INDIAN_IFSC_RE, INDIAN_MOBILE_10_RE, isStrictAadhaar12Digits } from "@shared/india-validation";
import { getPasswordPolicyBrUsr10FirstViolation } from "@shared/password-policy-br-usr-10";

const EMP_ID_RE = /^EMP-(\d{3})$/i;
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** BR-EMP-01: display / stored format EMP-[NNN] (3 digits, zero-padded). */
export function assertEmpIdFormat(empId: string): void {
  const t = empId.trim().toUpperCase();
  if (!EMP_ID_RE.test(t)) {
    throw new HrEmployeeRuleError("HR_EMP_EMPID_FORMAT", "Employee ID must match EMP-[NNN] (e.g. EMP-001).");
  }
}

export class HrEmployeeRuleError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "HrEmployeeRuleError";
  }
}

const MASKED_AADHAAR_RE = /^XXXX-XXXX-(\d{4})$/i;

/**
 * Accepts stored masked token (XXXX-XXXX-####) or exactly 12 digits (no spaces); stores masked BR-EMP-02.
 */
export function normalizeAadhaarMasked(input: string | null | undefined): string | null {
  if (input == null || String(input).trim() === "") return null;
  const raw = String(input).trim();
  const masked = MASKED_AADHAAR_RE.exec(raw);
  if (masked) {
    return `XXXX-XXXX-${masked[1]}`;
  }
  if (!isStrictAadhaar12Digits(raw)) {
    throw new HrEmployeeRuleError(
      "HR_EMP_AADHAAR_FORMAT",
      "Please enter a valid Aadhaar number (12 digits, no spaces or hyphens).",
    );
  }
  return `XXXX-XXXX-${raw.slice(-4)}`;
}

export function normalizePan(input: string | null | undefined): string | null {
  if (input == null || String(input).trim() === "") return null;
  const p = String(input).trim().toUpperCase().replace(/\s/g, "");
  if (!PAN_RE.test(p)) {
    throw new HrEmployeeRuleError("HR_EMP_PAN_FORMAT", "PAN must be 10 characters: AAAAA9999A.");
  }
  return p;
}

export function assertPersonalEmailFormat(email: string | null | undefined): void {
  if (email == null || String(email).trim() === "") return;
  const e = String(email).trim().toLowerCase();
  if (!EMAIL_RE.test(e)) {
    throw new HrEmployeeRuleError("HR_EMP_EMAIL_FORMAT", "Personal email must be a valid email address.");
  }
}

export function assertWorkEmailFormat(email: string | null | undefined): void {
  if (email == null || String(email).trim() === "") return;
  const e = String(email).trim().toLowerCase();
  if (!EMAIL_RE.test(e)) {
    throw new HrEmployeeRuleError("HR_EMP_WORK_EMAIL_FORMAT", "Work email must be a valid email address.");
  }
}

/** M-10 BR-USR-10: local password policy for IOMS user accounts (create / password change). */
export function assertPasswordComplexityBrUsr10(password: string): void {
  const v = getPasswordPolicyBrUsr10FirstViolation(password);
  if (v) throw new HrEmployeeRuleError("HR_LOGIN_PASSWORD_COMPLEXITY", v);
}

/** Normalizes to 10 digits; null if empty; throws if present but invalid. */
export function normalizeMobile10(input: string | null | undefined): string | null {
  if (input == null || String(input).trim() === "") return null;
  const d = String(input).replace(/\D/g, "");
  if (!INDIAN_MOBILE_10_RE.test(d)) {
    throw new HrEmployeeRuleError("HR_EMP_MOBILE_FORMAT", "Mobile must be a valid 10-digit Indian number.");
  }
  return d;
}

function parseIsoDateParts(s: string): { y: number; m: number; d: number } {
  const part = String(s).trim().slice(0, 10);
  const [y, m, d] = part.split("-").map((x) => parseInt(x, 10));
  if (!y || !m || !d) throw new HrEmployeeRuleError("HR_EMP_DATE_INVALID", "Invalid date (use YYYY-MM-DD).");
  return { y, m, d };
}

/** BR-EMP-04: joining date ≤ today; DOB implies age ≥ 18 on date of joining (and DOB ≤ joining). */
export function assertJoiningAndDob(joiningDate: string, dob: string | null | undefined): void {
  const today = new Date().toISOString().slice(0, 10);
  const j = joiningDate.trim().slice(0, 10);
  if (j > today) {
    throw new HrEmployeeRuleError("HR_EMP_JOINING_FUTURE", "Date of joining cannot be after today.");
  }
  if (dob == null || String(dob).trim() === "") return;
  const b = String(dob).trim().slice(0, 10);
  if (b > today) {
    throw new HrEmployeeRuleError("HR_EMP_DOB_FUTURE", "Date of birth cannot be in the future.");
  }
  if (b > j) {
    throw new HrEmployeeRuleError("HR_EMP_DOB_AFTER_JOIN", "Date of birth cannot be after date of joining.");
  }
  const { y: by, m: bm, d: bd } = parseIsoDateParts(b);
  const birth = new Date(Date.UTC(by, bm - 1, bd));
  const eighteen = new Date(birth);
  eighteen.setUTCFullYear(eighteen.getUTCFullYear() + 18);
  const joinDt = new Date(`${j}T12:00:00.000Z`);
  if (joinDt < eighteen) {
    throw new HrEmployeeRuleError("HR_EMP_AGE_MIN", "Employee must be at least 18 years old on date of joining (from date of birth).");
  }
}

/** Mon–Fri days strictly after `fromIso` through `toIso` (UTC dates). */
export function workingDaysAfter(fromIso: string, toIso: string): number {
  const from = String(fromIso).slice(0, 10);
  const to = String(toIso).slice(0, 10);
  if (to <= from) return 0;
  let count = 0;
  const cur = new Date(`${from}T12:00:00.000Z`);
  const end = new Date(`${to}T12:00:00.000Z`);
  while (cur < end) {
    cur.setUTCDate(cur.getUTCDate() + 1);
    const wd = cur.getUTCDay();
    if (wd !== 0 && wd !== 6) count++;
  }
  return count;
}

/** BR-EMP-05: Draft/Submitted and more than 15 working days since created date. */
export function isEmployeeDraftStale(createdAt: string | null | undefined, status: string): boolean {
  if (status !== "Draft" && status !== "Submitted") return false;
  const c = (createdAt ?? "").slice(0, 10);
  if (!c) return false;
  const today = new Date().toISOString().slice(0, 10);
  return workingDaysAfter(c, today) > 15;
}

/** BR-EMP-03: unique among Active / Draft / Submitted employees. */
const EMAIL_UNIQUENESS_STATUSES = ["Active", "Draft", "Submitted"] as const;

async function panTakenByOther(pan: string, excludeId: string | null): Promise<boolean> {
  const conds = [
    isNotNull(employees.pan),
    sql`upper(trim(${employees.pan})) = ${pan.toUpperCase()}`,
  ];
  if (excludeId) conds.push(ne(employees.id, excludeId));
  const rows = await db.select({ id: employees.id }).from(employees).where(and(...conds));
  return rows.length > 0;
}

async function aadhaarMaskedTakenByOther(masked: string, excludeId: string | null): Promise<boolean> {
  const conds = [eq(employees.aadhaarToken, masked)];
  if (excludeId) conds.push(ne(employees.id, excludeId));
  const rows = await db.select({ id: employees.id }).from(employees).where(and(...conds));
  return rows.length > 0;
}

async function aadhaarFingerprintTakenByOther(fp: string, excludeId: string | null): Promise<boolean> {
  const conds = [isNotNull(employees.aadhaarFingerprint), eq(employees.aadhaarFingerprint, fp)];
  if (excludeId) conds.push(ne(employees.id, excludeId));
  const rows = await db.select({ id: employees.id }).from(employees).where(and(...conds));
  return rows.length > 0;
}

async function personalEmailTakenByOther(emailNorm: string, excludeId: string | null): Promise<boolean> {
  const conds = [
    isNotNull(employees.personalEmail),
    sql`lower(trim(${employees.personalEmail})) = ${emailNorm}`,
    inArray(employees.status, [...EMAIL_UNIQUENESS_STATUSES]),
  ];
  if (excludeId) conds.push(ne(employees.id, excludeId));
  const rows = await db.select({ id: employees.id }).from(employees).where(and(...conds));
  return rows.length > 0;
}

export async function assertEmployeeUniqueness(args: {
  pan: string | null;
  aadhaarMasked: string | null;
  aadhaarFingerprint?: string | null;
  personalEmail: string | null;
  excludeEmployeeId: string | null;
}): Promise<void> {
  if (args.pan && (await panTakenByOther(args.pan, args.excludeEmployeeId))) {
    throw new HrEmployeeRuleError("HR_EMP_PAN_DUPLICATE", "PAN is already used by another employee.");
  }
  if (args.aadhaarFingerprint && (await aadhaarFingerprintTakenByOther(args.aadhaarFingerprint, args.excludeEmployeeId))) {
    throw new HrEmployeeRuleError("HR_EMP_AADHAAR_DUPLICATE", "This Aadhaar is already on file for another employee.");
  }
  if (args.aadhaarMasked && (await aadhaarMaskedTakenByOther(args.aadhaarMasked, args.excludeEmployeeId))) {
    throw new HrEmployeeRuleError("HR_EMP_AADHAAR_DUPLICATE", "This masked Aadhaar value is already on file for another employee.");
  }
  if (args.personalEmail) {
    const e = args.personalEmail.trim().toLowerCase();
    if (await personalEmailTakenByOther(e, args.excludeEmployeeId)) {
      throw new HrEmployeeRuleError("HR_EMP_EMAIL_DUPLICATE", "Personal email is already used by another active or pending employee.");
    }
  }
}

/** Allocate next EMP-NNN from existing official EMP-### ids only. */
export async function allocateNextEmpId(): Promise<string> {
  const rows = await db.select({ empId: employees.empId }).from(employees).where(isNotNull(employees.empId));
  let maxN = 0;
  for (const r of rows) {
    const m = r.empId && EMP_ID_RE.exec(String(r.empId).trim().toUpperCase());
    if (m) maxN = Math.max(maxN, parseInt(m[1]!, 10));
  }
  const next = maxN + 1;
  if (next > 999) {
    throw new HrEmployeeRuleError("HR_EMP_EMPID_EXHAUSTED", "EMP-ID sequence exceeds EMP-999; contact administrator.");
  }
  return `EMP-${String(next).padStart(3, "0")}`;
}

export function isDraftOrSubmitted(status: string): boolean {
  return status === "Draft" || status === "Submitted";
}

/** §4.1.1: Pay Level 1–18 (optional). */
export function normalizePayLevel(input: string | number | null | undefined): number | null {
  if (input == null) return null;
  if (typeof input === "string" && String(input).trim() === "") return null;
  const n = typeof input === "number" ? input : parseInt(String(input).trim(), 10);
  if (Number.isNaN(n) || n < 1 || n > 18) {
    throw new HrEmployeeRuleError("HR_EMP_PAY_LEVEL_RANGE", "Pay level must be a whole number from 1 to 18.");
  }
  return n;
}

/** §4.1.1: bank account 9–18 digits (optional). */
export function normalizeBankAccountNumber(input: string | null | undefined): string | null {
  if (input == null || String(input).trim() === "") return null;
  const d = String(input).replace(/\D/g, "");
  if (d.length < 9 || d.length > 18) {
    throw new HrEmployeeRuleError("HR_EMP_BANK_ACCOUNT_FORMAT", "Bank account number must be 9 to 18 digits.");
  }
  return d;
}

/** §4.1.1: IFSC 11 characters (optional). */
export function normalizeIfscCode(input: string | null | undefined): string | null {
  if (input == null || String(input).trim() === "") return null;
  const t = String(input).trim().toUpperCase().replace(/\s/g, "");
  if (!INDIAN_IFSC_RE.test(t)) {
    throw new HrEmployeeRuleError("HR_EMP_IFSC_FORMAT", "IFSC must be 11 characters: 4 letters, then 0, then 6 letters or digits (e.g. SBIN0001234).");
  }
  return t;
}

function trimMax(input: string | null | undefined, maxLen: number, code: string, label: string): string | null {
  if (input == null || String(input).trim() === "") return null;
  const t = String(input).trim();
  if (t.length > maxLen) {
    throw new HrEmployeeRuleError(code, `${label} must be at most ${maxLen} characters.`);
  }
  return t;
}

/**
 * SCR-EMP-02 / SRS §4.1.1 optional master fields: Location Posted, Pay Level, bank, IFSC, Category, Father/Spouse name.
 */
export function parseEmployeeMasterSrs411Fields(input: {
  locationPosted?: string | null;
  payLevel?: string | number | null;
  bankAccountNumber?: string | null;
  ifscCode?: string | null;
  category?: string | null;
  fatherOrSpouseName?: string | null;
}): {
  locationPosted: string | null;
  payLevel: number | null;
  bankAccountNumber: string | null;
  ifscCode: string | null;
  category: string | null;
  fatherOrSpouseName: string | null;
} {
  return {
    locationPosted: trimMax(
      input.locationPosted ?? null,
      200,
      "HR_EMP_LOCATION_POSTED_LENGTH",
      "Location posted",
    ),
    payLevel: normalizePayLevel(input.payLevel ?? null),
    bankAccountNumber: normalizeBankAccountNumber(input.bankAccountNumber ?? null),
    ifscCode: normalizeIfscCode(input.ifscCode ?? null),
    category: trimMax(input.category ?? null, 100, "HR_EMP_CATEGORY_LENGTH", "Category"),
    fatherOrSpouseName: trimMax(
      input.fatherOrSpouseName ?? null,
      150,
      "HR_EMP_FATHER_SPOUSE_LENGTH",
      "Father or spouse name",
    ),
  };
}
