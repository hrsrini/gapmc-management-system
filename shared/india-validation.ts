/**
 * India-specific field checks (email, mobile, Aadhaar) used on client and server.
 */

/** Practical RFC 5322–style check; aligns with existing HR personal email rule. */
export const STANDARD_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 10-digit Indian mobile (starts with 6–9). */
export const INDIAN_MOBILE_10_RE = /^[6-9]\d{9}$/;

export function isValidEmailFormat(email: string): boolean {
  const e = email.trim().toLowerCase();
  return e.length > 0 && STANDARD_EMAIL_RE.test(e);
}

/** Digits-only mobile; empty input → null. Returns null if not exactly 10 valid digits. */
export function parseIndianMobile10Digits(input: string | null | undefined): string | null {
  if (input == null || String(input).trim() === "") return null;
  const d = String(input).replace(/\D/g, "");
  if (!INDIAN_MOBILE_10_RE.test(d)) return null;
  return d;
}

/** True if value is exactly 12 digits, no spaces or other characters. */
export function isStrictAadhaar12Digits(raw: string): boolean {
  const t = String(raw).trim();
  return t.length === 12 && /^\d{12}$/.test(t);
}
