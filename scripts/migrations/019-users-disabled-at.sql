-- US-M10-001 / §1.4: audit trail when employee-linked user is disabled.
ALTER TABLE gapmc.users ADD COLUMN IF NOT EXISTS disabled_at text;

COMMENT ON COLUMN gapmc.users.disabled_at IS 'ISO timestamp when is_active became false (employment or admin).';
