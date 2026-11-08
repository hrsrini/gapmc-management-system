-- Case E transit: link security deposit refund at another check post to the original wizard transaction.
ALTER TABLE gapmc.market_transactions
  ADD COLUMN IF NOT EXISTS sd_refund_check_post_id text,
  ADD COLUMN IF NOT EXISTS sd_refund_txn_ref text,
  ADD COLUMN IF NOT EXISTS sd_refund_receipt_id text,
  ADD COLUMN IF NOT EXISTS sd_refund_date text,
  ADD COLUMN IF NOT EXISTS sd_refund_amount double precision,
  ADD COLUMN IF NOT EXISTS sd_refund_recorded_at text,
  ADD COLUMN IF NOT EXISTS sd_refund_recorded_by text;
