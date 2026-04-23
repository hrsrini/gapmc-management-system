-- M-03 Sr.17: revision basis / rule tag (metadata; invoice generation still uses rent_amount INR)
ALTER TABLE gapmc.rent_revision_overrides
  ADD COLUMN IF NOT EXISTS revision_basis text DEFAULT 'FixedMonthlyRent' NOT NULL;
