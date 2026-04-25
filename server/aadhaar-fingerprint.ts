import crypto from "crypto";

function secret(): string {
  const s = process.env.AADHAAR_HMAC_SECRET?.trim();
  if (!s) {
    throw new Error("AADHAAR_HMAC_SECRET_NOT_CONFIGURED");
  }
  return s;
}

export function normalizeAadhaarRaw12(input: unknown): string | null {
  if (input == null) return null;
  const d = String(input).replace(/\D/g, "");
  if (d.length === 0) return null;
  if (d.length !== 12) return null;
  return d;
}

export function maskAadhaar(raw12: string): string {
  const last4 = raw12.slice(-4);
  return `XXXX-XXXX-${last4}`;
}

/** BR-EMP-09: SHA256-HMAC fingerprint of Aadhaar raw digits (hex). */
export function aadhaarFingerprintHmac(raw12: string): string {
  return crypto.createHmac("sha256", secret()).update(raw12, "utf8").digest("hex");
}

