-- Idempotent: M-02 Track B govt pre-receipt issuance and lifecycle tracking.

CREATE TABLE IF NOT EXISTS gapmc.pre_receipts (
  id TEXT PRIMARY KEY,
  pre_receipt_no TEXT UNIQUE,
  entity_id TEXT NOT NULL REFERENCES gapmc.entities(id) ON DELETE CASCADE,
  yard_id TEXT NOT NULL,
  purpose TEXT,
  amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Issued', -- Issued | Dispatched | Acknowledged | Settled | Cancelled
  issued_at TEXT,
  dispatched_at TEXT,
  acknowledged_at TEXT,
  settled_at TEXT,
  settled_receipt_id TEXT,
  remarks TEXT,
  created_by TEXT,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_pre_receipts_entity_id ON gapmc.pre_receipts(entity_id);
CREATE INDEX IF NOT EXISTS idx_pre_receipts_yard_id ON gapmc.pre_receipts(yard_id);

