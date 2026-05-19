-- M-03: Full month, prorated, and overstay rent invoice billing
ALTER TABLE gapmc.rent_invoices
  ADD COLUMN IF NOT EXISTS billing_type text NOT NULL DEFAULT 'FullMonth',
  ADD COLUMN IF NOT EXISTS occupancy_from text,
  ADD COLUMN IF NOT EXISTS occupancy_to text,
  ADD COLUMN IF NOT EXISTS days_in_month integer,
  ADD COLUMN IF NOT EXISTS billable_days integer,
  ADD COLUMN IF NOT EXISTS billing_factor double precision,
  ADD COLUMN IF NOT EXISTS base_monthly_rent double precision,
  ADD COLUMN IF NOT EXISTS billing_config_json text;

CREATE TABLE IF NOT EXISTS gapmc.rent_billing_config (
  id text PRIMARY KEY,
  effective_from text NOT NULL,
  prorata_factor double precision NOT NULL DEFAULT 1,
  prorata_days_basis text NOT NULL DEFAULT 'Calendar',
  prorata_fixed_days integer,
  overstay_factor double precision NOT NULL DEFAULT 2,
  overstay_days_basis text NOT NULL DEFAULT 'Calendar',
  overstay_fixed_days integer,
  created_at text,
  updated_at text
);

INSERT INTO gapmc.rent_billing_config (
  id,
  effective_from,
  prorata_factor,
  prorata_days_basis,
  prorata_fixed_days,
  overstay_factor,
  overstay_days_basis,
  overstay_fixed_days,
  created_at,
  updated_at
)
SELECT
  'default-m03-billing',
  '2020-01-01',
  1,
  'Calendar',
  30,
  2,
  'Calendar',
  30,
  to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
WHERE NOT EXISTS (SELECT 1 FROM gapmc.rent_billing_config WHERE id = 'default-m03-billing');
