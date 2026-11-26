-- M-01: Posting & Reporting Officer Update (DO → DV → DA)
CREATE TABLE IF NOT EXISTS gapmc.hr_posting_update_requests (
  id text PRIMARY KEY,
  request_no text NOT NULL UNIQUE,
  employee_id text NOT NULL,
  change_type text NOT NULL,
  old_yard_id text,
  old_location_posted text,
  old_section text,
  old_reporting_officer_employee_id text,
  new_yard_id text,
  new_section text,
  new_reporting_officer_employee_id text,
  additional_yard_ids text,
  ho_section_by_yard_id text,
  withdraw_yard_ids text,
  effective_from text NOT NULL,
  order_no text,
  order_date text,
  remarks text,
  order_copy_blob_key text,
  order_copy_file_name text,
  order_copy_mime_type text,
  order_copy_size_bytes integer,
  status text NOT NULL,
  do_user text,
  dv_user text,
  approved_by text,
  submitted_at text,
  verified_at text,
  approved_at text,
  returned_at text,
  rejected_at text,
  return_or_reject_remarks text,
  workflow_revision_count integer DEFAULT 0,
  service_book_entry_id text,
  document_id text,
  created_at text,
  updated_at text
);

CREATE INDEX IF NOT EXISTS idx_hr_posting_update_employee
  ON gapmc.hr_posting_update_requests(employee_id);

CREATE INDEX IF NOT EXISTS idx_hr_posting_update_status
  ON gapmc.hr_posting_update_requests(status);

-- At most one open (non-terminal) request per employee
CREATE UNIQUE INDEX IF NOT EXISTS uq_hr_posting_update_open_per_employee
  ON gapmc.hr_posting_update_requests(employee_id)
  WHERE status IN ('PendingVerification', 'PendingApproval', 'ReturnedToDO');

CREATE TABLE IF NOT EXISTS gapmc.hr_posting_update_sequence (
  id text PRIMARY KEY,
  year integer NOT NULL,
  last_seq integer NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_hr_posting_update_sequence_year
  ON gapmc.hr_posting_update_sequence(year);
