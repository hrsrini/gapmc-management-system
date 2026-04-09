/**
 * CC-12: consistent JSON error envelope `{ error, code, details? }` for API errors.
 * Domain codes: `AUTH_*`, `ADMIN_*`, `HR_*`, `HR_EMP_*`, `HR_ROLE_DV_DA_CONFLICT`, `TADA_*`, `VOUCHER_*`, `RENT_*`, `LEAVE_*`, `PURCHASE_TX_*`,
 * `CHECKPOST_*`, `IOMS_*`, `STOCK_OPENING_*`, `ASSISTANT_*`, `RECEIPT_PAYMENT_MODE_INVALID`, `RECEIPT_GATEWAY_DISABLED`, `RECEIPT_CHEQUE_DISHONOUR_INVALID`, `PAYMENT_WEBHOOK_HMAC_INVALID`, `DAK_DIARY_NO_DUPLICATE`, `BUG_*`, `FLEET_*`, `WORK_*`, `LICENCE_*`, `ASSET_*`, `ALLOTMENT_*`, `M02_*`,
 * `MSP_*`, `RECEIPT_*`, `PAYMENT_LOG_*`, `DAK_*`, `LEGACY_*`, `STOCK_RETURN_*`, `CRON_*`.
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
