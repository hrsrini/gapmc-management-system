-- GAPMC reference designations (Designation Master): hierarchy level 1 = highest authority.
-- Upsert by code so re-runs are safe.

INSERT INTO gapmc.designation_master (id, code, name, hierarchy_level, status, remarks, created_at, updated_at)
VALUES
  ('dm_gapmc_smo', 'SMO', 'SMO (State Marketing Officer)', 1, 'Active', 'GAPMC reference master', (now() AT TIME ZONE 'utc')::text, (now() AT TIME ZONE 'utc')::text),
  ('dm_gapmc_sec', 'SEC', 'Secretary', 2, 'Active', 'GAPMC reference master', (now() AT TIME ZONE 'utc')::text, (now() AT TIME ZONE 'utc')::text),
  ('dm_gapmc_jsec', 'JSEC', 'Joint Secretary', 3, 'Active', 'GAPMC reference master', (now() AT TIME ZONE 'utc')::text, (now() AT TIME ZONE 'utc')::text),
  ('dm_gapmc_dsa', 'DSA', 'Deputy Secretary (Administration)', 4, 'Active', 'GAPMC reference master', (now() AT TIME ZONE 'utc')::text, (now() AT TIME ZONE 'utc')::text),
  ('dm_gapmc_dsi', 'DSI', 'Deputy Secretary (Inspection)', 4, 'Active', 'GAPMC reference master', (now() AT TIME ZONE 'utc')::text, (now() AT TIME ZONE 'utc')::text),
  ('dm_gapmc_actof', 'ACTOF', 'Account Officer', 4, 'Active', 'GAPMC reference master', (now() AT TIME ZONE 'utc')::text, (now() AT TIME ZONE 'utc')::text),
  ('dm_gapmc_astsec', 'ASTSEC', 'Assistant Secretary', 5, 'Active', 'GAPMC reference master', (now() AT TIME ZONE 'utc')::text, (now() AT TIME ZONE 'utc')::text),
  ('dm_gapmc_stn', 'STN', 'Stenographer', 6, 'Active', 'GAPMC reference master', (now() AT TIME ZONE 'utc')::text, (now() AT TIME ZONE 'utc')::text),
  ('dm_gapmc_actnt', 'ACTNT', 'Accountant', 6, 'Active', 'GAPMC reference master', (now() AT TIME ZONE 'utc')::text, (now() AT TIME ZONE 'utc')::text),
  ('dm_gapmc_actclr', 'ACTCLR', 'Account Clerk', 7, 'Active', 'GAPMC reference master', (now() AT TIME ZONE 'utc')::text, (now() AT TIME ZONE 'utc')::text),
  ('dm_gapmc_sysadm', 'SYSADM', 'System Administrator', 8, 'Active', 'GAPMC reference master', (now() AT TIME ZONE 'utc')::text, (now() AT TIME ZONE 'utc')::text),
  ('dm_gapmc_jec', 'JEC', 'Junior Engineer (Civil)', 8, 'Active', 'GAPMC reference master', (now() AT TIME ZONE 'utc')::text, (now() AT TIME ZONE 'utc')::text),
  ('dm_gapmc_jem', 'JEM', 'Junior Engineer (Mechanical)', 8, 'Active', 'GAPMC reference master', (now() AT TIME ZONE 'utc')::text, (now() AT TIME ZONE 'utc')::text),
  ('dm_gapmc_msup', 'MSUP', 'Market Supervisor', 8, 'Active', 'GAPMC reference master', (now() AT TIME ZONE 'utc')::text, (now() AT TIME ZONE 'utc')::text),
  ('dm_gapmc_grd', 'GRD', 'Grader', 9, 'Active', 'GAPMC reference master', (now() AT TIME ZONE 'utc')::text, (now() AT TIME ZONE 'utc')::text),
  ('dm_gapmc_ct', 'CT', 'Clerk Typist', 10, 'Active', 'GAPMC reference master', (now() AT TIME ZONE 'utc')::text, (now() AT TIME ZONE 'utc')::text),
  ('dm_gapmc_dvr', 'DVR', 'Driver', 11, 'Active', 'GAPMC reference master', (now() AT TIME ZONE 'utc')::text, (now() AT TIME ZONE 'utc')::text),
  ('dm_gapmc_mts', 'MTS', 'Multi-Tasking Staff (MTS)', 12, 'Active', 'GAPMC reference master', (now() AT TIME ZONE 'utc')::text, (now() AT TIME ZONE 'utc')::text),
  ('dm_gapmc_ma', 'MA', 'Market Attendant', 12, 'Active', 'GAPMC reference master', (now() AT TIME ZONE 'utc')::text, (now() AT TIME ZONE 'utc')::text),
  ('dm_gapmc_wcm', 'WCM', 'Watchman-cum-Mali', 12, 'Active', 'GAPMC reference master', (now() AT TIME ZONE 'utc')::text, (now() AT TIME ZONE 'utc')::text),
  ('dm_gapmc_swp', 'SWP', 'Sweeper', 13, 'Active', 'GAPMC reference master', (now() AT TIME ZONE 'utc')::text, (now() AT TIME ZONE 'utc')::text),
  ('dm_gapmc_sg', 'SG', 'Security Guard', 14, 'Active', 'GAPMC reference master', (now() AT TIME ZONE 'utc')::text, (now() AT TIME ZONE 'utc')::text)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  hierarchy_level = EXCLUDED.hierarchy_level,
  status = EXCLUDED.status,
  remarks = EXCLUDED.remarks,
  updated_at = EXCLUDED.updated_at;

-- Link employees that still have no designation_id when designation text matches a master name (case-insensitive).
UPDATE gapmc.employees e
SET designation_id = m.id
FROM gapmc.designation_master m
WHERE e.designation_id IS NULL AND lower(trim(e.designation)) = lower(trim(m.name));
