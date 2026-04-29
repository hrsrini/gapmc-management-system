-- M-04: measurement units master + commodities.unit_id (additive).
CREATE TABLE IF NOT EXISTS gapmc.measurement_units (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TEXT
);

ALTER TABLE gapmc.commodities
  ADD COLUMN IF NOT EXISTS unit_id TEXT;

CREATE INDEX IF NOT EXISTS commodities_unit_id_idx ON gapmc.commodities (unit_id);

INSERT INTO gapmc.measurement_units (id, name, sort_order, is_active, created_at)
VALUES
  ('m04-unit-kilogram', 'Kilogram', 10, true, to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
  ('m04-unit-nos', 'Nos', 20, true, to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
  ('m04-unit-liter', 'Liter', 30, true, to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
ON CONFLICT (id) DO NOTHING;

-- Backfill unit_id from legacy free-text unit where it matches common spellings
UPDATE gapmc.commodities c
SET unit_id = 'm04-unit-kilogram'
WHERE c.unit_id IS NULL
  AND c.unit IS NOT NULL
  AND lower(trim(c.unit)) IN ('kg', 'kgs', 'kilogram', 'kilograms');

UPDATE gapmc.commodities c
SET unit_id = 'm04-unit-nos'
WHERE c.unit_id IS NULL
  AND c.unit IS NOT NULL
  AND lower(trim(c.unit)) IN ('no', 'nos', 'number', 'numbers', 'nos.');

UPDATE gapmc.commodities c
SET unit_id = 'm04-unit-liter'
WHERE c.unit_id IS NULL
  AND c.unit IS NOT NULL
  AND lower(trim(c.unit)) IN ('l', 'ltr', 'liter', 'litre', 'liters', 'litres');
