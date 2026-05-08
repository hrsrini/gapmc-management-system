-- M-04: Fix purchase_transactions.trader_licence_id when it stores TA: unified id or public licence_no instead of trader_licences.id.
-- Safe to run multiple times (no-op when rows already normalized).

-- 1) TA:<trader_licence_id> → bare id when that id exists in trader_licences
UPDATE gapmc.purchase_transactions pt
SET trader_licence_id = cand.resolved_id
FROM (
  SELECT
    pt2.id AS purchase_id,
    trim(substring(trim(pt2.trader_licence_id) from 4)) AS resolved_id
  FROM gapmc.purchase_transactions pt2
  WHERE trim(pt2.trader_licence_id) ILIKE 'TA:%'
) cand
INNER JOIN gapmc.trader_licences tl ON tl.id = cand.resolved_id
WHERE pt.id = cand.purchase_id
  AND trim(pt.trader_licence_id) ILIKE 'TA:%'
  AND pt.trader_licence_id IS DISTINCT FROM cand.resolved_id;

-- 2) licence_no string stored in FK column → replace with trader_licences.id
UPDATE gapmc.purchase_transactions pt
SET trader_licence_id = tl.id
FROM gapmc.trader_licences tl
WHERE coalesce(trim(tl.licence_no), '') <> ''
  AND trim(pt.trader_licence_id) = trim(tl.licence_no)
  AND pt.trader_licence_id IS DISTINCT FROM tl.id;

-- 3) entity_public_code (ENT-…) stored as FK — requires gapmc.trader_licences.entity_public_code (US-M02-001)
UPDATE gapmc.purchase_transactions pt
SET trader_licence_id = tl.id
FROM gapmc.trader_licences tl
WHERE coalesce(trim(tl.entity_public_code), '') <> ''
  AND trim(pt.trader_licence_id) = trim(tl.entity_public_code)
  AND pt.trader_licence_id IS DISTINCT FROM tl.id;
