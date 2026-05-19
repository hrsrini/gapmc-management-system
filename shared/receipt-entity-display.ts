import { parseUnifiedEntityId } from "./unified-entity-id";

function looksLikeOpaqueRecordId(s: string): boolean {
  const t = s.trim();
  if (t.length < 10) return false;
  return /^[a-zA-Z0-9_-]+$/.test(t);
}

/** True when value is a unified-entity token or opaque DB id (not a human label). */
export function isTechnicalEntityToken(s: string | null | undefined): boolean {
  const t = String(s ?? "").trim();
  if (!t) return true;
  if (parseUnifiedEntityId(t)) return true;
  return looksLikeOpaqueRecordId(t);
}

/** Pick the first human-readable label; never return TA:/TB:/AH: or nanoid ids. */
export function finalizeEntityDisplayName(candidates: Array<string | null | undefined>): string {
  for (const c of candidates) {
    const t = String(c ?? "").trim();
    if (!t || t === "—") continue;
    if (isTechnicalEntityToken(t)) continue;
    const track = /^(Track A|Track B|Ad hoc):\s*(.+)$/i.exec(t);
    if (track?.[2]) {
      const inner = track[2].trim();
      if (inner && !isTechnicalEntityToken(inner)) return inner;
      continue;
    }
    return t;
  }
  return "—";
}
