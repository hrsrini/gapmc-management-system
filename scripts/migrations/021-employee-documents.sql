-- US-M01-009: employee_documents table
CREATE TABLE IF NOT EXISTS gapmc.employee_documents (
  id text PRIMARY KEY,
  employee_id text NOT NULL REFERENCES gapmc.employees(id) ON DELETE CASCADE,
  doc_type text NOT NULL,
  file_name text NOT NULL,
  mime_type text NOT NULL,
  size_bytes integer NOT NULL,
  blob_key text NOT NULL,
  status text NOT NULL,
  uploaded_by text,
  created_at text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_employee_documents_employee_id ON gapmc.employee_documents(employee_id);
