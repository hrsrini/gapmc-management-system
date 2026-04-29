BEGIN;

-- =========================
-- UAT Cleanup (Gapmc schema)
-- Keeps:
--   - users row where username='admin'
--   - admin mappings in user_roles, user_yards
--   - full roles/permissions tables: roles, permissions, role_permissions
-- Deletes:
--   - all other data in gapmc schema
-- =========================

-- 1) Safety: admin must exist exactly once
DO $$
DECLARE
  v_count int;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM gapmc.users
  WHERE username = 'admin';

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Expected exactly 1 admin user with username=admin, found %', v_count;
  END IF;
END $$;

-- 2) Capture admin identity
CREATE TEMP TABLE _keep_admin AS
SELECT id, employee_id
FROM gapmc.users
WHERE username = 'admin';

-- 3) Temporarily disable FK/trigger checks for bulk cleanup
SET LOCAL session_replication_role = replica;

-- 4) Delete all rows from all gapmc tables except explicitly preserved tables
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'gapmc'
      AND tablename NOT IN (
        'users',
        'user_roles',
        'user_yards',
        'roles',
        'permissions',
        'role_permissions'
      )
  LOOP
    EXECUTE format('DELETE FROM gapmc.%I;', r.tablename);
  END LOOP;
END $$;

-- 5) Keep only admin in users
DELETE FROM gapmc.users u
WHERE NOT EXISTS (
  SELECT 1 FROM _keep_admin k WHERE k.id = u.id
);

-- 6) Keep only admin mappings
DELETE FROM gapmc.user_roles ur
WHERE NOT EXISTS (
  SELECT 1 FROM _keep_admin k WHERE k.id = ur.user_id
);

DELETE FROM gapmc.user_yards uy
WHERE NOT EXISTS (
  SELECT 1 FROM _keep_admin k WHERE k.id = uy.user_id
);

-- 7) If admin is linked to an employee, keep that employee only
DELETE FROM gapmc.employees e
WHERE EXISTS (SELECT 1 FROM _keep_admin k WHERE k.employee_id IS NOT NULL)
  AND NOT EXISTS (
    SELECT 1 FROM _keep_admin k WHERE k.employee_id = e.id
  );

DELETE FROM gapmc.employees
WHERE NOT EXISTS (SELECT 1 FROM _keep_admin k WHERE k.employee_id IS NOT NULL);

-- 8) Re-enable normal FK/trigger behavior
SET LOCAL session_replication_role = origin;

-- 9) Validation snapshot
SELECT 'users_admin_count' AS check_name, COUNT(*)::text AS value
FROM gapmc.users WHERE username = 'admin'
UNION ALL
SELECT 'users_total', COUNT(*)::text FROM gapmc.users
UNION ALL
SELECT 'user_roles_total', COUNT(*)::text FROM gapmc.user_roles
UNION ALL
SELECT 'user_yards_total', COUNT(*)::text FROM gapmc.user_yards
UNION ALL
SELECT 'roles_total', COUNT(*)::text FROM gapmc.roles
UNION ALL
SELECT 'permissions_total', COUNT(*)::text FROM gapmc.permissions
UNION ALL
SELECT 'role_permissions_total', COUNT(*)::text FROM gapmc.role_permissions;

-- IMPORTANT:
-- If results are correct, execute COMMIT;
-- If anything looks wrong, execute ROLLBACK;
