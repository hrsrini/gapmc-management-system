-- M-03: per-yard per-month running invoice number (M03/{yard}/{YYYY-MM}/NNNNN).

CREATE TABLE IF NOT EXISTS gapmc.m03_rent_invoice_counters (
  yard_id TEXT NOT NULL,
  period_month TEXT NOT NULL,
  last_n INT NOT NULL DEFAULT 0,
  PRIMARY KEY (yard_id, period_month)
);
