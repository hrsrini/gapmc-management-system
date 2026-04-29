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

-- M-04 / M-10 / M-05 rows that reference trader licences or unified entity ids (prevents FK failures; cleans orphans)
-- Some installs predate M-04 monthly-return tables — skip DELETE if relation missing.
DO $wipe_opt$
BEGIN
  IF to_regclass('gapmc.market_monthly_return_lines') IS NOT NULL THEN
    EXECUTE 'DELETE FROM gapmc.market_monthly_return_lines';
  END IF;
  IF to_regclass('gapmc.market_monthly_returns') IS NOT NULL THEN
    EXECUTE 'DELETE FROM gapmc.market_monthly_returns';
  END IF;
  IF to_regclass('gapmc.market_fee_ledger') IS NOT NULL THEN
    EXECUTE 'DELETE FROM gapmc.market_fee_ledger';
  END IF;
END
$wipe_opt$;

DO $wipe_pg$
BEGIN
  IF to_regclass('gapmc.payment_gateway_log') IS NOT NULL AND to_regclass('gapmc.ioms_receipts') IS NOT NULL THEN
    EXECUTE $q$
      DELETE FROM gapmc.payment_gateway_log
      WHERE receipt_id IN (
        SELECT id FROM gapmc.ioms_receipts
        WHERE payer_type = 'TraderLicence'
           OR payer_ref_id IN (SELECT id FROM gapmc.trader_licences)
           OR (
             unified_entity_id IS NOT NULL
             AND (
               unified_entity_id LIKE 'TA:%'
               OR unified_entity_id LIKE 'TB:%'
               OR unified_entity_id LIKE 'AH:%'
             )
           )
      )
    $q$;
  END IF;
END
$wipe_pg$;

DELETE FROM gapmc.ioms_receipts
WHERE payer_type = 'TraderLicence'
   OR payer_ref_id IN (SELECT id FROM gapmc.trader_licences)
   OR (
     unified_entity_id IS NOT NULL
     AND (
       unified_entity_id LIKE 'TA:%'
       OR unified_entity_id LIKE 'TB:%'
       OR unified_entity_id LIKE 'AH:%'
     )
   );

DO $wipe_portal$
BEGIN
  IF to_regclass('gapmc.portal_users') IS NOT NULL THEN
    EXECUTE 'DELETE FROM gapmc.portal_users';
  END IF;
END
$wipe_portal$;

UPDATE gapmc.check_post_inward SET trader_licence_id = NULL WHERE trader_licence_id IS NOT NULL;

-- Break optional renewal parent links before bulk licence delete
UPDATE gapmc.trader_licences SET parent_licence_id = NULL WHERE parent_licence_id IS NOT NULL;

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
