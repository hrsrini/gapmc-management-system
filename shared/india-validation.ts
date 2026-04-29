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

/**
 * Strip non-digits and cap length at 10 for mobile text fields (UI entry only).
 * Use with `parseIndianMobile10Digits` / server `normalizeMobile10` for full validation on save.
 */
export function sanitizeMobile10Input(raw: string): string {
  return String(raw).replace(/\D/g, "").slice(0, 10);
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

/** Indian bank IFSC: 4 letters + 0 + 6 alphanumeric (e.g. SBIN0001234). SRS / BR-EMP data dictionary. */
export const INDIAN_IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

export function normalizeIfscInput(raw: string): string {
  return String(raw).trim().toUpperCase().replace(/\s/g, "");
}

export function isValidIfscFormat(raw: string): boolean {
  const t = normalizeIfscInput(raw);
  return t.length > 0 && INDIAN_IFSC_RE.test(t);
}

/** Indian PAN: 5 letters + 4 digits + 1 letter (e.g. ABCDE1234F). */
export const INDIAN_PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;

export function normalizePanInput(raw: string): string {
  return String(raw ?? "").trim().toUpperCase().replace(/\s/g, "").slice(0, 10);
}

export function isValidPanFormat(raw: string): boolean {
  const t = normalizePanInput(raw);
  return t.length === 10 && INDIAN_PAN_RE.test(t);
}

/**
 * Returns the first mismatch index (0..9) for the PAN pattern template AAAAA9999A.
 * Returns null when the provided value is fully valid.
 */
export function panFirstMismatchIndex(raw: string): number | null {
  const t = normalizePanInput(raw);
  if (t.length === 0) return null;
  const template = "AAAAA9999A";
  const n = Math.min(t.length, 10);
  for (let i = 0; i < n; i++) {
    const want = template[i]!;
    const ch = t[i]!;
    const ok = want === "A" ? /^[A-Z]$/.test(ch) : /^[0-9]$/.test(ch);
    if (!ok) return i;
  }
  // If length is 10 but regex fails (shouldn't happen given checks above), highlight last char.
  if (t.length === 10 && !INDIAN_PAN_RE.test(t)) return 9;
  return null;
}

/** H.2.2 — mask PAN in CSV / bulk exports (never emit full PAN). */
export function maskPanForExport(pan: string | null | undefined): string {
  const t = normalizePanInput(String(pan ?? ""));
  if (t.length === 0) return "";
  if (t.length !== 10 || !INDIAN_PAN_RE.test(t)) return "**********";
  return `${t.slice(0, 2)}******${t.slice(8)}`;
}
