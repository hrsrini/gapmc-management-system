-- M-02: Godown premises security deposit (per premises) + refund proposals.

CREATE TABLE IF NOT EXISTS gapmc.premises_security_deposits (
  id TEXT PRIMARY KEY,
  yard_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  premises_label TEXT,
  payer_type TEXT NOT NULL,
  payer_ref_id TEXT NOT NULL,
  payer_name TEXT,
  unified_entity_id TEXT,
  asset_allotment_id TEXT,
  entity_allotment_id TEXT,
  premises_agreement_id TEXT,
  agreement_line_id TEXT,
  amount DOUBLE PRECISION NOT NULL,
  status TEXT NOT NULL DEFAULT 'Held',
  deposit_receipt_id TEXT,
  deposit_receipt_no TEXT,
  deposit_receipt_date TEXT,
  refund_proposal_id TEXT,
  refund_receipt_id TEXT,
  refund_receipt_no TEXT,
  refunded_at TEXT,
  vacated_on TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS premises_security_deposits_payer_idx
  ON gapmc.premises_security_deposits (payer_type, payer_ref_id);
CREATE INDEX IF NOT EXISTS premises_security_deposits_yard_idx
  ON gapmc.premises_security_deposits (yard_id);
CREATE INDEX IF NOT EXISTS premises_security_deposits_status_idx
  ON gapmc.premises_security_deposits (status);
CREATE INDEX IF NOT EXISTS premises_security_deposits_asset_idx
  ON gapmc.premises_security_deposits (asset_id);

CREATE TABLE IF NOT EXISTS gapmc.sd_refund_proposals (
  id TEXT PRIMARY KEY,
  proposal_no TEXT NOT NULL UNIQUE,
  yard_id TEXT NOT NULL,
  payer_type TEXT NOT NULL,
  payer_ref_id TEXT NOT NULL,
  payer_name TEXT,
  unified_entity_id TEXT,
  proposal_date TEXT NOT NULL,
  selected_deposit_total DOUBLE PRECISION NOT NULL DEFAULT 0,
  deductions_total DOUBLE PRECISION NOT NULL DEFAULT 0,
  net_payable DOUBLE PRECISION NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Draft',
  payment_mode TEXT,
  payment_date TEXT,
  cheque_no TEXT,
  bank_name TEXT,
  cheque_date TEXT,
  utr_ref TEXT,
  payment_remarks TEXT,
  do_user TEXT,
  dv_user TEXT,
  da_user TEXT,
  submitted_at TEXT,
  verified_at TEXT,
  approved_at TEXT,
  returned_at TEXT,
  rejected_at TEXT,
  return_or_reject_remarks TEXT,
  refund_receipt_id TEXT,
  refund_receipt_no TEXT,
  workflow_revision_count INTEGER DEFAULT 0,
  created_at TEXT,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS sd_refund_proposals_payer_idx
  ON gapmc.sd_refund_proposals (payer_type, payer_ref_id);
CREATE INDEX IF NOT EXISTS sd_refund_proposals_status_idx
  ON gapmc.sd_refund_proposals (status);

CREATE TABLE IF NOT EXISTS gapmc.sd_refund_proposal_deposits (
  id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL,
  deposit_id TEXT NOT NULL,
  amount DOUBLE PRECISION NOT NULL
);

CREATE INDEX IF NOT EXISTS sd_refund_proposal_deposits_proposal_idx
  ON gapmc.sd_refund_proposal_deposits (proposal_id);

CREATE TABLE IF NOT EXISTS gapmc.sd_refund_proposal_deductions (
  id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL,
  amount DOUBLE PRECISION NOT NULL
);

CREATE INDEX IF NOT EXISTS sd_refund_proposal_deductions_proposal_idx
  ON gapmc.sd_refund_proposal_deductions (proposal_id);

CREATE TABLE IF NOT EXISTS gapmc.sd_refund_proposal_sequence (
  id TEXT PRIMARY KEY,
  financial_year TEXT NOT NULL UNIQUE,
  last_seq INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS gapmc.premises_sd_ledger_entries (
  id TEXT PRIMARY KEY,
  yard_id TEXT NOT NULL,
  payer_type TEXT NOT NULL,
  payer_ref_id TEXT NOT NULL,
  unified_entity_id TEXT,
  entry_date TEXT NOT NULL,
  particulars TEXT NOT NULL,
  linked_doc_type TEXT,
  linked_doc_id TEXT,
  linked_doc_no TEXT,
  premises_label TEXT,
  asset_id TEXT,
  credit_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  debit_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at TEXT
);

CREATE INDEX IF NOT EXISTS premises_sd_ledger_entries_payer_idx
  ON gapmc.premises_sd_ledger_entries (payer_type, payer_ref_id);

-- Backfill Held deposits from trader asset allotments that already have SD amount.
INSERT INTO gapmc.premises_security_deposits (
  id, yard_id, asset_id, premises_label, payer_type, payer_ref_id, payer_name,
  unified_entity_id, asset_allotment_id, amount, status,
  deposit_receipt_id, deposit_receipt_no, deposit_receipt_date,
  vacated_on, created_at, updated_at
)
SELECT
  'psd_aa_' || a.id,
  COALESCE(ast.yard_id, ''),
  a.asset_id,
  COALESCE(ast.asset_id, a.asset_id),
  'TraderLicence',
  a.trader_licence_id,
  a.allottee_name,
  'TA:' || a.trader_licence_id,
  a.id,
  a.security_deposit,
  CASE WHEN a.status = 'Vacated' THEN 'Held' ELSE 'Held' END,
  r.id,
  r.receipt_no,
  LEFT(COALESCE(r.created_at, a.allotment_date, a.from_date, NOW()::text), 10),
  CASE WHEN a.status = 'Vacated' THEN a.to_date ELSE NULL END,
  COALESCE(a.allotment_date, a.from_date, NOW()::text),
  COALESCE(a.approved_at, a.allotment_date, a.from_date, NOW()::text)
FROM gapmc.asset_allotments a
LEFT JOIN gapmc.assets ast ON ast.id = a.asset_id
LEFT JOIN LATERAL (
  SELECT ir.id, ir.receipt_no, ir.created_at
  FROM gapmc.ioms_receipts ir
  WHERE ir.source_module = 'M-02'
    AND ir.source_record_id = a.id
    AND ir.revenue_head = 'SecurityDeposit'
  ORDER BY ir.created_at ASC
  LIMIT 1
) r ON TRUE
WHERE a.security_deposit IS NOT NULL
  AND a.security_deposit > 0
  AND a.trader_licence_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM gapmc.premises_security_deposits d WHERE d.asset_allotment_id = a.id
  );

-- Backfill from entity allotments.
INSERT INTO gapmc.premises_security_deposits (
  id, yard_id, asset_id, premises_label, payer_type, payer_ref_id, payer_name,
  unified_entity_id, entity_allotment_id, amount, status,
  deposit_receipt_id, deposit_receipt_no, deposit_receipt_date,
  vacated_on, created_at, updated_at
)
SELECT
  'psd_ea_' || a.id,
  COALESCE(ast.yard_id, ''),
  a.asset_id,
  COALESCE(ast.asset_id, a.asset_id),
  'Entity',
  a.entity_id,
  a.allottee_name,
  'TB:' || a.entity_id,
  a.id,
  a.security_deposit,
  'Held',
  r.id,
  r.receipt_no,
  LEFT(COALESCE(r.created_at, a.allotment_date, a.from_date, NOW()::text), 10),
  CASE WHEN a.status = 'Vacated' THEN a.to_date ELSE NULL END,
  COALESCE(a.allotment_date, a.from_date, NOW()::text),
  COALESCE(a.approved_at, a.allotment_date, a.from_date, NOW()::text)
FROM gapmc.entity_allotments a
LEFT JOIN gapmc.assets ast ON ast.id = a.asset_id
LEFT JOIN LATERAL (
  SELECT ir.id, ir.receipt_no, ir.created_at
  FROM gapmc.ioms_receipts ir
  WHERE ir.source_module = 'M-02'
    AND ir.source_record_id = a.id
    AND ir.revenue_head = 'SecurityDeposit'
  ORDER BY ir.created_at ASC
  LIMIT 1
) r ON TRUE
WHERE a.security_deposit IS NOT NULL
  AND a.security_deposit > 0
  AND a.entity_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM gapmc.premises_security_deposits d WHERE d.entity_allotment_id = a.id
  );

-- Ledger credits for already-receipted deposits.
INSERT INTO gapmc.premises_sd_ledger_entries (
  id, yard_id, payer_type, payer_ref_id, unified_entity_id, entry_date, particulars,
  linked_doc_type, linked_doc_id, linked_doc_no, premises_label, asset_id,
  credit_amount, debit_amount, created_at
)
SELECT
  'psdl_' || d.id,
  d.yard_id,
  d.payer_type,
  d.payer_ref_id,
  d.unified_entity_id,
  COALESCE(d.deposit_receipt_date, LEFT(COALESCE(d.created_at, NOW()::text), 10)),
  'Security deposit received',
  'SECDEP',
  d.deposit_receipt_id,
  d.deposit_receipt_no,
  d.premises_label,
  d.asset_id,
  d.amount,
  0,
  COALESCE(d.created_at, NOW()::text)
FROM gapmc.premises_security_deposits d
WHERE d.deposit_receipt_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM gapmc.premises_sd_ledger_entries e WHERE e.id = 'psdl_' || d.id
  );
