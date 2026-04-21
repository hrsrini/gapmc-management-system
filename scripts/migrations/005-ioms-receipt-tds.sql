-- M-05: optional TDS amount on receipt (e.g. copied from M-03 rent invoice for 194-I disclosure on PDF).
ALTER TABLE gapmc.ioms_receipts
  ADD COLUMN IF NOT EXISTS tds_amount double precision NOT NULL DEFAULT 0;
