-- Location Master: Party Name for Tapal Inward/Outward autofill (sender designation).
ALTER TABLE gapmc.yards
  ADD COLUMN IF NOT EXISTS party_name text;

COMMENT ON COLUMN gapmc.yards.party_name IS
  'Sender designation/name used when this location is selected as Received From / Sent To (Tapal).';

-- Sensible defaults by location type (only where still blank)
UPDATE gapmc.yards
SET party_name = CASE
  WHEN upper(trim(type)) = 'HO' THEN 'The Secretary'
  WHEN upper(trim(type)) IN ('CHECKPOST', 'CHECK_POST', 'CHECK-POST') THEN 'Market Supervisor / Checkpost In-charge'
  ELSE 'Market Supervisor / Yard In-charge'
END
WHERE party_name IS NULL OR btrim(party_name) = '';
