-- M-06 Payment Voucher TDS fields (Works M-08 A18)
ALTER TABLE gapmc.payment_vouchers ADD COLUMN IF NOT EXISTS tds_applicable boolean DEFAULT false;
ALTER TABLE gapmc.payment_vouchers ADD COLUMN IF NOT EXISTS tds_section text;
ALTER TABLE gapmc.payment_vouchers ADD COLUMN IF NOT EXISTS tds_rate_percent double precision;
ALTER TABLE gapmc.payment_vouchers ADD COLUMN IF NOT EXISTS tds_applicable_amount double precision;
ALTER TABLE gapmc.payment_vouchers ADD COLUMN IF NOT EXISTS tds_amount double precision DEFAULT 0;
ALTER TABLE gapmc.payment_vouchers ADD COLUMN IF NOT EXISTS net_payable double precision;
