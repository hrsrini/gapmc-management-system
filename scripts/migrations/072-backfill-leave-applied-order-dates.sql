-- Backfill leave application date + fixed sanction order date from audit_log.
-- applied_at: Create audit timestamp (YYYY-MM-DD).
-- order_date: first Update that set status=Approved (YYYY-MM-DD).

-- Normalize any ISO timestamps already stored in applied_at to date-only.
UPDATE gapmc.leave_requests
SET applied_at = LEFT(applied_at, 10)
WHERE applied_at ~ '^\d{4}-\d{2}-\d{2}T';

UPDATE gapmc.leave_requests
SET order_date = LEFT(order_date, 10)
WHERE order_date ~ '^\d{4}-\d{2}-\d{2}T';

-- Application date from Create audit.
UPDATE gapmc.leave_requests lr
SET applied_at = LEFT(a.created_at, 10)
FROM (
  SELECT DISTINCT ON (record_id) record_id, created_at
  FROM gapmc.audit_log
  WHERE module = 'HR'
    AND action = 'Create'
    AND record_id IS NOT NULL
    AND btrim(record_id) <> ''
  ORDER BY record_id, created_at ASC
) a
WHERE lr.id = a.record_id
  AND (lr.applied_at IS NULL OR btrim(lr.applied_at) = '');

-- Order date from first Approved transition in audit (Approved + Superseded).
UPDATE gapmc.leave_requests lr
SET order_date = LEFT(a.created_at, 10)
FROM (
  SELECT DISTINCT ON (record_id) record_id, created_at
  FROM gapmc.audit_log
  WHERE module = 'HR'
    AND action = 'Update'
    AND record_id IS NOT NULL
    AND btrim(record_id) <> ''
    AND COALESCE(after_value->>'status', '') = 'Approved'
  ORDER BY record_id, created_at ASC
) a
WHERE lr.id = a.record_id
  AND lr.status IN ('Approved', 'Superseded')
  AND (lr.order_date IS NULL OR btrim(lr.order_date) = '');

-- Last-resort application date when no Create audit exists (historical / imported).
UPDATE gapmc.leave_requests
SET applied_at = LEFT(from_date, 10)
WHERE (applied_at IS NULL OR btrim(applied_at) = '')
  AND from_date ~ '^\d{4}-\d{2}-\d{2}';

COMMENT ON COLUMN gapmc.leave_requests.applied_at IS 'YYYY-MM-DD leave application date (user-entered; Form-1 + sanction READ).';
COMMENT ON COLUMN gapmc.leave_requests.order_date IS 'YYYY-MM-DD sanction order date fixed at DA approval (does not change on re-download).';
