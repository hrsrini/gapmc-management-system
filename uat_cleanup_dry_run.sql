BEGIN;

-- Ensure admin exists exactly once
DO $$
DECLARE v_count int;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM gapmc.users
  WHERE username = 'admin';

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Expected exactly 1 admin user with username=admin, found %', v_count;
  END IF;
END $$;

CREATE TEMP TABLE _keep_admin AS
SELECT id, employee_id
FROM gapmc.users
WHERE username = 'admin';

-- Per-table row counts (all tables in gapmc)
DO $$
DECLARE r record;
DECLARE v_count bigint;
BEGIN
  RAISE NOTICE '---- GAPMC TABLE COUNTS (CURRENT) ----';
  FOR r IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'gapmc'
    ORDER BY tablename
  LOOP
    EXECUTE format('SELECT COUNT(*) FROM gapmc.%I', r.tablename) INTO v_count;
    RAISE NOTICE '% = %', r.tablename, v_count;
  END LOOP;
END $$;

-- Explicit keep/remove summary
SELECT
  (SELECT COUNT(*) FROM gapmc.users) AS users_total,
  (SELECT COUNT(*) FROM gapmc.users u WHERE EXISTS (SELECT 1 FROM _keep_admin k WHERE k.id = u.id)) AS users_kept,
  (SELECT COUNT(*) FROM gapmc.users u WHERE NOT EXISTS (SELECT 1 FROM _keep_admin k WHERE k.id = u.id)) AS users_to_delete,
  (SELECT COUNT(*) FROM gapmc.user_roles) AS user_roles_total,
  (SELECT COUNT(*) FROM gapmc.user_roles ur WHERE EXISTS (SELECT 1 FROM _keep_admin k WHERE k.id = ur.user_id)) AS user_roles_kept,
  (SELECT COUNT(*) FROM gapmc.user_roles ur WHERE NOT EXISTS (SELECT 1 FROM _keep_admin k WHERE k.id = ur.user_id)) AS user_roles_to_delete,
  (SELECT COUNT(*) FROM gapmc.user_yards) AS user_yards_total,
  (SELECT COUNT(*) FROM gapmc.user_yards uy WHERE EXISTS (SELECT 1 FROM _keep_admin k WHERE k.id = uy.user_id)) AS user_yards_kept,
  (SELECT COUNT(*) FROM gapmc.user_yards uy WHERE NOT EXISTS (SELECT 1 FROM _keep_admin k WHERE k.id = uy.user_id)) AS user_yards_to_delete,
  (SELECT COUNT(*) FROM gapmc.roles) AS roles_kept,
  (SELECT COUNT(*) FROM gapmc.permissions) AS permissions_kept,
  (SELECT COUNT(*) FROM gapmc.role_permissions) AS role_permissions_kept,
  (SELECT COUNT(*) FROM gapmc.employees) AS employees_total,
  (SELECT COUNT(*) FROM gapmc.employees e WHERE EXISTS (SELECT 1 FROM _keep_admin k WHERE k.employee_id = e.id)) AS employees_kept,
  (SELECT COUNT(*) FROM gapmc.employees e WHERE NOT EXISTS (SELECT 1 FROM _keep_admin k WHERE k.employee_id = e.id)) AS employees_to_delete;

ROLLBACK;
