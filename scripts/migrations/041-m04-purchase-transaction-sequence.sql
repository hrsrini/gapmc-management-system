-- M-04: Per-yard + financial-year sequence for purchase_transactions.transaction_no

CREATE TABLE IF NOT EXISTS gapmc.purchase_transaction_sequence (
  yard_id text NOT NULL,
  financial_year text NOT NULL,
  last_seq integer NOT NULL DEFAULT 0,
  PRIMARY KEY (yard_id, financial_year)
);
