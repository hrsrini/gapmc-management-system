-- M-01 Leave: store debit split for set-off-aware revision reversal

ALTER TABLE gapmc.leave_requests ADD COLUMN IF NOT EXISTS debit_from_set_off_days DOUBLE PRECISION;
ALTER TABLE gapmc.leave_requests ADD COLUMN IF NOT EXISTS debit_from_balance_days DOUBLE PRECISION;
