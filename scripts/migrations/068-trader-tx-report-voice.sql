-- M-04: trader transaction report fields + AI voice recording sessions
ALTER TABLE gapmc.purchase_transactions ADD COLUMN IF NOT EXISTS place_of_purchase text;
ALTER TABLE gapmc.purchase_transactions ADD COLUMN IF NOT EXISTS rate_per_unit double precision;
ALTER TABLE gapmc.purchase_transactions ADD COLUMN IF NOT EXISTS farmer_name_snapshot text;

CREATE TABLE IF NOT EXISTS gapmc.trader_voice_sessions (
  id text PRIMARY KEY,
  trader_licence_id text NOT NULL,
  yard_id text NOT NULL,
  status text NOT NULL DEFAULT 'Open', -- Open | Submitted | Abandoned
  mobile_verified boolean NOT NULL DEFAULT false,
  licence_class text,
  lines_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  total_purchase_value double precision NOT NULL DEFAULT 0,
  created_by text,
  created_at text NOT NULL,
  updated_at text NOT NULL,
  submitted_at text
);

CREATE INDEX IF NOT EXISTS trader_voice_sessions_trader_idx ON gapmc.trader_voice_sessions (trader_licence_id);
CREATE INDEX IF NOT EXISTS trader_voice_sessions_status_idx ON gapmc.trader_voice_sessions (status);
