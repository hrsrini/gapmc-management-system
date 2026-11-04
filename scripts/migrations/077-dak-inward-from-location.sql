-- Persist Tapal Inward "Received from" Location Master id for edit preselect.

ALTER TABLE gapmc.dak_inward
  ADD COLUMN IF NOT EXISTS from_location_id TEXT;
