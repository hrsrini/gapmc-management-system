/**
 * M-10: external entity portal users (US-M10-005).
 */

CREATE TABLE IF NOT EXISTS gapmc.portal_users (
  id TEXT PRIMARY KEY,
  unified_entity_id TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  disabled_at TEXT,
  force_password_change BOOLEAN DEFAULT true,
  last_login_at TEXT,
  provisioned_at TEXT NOT NULL,
  provisioned_by TEXT
);

