-- M-05 manual receipt types + manual receipt metadata on ioms_receipts
CREATE TABLE IF NOT EXISTS gapmc.manual_receipt_types (
  id text PRIMARY KEY,
  sort_order integer NOT NULL DEFAULT 0,
  ledger_name text NOT NULL UNIQUE,
  tally_ledger_id text,
  primary_group text,
  statement_class text,
  revenue_head text NOT NULL,
  payee_rule text NOT NULL,
  requires_premises boolean NOT NULL DEFAULT false,
  show_in_dropdown boolean NOT NULL DEFAULT true,
  linking_notes text,
  is_active boolean NOT NULL DEFAULT true
);

ALTER TABLE gapmc.ioms_receipts ADD COLUMN IF NOT EXISTS manual_receipt_type_id text;
ALTER TABLE gapmc.ioms_receipts ADD COLUMN IF NOT EXISTS payer_party_type text;
ALTER TABLE gapmc.ioms_receipts ADD COLUMN IF NOT EXISTS payer_address text;
ALTER TABLE gapmc.ioms_receipts ADD COLUMN IF NOT EXISTS payer_contact text;
ALTER TABLE gapmc.ioms_receipts ADD COLUMN IF NOT EXISTS premises_asset_id text;
ALTER TABLE gapmc.ioms_receipts ADD COLUMN IF NOT EXISTS application_ref text;
ALTER TABLE gapmc.ioms_receipts ADD COLUMN IF NOT EXISTS narration text;
