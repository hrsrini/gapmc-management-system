-- M-01 Leave Form-1: LTC block year + refund undertaking user inputs (items 10 & 12)

ALTER TABLE gapmc.leave_requests ADD COLUMN IF NOT EXISTS ltc_block_year TEXT;
ALTER TABLE gapmc.leave_requests ADD COLUMN IF NOT EXISTS refund_undertaking_i TEXT;
ALTER TABLE gapmc.leave_requests ADD COLUMN IF NOT EXISTS refund_undertaking_ii TEXT;
