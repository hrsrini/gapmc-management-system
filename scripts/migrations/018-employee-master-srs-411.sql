-- M-01 SRS §4.1.1 / SCR-EMP-02: additional employee master fields (Location Posted, Pay Level, bank, IFSC, Category, Father/Spouse).
-- Idempotent. Prefer `npm run db:push` when Drizzle is the source of truth.

ALTER TABLE gapmc.employees ADD COLUMN IF NOT EXISTS location_posted text;
ALTER TABLE gapmc.employees ADD COLUMN IF NOT EXISTS pay_level integer;
ALTER TABLE gapmc.employees ADD COLUMN IF NOT EXISTS bank_account_number text;
ALTER TABLE gapmc.employees ADD COLUMN IF NOT EXISTS ifsc_code text;
ALTER TABLE gapmc.employees ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE gapmc.employees ADD COLUMN IF NOT EXISTS father_or_spouse_name text;

COMMENT ON COLUMN gapmc.employees.location_posted IS 'SRS §4.1.1 Location Posted (text)';
COMMENT ON COLUMN gapmc.employees.pay_level IS 'SRS §4.1.1 Pay Level 1–18';
COMMENT ON COLUMN gapmc.employees.bank_account_number IS 'SRS §4.1.1 Bank account (9–18 digits)';
COMMENT ON COLUMN gapmc.employees.ifsc_code IS 'SRS §4.1.1 IFSC 11 characters';
COMMENT ON COLUMN gapmc.employees.category IS 'SRS §4.1.1 Employee / reservation category';
COMMENT ON COLUMN gapmc.employees.father_or_spouse_name IS 'SRS §4.1.1 Father or Spouse name';
