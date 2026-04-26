import crypto from "crypto";

export function normalizeAadhaarRaw12(input: unknown): string | null {
  if (input == null) return null;
  const d = String(input).replace(/\D/g, "");
  if (d.length === 0) return null;
  if (d.length !== 12) return null;
  return d;
}

/** Raw digits from JSON body (camelCase or snake_case); never persists raw. */
export function readAadhaarRawFromRequestBody(body: Record<string, unknown>): string | null {
  return normalizeAadhaarRaw12(body.aadhaarRaw ?? body.aadhaar ?? body.aadhaar_raw);
}

export function maskAadhaar(raw12: string): string {
  const last4 = raw12.slice(-4);
  return `XXXX-XXXX-${last4}`;
}

/** BR-EMP-09: SHA256-HMAC fingerprint of Aadhaar raw digits (hex). */
export function aadhaarFingerprintHmac(raw12: string, secretKey: string): string {
  return crypto.createHmac("sha256", secretKey).update(raw12, "utf8").digest("hex");
}

