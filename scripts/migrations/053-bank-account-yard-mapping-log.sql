-- FR-RCP-010: append-only yard mapping history (never delete rows).
CREATE TABLE IF NOT EXISTS gapmc.gaplmb_bank_account_yard_mapping_log (
  id text PRIMARY KEY,
  bank_account_id text NOT NULL REFERENCES gapmc.gaplmb_bank_accounts(id) ON DELETE CASCADE,
  action_type text NOT NULL,
  yard_id text,
  previous_mapping_json text NOT NULL DEFAULT '[]',
  new_mapping_json text NOT NULL DEFAULT '[]',
  remarks text,
  changed_by text,
  changed_at text NOT NULL
);

CREATE INDEX IF NOT EXISTS gaplmb_bank_account_yard_mapping_log_account_idx
  ON gapmc.gaplmb_bank_account_yard_mapping_log (bank_account_id, changed_at DESC);

COMMENT ON TABLE gapmc.gaplmb_bank_account_yard_mapping_log IS
  'FR-RCP-010 append-only audit log for bank account ↔ yard mapping changes.';
