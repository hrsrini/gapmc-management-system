-- M-04: Denormalized trader display on purchase_transactions (survives FK quirks; list UI + receipts).
-- Requires gapmc.trader_licences.provisional_licence_no / entity_public_code from 038 for full COALESCE in backfill.

ALTER TABLE gapmc.purchase_transactions
  ADD COLUMN IF NOT EXISTS trader_firm_name_snapshot text,
  ADD COLUMN IF NOT EXISTS trader_licence_no_snapshot text;

-- Backfill from joined trader_licences (same matching rules as API list).
UPDATE gapmc.purchase_transactions pt
SET
  trader_firm_name_snapshot = tl.firm_name,
  trader_licence_no_snapshot = NULLIF(
    TRIM(
      COALESCE(
        NULLIF(TRIM(tl.licence_no), ''),
        NULLIF(TRIM(tl.provisional_licence_no), ''),
        NULLIF(TRIM(tl.entity_public_code), '')
      )
    ),
    ''
  )
FROM gapmc.trader_licences tl
WHERE (
  tl.id = (
    CASE
      WHEN trim(pt.trader_licence_id) ILIKE 'TA:%'
      THEN trim(substring(trim(pt.trader_licence_id) from 4))
      ELSE trim(pt.trader_licence_id)
    END
  )
  OR (
    tl.licence_no IS NOT NULL
    AND trim(tl.licence_no) = trim(pt.trader_licence_id)
  )
  OR (
    tl.entity_public_code IS NOT NULL
    AND trim(tl.entity_public_code) = trim(pt.trader_licence_id)
  )
);

-- Canonicalize trader_licence_id to trader row id when FK wrongly held licence_no / ENT code / TA: prefix.
UPDATE gapmc.purchase_transactions pt
SET trader_licence_id = tl.id
FROM gapmc.trader_licences tl
WHERE pt.trader_licence_id IS DISTINCT FROM tl.id
  AND (
    tl.id = (
      CASE
        WHEN trim(pt.trader_licence_id) ILIKE 'TA:%'
        THEN trim(substring(trim(pt.trader_licence_id) from 4))
        ELSE trim(pt.trader_licence_id)
      END
    )
    OR (
      tl.licence_no IS NOT NULL
      AND trim(tl.licence_no) = trim(pt.trader_licence_id)
    )
    OR (
      tl.entity_public_code IS NOT NULL
      AND trim(tl.entity_public_code) = trim(pt.trader_licence_id)
    )
  );
