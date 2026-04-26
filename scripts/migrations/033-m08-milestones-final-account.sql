/**
 * M-08: works milestones + final accounts.
 */

CREATE TABLE IF NOT EXISTS gapmc.works_milestones (
  id TEXT PRIMARY KEY,
  work_id TEXT NOT NULL,
  milestone_name TEXT NOT NULL,
  expected_date TEXT,
  actual_date TEXT,
  percent_complete INTEGER NOT NULL,
  value_of_work_inr DOUBLE PRECISION NOT NULL DEFAULT 0,
  attachments JSONB,
  status TEXT NOT NULL,
  do_user TEXT,
  dv_user TEXT,
  da_user TEXT,
  created_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_works_milestones_work_id ON gapmc.works_milestones(work_id);

CREATE TABLE IF NOT EXISTS gapmc.works_final_accounts (
  id TEXT PRIMARY KEY,
  work_id TEXT NOT NULL UNIQUE,
  actual_cost_inr DOUBLE PRECISION NOT NULL,
  sanctioned_amount_inr DOUBLE PRECISION,
  revised_estimate_approved_by TEXT,
  revised_estimate_remarks TEXT,
  supporting_docs JSONB,
  status TEXT NOT NULL,
  do_user TEXT,
  dv_user TEXT,
  da_user TEXT,
  created_at TEXT,
  approved_at TEXT
);

