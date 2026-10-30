-- Tapal Outward: multi To / Copy-To recipients (JSON arrays).
ALTER TABLE gapmc.dak_outward
  ADD COLUMN IF NOT EXISTS to_recipients_json jsonb,
  ADD COLUMN IF NOT EXISTS copy_to_json jsonb;

COMMENT ON COLUMN gapmc.dak_outward.to_recipients_json IS
  'JSON array of {name, address, locationId?} for primary To recipients.';
COMMENT ON COLUMN gapmc.dak_outward.copy_to_json IS
  'JSON array of {name, address, locationId?} for Copy To recipients.';

-- Backfill primary To from legacy columns where JSON empty
UPDATE gapmc.dak_outward
SET to_recipients_json = jsonb_build_array(
  jsonb_build_object(
    'name', coalesce(nullif(btrim(to_party), ''), '—'),
    'address', coalesce(nullif(btrim(to_address), ''), '')
  )
)
WHERE to_recipients_json IS NULL
  AND to_party IS NOT NULL
  AND btrim(to_party) <> '';
