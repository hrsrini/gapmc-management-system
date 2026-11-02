/**
 * Password policy for IOMS employee/admin accounts (FRD Password Management).
 * - Employees: minimum 8 characters (+ upper, lower, digit, special).
 * - ADMIN user / ADMIN role: minimum 15 characters (same complexity).
 * - Must not contain username, employee ID, or email local-part.
 */

export const PASSWORD_MIN_LENGTH_EMPLOYEE = 8;
export const PASSWORD_MIN_LENGTH_ADMIN = 15;

export type PasswordPolicyContext = {
  /** True when the account has (or will have) ADMIN tier. */
  isAdmin?: boolean;
  /** Values that must not appear in the password (case-insensitive), e.g. username, empId, email local-part. */
  forbiddenSubstrings?: Array<string | null | undefined>;
};

function normalizeForbidden(raw: Array<string | null | undefined> | undefined): string[] {
  const out: string[] = [];
  for (const v of raw ?? []) {
    const t = String(v ?? "")
      .trim()
      .toLowerCase();
    if (t.length >= 3) out.push(t);
  }
  return [...new Set(out)];
}

export function passwordMinLength(isAdmin?: boolean): number {
  return isAdmin ? PASSWORD_MIN_LENGTH_ADMIN : PASSWORD_MIN_LENGTH_EMPLOYEE;
}

/** Returns the first policy violation message, or null when valid. */
export function getPasswordPolicyBrUsr10FirstViolation(
  password: string,
  ctx: PasswordPolicyContext = {},
): string | null {
  const s = String(password ?? "");
  const min = passwordMinLength(ctx.isAdmin);
  if (s.length < min) {
    return ctx.isAdmin
      ? `Password must contain at least ${min} characters for Admin users.`
      : `Password must contain at least ${min} characters.`;
  }
  if (!/[A-Z]/.test(s)) return "Password must contain at least one uppercase letter.";
  if (!/[a-z]/.test(s)) return "Password must contain at least one lowercase letter.";
  if (!/\d/.test(s)) return "Password must contain at least one numeric character.";
  if (!/[^A-Za-z0-9]/.test(s)) {
    return "Password must contain at least one special character (e.g. @, #, $, %, &, *).";
  }
  const lower = s.toLowerCase();
  for (const frag of normalizeForbidden(ctx.forbiddenSubstrings)) {
    // Word-boundary style: block "admin@…" / "EMP-0099" but allow "GapmcAdmin@…"
    // (username embedded inside a longer alphabetic token).
    const escaped = frag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i");
    if (re.test(lower)) {
      return "Password must not contain your User ID, Employee ID, or other easily identifiable personal information.";
    }
  }
  return null;
}

export function passwordPolicyBrUsr10Hint(isAdmin?: boolean): string {
  const min = passwordMinLength(isAdmin);
  if (isAdmin) {
    return `Admin: at least ${min} characters with upper-case, lower-case, a digit, and a special character. Must not contain User ID / Employee ID.`;
  }
  return `At least ${min} characters with upper-case, lower-case, a digit, and a special character. Must not contain User ID / Employee ID.`;
}

/** Collect common identity fragments for password personal-info checks. */
export function passwordForbiddenIdentityFragments(args: {
  email?: string | null;
  username?: string | null;
  empId?: string | null;
  name?: string | null;
}): string[] {
  const frags: string[] = [];
  const email = String(args.email ?? "").trim().toLowerCase();
  if (email) {
    frags.push(email);
    const local = email.split("@")[0];
    if (local) frags.push(local);
  }
  const username = String(args.username ?? "").trim().toLowerCase();
  if (username) frags.push(username);
  const empId = String(args.empId ?? "").trim().toLowerCase();
  if (empId) {
    frags.push(empId);
    frags.push(empId.replace(/^emp-/, ""));
  }
  return frags;
}
