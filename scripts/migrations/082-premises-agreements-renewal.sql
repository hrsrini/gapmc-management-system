-- Multi-premises agreements, renewal, notices, revisions, penalties, vacation & settlement.

CREATE TABLE IF NOT EXISTS gapmc.premises_agreement_seq (
  year_key text PRIMARY KEY,
  last_seq integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS gapmc.renewal_notice_seq (
  year_key text PRIMARY KEY,
  last_seq integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS gapmc.final_demand_notice_seq (
  year_key text PRIMARY KEY,
  last_seq integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS gapmc.premises_agreements (
  id text PRIMARY KEY,
  agreement_no text NOT NULL UNIQUE,
  track text NOT NULL,
  trader_licence_id text,
  entity_id text,
  yard_id text NOT NULL,
  allottee_name text NOT NULL,
  allotment_date text,
  from_date text NOT NULL,
  to_date text NOT NULL,
  agreement_type text NOT NULL DEFAULT 'RentalAgreement',
  agreement_ref text,
  rent_revision_mode text NOT NULL DEFAULT 'StandardConsecutiveRenewal',
  agreement_period_number integer NOT NULL DEFAULT 1,
  rent_revision_frequency integer NOT NULL DEFAULT 3,
  renewal_tenure_months integer,
  penalty_clause_ref text,
  penalty_method text,
  penalty_rate double precision,
  total_security_deposit double precision NOT NULL DEFAULT 0,
  approval_status text NOT NULL DEFAULT 'Draft',
  renewal_status text NOT NULL DEFAULT 'Active',
  do_user text,
  dv_user text,
  da_user text,
  verified_at text,
  approved_at text,
  dv_return_remarks text,
  rejection_remarks text,
  agreement_doc_file text,
  agreement_doc_uploaded_at text,
  gst_applicable boolean NOT NULL DEFAULT true,
  created_by text,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

CREATE INDEX IF NOT EXISTS premises_agreements_yard_idx ON gapmc.premises_agreements (yard_id);
CREATE INDEX IF NOT EXISTS premises_agreements_licence_idx ON gapmc.premises_agreements (trader_licence_id);
CREATE INDEX IF NOT EXISTS premises_agreements_entity_idx ON gapmc.premises_agreements (entity_id);
CREATE INDEX IF NOT EXISTS premises_agreements_renewal_status_idx ON gapmc.premises_agreements (renewal_status);

CREATE TABLE IF NOT EXISTS gapmc.agreement_premises_lines (
  id text PRIMARY KEY,
  agreement_id text NOT NULL,
  asset_id text NOT NULL,
  monthly_rent double precision NOT NULL DEFAULT 0,
  deposit_share double precision NOT NULL DEFAULT 0,
  area_sqm double precision,
  tenancy_status text NOT NULL DEFAULT 'Pending',
  vacated_on text,
  legacy_asset_allotment_id text,
  legacy_entity_allotment_id text,
  rent_revision_mode_override text,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

CREATE INDEX IF NOT EXISTS agreement_premises_lines_agreement_idx ON gapmc.agreement_premises_lines (agreement_id);
CREATE INDEX IF NOT EXISTS agreement_premises_lines_asset_idx ON gapmc.agreement_premises_lines (asset_id);

CREATE TABLE IF NOT EXISTS gapmc.agreement_renewals (
  id text PRIMARY KEY,
  agreement_id text NOT NULL,
  renewal_date text NOT NULL,
  prior_from_date text NOT NULL,
  prior_to_date text NOT NULL,
  renewal_from_date text NOT NULL,
  renewal_to_date text NOT NULL,
  prior_period_number integer NOT NULL,
  new_period_number integer NOT NULL,
  status text NOT NULL DEFAULT 'Draft',
  revision_batch_id text,
  penalty_id text,
  remarks text,
  completed_at text,
  created_by text,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

CREATE INDEX IF NOT EXISTS agreement_renewals_agreement_idx ON gapmc.agreement_renewals (agreement_id);

CREATE TABLE IF NOT EXISTS gapmc.renewal_notices (
  id text PRIMARY KEY,
  agreement_id text NOT NULL,
  notice_no text NOT NULL UNIQUE,
  version_no integer NOT NULL DEFAULT 1,
  notice_date text NOT NULL,
  last_date_to_renew text,
  pdf_file text,
  generated_by text,
  generated_at text NOT NULL,
  dispatch_date text,
  dispatch_remarks text,
  is_reprint boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS renewal_notices_agreement_idx ON gapmc.renewal_notices (agreement_id);

CREATE TABLE IF NOT EXISTS gapmc.rent_revision_batches (
  id text PRIMARY KEY,
  agreement_id text NOT NULL,
  renewal_id text,
  effective_date text NOT NULL,
  revision_basis text NOT NULL DEFAULT 'FixedMonthlyRent',
  status text NOT NULL DEFAULT 'Draft',
  remarks text,
  do_user text,
  dv_user text,
  da_user text,
  verified_at text,
  approved_at text,
  return_remarks text,
  rejection_remarks text,
  created_by text,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS gapmc.rent_revision_lines (
  id text PRIMARY KEY,
  batch_id text NOT NULL,
  agreement_line_id text NOT NULL,
  asset_id text NOT NULL,
  existing_rent double precision NOT NULL,
  revised_rent double precision NOT NULL,
  created_at text NOT NULL
);

CREATE INDEX IF NOT EXISTS rent_revision_batches_agreement_idx ON gapmc.rent_revision_batches (agreement_id);
CREATE INDEX IF NOT EXISTS rent_revision_lines_batch_idx ON gapmc.rent_revision_lines (batch_id);

CREATE TABLE IF NOT EXISTS gapmc.delay_penalties (
  id text PRIMARY KEY,
  agreement_id text NOT NULL,
  renewal_id text,
  expiry_date text NOT NULL,
  regularisation_date text NOT NULL,
  days_of_delay integer NOT NULL,
  method text NOT NULL,
  rate double precision NOT NULL,
  calculated_amount double precision NOT NULL,
  status text NOT NULL DEFAULT 'Draft',
  remarks text,
  do_user text,
  dv_user text,
  da_user text,
  verified_at text,
  approved_at text,
  return_remarks text,
  rejection_remarks text,
  created_by text,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

CREATE INDEX IF NOT EXISTS delay_penalties_agreement_idx ON gapmc.delay_penalties (agreement_id);

CREATE TABLE IF NOT EXISTS gapmc.vacation_eviction_events (
  id text PRIMARY KEY,
  agreement_id text NOT NULL,
  agreement_line_id text NOT NULL,
  case_type text NOT NULL,
  intimation_date text,
  proposed_vacation_date text,
  actual_vacation_date text,
  order_type text,
  order_ref_no text,
  order_date text,
  order_doc_file text,
  remarks text,
  created_by text,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS gapmc.full_final_settlements (
  id text PRIMARY KEY,
  agreement_id text NOT NULL,
  agreement_line_id text NOT NULL,
  vacation_event_id text NOT NULL,
  revision_no integer NOT NULL DEFAULT 1,
  outstanding_rent double precision NOT NULL DEFAULT 0,
  interest_amount double precision NOT NULL DEFAULT 0,
  other_dues double precision NOT NULL DEFAULT 0,
  additional_receivable double precision NOT NULL DEFAULT 0,
  deposit_held double precision NOT NULL DEFAULT 0,
  deductions double precision NOT NULL DEFAULT 0,
  system_calculated_net double precision NOT NULL DEFAULT 0,
  proposed_adjustments_json text,
  approved_adjustments_json text,
  final_approved_net double precision,
  status text NOT NULL DEFAULT 'Draft',
  remarks text,
  do_user text,
  dv_user text,
  da_user text,
  verified_at text,
  approved_at text,
  created_by text,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS gapmc.final_demand_notices (
  id text PRIMARY KEY,
  settlement_id text NOT NULL,
  agreement_id text NOT NULL,
  notice_no text NOT NULL UNIQUE,
  version_no integer NOT NULL DEFAULT 1,
  notice_date text NOT NULL,
  payment_due_date text,
  total_payable double precision NOT NULL,
  pdf_file text,
  generated_by text,
  generated_at text NOT NULL
);

-- Backfill: one agreement + one line per existing trader allotment.
INSERT INTO gapmc.premises_agreements (
  id, agreement_no, track, trader_licence_id, entity_id, yard_id, allottee_name,
  allotment_date, from_date, to_date, agreement_type, rent_revision_mode,
  agreement_period_number, rent_revision_frequency, total_security_deposit,
  approval_status, renewal_status, do_user, dv_user, da_user, verified_at, approved_at,
  agreement_doc_file, agreement_doc_uploaded_at, gst_applicable, created_at, updated_at
)
SELECT
  a.id,
  'MIG-A-' || a.id,
  'TrackA',
  a.trader_licence_id,
  NULL,
  COALESCE(ast.yard_id, ''),
  a.allottee_name,
  a.allotment_date,
  a.from_date,
  a.to_date,
  COALESCE(a.agreement_type, 'RentalAgreement'),
  COALESCE(a.rent_revision_mode, 'StandardConsecutiveRenewal'),
  GREATEST(1, COALESCE(a.consecutive_renewal_count, 0) + 1),
  3,
  COALESCE(a.security_deposit, 0),
  COALESCE(a.approval_status, 'Draft'),
  CASE WHEN COALESCE(a.approval_status, 'Draft') = 'Approved' THEN 'Active' ELSE 'Active' END,
  a.do_user, a.dv_user, a.da_user, a.verified_at, a.approved_at,
  a.agreement_doc_file, a.agreement_doc_uploaded_at,
  COALESCE(a.gst_applicable, true),
  COALESCE(a.approved_at, a.verified_at, a.allotment_date, a.from_date, NOW()::text),
  COALESCE(a.approved_at, a.verified_at, a.allotment_date, a.from_date, NOW()::text)
FROM gapmc.asset_allotments a
LEFT JOIN gapmc.assets ast ON ast.id = a.asset_id
WHERE NOT EXISTS (SELECT 1 FROM gapmc.premises_agreements p WHERE p.id = a.id)
  AND COALESCE(ast.yard_id, '') <> '';

INSERT INTO gapmc.agreement_premises_lines (
  id, agreement_id, asset_id, monthly_rent, deposit_share, area_sqm, tenancy_status,
  legacy_asset_allotment_id, created_at, updated_at
)
SELECT
  a.id || '-line',
  a.id,
  a.asset_id,
  COALESCE(a.monthly_rent, 0),
  COALESCE(a.security_deposit, 0),
  NULL,
  COALESCE(a.status, 'Pending'),
  a.id,
  COALESCE(a.approved_at, a.from_date, NOW()::text),
  COALESCE(a.approved_at, a.from_date, NOW()::text)
FROM gapmc.asset_allotments a
LEFT JOIN gapmc.assets ast ON ast.id = a.asset_id
WHERE EXISTS (SELECT 1 FROM gapmc.premises_agreements p WHERE p.id = a.id)
  AND NOT EXISTS (SELECT 1 FROM gapmc.agreement_premises_lines l WHERE l.legacy_asset_allotment_id = a.id)
  AND COALESCE(ast.yard_id, '') <> '';

-- Backfill entity allotments.
INSERT INTO gapmc.premises_agreements (
  id, agreement_no, track, trader_licence_id, entity_id, yard_id, allottee_name,
  allotment_date, from_date, to_date, agreement_type, rent_revision_mode,
  agreement_period_number, rent_revision_frequency, total_security_deposit,
  approval_status, renewal_status, do_user, dv_user, da_user, verified_at, approved_at,
  agreement_doc_file, agreement_doc_uploaded_at, gst_applicable, created_at, updated_at
)
SELECT
  e.id,
  'MIG-B-' || e.id,
  'TrackB',
  NULL,
  e.entity_id,
  COALESCE(ast.yard_id, ''),
  e.allottee_name,
  e.allotment_date,
  e.from_date,
  e.to_date,
  COALESCE(e.agreement_type, 'RentalAgreement'),
  COALESCE(e.rent_revision_mode, 'StandardConsecutiveRenewal'),
  GREATEST(1, COALESCE(e.consecutive_renewal_count, 0) + 1),
  3,
  COALESCE(e.security_deposit, 0),
  COALESCE(e.approval_status, 'Draft'),
  'Active',
  e.do_user, e.dv_user, e.da_user, e.verified_at, e.approved_at,
  e.agreement_doc_file, e.agreement_doc_uploaded_at,
  COALESCE(e.gst_applicable, true),
  COALESCE(e.approved_at, e.verified_at, e.allotment_date, e.from_date, NOW()::text),
  COALESCE(e.approved_at, e.verified_at, e.allotment_date, e.from_date, NOW()::text)
FROM gapmc.entity_allotments e
LEFT JOIN gapmc.assets ast ON ast.id = e.asset_id
WHERE NOT EXISTS (SELECT 1 FROM gapmc.premises_agreements p WHERE p.id = e.id)
  AND COALESCE(ast.yard_id, '') <> '';

INSERT INTO gapmc.agreement_premises_lines (
  id, agreement_id, asset_id, monthly_rent, deposit_share, area_sqm, tenancy_status,
  legacy_entity_allotment_id, created_at, updated_at
)
SELECT
  e.id || '-line',
  e.id,
  e.asset_id,
  COALESCE(e.monthly_rent, 0),
  COALESCE(e.security_deposit, 0),
  NULL,
  COALESCE(e.status, 'Pending'),
  e.id,
  COALESCE(e.approved_at, e.from_date, NOW()::text),
  COALESCE(e.approved_at, e.from_date, NOW()::text)
FROM gapmc.entity_allotments e
LEFT JOIN gapmc.assets ast ON ast.id = e.asset_id
WHERE EXISTS (SELECT 1 FROM gapmc.premises_agreements p WHERE p.id = e.id)
  AND NOT EXISTS (SELECT 1 FROM gapmc.agreement_premises_lines l WHERE l.legacy_entity_allotment_id = e.id)
  AND COALESCE(ast.yard_id, '') <> '';
