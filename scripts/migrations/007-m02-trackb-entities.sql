-- Idempotent: M-02 Track B entity master + premises allocation (non-trader / govt / ad-hoc).

CREATE TABLE IF NOT EXISTS gapmc.entities (
  id TEXT PRIMARY KEY,
  entity_code TEXT UNIQUE,
  track TEXT NOT NULL, -- TrackA | TrackB
  sub_type TEXT, -- Govt | Commercial | AdHocOccupant | etc.
  name TEXT NOT NULL,
  yard_id TEXT NOT NULL,
  pan TEXT,
  gstin TEXT,
  mobile TEXT,
  email TEXT,
  address TEXT,
  status TEXT NOT NULL DEFAULT 'Active', -- Draft | Active | Inactive | Blocked
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS gapmc.entity_allotments (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  entity_id TEXT NOT NULL REFERENCES gapmc.entities(id) ON DELETE CASCADE,
  allottee_name TEXT NOT NULL,
  from_date TEXT NOT NULL,
  to_date TEXT NOT NULL,
  status TEXT NOT NULL, -- Active | Vacated
  security_deposit DOUBLE PRECISION,
  do_user TEXT,
  da_user TEXT
);

CREATE INDEX IF NOT EXISTS idx_entity_allotments_entity_id ON gapmc.entity_allotments(entity_id);
CREATE INDEX IF NOT EXISTS idx_entity_allotments_asset_id ON gapmc.entity_allotments(asset_id);

