-- M-09: optional file attachments for inward / outward dak (additive; nullable JSONB).
ALTER TABLE gapmc.dak_inward ADD COLUMN IF NOT EXISTS attachments jsonb;
ALTER TABLE gapmc.dak_outward ADD COLUMN IF NOT EXISTS attachments jsonb;
