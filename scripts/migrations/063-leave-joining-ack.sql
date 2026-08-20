-- M-01 Leave: Joining Report hard-copy / scan acknowledgment (optional DV/Admin)

ALTER TABLE gapmc.leave_requests ADD COLUMN IF NOT EXISTS joining_report_ack_at TEXT;
ALTER TABLE gapmc.leave_requests ADD COLUMN IF NOT EXISTS joining_report_ack_by TEXT;
ALTER TABLE gapmc.leave_requests ADD COLUMN IF NOT EXISTS joining_report_ack_remarks TEXT;
