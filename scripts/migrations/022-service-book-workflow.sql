-- US-M01-003: service_book_entries workflow columns
ALTER TABLE gapmc.service_book_entries ADD COLUMN IF NOT EXISTS do_user text;
ALTER TABLE gapmc.service_book_entries ADD COLUMN IF NOT EXISTS dv_user text;
ALTER TABLE gapmc.service_book_entries ADD COLUMN IF NOT EXISTS rejection_reason_code text;
ALTER TABLE gapmc.service_book_entries ADD COLUMN IF NOT EXISTS rejection_remarks text;
ALTER TABLE gapmc.service_book_entries ADD COLUMN IF NOT EXISTS workflow_revision_count integer DEFAULT 0;
ALTER TABLE gapmc.service_book_entries ADD COLUMN IF NOT EXISTS dv_return_remarks text;

-- Backfill existing rows to a sane starting status
UPDATE gapmc.service_book_entries
SET status = 'Pending'
WHERE status IS NULL OR trim(status) = '';

CREATE INDEX IF NOT EXISTS idx_service_book_entries_employee_id ON gapmc.service_book_entries(employee_id);
