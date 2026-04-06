-- Idempotent: IOMS leave workflow + M-04 purchase adjustments (gapmc schema).
-- Safe to re-run. Prefer `npm run db:push` when Drizzle is the source of truth.

ALTER TABLE gapmc.leave_requests ADD COLUMN IF NOT EXISTS do_user text;
ALTER TABLE gapmc.leave_requests ADD COLUMN IF NOT EXISTS dv_user text;
ALTER TABLE gapmc.leave_requests ADD COLUMN IF NOT EXISTS workflow_revision_count integer DEFAULT 0;
ALTER TABLE gapmc.leave_requests ADD COLUMN IF NOT EXISTS dv_return_remarks text;

ALTER TABLE gapmc.purchase_transactions ADD COLUMN IF NOT EXISTS parent_transaction_id text;
ALTER TABLE gapmc.purchase_transactions ADD COLUMN IF NOT EXISTS entry_kind text NOT NULL DEFAULT 'Original';

COMMENT ON COLUMN gapmc.purchase_transactions.parent_transaction_id IS 'M-04: links adjustment row to Approved original purchase';
COMMENT ON COLUMN gapmc.purchase_transactions.entry_kind IS 'Original | Adjustment';
