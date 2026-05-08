-- US-M02-001: provisional licence no., application serial, public entity code (ENT-…), undertaking flag, serial counters.

ALTER TABLE gapmc.trader_licences
  ADD COLUMN IF NOT EXISTS provisional_licence_no text,
  ADD COLUMN IF NOT EXISTS application_serial text,
  ADD COLUMN IF NOT EXISTS entity_public_code text,
  ADD COLUMN IF NOT EXISTS bm_undertaking_accepted boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS trader_licences_entity_public_code_uq
  ON gapmc.trader_licences (entity_public_code)
  WHERE entity_public_code IS NOT NULL AND trim(entity_public_code) <> '';

-- Global integer licence numbers (final sequential issue on Active).
CREATE SEQUENCE IF NOT EXISTS gapmc.seq_trader_licence_numeric AS bigint;

SELECT setval(
  'gapmc.seq_trader_licence_numeric',
  GREATEST(
    10000::bigint,
    COALESCE(
      (SELECT MAX(CAST(licence_no AS bigint)) FROM gapmc.trader_licences WHERE licence_no ~ '^[0-9]+$'),
      10000::bigint
    )
  )
);

-- Per-calendar-year counters for APP-YYYY-NNNN and ENT-YYYY-NNNNN.
CREATE TABLE IF NOT EXISTS gapmc.m02_year_counters (
  scope text NOT NULL,
  year int NOT NULL,
  last_n int NOT NULL DEFAULT 0,
  PRIMARY KEY (scope, year)
);
