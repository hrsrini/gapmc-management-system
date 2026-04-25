-- US-M01-001: Aadhaar fingerprint + registration workflow status
ALTER TABLE gapmc.employees ADD COLUMN IF NOT EXISTS aadhaar_fingerprint text;

-- allow Recommended status (no constraint enforced at DB layer; stored as text)
COMMENT ON COLUMN gapmc.employees.aadhaar_fingerprint IS 'SHA256-HMAC fingerprint of raw Aadhaar for uniqueness; raw not stored.';
