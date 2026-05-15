-- M-03: interest rows payment status + receipt breakdown for rent+interest combined receipts.
ALTER TABLE gapmc.ioms_receipts ADD COLUMN IF NOT EXISTS m03_breakdown_json text;
ALTER TABLE gapmc.rent_deposit_ledger ADD COLUMN IF NOT EXISTS interest_payment_status text;
ALTER TABLE gapmc.rent_deposit_ledger ADD COLUMN IF NOT EXISTS settled_receipt_id text;

UPDATE gapmc.rent_deposit_ledger
SET interest_payment_status = 'Unpaid'
WHERE entry_type = 'Interest' AND (interest_payment_status IS NULL OR trim(interest_payment_status) = '');
