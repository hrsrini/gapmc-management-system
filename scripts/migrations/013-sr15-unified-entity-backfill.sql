-- Sr.15: Backfill unified entity ids on legacy rows + rent deposit ledger (Track A = TA:).

-- IOMS receipts: infer from payer when still null.
UPDATE gapmc.ioms_receipts r
SET unified_entity_id = 'TA:' || trim(both from r.payer_ref_id)
WHERE r.unified_entity_id IS NULL
  AND r.payer_ref_id IS NOT NULL
  AND trim(both from r.payer_ref_id) <> ''
  AND lower(trim(both from coalesce(r.payer_type, ''))) IN ('tenantlicence', 'traderlicence');

UPDATE gapmc.ioms_receipts r
SET unified_entity_id = 'TB:' || trim(both from r.payer_ref_id)
WHERE r.unified_entity_id IS NULL
  AND r.payer_ref_id IS NOT NULL
  AND trim(both from r.payer_ref_id) <> ''
  AND lower(trim(both from coalesce(r.payer_type, ''))) = 'entity';

-- Rent deposit ledger (always tenant licence = Track A).
ALTER TABLE gapmc.rent_deposit_ledger
  ADD COLUMN IF NOT EXISTS unified_entity_id text;

UPDATE gapmc.rent_deposit_ledger
SET unified_entity_id = 'TA:' || trim(both from tenant_licence_id)
WHERE (unified_entity_id IS NULL OR trim(both from unified_entity_id) = '')
  AND tenant_licence_id IS NOT NULL
  AND trim(both from tenant_licence_id) <> '';

CREATE INDEX IF NOT EXISTS rent_deposit_ledger_unified_entity_id_idx
  ON gapmc.rent_deposit_ledger(unified_entity_id);
