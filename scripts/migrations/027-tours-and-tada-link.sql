-- US-M01-006: tour programmes + TA/DA linkage and late-submission override
CREATE TABLE IF NOT EXISTS gapmc.tour_programmes (
  id text PRIMARY KEY,
  tour_no text NOT NULL UNIQUE,
  employee_id text NOT NULL,
  destination text NOT NULL,
  purpose text NOT NULL,
  from_date text NOT NULL,
  to_date text NOT NULL,
  status text NOT NULL,
  do_user text,
  dv_user text,
  approved_by text,
  rejection_reason_code text,
  rejection_remarks text,
  workflow_revision_count integer DEFAULT 0,
  dv_return_remarks text,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

ALTER TABLE gapmc.ta_da_claims ADD COLUMN IF NOT EXISTS tour_programme_id text;
ALTER TABLE gapmc.ta_da_claims ADD COLUMN IF NOT EXISTS return_date text;
ALTER TABLE gapmc.ta_da_claims ADD COLUMN IF NOT EXISTS da_override_late_submission boolean DEFAULT false;

COMMENT ON COLUMN gapmc.ta_da_claims.tour_programme_id IS 'Approved tour programme id backing this claim.';
COMMENT ON COLUMN gapmc.ta_da_claims.return_date IS 'Return date (YYYY-MM-DD) used for submission-window rules.';
COMMENT ON COLUMN gapmc.ta_da_claims.da_override_late_submission IS 'True when DA overrides 61+ day submission block.';
