/**
 * M-04: grace-period transaction flags (schema sync).
 *
 * These columns are referenced by M-04 reporting + receipts PDF rendering.
 * Use IF NOT EXISTS so it is safe to run multiple times.
 */

ALTER TABLE gapmc.ioms_receipts
  ADD COLUMN IF NOT EXISTS is_grace_period boolean DEFAULT false;

ALTER TABLE gapmc.purchase_transactions
  ADD COLUMN IF NOT EXISTS is_grace_period boolean DEFAULT false;

ALTER TABLE gapmc.check_post_inward
  ADD COLUMN IF NOT EXISTS is_grace_period boolean DEFAULT false;

