-- M-01: centralized designation master for hierarchy, workflow routing, and validation.
CREATE TABLE IF NOT EXISTS gapmc.designation_master (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  hierarchy_level INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Active',
  remarks TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_designation_master_status ON gapmc.designation_master (status);

ALTER TABLE gapmc.employees ADD COLUMN IF NOT EXISTS designation_id TEXT;

DO $$
BEGIN
  ALTER TABLE gapmc.employees
    ADD CONSTRAINT employees_designation_id_fkey
    FOREIGN KEY (designation_id) REFERENCES gapmc.designation_master (id) ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

INSERT INTO gapmc.designation_master (id, code, name, hierarchy_level, status, remarks, created_at, updated_at)
VALUES
  ('dm_seed_admin', 'ADMIN', 'Administrator', 100, 'Active', 'Seeded for hierarchy / routing', (now() AT TIME ZONE 'utc')::text, (now() AT TIME ZONE 'utc')::text),
  ('dm_seed_staff', 'STAFF', 'Staff', 20, 'Active', 'Seeded for hierarchy / routing', (now() AT TIME ZONE 'utc')::text, (now() AT TIME ZONE 'utc')::text)
ON CONFLICT (code) DO NOTHING;

UPDATE gapmc.employees e
SET designation_id = m.id
FROM gapmc.designation_master m
WHERE e.designation_id IS NULL AND lower(trim(e.designation)) = lower(trim(m.name));
