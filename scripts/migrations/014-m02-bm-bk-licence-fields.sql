-- M-02 Sr.9 Form BM supplementary fields + Sr.10 BK renewal declaration / fee snapshot
ALTER TABLE gapmc.trader_licences
  ADD COLUMN IF NOT EXISTS father_spouse_name text,
  ADD COLUMN IF NOT EXISTS date_of_birth text,
  ADD COLUMN IF NOT EXISTS emergency_contact_mobile text,
  ADD COLUMN IF NOT EXISTS character_cert_issuer text,
  ADD COLUMN IF NOT EXISTS character_cert_date text,
  ADD COLUMN IF NOT EXISTS parent_licence_fee_snapshot double precision,
  ADD COLUMN IF NOT EXISTS renewal_no_arrears_declared boolean DEFAULT false NOT NULL;
