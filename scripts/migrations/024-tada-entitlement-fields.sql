-- US-M01-006/012: TA/DA entitlement calculation fields
ALTER TABLE gapmc.ta_da_claims ADD COLUMN IF NOT EXISTS pay_level_snapshot integer;
ALTER TABLE gapmc.ta_da_claims ADD COLUMN IF NOT EXISTS city_category text;
ALTER TABLE gapmc.ta_da_claims ADD COLUMN IF NOT EXISTS days integer;
ALTER TABLE gapmc.ta_da_claims ADD COLUMN IF NOT EXISTS hotel_amount double precision;
ALTER TABLE gapmc.ta_da_claims ADD COLUMN IF NOT EXISTS entitled_train_class text;
ALTER TABLE gapmc.ta_da_claims ADD COLUMN IF NOT EXISTS entitled_da_per_day double precision;
ALTER TABLE gapmc.ta_da_claims ADD COLUMN IF NOT EXISTS entitled_hotel_per_day double precision;
ALTER TABLE gapmc.ta_da_claims ADD COLUMN IF NOT EXISTS entitled_total double precision;

COMMENT ON COLUMN gapmc.ta_da_claims.pay_level_snapshot IS 'Employee pay level snapshot used for entitlement lookup.';
COMMENT ON COLUMN gapmc.ta_da_claims.city_category IS 'City category A/B used for DA/hotel ceilings.';
COMMENT ON COLUMN gapmc.ta_da_claims.days IS 'Number of tour days used for entitlement.';
COMMENT ON COLUMN gapmc.ta_da_claims.hotel_amount IS 'Claimed hotel amount (optional; capped at ceiling).' ;
COMMENT ON COLUMN gapmc.ta_da_claims.entitled_total IS 'Computed entitlement total (DA + capped hotel) in INR.';
