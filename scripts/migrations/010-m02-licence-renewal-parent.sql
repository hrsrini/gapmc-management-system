-- M-02 Sr.10: Renewal linkage (Form BK)
ALTER TABLE gapmc.trader_licences
  ADD COLUMN IF NOT EXISTS parent_licence_id text;

ALTER TABLE gapmc.trader_licences
  ADD COLUMN IF NOT EXISTS application_kind text; -- New | Renewal

CREATE INDEX IF NOT EXISTS trader_licences_parent_idx
  ON gapmc.trader_licences(parent_licence_id);

