/**
 * Employee Additional Charge Locations (beyond Primary Location Posted / yardId).
 * Stored in employees.location_posted as either:
 * - legacy JSON array of yard ID strings, or
 * - JSON array of holdings: { yardId, from?: YYYY-MM-DD, section?: string | null }
 */

const YARD_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export type AdditionalChargeHolding = {
  yardId: string;
  /** Charge start date (YYYY-MM-DD); missing for legacy rows. */
  from?: string | null;
  /** HO section when the charge location is Head Office (information only). */
  section?: string | null;
};

function extractYardId(item: unknown): string {
  if (typeof item === "string") return item.trim();
  if (item && typeof item === "object" && "yardId" in item) {
    return String((item as { yardId?: unknown }).yardId ?? "").trim();
  }
  return "";
}

/** Parse stored location_posted into additional-charge holdings (excludes primary when provided). */
export function parseAdditionalChargeHoldings(
  raw: string | null | undefined,
  primaryYardId?: string | null,
): AdditionalChargeHolding[] {
  const primary = String(primaryYardId ?? "").trim();
  const t = String(raw ?? "").trim();
  if (!t) return [];

  let items: unknown[] = [];
  if (t.startsWith("[")) {
    try {
      const parsed = JSON.parse(t) as unknown;
      if (Array.isArray(parsed)) items = parsed;
    } catch {
      items = [];
    }
  } else if (t.includes(",")) {
    items = t.split(",").map((x) => x.trim()).filter(Boolean);
  } else if (YARD_ID_RE.test(t)) {
    items = [t];
  } else {
    items = [];
  }

  const seen = new Set<string>();
  const out: AdditionalChargeHolding[] = [];
  for (const item of items) {
    const yardId = extractYardId(item);
    if (!YARD_ID_RE.test(yardId)) continue;
    if (primary && yardId === primary) continue;
    if (seen.has(yardId)) continue;
    seen.add(yardId);
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const o = item as { from?: unknown; section?: unknown };
      const from = o.from != null && String(o.from).trim() ? String(o.from).trim() : null;
      const section = o.section != null && String(o.section).trim() ? String(o.section).trim() : null;
      out.push({ yardId, from, section });
    } else {
      out.push({ yardId, from: null, section: null });
    }
  }
  return out;
}

/** Parse stored location_posted into additional-charge yard IDs (excludes primary when provided). */
export function parseAdditionalChargeYardIds(
  raw: string | null | undefined,
  primaryYardId?: string | null,
): string[] {
  return parseAdditionalChargeHoldings(raw, primaryYardId).map((h) => h.yardId);
}

/** Serialize additional-charge yard IDs for employees.location_posted (legacy string[] form). */
export function serializeAdditionalChargeYardIds(
  yardIds: string[] | null | undefined,
  primaryYardId?: string | null,
): string | null {
  const ids = parseAdditionalChargeYardIds(
    JSON.stringify(Array.isArray(yardIds) ? yardIds : []),
    primaryYardId,
  );
  if (ids.length === 0) return null;
  return JSON.stringify(ids);
}

/** Serialize holdings (preferred when start dates / HO sections are known). */
export function serializeAdditionalChargeHoldings(
  holdings: AdditionalChargeHolding[] | null | undefined,
  primaryYardId?: string | null,
): string | null {
  const primary = String(primaryYardId ?? "").trim();
  const seen = new Set<string>();
  const out: AdditionalChargeHolding[] = [];
  for (const h of holdings ?? []) {
    const yardId = String(h?.yardId ?? "").trim();
    if (!YARD_ID_RE.test(yardId)) continue;
    if (primary && yardId === primary) continue;
    if (seen.has(yardId)) continue;
    seen.add(yardId);
    const from = h.from != null && String(h.from).trim() ? String(h.from).trim() : null;
    const section = h.section != null && String(h.section).trim() ? String(h.section).trim() : null;
    out.push({ yardId, from, section });
  }
  if (out.length === 0) return null;
  // Prefer structured form whenever any holding has metadata; else plain ids for compactness.
  const anyMeta = out.some((h) => h.from || h.section);
  if (!anyMeta) return JSON.stringify(out.map((h) => h.yardId));
  return JSON.stringify(out);
}

/** Resolve display labels for additional charge yards. */
export function formatAdditionalChargeLabels(
  raw: string | null | undefined,
  primaryYardId: string | null | undefined,
  yardById: Record<string, { name?: string | null; code?: string | null } | undefined>,
): string[] {
  return parseAdditionalChargeYardIds(raw, primaryYardId).map((id) => {
    const y = yardById[id];
    return (y?.name ?? y?.code ?? id).trim() || id;
  });
}
