-- Case E: mark Security Deposit (Market Fee) as expired / retained when validity window ends without refund.
ALTER TABLE gapmc.market_transactions
  ADD COLUMN IF NOT EXISTS sd_expired_at text,
  ADD COLUMN IF NOT EXISTS sd_expired_booked_at text;
