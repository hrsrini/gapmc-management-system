-- US-M03-007: Non-GST premises charge lines (garbage, verandah, open space, etc.)
-- Stores charge lines as JSON text (array of {label, amount}).

ALTER TABLE gapmc.rent_invoices
  ADD COLUMN IF NOT EXISTS non_gst_charges_json text;

