-- Leave application date (READ on sanction order) and fixed sanction order date (approval day).
ALTER TABLE gapmc.leave_requests ADD COLUMN IF NOT EXISTS applied_at TEXT;
ALTER TABLE gapmc.leave_requests ADD COLUMN IF NOT EXISTS order_date TEXT;

COMMENT ON COLUMN gapmc.leave_requests.applied_at IS 'YYYY-MM-DD leave application date (user-entered; Form-1 + sanction READ).';
COMMENT ON COLUMN gapmc.leave_requests.order_date IS 'YYYY-MM-DD sanction order date fixed at DA approval (does not change on re-download).';
