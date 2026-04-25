-- US-M01-005: basic pay + DA amount for leave encashment
ALTER TABLE gapmc.employees ADD COLUMN IF NOT EXISTS basic_pay_inr double precision;
ALTER TABLE gapmc.employees ADD COLUMN IF NOT EXISTS da_amount_inr double precision;

COMMENT ON COLUMN gapmc.employees.basic_pay_inr IS 'Basic pay in INR for leave encashment formula.';
COMMENT ON COLUMN gapmc.employees.da_amount_inr IS 'DA amount in INR for leave encashment formula.';
