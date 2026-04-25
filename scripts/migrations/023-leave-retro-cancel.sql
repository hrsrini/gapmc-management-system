-- US-M01-014: leave retrospective + cancel fields
ALTER TABLE gapmc.leave_requests ADD COLUMN IF NOT EXISTS is_retrospective boolean DEFAULT false;
ALTER TABLE gapmc.leave_requests ADD COLUMN IF NOT EXISTS cancelled_at text;
ALTER TABLE gapmc.leave_requests ADD COLUMN IF NOT EXISTS cancelled_by text;

COMMENT ON COLUMN gapmc.leave_requests.is_retrospective IS 'True when leave was entered retrospectively by HR/Admin.';
COMMENT ON COLUMN gapmc.leave_requests.cancelled_at IS 'ISO timestamp when leave was cancelled.';
COMMENT ON COLUMN gapmc.leave_requests.cancelled_by IS 'User id who cancelled the leave.';
