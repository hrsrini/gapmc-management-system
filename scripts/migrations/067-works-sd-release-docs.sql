-- M-08: SD release date/letter + Work Order supporting documents (licenses/approvals)
ALTER TABLE gapmc.works_sd_pbg ADD COLUMN IF NOT EXISTS release_date text;
ALTER TABLE gapmc.works_sd_pbg ADD COLUMN IF NOT EXISTS release_letter_file text;
ALTER TABLE gapmc.works_sd_pbg ADD COLUMN IF NOT EXISTS released_by text;

CREATE TABLE IF NOT EXISTS gapmc.works_documents (
  id text PRIMARY KEY,
  work_id text NOT NULL,
  category text NOT NULL DEFAULT 'Other', -- License | Approval | Other
  original_name text,
  stored_name text NOT NULL,
  uploaded_by text,
  created_at text
);

CREATE INDEX IF NOT EXISTS works_documents_work_id_idx ON gapmc.works_documents (work_id);
