-- Advance rent deposits, deposit ledger entries, and payment adjustments (M-03 FRD).
CREATE TABLE IF NOT EXISTS gapmc.advance_rent_deposits (
  id text PRIMARY KEY,
  deposit_receipt_no text NOT NULL UNIQUE,
  yard_id text NOT NULL,
  trader_licence_id text NOT NULL,
  unified_entity_id text,
  asset_id text NOT NULL,
  allotment_id text,
  deposit_date text NOT NULL,
  period_from text,
  period_to text,
  deposit_amount double precision NOT NULL,
  adjusted_amount double precision NOT NULL DEFAULT 0,
  balance_amount double precision NOT NULL,
  status text NOT NULL DEFAULT 'Active',
  receipt_id text,
  payment_mode text,
  payment_ref text,
  received_by text,
  remarks text,
  created_by text,
  created_at text,
  updated_at text
);

CREATE INDEX IF NOT EXISTS idx_adv_rent_dep_trader ON gapmc.advance_rent_deposits (trader_licence_id);
CREATE INDEX IF NOT EXISTS idx_adv_rent_dep_asset ON gapmc.advance_rent_deposits (asset_id);
CREATE INDEX IF NOT EXISTS idx_adv_rent_dep_status ON gapmc.advance_rent_deposits (status);
CREATE INDEX IF NOT EXISTS idx_adv_rent_dep_yard ON gapmc.advance_rent_deposits (yard_id);

CREATE TABLE IF NOT EXISTS gapmc.advance_rent_deposit_entries (
  id text PRIMARY KEY,
  deposit_id text NOT NULL,
  entry_date text NOT NULL,
  entry_type text NOT NULL,
  amount_inr double precision NOT NULL,
  balance_after double precision NOT NULL,
  invoice_id text,
  invoice_no text,
  adjustment_ref text,
  rent_receipt_id text,
  rent_receipt_no text,
  remarks text,
  created_by text,
  created_at text
);

CREATE INDEX IF NOT EXISTS idx_adv_rent_dep_ent_dep ON gapmc.advance_rent_deposit_entries (deposit_id);
CREATE INDEX IF NOT EXISTS idx_adv_rent_dep_ent_inv ON gapmc.advance_rent_deposit_entries (invoice_id);

CREATE TABLE IF NOT EXISTS gapmc.payment_adjustments (
  id text PRIMARY KEY,
  adjustment_no text NOT NULL UNIQUE,
  yard_id text NOT NULL,
  trader_licence_id text,
  unified_entity_id text,
  against_invoice_id text,
  against_receipt_id text,
  advance_deposit_id text,
  adjustment_type text NOT NULL,
  amount_inr double precision NOT NULL,
  reason text,
  status text NOT NULL DEFAULT 'Draft',
  due_before double precision,
  due_after double precision,
  created_by text,
  approved_by text,
  created_at text,
  approved_at text,
  updated_at text
);

CREATE INDEX IF NOT EXISTS idx_pay_adj_trader ON gapmc.payment_adjustments (trader_licence_id);
CREATE INDEX IF NOT EXISTS idx_pay_adj_invoice ON gapmc.payment_adjustments (against_invoice_id);
CREATE INDEX IF NOT EXISTS idx_pay_adj_status ON gapmc.payment_adjustments (status);

CREATE TABLE IF NOT EXISTS gapmc.payment_adjustment_seq (
  year_month_key text PRIMARY KEY,
  last_seq integer NOT NULL DEFAULT 0
);
