-- Old/New License Number Management: bidirectional link between new and superseded old licences.
ALTER TABLE gapmc.trader_licences
  ADD COLUMN IF NOT EXISTS linked_old_licence_id text,
  ADD COLUMN IF NOT EXISTS superseded_by_licence_id text;

CREATE INDEX IF NOT EXISTS trader_licences_linked_old_idx
  ON gapmc.trader_licences (linked_old_licence_id)
  WHERE linked_old_licence_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS trader_licences_superseded_by_idx
  ON gapmc.trader_licences (superseded_by_licence_id)
  WHERE superseded_by_licence_id IS NOT NULL;
