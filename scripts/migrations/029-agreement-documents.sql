-- M-02 US-M02-013: Agreement document upload + version history.

CREATE TABLE IF NOT EXISTS gapmc.agreement_documents (
  id TEXT PRIMARY KEY,
  agreement_id TEXT NOT NULL REFERENCES gapmc.agreements(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  blob_key TEXT NOT NULL,
  uploaded_by TEXT,
  created_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS agreement_documents_agreement_version_uq
  ON gapmc.agreement_documents(agreement_id, version);

CREATE INDEX IF NOT EXISTS agreement_documents_agreement_id_idx
  ON gapmc.agreement_documents(agreement_id, version DESC);

