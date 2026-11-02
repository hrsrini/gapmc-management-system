-- Mandatory password change for existing IOMS users (Password Management FRD).

ALTER TABLE gapmc.users
  ADD COLUMN IF NOT EXISTS force_password_change BOOLEAN NOT NULL DEFAULT TRUE;

-- Existing non-ADMIN accounts must change password on next login.
-- ADMIN-tier accounts are exempt from mandatory password-change gating.
UPDATE gapmc.users u
SET force_password_change = TRUE
WHERE force_password_change IS DISTINCT FROM TRUE
  AND NOT EXISTS (
    SELECT 1
    FROM gapmc.user_roles ur
    JOIN gapmc.roles r ON r.id = ur.role_id
    WHERE ur.user_id = u.id AND r.tier = 'ADMIN'
  );

UPDATE gapmc.users u
SET force_password_change = FALSE
WHERE EXISTS (
  SELECT 1
  FROM gapmc.user_roles ur
  JOIN gapmc.roles r ON r.id = ur.role_id
  WHERE ur.user_id = u.id AND r.tier = 'ADMIN'
);
