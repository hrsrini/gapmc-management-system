-- US-M01-008: LTC settlement fields
ALTER TABLE gapmc.ltc_claims ADD COLUMN IF NOT EXISTS block_period text;
ALTER TABLE gapmc.ltc_claims ADD COLUMN IF NOT EXISTS ltc_type text;
ALTER TABLE gapmc.ltc_claims ADD COLUMN IF NOT EXISTS estimated_entitlement double precision;
ALTER TABLE gapmc.ltc_claims ADD COLUMN IF NOT EXISTS advance_amount double precision;
ALTER TABLE gapmc.ltc_claims ADD COLUMN IF NOT EXISTS actual_claim_amount double precision;
ALTER TABLE gapmc.ltc_claims ADD COLUMN IF NOT EXISTS net_payable double precision;
ALTER TABLE gapmc.ltc_claims ADD COLUMN IF NOT EXISTS settled_at text;

COMMENT ON COLUMN gapmc.ltc_claims.block_period IS 'LTC block period e.g. 2024-2028';
COMMENT ON COLUMN gapmc.ltc_claims.ltc_type IS 'HomeTown or AllIndia';
COMMENT ON COLUMN gapmc.ltc_claims.net_payable IS 'ActualClaimAmount - AdvanceAmount';
