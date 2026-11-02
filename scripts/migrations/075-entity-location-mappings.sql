-- M-02: Entity multi-location mapping (common Entity Master ↔ yards).

CREATE TABLE IF NOT EXISTS gapmc.entity_location_mappings (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  yard_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Active',
  effective_from TEXT,
  effective_to TEXT,
  unmapped_at TEXT,
  unmapped_reason TEXT,
  created_by TEXT,
  created_at TEXT,
  updated_at TEXT,
  CONSTRAINT entity_location_mappings_entity_yard UNIQUE (entity_id, yard_id)
);

CREATE INDEX IF NOT EXISTS entity_location_mappings_entity_idx
  ON gapmc.entity_location_mappings (entity_id);

CREATE INDEX IF NOT EXISTS entity_location_mappings_yard_idx
  ON gapmc.entity_location_mappings (yard_id);

CREATE INDEX IF NOT EXISTS entity_location_mappings_active_yard_idx
  ON gapmc.entity_location_mappings (yard_id)
  WHERE status = 'Active';

-- Backfill: one Active mapping per existing entity home yard.
INSERT INTO gapmc.entity_location_mappings (
  id, entity_id, yard_id, status, effective_from, created_at, updated_at
)
SELECT
  'elm_' || e.id,
  e.id,
  e.yard_id,
  'Active',
  COALESCE(e.created_at, NOW()::text),
  COALESCE(e.created_at, NOW()::text),
  COALESCE(e.updated_at, e.created_at, NOW()::text)
FROM gapmc.entities e
WHERE e.yard_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM gapmc.entity_location_mappings m
    WHERE m.entity_id = e.id AND m.yard_id = e.yard_id
  );
