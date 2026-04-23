-- Idempotent: M-01 Module_01 verification gaps (employee master extensions, leave, LTC workflow, leave balances).
-- Safe to re-run. Prefer `npm run db:push` when Drizzle is the source of truth.

-- Employee master (SRS §4.1.1 / SCR-EMP-02 extensions)
ALTER TABLE gapmc.employees ADD COLUMN IF NOT EXISTS gender text;
ALTER TABLE gapmc.employees ADD COLUMN IF NOT EXISTS marital_status text;
ALTER TABLE gapmc.employees ADD COLUMN IF NOT EXISTS blood_group text;
ALTER TABLE gapmc.employees ADD COLUMN IF NOT EXISTS permanent_address text;
ALTER TABLE gapmc.employees ADD COLUMN IF NOT EXISTS correspondence_address text;
ALTER TABLE gapmc.employees ADD COLUMN IF NOT EXISTS emergency_contact_name text;
ALTER TABLE gapmc.employees ADD COLUMN IF NOT EXISTS emergency_contact_mobile text;
ALTER TABLE gapmc.employees ADD COLUMN IF NOT EXISTS reporting_officer_employee_id text;

-- Leave application (SCR-LVE-01)
ALTER TABLE gapmc.leave_requests ADD COLUMN IF NOT EXISTS reason text;
ALTER TABLE gapmc.leave_requests ADD COLUMN IF NOT EXISTS supporting_document_url text;

-- Opening / running leave balances (go-live opening per type)
CREATE TABLE IF NOT EXISTS gapmc.employee_leave_balances (
  id text PRIMARY KEY,
  employee_id text NOT NULL REFERENCES gapmc.employees(id) ON DELETE CASCADE,
  leave_type text NOT NULL,
  balance_days double precision NOT NULL DEFAULT 0,
  updated_at text,
  UNIQUE (employee_id, leave_type)
);

-- LTC: align with TA/DA DV→DA workflow
ALTER TABLE gapmc.ltc_claims ADD COLUMN IF NOT EXISTS do_user text;
ALTER TABLE gapmc.ltc_claims ADD COLUMN IF NOT EXISTS dv_user text;
ALTER TABLE gapmc.ltc_claims ADD COLUMN IF NOT EXISTS approved_by text;
ALTER TABLE gapmc.ltc_claims ADD COLUMN IF NOT EXISTS rejection_reason_code text;
ALTER TABLE gapmc.ltc_claims ADD COLUMN IF NOT EXISTS rejection_remarks text;
ALTER TABLE gapmc.ltc_claims ADD COLUMN IF NOT EXISTS workflow_revision_count integer DEFAULT 0;
ALTER TABLE gapmc.ltc_claims ADD COLUMN IF NOT EXISTS dv_return_remarks text;

COMMENT ON TABLE gapmc.employee_leave_balances IS 'M-01: opening/running leave balance per employee and leave_type; debited on DA final approval when a row exists.';
