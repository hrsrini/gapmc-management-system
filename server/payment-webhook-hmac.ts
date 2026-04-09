import crypto from "crypto";
import type { Request } from "express";

type ReqWithRaw = Request & { rawBody?: Buffer };

/**
 * When `PAYMENT_WEBHOOK_HMAC_SECRET` is set, callbacks must send `X-Payment-Signature`
 * (or `X-Signature-Hmac-Sha256`) equal to lowercase hex SHA256-HMAC of the **raw** JSON body.
 * Omit the env var to skip verification (dev / pre-policy).
 */
export function verifyPaymentWebhookHmac(req: ReqWithRaw): { ok: true } | { ok: false; reason: string } {
  const secret = process.env.PAYMENT_WEBHOOK_HMAC_SECRET?.trim();
  if (!secret) return { ok: true };

  const h1 = req.headers["x-payment-signature"];
  const h2 = req.headers["x-signature-hmac-sha256"];
  const rawSig = (Array.isArray(h1) ? h1[0] : h1) ?? (Array.isArray(h2) ? h2[0] : h2);
  const sig = rawSig ? String(rawSig).trim() : "";
  const raw = req.rawBody;
  if (!raw || !Buffer.isBuffer(raw)) {
    return { ok: false, reason: "Raw request body required for HMAC (ensure JSON parser preserves rawBody)" };
  }
  if (!sig) {
    return { ok: false, reason: "Missing X-Payment-Signature (or X-Signature-Hmac-Sha256)" };
  }

  const expectedHex = crypto.createHmac("sha256", secret).update(raw).digest("hex");
  const normalized = sig.toLowerCase().startsWith("sha256=") ? sig.slice(7).trim().toLowerCase() : sig.toLowerCase();

  try {
    const a = Buffer.from(normalized, "utf8");
    const b = Buffer.from(expectedHex, "utf8");
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return { ok: false, reason: "HMAC signature mismatch" };
    }
  } catch {
    return { ok: false, reason: "HMAC signature compare failed" };
  }

  return { ok: true };
}
