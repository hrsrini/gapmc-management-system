-- M-02: Trader licence multi-location mapping (Track A licence ↔ yards).

CREATE TABLE IF NOT EXISTS gapmc.trader_licence_location_mappings (
  id TEXT PRIMARY KEY,
  trader_licence_id TEXT NOT NULL,
  yard_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Active',
  effective_from TEXT,
  effective_to TEXT,
  unmapped_at TEXT,
  unmapped_reason TEXT,
  created_by TEXT,
  created_at TEXT,
  updated_at TEXT,
  CONSTRAINT trader_licence_location_mappings_licence_yard UNIQUE (trader_licence_id, yard_id)
);

CREATE INDEX IF NOT EXISTS trader_licence_location_mappings_licence_idx
  ON gapmc.trader_licence_location_mappings (trader_licence_id);

CREATE INDEX IF NOT EXISTS trader_licence_location_mappings_yard_idx
  ON gapmc.trader_licence_location_mappings (yard_id);

CREATE INDEX IF NOT EXISTS trader_licence_location_mappings_active_yard_idx
  ON gapmc.trader_licence_location_mappings (yard_id)
  WHERE status = 'Active';

-- Backfill: one Active mapping per existing licence home yard.
INSERT INTO gapmc.trader_licence_location_mappings (
  id, trader_licence_id, yard_id, status, effective_from, created_at, updated_at
)
SELECT
  'tlm_' || l.id,
  l.id,
  l.yard_id,
  'Active',
  COALESCE(l.created_at, NOW()::text),
  COALESCE(l.created_at, NOW()::text),
  COALESCE(l.updated_at, l.created_at, NOW()::text)
FROM gapmc.trader_licences l
WHERE l.yard_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM gapmc.trader_licence_location_mappings m
    WHERE m.trader_licence_id = l.id AND m.yard_id = l.yard_id
  );
