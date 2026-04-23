/**
 * Shared defaults for Playwright API + E2E tests (admin login).
 * Override with PW_ADMIN_EMAIL / PW_ADMIN_PASSWORD (single password).
 */
export function adminEmail(): string {
  return (process.env.PW_ADMIN_EMAIL || "admin@gapmc.local").trim();
}

/** Ordered candidates: explicit env, then new seed, then legacy dev DB. */
export function adminPasswordCandidates(): string[] {
  const single = process.env.PW_ADMIN_PASSWORD?.trim();
  if (single) return [single];
  return ["GapmcAdmin@2026!", "Apmc@2026"];
}
