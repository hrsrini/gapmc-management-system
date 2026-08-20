-- M-01 Leave: rejoining / revised leave / location email (client response Aug 2026)

ALTER TABLE gapmc.yards ADD COLUMN IF NOT EXISTS email TEXT;

ALTER TABLE gapmc.leave_requests ADD COLUMN IF NOT EXISTS rejoining_date TEXT;
ALTER TABLE gapmc.leave_requests ADD COLUMN IF NOT EXISTS rejoining_reported_at TEXT;
ALTER TABLE gapmc.leave_requests ADD COLUMN IF NOT EXISTS rejoining_reported_by TEXT;
ALTER TABLE gapmc.leave_requests ADD COLUMN IF NOT EXISTS joining_report_pdf_url TEXT;
ALTER TABLE gapmc.leave_requests ADD COLUMN IF NOT EXISTS joining_report_scan_url TEXT;
ALTER TABLE gapmc.leave_requests ADD COLUMN IF NOT EXISTS fitness_cert_url TEXT;
ALTER TABLE gapmc.leave_requests ADD COLUMN IF NOT EXISTS revised_from_leave_id TEXT;
ALTER TABLE gapmc.leave_requests ADD COLUMN IF NOT EXISTS superseded_by_leave_id TEXT;

CREATE INDEX IF NOT EXISTS idx_leave_requests_revised_from ON gapmc.leave_requests(revised_from_leave_id);
CREATE INDEX IF NOT EXISTS idx_leave_requests_rejoining ON gapmc.leave_requests(rejoining_date);
