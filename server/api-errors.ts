/**
 * CC-12: consistent JSON error envelope `{ error, code, details? }` for API errors.
 * Domain codes: `AUTH_*`, `ADMIN_*`, `HR_*`, `HR_EMP_*`, `HR_ROLE_DV_DA_CONFLICT`, `TADA_*`, `VOUCHER_*`, `RENT_*`, `LEAVE_*`, `PURCHASE_TX_*`,
 * `CHECKPOST_*`, `IOMS_*`, `STOCK_OPENING_*`, `ASSISTANT_*`, `RECEIPT_PAYMENT_MODE_INVALID`, `RECEIPT_GATEWAY_DISABLED`, `RECEIPT_CHEQUE_DISHONOUR_INVALID`, `ADMIN_RECEIPT_LOGO_*`, `PAYMENT_WEBHOOK_HMAC_INVALID`, `PAYMENT_WEBHOOK_HMAC_NOT_CONFIGURED`, `PAYMENT_DEV_CALLBACK_DISABLED`, `PAYMENT_LOG_RECEIPT_MISMATCH`, `DAK_DIARY_NO_DUPLICATE`, `BUG_*`, `FLEET_*`, `WORK_*`, `LICENCE_*`, `ASSET_*`, `ALLOTMENT_*`, `M02_*`,
 * `MSP_*`, `RECEIPT_*`, `PAYMENT_LOG_*`, `DAK_*`, `LEGACY_*`, `STOCK_RETURN_*`, `CRON_*`, `ADMIN_CONFIG_URL_INVALID`,
 * `VOUCHER_ATTACHMENT_*`, `DAK_ATTACHMENT_*`, `ADMIN_CONFIG_RETENTION_YEARS`.
 * Unhandled handler failures use `INTERNAL_ERROR` (HTTP 500).
 */
import type { Response } from "express";

export function sendApiError(
  res: Response,
  status: number,
  code: string,
  message: string,
  details?: unknown
): void {
  const body: { error: string; code: string; details?: unknown } = { error: message, code };
  if (details !== undefined) body.details = details;
  res.status(status).json(body);
}

/** Map storage adapter failures to actionable Admin messages (no secrets). */
export function describeStorageFailure(e: unknown, action: string): string {
  const detail = e instanceof Error ? e.message : String(e);
  const lower = detail.toLowerCase();
  if (
    lower.includes("supabase_url") ||
    lower.includes("service_role") ||
    lower.includes("invalid jwt") ||
    lower.includes("invalid api key") ||
    lower.includes("jwt")
  ) {
    return `${action}: Supabase Storage is not configured on this server. Set OBJECT_STORAGE_DRIVER=supabase, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_STORAGE_BUCKET, and SUPABASE_STORAGE_PREFIX on ECS (see docs/DEPLOY-SUPABASE-STORAGE.md).`;
  }
  if (lower.includes("bucket") && lower.includes("not found")) {
    return `${action}: Storage bucket missing. Run npm run storage:ensure-bucket against this Supabase project.`;
  }
  return `${action}: ${detail}`;
}
