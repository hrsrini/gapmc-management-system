-- Leave and Licence Agreement Generator (Rent Agreement Generator hand-off).
-- Statuses: Draft | Final | Executed | Cancelled. Versions store immutable PDF snapshots.

CREATE TABLE IF NOT EXISTS gapmc.leave_licence_agreements (
  id text PRIMARY KEY,
  premises_agreement_id text NOT NULL,
  allotment_ref text NOT NULL,
  /** New | Renewal */
  basis text NOT NULL DEFAULT 'New',
  licence_or_entity_no text,
  renewal_no integer NOT NULL DEFAULT 1,
  /** Draft | Final | Executed | Cancelled */
  status text NOT NULL DEFAULT 'Draft',
  current_version_no integer NOT NULL DEFAULT 0,
  superseded_by_id text,
  cancelled_from_id text,
  cancel_reason text,
  cancel_effective_date text,
  cancel_order_ref text,
  cancel_order_file text,
  cancelled_at text,
  cancelled_by text,
  executed_at text,
  executed_by text,
  signed_scan_file text,
  signed_scan_uploaded_at text,
  created_by text,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS leave_licence_agreements_active_premises_uidx
  ON gapmc.leave_licence_agreements (premises_agreement_id)
  WHERE status IN ('Draft', 'Final', 'Executed');

CREATE INDEX IF NOT EXISTS leave_licence_agreements_premises_idx
  ON gapmc.leave_licence_agreements (premises_agreement_id);

CREATE INDEX IF NOT EXISTS leave_licence_agreements_status_idx
  ON gapmc.leave_licence_agreements (status);

CREATE TABLE IF NOT EXISTS gapmc.leave_licence_agreement_versions (
  id text PRIMARY KEY,
  leave_licence_agreement_id text NOT NULL,
  version_no integer NOT NULL,
  /** Draft | Final | Voided | Executed */
  kind text NOT NULL DEFAULT 'Draft',
  /** Full field snapshot used to reproduce the PDF. */
  snapshot_json text NOT NULL,
  content_sha256 text,
  pdf_file text,
  pdf_page_count integer,
  generated_by text,
  generated_at text NOT NULL,
  voided_at text,
  UNIQUE (leave_licence_agreement_id, version_no)
);

CREATE INDEX IF NOT EXISTS leave_licence_agreement_versions_lla_idx
  ON gapmc.leave_licence_agreement_versions (leave_licence_agreement_id);
