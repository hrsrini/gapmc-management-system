-- M-02 Sr.15: persist unified entity id on IOMS receipts (TA:|TB:|AH:) for reporting / exports.

ALTER TABLE gapmc.ioms_receipts
  ADD COLUMN IF NOT EXISTS unified_entity_id text;

CREATE INDEX IF NOT EXISTS ioms_receipts_unified_entity_id_idx
  ON gapmc.ioms_receipts(unified_entity_id);
