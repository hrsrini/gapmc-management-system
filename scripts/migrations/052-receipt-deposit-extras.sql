-- M-05 §8.4: bank account config version history (BR-RCP-33)

CREATE TABLE IF NOT EXISTS gapmc.gaplmb_bank_account_versions (
  id text PRIMARY KEY,
  bank_account_id text NOT NULL REFERENCES gapmc.gaplmb_bank_accounts(id) ON DELETE CASCADE,
  snapshot_json text NOT NULL,
  changed_by text,
  changed_at text NOT NULL
);

CREATE INDEX IF NOT EXISTS gaplmb_bank_account_versions_account_idx
  ON gapmc.gaplmb_bank_account_versions (bank_account_id, changed_at DESC);
