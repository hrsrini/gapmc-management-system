-- M-03 Sr.17: Rent revision overrides — DO/DV/DA workflow (aligns with rent invoices).
-- New revisions start Draft; monthly cron uses only Approved rows.

ALTER TABLE gapmc.rent_revision_overrides
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'Draft';

UPDATE gapmc.rent_revision_overrides
SET status = 'Approved'
WHERE status = 'Draft';

ALTER TABLE gapmc.rent_revision_overrides
  ALTER COLUMN status DROP DEFAULT;

ALTER TABLE gapmc.rent_revision_overrides
  ADD COLUMN IF NOT EXISTS do_user text,
  ADD COLUMN IF NOT EXISTS dv_user text,
  ADD COLUMN IF NOT EXISTS da_user text,
  ADD COLUMN IF NOT EXISTS verified_at text,
  ADD COLUMN IF NOT EXISTS approved_at text,
  ADD COLUMN IF NOT EXISTS workflow_revision_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dv_return_remarks text;

-- Backfill DO from legacy created_by for already-effective overrides.
UPDATE gapmc.rent_revision_overrides
SET do_user = created_by
WHERE do_user IS NULL AND created_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS rent_revision_overrides_status_idx
  ON gapmc.rent_revision_overrides(status);
