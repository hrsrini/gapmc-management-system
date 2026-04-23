-- M-02 Sr.15: Unified entity master (Track A + Track B + ad-hoc occupants)
-- Minimal implementation: add ad-hoc entities table; unify in API as union view.
CREATE TABLE IF NOT EXISTS gapmc.ad_hoc_entities (
  id text PRIMARY KEY,
  entity_code text UNIQUE,
  name text NOT NULL,
  yard_id text NOT NULL,
  pan text,
  gstin text,
  mobile text,
  email text,
  address text,
  status text NOT NULL DEFAULT 'Active',
  created_at text,
  updated_at text
);

-- M-03 Sr.17: Rent revision configuration
-- Minimal implementation: effective-dated rent amount overrides per allotment.
CREATE TABLE IF NOT EXISTS gapmc.rent_revision_overrides (
  id text PRIMARY KEY,
  allotment_id text NOT NULL REFERENCES gapmc.asset_allotments(id) ON DELETE CASCADE,
  effective_month text NOT NULL, -- YYYY-MM
  rent_amount double precision NOT NULL DEFAULT 0,
  remarks text,
  created_at text,
  created_by text
);

CREATE INDEX IF NOT EXISTS rent_revision_overrides_allotment_idx
  ON gapmc.rent_revision_overrides(allotment_id, effective_month);

