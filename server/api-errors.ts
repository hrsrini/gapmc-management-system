/**
 * CC-12: consistent JSON error envelope `{ error, code, details? }` for API errors.
 * Domain codes: `AUTH_*`, `ADMIN_*`, `HR_*`, `VOUCHER_*`, `RENT_*`, `LEAVE_*`, `PURCHASE_TX_*`,
 * `CHECKPOST_*`, `IOMS_*`, `BUG_*`, `FLEET_*`, `WORK_*`, `LICENCE_*`, `ASSET_*`, `ALLOTMENT_*`, `M02_*`,
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
