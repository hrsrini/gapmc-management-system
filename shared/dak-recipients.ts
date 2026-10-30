/** Shared Tapal Outward recipient helpers (To / Copy To). */

export type DakRecipientRow = {
  name: string;
  address: string;
  locationId?: string | null;
};

export function parseDakRecipients(raw: unknown): DakRecipientRow[] {
  if (!Array.isArray(raw)) return [];
  const out: DakRecipientRow[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const name = String(o.name ?? "").trim();
    const address = String(o.address ?? "").trim();
    const locationId =
      o.locationId == null || String(o.locationId).trim() === ""
        ? null
        : String(o.locationId).trim();
    if (!name && !address) continue;
    out.push({ name: name || "—", address, locationId });
  }
  return out;
}

/** Flatten names for legacy to_party / register "To" column. */
export function joinRecipientNames(rows: DakRecipientRow[]): string {
  const names = rows.map((r) => r.name.trim()).filter(Boolean);
  return names.length ? names.join("; ") : "";
}

export function joinRecipientAddresses(rows: DakRecipientRow[]): string {
  const addrs = rows.map((r) => r.address.trim()).filter(Boolean);
  return addrs.length ? addrs.join("; ") : "";
}
