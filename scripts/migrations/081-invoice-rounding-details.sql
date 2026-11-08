-- Nearest-rupee invoice rounding audit (M-03 rent / combined and future invoice modules).
CREATE TABLE IF NOT EXISTS gapmc.invoice_rounding_details (
  id text PRIMARY KEY,
  invoice_id text NOT NULL,
  invoice_module text NOT NULL,
  invoice_no text,
  original_invoice_amount double precision NOT NULL,
  rounding_amount double precision NOT NULL,
  rounding_type text NOT NULL,
  final_invoice_amount double precision NOT NULL,
  rounding_date text NOT NULL,
  created_by text,
  created_on text NOT NULL,
  record_status text NOT NULL DEFAULT 'Active'
);

CREATE UNIQUE INDEX IF NOT EXISTS invoice_rounding_details_active_uidx
  ON gapmc.invoice_rounding_details (invoice_id, invoice_module)
  WHERE record_status = 'Active';
