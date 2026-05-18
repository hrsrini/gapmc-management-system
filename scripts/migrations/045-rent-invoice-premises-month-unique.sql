-- M-03: one non-cancelled rent invoice per premises (asset_id) per billing month (YYYY-MM).
-- Normalize legacy rows that stored premises code in asset_id instead of assets.id.

UPDATE gapmc.rent_invoices ri
SET asset_id = a.id
FROM gapmc.assets a
WHERE trim(ri.asset_id) = trim(a.asset_id)
  AND ri.asset_id IS DISTINCT FROM a.id;

CREATE UNIQUE INDEX IF NOT EXISTS ux_rent_invoices_asset_period_active
  ON gapmc.rent_invoices (asset_id, period_month)
  WHERE status IS DISTINCT FROM 'Cancelled';
