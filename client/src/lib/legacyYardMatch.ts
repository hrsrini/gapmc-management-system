import { LOCATIONS } from "@/data/yards";

/** Minimal yard row from `GET /api/yards` or `/api/yards/for-reports`. */
export interface ApiYardRef {
  id: string;
  name: string;
  code: string;
  type?: string | null;
  isActive?: boolean | null;
}

function normCode(c: string) {
  return String(c).trim().toUpperCase();
}

function normName(n: string) {
  return String(n).trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Maps gapmc legacy `invoices` / `receipts` (integer `yard_id` + label) to an IOMS `yards` row.
 * Uses static `LOCATIONS` codes (1→MARG, …) first, then normalized name match.
 */
export function legacyRentRowMatchesApiYard(
  legacyYardId: number,
  legacyYardLabel: string,
  apiYard: ApiYardRef,
): boolean {
  const loc = LOCATIONS.find((l) => l.id === legacyYardId);
  if (loc && normCode(apiYard.code) === normCode(loc.code)) return true;
  if (legacyYardLabel && apiYard.name && normName(legacyYardLabel) === normName(apiYard.name)) {
    return true;
  }
  return false;
}

export function filterApiYardsForLegacyRentReports(yards: ApiYardRef[]): ApiYardRef[] {
  return yards.filter((y) => String(y.type ?? "").toLowerCase() === "yard");
}

/** Map IOMS yard → legacy `gapmc.traders` / `invoices` integer `yard_id` (via static location codes). */
export function apiYardToLegacyYardId(apiYard: ApiYardRef): number | null {
  const loc = LOCATIONS.find((l) => normCode(l.code) === normCode(apiYard.code));
  return loc ? loc.id : null;
}

export function legacyYardIdToApiYardId(legacyId: number, yards: ApiYardRef[]): string | null {
  const loc = LOCATIONS.find((l) => l.id === legacyId);
  if (!loc) return null;
  const y = yards.find((api) => normCode(api.code) === normCode(loc.code));
  return y?.id ?? null;
}

export function legacyRowMatchesSelectedApiYard(
  legacyId: number,
  legacyName: string,
  selectedApiYardId: string,
  yards: ApiYardRef[],
): boolean {
  if (selectedApiYardId === "all") return true;
  const y = yards.find((x) => x.id === selectedApiYardId);
  if (!y) return false;
  return legacyRentRowMatchesApiYard(legacyId, legacyName, y);
}
