-- M-04 Farmer Master: Farmer ID, Address, State (plus existing name/mobile/krishi/village/taluk/district).

ALTER TABLE gapmc.farmers
  ADD COLUMN IF NOT EXISTS farmer_code TEXT;

ALTER TABLE gapmc.farmers
  ADD COLUMN IF NOT EXISTS address TEXT;

ALTER TABLE gapmc.farmers
  ADD COLUMN IF NOT EXISTS state TEXT;
