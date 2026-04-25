-- US-M10-003: MFA columns for gapmc.users
ALTER TABLE gapmc.users ADD COLUMN IF NOT EXISTS mfa_enabled boolean DEFAULT false;
ALTER TABLE gapmc.users ADD COLUMN IF NOT EXISTS mfa_secret text;
ALTER TABLE gapmc.users ADD COLUMN IF NOT EXISTS mfa_verified_at text;

COMMENT ON COLUMN gapmc.users.mfa_enabled IS 'True when TOTP second factor is enabled for this user.';
COMMENT ON COLUMN gapmc.users.mfa_secret IS 'Base32 secret for TOTP (server-side only).';
COMMENT ON COLUMN gapmc.users.mfa_verified_at IS 'ISO timestamp when MFA was verified/enabled.';