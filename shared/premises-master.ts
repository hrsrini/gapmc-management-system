/** M-02 Premises Master — field catalogues (Premises Management FR). */

export const PREMISES_TYPE_VALUES = [
  "Auction Shed",
  "Canteen",
  "Cold Storage",
  "Fruit Shed Block",
  "Godown",
  "Office",
  "Ripening Chamber",
  "Seminar Hall",
  "Shop",
  "Stall",
] as const;

export type PremisesType = (typeof PREMISES_TYPE_VALUES)[number];

export const PREMISES_LOCATION_VALUES = [
  "Basement",
  "First Floor",
  "Ground Floor",
  "Open Space",
  "Second Floor",
  "Third Floor",
  "Upper Ground Floor",
] as const;

export type PremisesLocation = (typeof PREMISES_LOCATION_VALUES)[number];

export const PROPERTY_TAX_AUTHORITY_VALUES = [
  "Municipal Council / Corporation",
  "Village Panchayat",
] as const;

export type PropertyTaxAuthority = (typeof PROPERTY_TAX_AUTHORITY_VALUES)[number];

export const UTILITY_CONNECTION_VALUES = ["No Connection", "Shared", "Independent"] as const;

export type UtilityConnectionType = (typeof UTILITY_CONNECTION_VALUES)[number];

export function normalizePremisesType(v: unknown): PremisesType | null {
  const s = String(v ?? "").trim();
  return (PREMISES_TYPE_VALUES as readonly string[]).includes(s) ? (s as PremisesType) : null;
}

export function normalizePremisesLocation(v: unknown): PremisesLocation | null {
  const s = String(v ?? "").trim();
  return (PREMISES_LOCATION_VALUES as readonly string[]).includes(s) ? (s as PremisesLocation) : null;
}

export function normalizePropertyTaxAuthority(v: unknown): PropertyTaxAuthority | null {
  const s = String(v ?? "").trim();
  return (PROPERTY_TAX_AUTHORITY_VALUES as readonly string[]).includes(s) ? (s as PropertyTaxAuthority) : null;
}

export function normalizeUtilityConnection(v: unknown): UtilityConnectionType | null {
  const s = String(v ?? "").trim();
  return (UTILITY_CONNECTION_VALUES as readonly string[]).includes(s) ? (s as UtilityConnectionType) : null;
}

/** Map legacy asset_type values to the current premises type catalogue. */
export function migrateLegacyPremisesType(assetType: string | null | undefined): PremisesType {
  const t = String(assetType ?? "").trim();
  if ((PREMISES_TYPE_VALUES as readonly string[]).includes(t)) return t as PremisesType;
  if (t === "Building") return "Office";
  return "Shop";
}
