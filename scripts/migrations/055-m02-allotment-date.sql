-- M-02: Allotment date on premises allocation records (entity + trader allotments).

ALTER TABLE gapmc.entity_allotments ADD COLUMN IF NOT EXISTS allotment_date TEXT;
ALTER TABLE gapmc.asset_allotments ADD COLUMN IF NOT EXISTS allotment_date TEXT;
