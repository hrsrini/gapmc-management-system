-- M-04: one monthly return per trader licence per YYYY-MM period.
-- Removes duplicate rows (keeps the most recently updated) before adding the unique index.

DELETE FROM gapmc.market_monthly_return_lines
WHERE return_id IN (
  SELECT id
  FROM (
    SELECT
      id,
      row_number() OVER (
        PARTITION BY trader_licence_id, period
        ORDER BY coalesce(updated_at, created_at, '') DESC, id DESC
      ) AS rn
    FROM gapmc.market_monthly_returns
  ) ranked
  WHERE rn > 1
);

DELETE FROM gapmc.market_monthly_returns
WHERE id IN (
  SELECT id
  FROM (
    SELECT
      id,
      row_number() OVER (
        PARTITION BY trader_licence_id, period
        ORDER BY coalesce(updated_at, created_at, '') DESC, id DESC
      ) AS rn
    FROM gapmc.market_monthly_returns
  ) ranked
  WHERE rn > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS market_monthly_returns_trader_period_uidx
  ON gapmc.market_monthly_returns (trader_licence_id, period);
