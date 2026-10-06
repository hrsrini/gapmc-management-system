/**
 * Employee Additional Charge Locations (beyond Primary Location Posted / yardId).
 * Stored in employees.location_posted as a JSON array of yard IDs.
 */

const YARD_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Parse stored location_posted into additional-charge yard IDs (excludes primary when provided). */
export function parseAdditionalChargeYardIds(
  raw: string | null | undefined,
  primaryYardId?: string | null,
): string[] {
  const primary = String(primaryYardId ?? "").trim();
  const t = String(raw ?? "").trim();
  if (!t) return [];

  let ids: string[] = [];
  if (t.startsWith("[")) {
    try {
      const parsed = JSON.parse(t) as unknown;
      if (Array.isArray(parsed)) {
        ids = parsed.map((x) => String(x ?? "").trim()).filter(Boolean);
      }
    } catch {
      ids = [];
    }
  } else if (t.includes(",")) {
    ids = t.split(",").map((x) => x.trim()).filter(Boolean);
  } else if (YARD_ID_RE.test(t)) {
    // Single yard id (not free-text legacy)
    ids = [t];
  } else {
    // Legacy free-text location note — no yard IDs
    ids = [];
  }

  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!YARD_ID_RE.test(id)) continue;
    if (primary && id === primary) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Serialize additional-charge yard IDs for employees.location_posted. */
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
