-- A15: payment mode on M-06 payment vouchers (Cash | Cheque | DD | Online)
ALTER TABLE gapmc.payment_vouchers ADD COLUMN IF NOT EXISTS payment_mode text;
