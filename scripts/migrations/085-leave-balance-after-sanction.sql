-- Snapshot leave balance printed on Sanction Order at DA approval (immutable thereafter).

ALTER TABLE gapmc.leave_requests
  ADD COLUMN IF NOT EXISTS balance_after_sanction_days double precision;
