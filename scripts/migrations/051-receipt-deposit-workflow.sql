-- M-05 §8.4 Receipt Deposit and Settlement Workflow (FR-RCP-010–014)

CREATE TABLE IF NOT EXISTS gapmc.gaplmb_bank_accounts (
  id text PRIMARY KEY,
  bank_name text NOT NULL,
  account_number text NOT NULL,
  ifsc_code text,
  branch text,
  is_active boolean NOT NULL DEFAULT true,
  created_by text,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS gaplmb_bank_accounts_account_ifsc_uq
  ON gapmc.gaplmb_bank_accounts (account_number, COALESCE(ifsc_code, ''));

CREATE TABLE IF NOT EXISTS gapmc.gaplmb_bank_account_yards (
  bank_account_id text NOT NULL REFERENCES gapmc.gaplmb_bank_accounts(id) ON DELETE CASCADE,
  yard_id text NOT NULL,
  PRIMARY KEY (bank_account_id, yard_id)
);

CREATE TABLE IF NOT EXISTS gapmc.gaplmb_bank_account_roles (
  bank_account_id text NOT NULL REFERENCES gapmc.gaplmb_bank_accounts(id) ON DELETE CASCADE,
  role_tier text NOT NULL,
  PRIMARY KEY (bank_account_id, role_tier)
);

CREATE TABLE IF NOT EXISTS gapmc.receipt_deposit_sequence (
  yard_id text NOT NULL,
  deposit_date_ymd text NOT NULL,
  last_seq integer NOT NULL DEFAULT 0,
  PRIMARY KEY (yard_id, deposit_date_ymd)
);

CREATE TABLE IF NOT EXISTS gapmc.receipt_deposits (
  id text PRIMARY KEY,
  deposit_ref_no text NOT NULL UNIQUE,
  yard_id text NOT NULL,
  bank_account_id text NOT NULL REFERENCES gapmc.gaplmb_bank_accounts(id),
  deposit_date text NOT NULL,
  total_amount double precision NOT NULL DEFAULT 0,
  status text NOT NULL,
  passbook_reference text,
  passbook_date text,
  verified_by text,
  verified_at text,
  approved_by text,
  approved_at text,
  rejection_reason text,
  reversal_reason text,
  reversed_by text,
  reversed_at text,
  has_dishonoured_cheque boolean NOT NULL DEFAULT false,
  dishonour_date text,
  created_by text,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

CREATE INDEX IF NOT EXISTS receipt_deposits_yard_status_idx
  ON gapmc.receipt_deposits (yard_id, status);

CREATE TABLE IF NOT EXISTS gapmc.receipt_deposit_lines (
  id text PRIMARY KEY,
  deposit_id text NOT NULL REFERENCES gapmc.receipt_deposits(id) ON DELETE CASCADE,
  receipt_id text NOT NULL REFERENCES gapmc.ioms_receipts(id),
  amount double precision NOT NULL
);

CREATE INDEX IF NOT EXISTS receipt_deposit_lines_receipt_idx
  ON gapmc.receipt_deposit_lines (receipt_id);

ALTER TABLE gapmc.ioms_receipts ADD COLUMN IF NOT EXISTS deposit_status text;
ALTER TABLE gapmc.ioms_receipts ADD COLUMN IF NOT EXISTS deposit_id text;
ALTER TABLE gapmc.ioms_receipts ADD COLUMN IF NOT EXISTS deposit_deferred_until text;

COMMENT ON COLUMN gapmc.ioms_receipts.deposit_status IS 'Undeposited | DepositedPendingVerification | DepositVerified | DepositSettled | AutoSettled | NotCleared';
COMMENT ON TABLE gapmc.receipt_deposits IS 'M-05 bank deposit batches (DEP-[LOC]-[YYYYMMDD]-[NNN])';

-- Existing paid cash/cheque/DD: treat as already settled (ledger may already be posted).
UPDATE gapmc.ioms_receipts
SET deposit_status = 'DepositSettled'
WHERE deposit_status IS NULL
  AND status IN ('Paid', 'Reconciled')
  AND payment_mode IN ('Cash', 'Cheque', 'DD');

UPDATE gapmc.ioms_receipts
SET deposit_status = 'AutoSettled'
WHERE deposit_status IS NULL
  AND status IN ('Paid', 'Reconciled')
  AND payment_mode NOT IN ('Cash', 'Cheque', 'DD');
