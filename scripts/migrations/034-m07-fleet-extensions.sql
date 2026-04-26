/**
 * M-07: Fleet extensions (vehicle master + trip log + maintenance).
 */

ALTER TABLE gapmc.vehicles
  ADD COLUMN IF NOT EXISTS make TEXT,
  ADD COLUMN IF NOT EXISTS model TEXT,
  ADD COLUMN IF NOT EXISTS year_of_manufacture INTEGER,
  ADD COLUMN IF NOT EXISTS fuel_type TEXT,
  ADD COLUMN IF NOT EXISTS ownership_type TEXT,
  ADD COLUMN IF NOT EXISTS ownership_vendor_name TEXT,
  ADD COLUMN IF NOT EXISTS puc_expiry TEXT,
  ADD COLUMN IF NOT EXISTS documents JSONB;

ALTER TABLE gapmc.vehicle_trip_log
  ADD COLUMN IF NOT EXISTS fuel_filled_litres DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS fuel_cost_inr DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS fuel_receipt_docs JSONB;

ALTER TABLE gapmc.vehicle_maintenance
  ADD COLUMN IF NOT EXISTS odometer_reading_km DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS invoice_no TEXT,
  ADD COLUMN IF NOT EXISTS invoice_docs JSONB,
  ADD COLUMN IF NOT EXISTS work_id TEXT,
  ADD COLUMN IF NOT EXISTS is_emergency BOOLEAN DEFAULT false;

