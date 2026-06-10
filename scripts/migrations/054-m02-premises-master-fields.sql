-- M-02 Premises Master — extended fields + lifecycle status (Vacant / Vacating / Allocated / …)

ALTER TABLE gapmc.assets ADD COLUMN IF NOT EXISTS premises_location text;
ALTER TABLE gapmc.assets ADD COLUMN IF NOT EXISTS property_tax_authority text;
ALTER TABLE gapmc.assets ADD COLUMN IF NOT EXISTS house_no text;
ALTER TABLE gapmc.assets ADD COLUMN IF NOT EXISTS electricity_connection_type text;
ALTER TABLE gapmc.assets ADD COLUMN IF NOT EXISTS contract_account_no text;
ALTER TABLE gapmc.assets ADD COLUMN IF NOT EXISTS water_connection_type text;
ALTER TABLE gapmc.assets ADD COLUMN IF NOT EXISTS consumer_id text;

COMMENT ON COLUMN gapmc.assets.premises_location IS 'Basement | First Floor | Ground Floor | Open Space | Second Floor | Third Floor | Upper Ground Floor';
COMMENT ON COLUMN gapmc.assets.property_tax_authority IS 'Municipal Council / Corporation | Village Panchayat';
COMMENT ON COLUMN gapmc.assets.electricity_connection_type IS 'No Connection | Shared | Independent';
COMMENT ON COLUMN gapmc.assets.water_connection_type IS 'No Connection | Shared | Independent';
COMMENT ON COLUMN gapmc.assets.premises_status IS 'Vacant | Vacating | Allocated | UnsafeForOccupation | Demolished';

ALTER TABLE gapmc.assets ALTER COLUMN premises_status SET DEFAULT 'Vacant';

-- Legacy Active → Vacant
UPDATE gapmc.assets SET premises_status = 'Vacant' WHERE premises_status = 'Active';

-- Premises with an active tenancy → Allocated
UPDATE gapmc.assets a
SET premises_status = 'Allocated'
WHERE EXISTS (
  SELECT 1 FROM gapmc.entity_allotments ea
  WHERE ea.asset_id = a.id AND ea.status = 'Active'
);

UPDATE gapmc.assets a
SET premises_status = 'Allocated'
WHERE premises_status = 'Vacant'
  AND EXISTS (
    SELECT 1 FROM gapmc.asset_allotments aa
    WHERE aa.asset_id = a.id AND aa.status = 'Active'
  );
