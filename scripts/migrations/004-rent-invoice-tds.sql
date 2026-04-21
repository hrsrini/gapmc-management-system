-- M-03: Section 194-I style TDS on rent (threshold + PAN); informational per invoice.
ALTER TABLE gapmc.rent_invoices
  ADD COLUMN IF NOT EXISTS tds_applicable boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tds_amount double precision NOT NULL DEFAULT 0;
