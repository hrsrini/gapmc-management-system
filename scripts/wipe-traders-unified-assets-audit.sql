-- =============================================================================
-- Wipe: legacy traders, unified entities (licences + Track B + ad-hoc), assets,
--       allotments (Shop Vacant is derived from these), and admin audit_log.
-- Also clears legacy rows that FK-block trader deletion (invoices, receipts, etc.)
-- and M-03 rent rows tied to allotments.
--
-- Review before run. Then: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/wipe-traders-unified-assets-audit.sql
-- Or: node scripts/run-wipe-traders-entities-assets-audit.mjs
-- =============================================================================

BEGIN;

SET LOCAL session_replication_role = replica;

-- M-03 rent (depends on allotments / licences)
DELETE FROM gapmc.credit_notes;
DELETE FROM gapmc.rent_deposit_ledger;
DELETE FROM gapmc.rent_revision_overrides;
DELETE FROM gapmc.rent_invoices;

-- Legacy rent/trader satellite tables
DELETE FROM gapmc.agreement_documents;
DELETE FROM gapmc.agreements;
DELETE FROM gapmc.market_fees;
DELETE FROM gapmc.stock_returns;
DELETE FROM gapmc.receipts;
DELETE FROM gapmc.invoices;

-- M-02 satellite
DELETE FROM gapmc.trader_blocking_log;
DELETE FROM gapmc.trader_stock_openings;
DELETE FROM gapmc.assistant_traders;
DELETE FROM gapmc.purchase_transactions;

DELETE FROM gapmc.asset_allotments;
DELETE FROM gapmc.entity_allotments;
DELETE FROM gapmc.pre_receipts;

-- Unified / Track A licences
DELETE FROM gapmc.trader_licences;
DELETE FROM gapmc.entities;
DELETE FROM gapmc.ad_hoc_entities;

DELETE FROM gapmc.assets;

DELETE FROM gapmc.traders;

-- Admin audit trail (optional wipe)
DELETE FROM gapmc.audit_log;

SET LOCAL session_replication_role = origin;

-- Inspect counts, then:
-- COMMIT;
ROLLBACK;
