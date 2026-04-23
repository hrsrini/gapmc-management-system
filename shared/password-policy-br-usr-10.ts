/**
 * M-10 BR-USR-10: password rules for local IOMS user accounts (shared by client hints + server enforcement).
 */
export function getPasswordPolicyBrUsr10FirstViolation(password: string): string | null {
  const s = String(password ?? "");
  if (s.length < 12) return "Password must be at least 12 characters.";
  if (!/[A-Z]/.test(s)) return "Password must include at least one upper-case letter.";
  if (!/[a-z]/.test(s)) return "Password must include at least one lower-case letter.";
  if (!/\d/.test(s)) return "Password must include at least one digit.";
  if (!/[^A-Za-z0-9]/.test(s)) return "Password must include at least one special character (non-alphanumeric).";
  return null;
}

export function passwordPolicyBrUsr10Hint(): string {
  return "At least 12 characters with upper-case, lower-case, a digit, and a special character.";
}
