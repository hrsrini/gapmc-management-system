/** M-02 Track B entity sub-types (formal list; keep in sync with SRS / verification sheet). */

export const TRACKB_SUBTYPES = ["Govt", "Commercial", "AdHocOccupant"] as const;
export type TrackBSubType = (typeof TRACKB_SUBTYPES)[number];

const trackBSubTypeSet = new Set<string>(TRACKB_SUBTYPES.map((s) => s.toLowerCase()));

/** Returns canonical casing from `TRACKB_SUBTYPES`, or null if invalid / empty. */
export function normalizeTrackBSubType(raw: unknown): string | null {
  if (raw == null) return null;
  const v = String(raw).trim();
  if (!v) return null;
  const key = v.toLowerCase();
  if (!trackBSubTypeSet.has(key)) return null;
  const idx = TRACKB_SUBTYPES.findIndex((x) => x.toLowerCase() === key);
  return idx >= 0 ? TRACKB_SUBTYPES[idx]! : null;
}

/** Govt Track B entities use the pre-receipt billing instrument; others use tax-invoice style flows (e.g. M-03). */
export function isTrackBGovtSubType(subType: string | null | undefined): boolean {
  return String(subType ?? "").trim() === "Govt";
}

/** Same copy as GET /api/ioms/dues Track B branch when sub-type is not Govt (keep in sync). */
export const TRACKB_NON_GOV_DUES_API_HINT =
  "This Track B entity is not Govt sub-type: pre-receipt dues do not apply. Use M-03 rent / GST tax invoices (and related receipts) for Commercial or Ad-hoc occupant entities.";

/** Short label for registers / grids (entity list, profile). */
export function trackBShortBillingLabel(subType: string | null | undefined): string {
  return isTrackBGovtSubType(subType) ? "Pre-receipt (M-02)" : "M-03 rent / GST";
}

/** Entity profile / onboarding copy: where to bill and pay this Track B entity. */
export function trackBBillingProfileHint(subType: string | null | undefined): string {
  return isTrackBGovtSubType(subType)
    ? "Govt sub-type: use pre-receipts (M-02) for demands on this entity. Open Dues with this TB: id to see outstanding pre-receipt lines, or use the Pre-receipts register to issue and track instruments."
    : TRACKB_NON_GOV_DUES_API_HINT;
}
