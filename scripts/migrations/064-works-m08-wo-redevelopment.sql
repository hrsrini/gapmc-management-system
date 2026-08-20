-- M-08 Works Work-Order redevelopment (confirmed client decisions A1–A19 + answered 3.x)
-- Vendor master, WO workflow, GST bills, mobilization advance, SD/PBG

-- Vendor master (shared; AMC can use later)
CREATE TABLE IF NOT EXISTS gapmc.vendors (
  id text PRIMARY KEY,
  name text NOT NULL,
  code text,
  gstin text,
  pan text,
  contact_name text,
  phone text,
  email text,
  address text,
  status text NOT NULL DEFAULT 'Active',
  created_at text,
  updated_at text
);

CREATE UNIQUE INDEX IF NOT EXISTS vendors_code_uidx
  ON gapmc.vendors (code) WHERE code IS NOT NULL AND btrim(code) <> '';

-- Works extensions
ALTER TABLE gapmc.works ADD COLUMN IF NOT EXISTS vendor_id text;
ALTER TABLE gapmc.works ADD COLUMN IF NOT EXISTS wo_amount_excl_gst double precision;
ALTER TABLE gapmc.works ADD COLUMN IF NOT EXISTS scope_text text;
ALTER TABLE gapmc.works ADD COLUMN IF NOT EXISTS terms_conditions text;
ALTER TABLE gapmc.works ADD COLUMN IF NOT EXISTS dlp_months integer;
ALTER TABLE gapmc.works ADD COLUMN IF NOT EXISTS penalty_text text;
ALTER TABLE gapmc.works ADD COLUMN IF NOT EXISTS retention_percent double precision;
ALTER TABLE gapmc.works ADD COLUMN IF NOT EXISTS remarks text;
ALTER TABLE gapmc.works ADD COLUMN IF NOT EXISTS updated_at text;

-- Map legacy operational statuses into DO→DV→DA workflow vocabulary
UPDATE gapmc.works SET status = 'Draft' WHERE status IN ('Planned');
UPDATE gapmc.works SET status = 'Approved' WHERE status IN ('InProgress');
-- Completed / Closed remain; Rejected is new

CREATE UNIQUE INDEX IF NOT EXISTS works_work_order_no_uidx
  ON gapmc.works (work_order_no) WHERE work_order_no IS NOT NULL AND btrim(work_order_no) <> '';

-- Bills: GST + workflow + lock
ALTER TABLE gapmc.works_bills ADD COLUMN IF NOT EXISTS taxable_amount double precision;
ALTER TABLE gapmc.works_bills ADD COLUMN IF NOT EXISTS gst_percent double precision;
ALTER TABLE gapmc.works_bills ADD COLUMN IF NOT EXISTS gst_amount double precision;
ALTER TABLE gapmc.works_bills ADD COLUMN IF NOT EXISTS do_user text;
ALTER TABLE gapmc.works_bills ADD COLUMN IF NOT EXISTS dv_user text;
ALTER TABLE gapmc.works_bills ADD COLUMN IF NOT EXISTS da_user text;
ALTER TABLE gapmc.works_bills ADD COLUMN IF NOT EXISTS locked_at text;
ALTER TABLE gapmc.works_bills ADD COLUMN IF NOT EXISTS overbilling_override_remark text;
ALTER TABLE gapmc.works_bills ADD COLUMN IF NOT EXISTS remarks text;
ALTER TABLE gapmc.works_bills ADD COLUMN IF NOT EXISTS created_at text;
ALTER TABLE gapmc.works_bills ADD COLUMN IF NOT EXISTS updated_at text;

UPDATE gapmc.works_bills
SET taxable_amount = amount
WHERE taxable_amount IS NULL AND amount IS NOT NULL;

UPDATE gapmc.works_bills
SET status = 'Draft'
WHERE status IS NULL OR status IN ('Pending', '');

-- Mobilization advance (one per WO enforced in API)
CREATE TABLE IF NOT EXISTS gapmc.works_advances (
  id text PRIMARY KEY,
  work_id text NOT NULL UNIQUE,
  amount double precision NOT NULL,
  status text NOT NULL DEFAULT 'Draft',
  remarks text,
  do_user text,
  dv_user text,
  da_user text,
  created_at text,
  updated_at text
);

CREATE TABLE IF NOT EXISTS gapmc.works_advance_adjustments (
  id text PRIMARY KEY,
  advance_id text NOT NULL,
  bill_id text,
  voucher_id text,
  amount double precision NOT NULL,
  remarks text,
  created_by text,
  created_at text
);

-- Security Deposit / PBG (multiple per WO; refund/release workflow in v1)
CREATE TABLE IF NOT EXISTS gapmc.works_sd_pbg (
  id text PRIMARY KEY,
  work_id text NOT NULL,
  instrument_type text NOT NULL, -- SD | PBG
  amount double precision NOT NULL,
  mode text NOT NULL, -- Cash | DD | BG | Other
  instrument_no text,
  bank_name text,
  valid_from text,
  valid_to text,
  other_details text,
  status text NOT NULL DEFAULT 'Active', -- Active | ReleaseRequested | Released | Invoked
  release_status text, -- Draft | Verified | Approved (when releasing)
  release_remarks text,
  do_user text,
  dv_user text,
  da_user text,
  voucher_id text,
  created_at text,
  updated_at text
);

-- Multi-bill payment allocations linked to M-06 voucher
CREATE TABLE IF NOT EXISTS gapmc.works_payment_allocations (
  id text PRIMARY KEY,
  work_id text NOT NULL,
  voucher_id text NOT NULL,
  bill_id text NOT NULL,
  amount double precision NOT NULL,
  advance_adjusted double precision NOT NULL DEFAULT 0,
  created_by text,
  created_at text
);

CREATE INDEX IF NOT EXISTS works_payment_allocations_voucher_idx
  ON gapmc.works_payment_allocations (voucher_id);
CREATE INDEX IF NOT EXISTS works_payment_allocations_bill_idx
  ON gapmc.works_payment_allocations (bill_id);
