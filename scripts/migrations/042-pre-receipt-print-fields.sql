-- Optional fields for standard pre-receipt PDF (rent wording).
ALTER TABLE gapmc.pre_receipts ADD COLUMN IF NOT EXISTS rent_premises_type TEXT;
ALTER TABLE gapmc.pre_receipts ADD COLUMN IF NOT EXISTS rent_premises_ref TEXT;
ALTER TABLE gapmc.pre_receipts ADD COLUMN IF NOT EXISTS rent_billing_month TEXT;
