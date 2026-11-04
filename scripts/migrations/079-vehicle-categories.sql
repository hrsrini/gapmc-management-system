-- M-07 / M-04: Vehicle Category (Make/Model) master

CREATE TABLE IF NOT EXISTS gapmc.vehicle_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  capacity_kg DOUBLE PRECISION,
  manufacturer_company TEXT,
  status TEXT NOT NULL DEFAULT 'Active',
  created_at TEXT,
  updated_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS vehicle_categories_name_lower_uidx
  ON gapmc.vehicle_categories (lower(trim(name)));

ALTER TABLE gapmc.vehicles
  ADD COLUMN IF NOT EXISTS vehicle_category_id TEXT;
