-- Idempotent: US-M02-003 Premises Allocation Record (entity allotments workflow, premises lifecycle, TB rent invoices).

-- Premises lifecycle (E-PRE-004): Unsafe / Demolished block new allocations when not Active.
ALTER TABLE gapmc.assets
  ADD COLUMN IF NOT EXISTS premises_status TEXT NOT NULL DEFAULT 'Active';

-- Counter for premises ref suffix [PREMISES-ID]-[YARD]-[NN]
CREATE TABLE IF NOT EXISTS gapmc.premises_ref_counters (
  premises_key TEXT PRIMARY KEY,
  last_nn INTEGER NOT NULL DEFAULT 0
);

-- Extend entity allotments (US-M02-003)
ALTER TABLE gapmc.entity_allotments ADD COLUMN IF NOT EXISTS approval_status TEXT;
ALTER TABLE gapmc.entity_allotments ADD COLUMN IF NOT EXISTS premises_ref_no TEXT;
ALTER TABLE gapmc.entity_allotments ADD COLUMN IF NOT EXISTS monthly_rent DOUBLE PRECISION;
ALTER TABLE gapmc.entity_allotments ADD COLUMN IF NOT EXISTS gst_applicable BOOLEAN;
ALTER TABLE gapmc.entity_allotments ADD COLUMN IF NOT EXISTS gst_locked BOOLEAN;
ALTER TABLE gapmc.entity_allotments ADD COLUMN IF NOT EXISTS agreement_type TEXT;
ALTER TABLE gapmc.entity_allotments ADD COLUMN IF NOT EXISTS agreement_doc_file TEXT;
ALTER TABLE gapmc.entity_allotments ADD COLUMN IF NOT EXISTS agreement_doc_uploaded_at TEXT;
ALTER TABLE gapmc.entity_allotments ADD COLUMN IF NOT EXISTS rent_revision_mode TEXT;
ALTER TABLE gapmc.entity_allotments ADD COLUMN IF NOT EXISTS consecutive_renewal_count INTEGER;
ALTER TABLE gapmc.entity_allotments ADD COLUMN IF NOT EXISTS dv_user TEXT;
ALTER TABLE gapmc.entity_allotments ADD COLUMN IF NOT EXISTS verified_at TEXT;
ALTER TABLE gapmc.entity_allotments ADD COLUMN IF NOT EXISTS approved_at TEXT;
ALTER TABLE gapmc.entity_allotments ADD COLUMN IF NOT EXISTS workflow_revision_count INTEGER;
ALTER TABLE gapmc.entity_allotments ADD COLUMN IF NOT EXISTS dv_return_remarks TEXT;
ALTER TABLE gapmc.entity_allotments ADD COLUMN IF NOT EXISTS rejection_remarks TEXT;
ALTER TABLE gapmc.entity_allotments ADD COLUMN IF NOT EXISTS agreement_gap_da_override BOOLEAN;
ALTER TABLE gapmc.entity_allotments ADD COLUMN IF NOT EXISTS da_gst_override BOOLEAN;

-- Extend trader (Track A) asset allotments with the same Premises Allocation fields (US-M02-003 gaps fix)
ALTER TABLE gapmc.asset_allotments ADD COLUMN IF NOT EXISTS dv_user TEXT;
ALTER TABLE gapmc.asset_allotments ADD COLUMN IF NOT EXISTS approval_status TEXT;
ALTER TABLE gapmc.asset_allotments ADD COLUMN IF NOT EXISTS premises_ref_no TEXT;
ALTER TABLE gapmc.asset_allotments ADD COLUMN IF NOT EXISTS monthly_rent DOUBLE PRECISION;
ALTER TABLE gapmc.asset_allotments ADD COLUMN IF NOT EXISTS gst_applicable BOOLEAN;
ALTER TABLE gapmc.asset_allotments ADD COLUMN IF NOT EXISTS gst_locked BOOLEAN;
ALTER TABLE gapmc.asset_allotments ADD COLUMN IF NOT EXISTS agreement_type TEXT;
ALTER TABLE gapmc.asset_allotments ADD COLUMN IF NOT EXISTS agreement_doc_file TEXT;
ALTER TABLE gapmc.asset_allotments ADD COLUMN IF NOT EXISTS agreement_doc_uploaded_at TEXT;
ALTER TABLE gapmc.asset_allotments ADD COLUMN IF NOT EXISTS rent_revision_mode TEXT;
ALTER TABLE gapmc.asset_allotments ADD COLUMN IF NOT EXISTS consecutive_renewal_count INTEGER;
ALTER TABLE gapmc.asset_allotments ADD COLUMN IF NOT EXISTS verified_at TEXT;
ALTER TABLE gapmc.asset_allotments ADD COLUMN IF NOT EXISTS approved_at TEXT;
ALTER TABLE gapmc.asset_allotments ADD COLUMN IF NOT EXISTS workflow_revision_count INTEGER;
ALTER TABLE gapmc.asset_allotments ADD COLUMN IF NOT EXISTS dv_return_remarks TEXT;
ALTER TABLE gapmc.asset_allotments ADD COLUMN IF NOT EXISTS rejection_remarks TEXT;
ALTER TABLE gapmc.asset_allotments ADD COLUMN IF NOT EXISTS agreement_gap_da_override BOOLEAN;
ALTER TABLE gapmc.asset_allotments ADD COLUMN IF NOT EXISTS da_gst_override BOOLEAN;

-- Backfill existing rows as legacy approved allocations
UPDATE gapmc.entity_allotments ea
SET
  approval_status = COALESCE(ea.approval_status, 'Approved'),
  monthly_rent = COALESCE(ea.monthly_rent, 0),
  gst_locked = COALESCE(ea.gst_locked, TRUE),
  agreement_type = COALESCE(ea.agreement_type, 'RentalAgreement'),
  rent_revision_mode = COALESCE(ea.rent_revision_mode, 'StandardConsecutiveRenewal'),
  consecutive_renewal_count = COALESCE(ea.consecutive_renewal_count, 0),
  workflow_revision_count = COALESCE(ea.workflow_revision_count, 0),
  agreement_gap_da_override = COALESCE(ea.agreement_gap_da_override, FALSE),
  da_gst_override = COALESCE(ea.da_gst_override, FALSE)
WHERE ea.approval_status IS NULL
   OR ea.monthly_rent IS NULL
   OR ea.gst_locked IS NULL
   OR ea.agreement_type IS NULL
   OR ea.rent_revision_mode IS NULL
   OR ea.consecutive_renewal_count IS NULL
   OR ea.workflow_revision_count IS NULL
   OR ea.agreement_gap_da_override IS NULL
   OR ea.da_gst_override IS NULL;

UPDATE gapmc.entity_allotments ea
SET gst_applicable = CASE
  WHEN ea.gst_applicable IS NOT NULL THEN ea.gst_applicable
  WHEN EXISTS (
    SELECT 1 FROM gapmc.entities e
    WHERE e.id = ea.entity_id AND trim(COALESCE(e.sub_type, '')) = 'Govt'
  ) THEN FALSE
  ELSE TRUE
END
WHERE ea.gst_applicable IS NULL;

ALTER TABLE gapmc.entity_allotments ALTER COLUMN approval_status SET DEFAULT 'Draft';
UPDATE gapmc.entity_allotments SET approval_status = 'Approved' WHERE approval_status IS NULL;
ALTER TABLE gapmc.entity_allotments ALTER COLUMN approval_status SET NOT NULL;

ALTER TABLE gapmc.entity_allotments ALTER COLUMN monthly_rent SET DEFAULT 0;
UPDATE gapmc.entity_allotments SET monthly_rent = 0 WHERE monthly_rent IS NULL;
ALTER TABLE gapmc.entity_allotments ALTER COLUMN monthly_rent SET NOT NULL;

UPDATE gapmc.entity_allotments ea
SET gst_applicable = CASE
  WHEN EXISTS (
    SELECT 1 FROM gapmc.entities e
    WHERE e.id = ea.entity_id AND trim(COALESCE(e.sub_type, '')) = 'Govt'
  ) THEN FALSE
  ELSE TRUE
END
WHERE ea.gst_applicable IS NULL;
ALTER TABLE gapmc.entity_allotments ALTER COLUMN gst_applicable SET DEFAULT TRUE;
ALTER TABLE gapmc.entity_allotments ALTER COLUMN gst_applicable SET NOT NULL;

UPDATE gapmc.entity_allotments SET gst_locked = TRUE WHERE gst_locked IS NULL;
ALTER TABLE gapmc.entity_allotments ALTER COLUMN gst_locked SET DEFAULT FALSE;
ALTER TABLE gapmc.entity_allotments ALTER COLUMN gst_locked SET NOT NULL;

ALTER TABLE gapmc.entity_allotments ALTER COLUMN agreement_type SET DEFAULT 'RentalAgreement';
UPDATE gapmc.entity_allotments SET agreement_type = 'RentalAgreement' WHERE agreement_type IS NULL OR trim(agreement_type) = '';
ALTER TABLE gapmc.entity_allotments ALTER COLUMN agreement_type SET NOT NULL;

ALTER TABLE gapmc.entity_allotments ALTER COLUMN rent_revision_mode SET DEFAULT 'StandardConsecutiveRenewal';
UPDATE gapmc.entity_allotments SET rent_revision_mode = 'StandardConsecutiveRenewal' WHERE rent_revision_mode IS NULL OR trim(rent_revision_mode) = '';
ALTER TABLE gapmc.entity_allotments ALTER COLUMN rent_revision_mode SET NOT NULL;

-- Backfill + defaults for asset_allotments (treat existing rows as legacy Approved allocations)
UPDATE gapmc.asset_allotments aa
SET
  approval_status = COALESCE(aa.approval_status, 'Approved'),
  monthly_rent = COALESCE(aa.monthly_rent, 0),
  gst_applicable = COALESCE(aa.gst_applicable, TRUE),
  gst_locked = COALESCE(aa.gst_locked, TRUE),
  agreement_type = COALESCE(aa.agreement_type, 'RentalAgreement'),
  rent_revision_mode = COALESCE(aa.rent_revision_mode, 'StandardConsecutiveRenewal'),
  consecutive_renewal_count = COALESCE(aa.consecutive_renewal_count, 0),
  workflow_revision_count = COALESCE(aa.workflow_revision_count, 0),
  agreement_gap_da_override = COALESCE(aa.agreement_gap_da_override, FALSE),
  da_gst_override = COALESCE(aa.da_gst_override, FALSE)
WHERE aa.approval_status IS NULL
   OR aa.monthly_rent IS NULL
   OR aa.gst_applicable IS NULL
   OR aa.gst_locked IS NULL
   OR aa.agreement_type IS NULL
   OR aa.rent_revision_mode IS NULL
   OR aa.consecutive_renewal_count IS NULL
   OR aa.workflow_revision_count IS NULL
   OR aa.agreement_gap_da_override IS NULL
   OR aa.da_gst_override IS NULL;

ALTER TABLE gapmc.asset_allotments ALTER COLUMN approval_status SET DEFAULT 'Draft';
UPDATE gapmc.asset_allotments SET approval_status = 'Approved' WHERE approval_status IS NULL;
ALTER TABLE gapmc.asset_allotments ALTER COLUMN approval_status SET NOT NULL;

ALTER TABLE gapmc.asset_allotments ALTER COLUMN monthly_rent SET DEFAULT 0;
UPDATE gapmc.asset_allotments SET monthly_rent = 0 WHERE monthly_rent IS NULL;
ALTER TABLE gapmc.asset_allotments ALTER COLUMN monthly_rent SET NOT NULL;

ALTER TABLE gapmc.asset_allotments ALTER COLUMN gst_applicable SET DEFAULT TRUE;
UPDATE gapmc.asset_allotments SET gst_applicable = TRUE WHERE gst_applicable IS NULL;
ALTER TABLE gapmc.asset_allotments ALTER COLUMN gst_applicable SET NOT NULL;

ALTER TABLE gapmc.asset_allotments ALTER COLUMN gst_locked SET DEFAULT FALSE;
UPDATE gapmc.asset_allotments SET gst_locked = TRUE WHERE gst_locked IS NULL;
ALTER TABLE gapmc.asset_allotments ALTER COLUMN gst_locked SET NOT NULL;

ALTER TABLE gapmc.asset_allotments ALTER COLUMN agreement_type SET DEFAULT 'RentalAgreement';
UPDATE gapmc.asset_allotments SET agreement_type = 'RentalAgreement' WHERE agreement_type IS NULL OR trim(agreement_type) = '';
ALTER TABLE gapmc.asset_allotments ALTER COLUMN agreement_type SET NOT NULL;

ALTER TABLE gapmc.asset_allotments ALTER COLUMN rent_revision_mode SET DEFAULT 'StandardConsecutiveRenewal';
UPDATE gapmc.asset_allotments SET rent_revision_mode = 'StandardConsecutiveRenewal' WHERE rent_revision_mode IS NULL OR trim(rent_revision_mode) = '';
ALTER TABLE gapmc.asset_allotments ALTER COLUMN rent_revision_mode SET NOT NULL;

UPDATE gapmc.asset_allotments SET consecutive_renewal_count = 0 WHERE consecutive_renewal_count IS NULL;
ALTER TABLE gapmc.asset_allotments ALTER COLUMN consecutive_renewal_count SET DEFAULT 0;
ALTER TABLE gapmc.asset_allotments ALTER COLUMN consecutive_renewal_count SET NOT NULL;

UPDATE gapmc.asset_allotments SET workflow_revision_count = 0 WHERE workflow_revision_count IS NULL;
ALTER TABLE gapmc.asset_allotments ALTER COLUMN workflow_revision_count SET DEFAULT 0;
ALTER TABLE gapmc.asset_allotments ALTER COLUMN workflow_revision_count SET NOT NULL;

UPDATE gapmc.asset_allotments SET agreement_gap_da_override = FALSE WHERE agreement_gap_da_override IS NULL;
ALTER TABLE gapmc.asset_allotments ALTER COLUMN agreement_gap_da_override SET DEFAULT FALSE;
ALTER TABLE gapmc.asset_allotments ALTER COLUMN agreement_gap_da_override SET NOT NULL;

UPDATE gapmc.asset_allotments SET da_gst_override = FALSE WHERE da_gst_override IS NULL;
ALTER TABLE gapmc.asset_allotments ALTER COLUMN da_gst_override SET DEFAULT FALSE;
ALTER TABLE gapmc.asset_allotments ALTER COLUMN da_gst_override SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_asset_allotments_premises_ref_no
  ON gapmc.asset_allotments (premises_ref_no)
  WHERE premises_ref_no IS NOT NULL AND trim(premises_ref_no) <> '';

UPDATE gapmc.entity_allotments SET consecutive_renewal_count = 0 WHERE consecutive_renewal_count IS NULL;
ALTER TABLE gapmc.entity_allotments ALTER COLUMN consecutive_renewal_count SET DEFAULT 0;
ALTER TABLE gapmc.entity_allotments ALTER COLUMN consecutive_renewal_count SET NOT NULL;

UPDATE gapmc.entity_allotments SET workflow_revision_count = 0 WHERE workflow_revision_count IS NULL;
ALTER TABLE gapmc.entity_allotments ALTER COLUMN workflow_revision_count SET DEFAULT 0;
ALTER TABLE gapmc.entity_allotments ALTER COLUMN workflow_revision_count SET NOT NULL;

UPDATE gapmc.entity_allotments SET agreement_gap_da_override = FALSE WHERE agreement_gap_da_override IS NULL;
ALTER TABLE gapmc.entity_allotments ALTER COLUMN agreement_gap_da_override SET DEFAULT FALSE;
ALTER TABLE gapmc.entity_allotments ALTER COLUMN agreement_gap_da_override SET NOT NULL;

UPDATE gapmc.entity_allotments SET da_gst_override = FALSE WHERE da_gst_override IS NULL;
ALTER TABLE gapmc.entity_allotments ALTER COLUMN da_gst_override SET DEFAULT FALSE;
ALTER TABLE gapmc.entity_allotments ALTER COLUMN da_gst_override SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_entity_allotments_premises_ref_no
  ON gapmc.entity_allotments (premises_ref_no)
  WHERE premises_ref_no IS NOT NULL AND trim(premises_ref_no) <> '';

-- TB rent invoices: `tenant_licence_id` stores unified `TB:<entity_id>` for entity allocations (see US-M02-003); entity_id denormalized for joins.
ALTER TABLE gapmc.rent_invoices ADD COLUMN IF NOT EXISTS entity_id TEXT REFERENCES gapmc.entities (id) ON DELETE SET NULL;
ALTER TABLE gapmc.rent_invoices ADD COLUMN IF NOT EXISTS allotment_kind TEXT NOT NULL DEFAULT 'TraderLicence';

UPDATE gapmc.rent_invoices SET allotment_kind = 'TraderLicence' WHERE allotment_kind IS NULL OR trim(allotment_kind) = '';

-- Ledger: TB rows use unified_entity_id without tenant row
ALTER TABLE gapmc.rent_deposit_ledger ALTER COLUMN tenant_licence_id DROP NOT NULL;
