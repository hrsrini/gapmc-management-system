/** Human-readable unified-entity / public entity ID display (M-02). */

export type UnifiedEntityKindLabel = "TrackA" | "TrackB" | "AdHoc";

const KIND_PREFIX: Record<UnifiedEntityKindLabel, string> = {
  TrackA: "TA",
  TrackB: "TB",
  AdHoc: "AH",
};

/**
 * Unified entity master column: licence number (Track A) or public entity code (Track B / ad-hoc).
 * No `TA:` / `TB:` prefix — e.g. `GAPMC/…` or `ENT-2026-00004`.
 */
export function formatLicenceOrEntityIdDisplay(
  kind: UnifiedEntityKindLabel,
  args: { licenceNo?: string | null; publicEntityCode?: string | null },
): string {
  if (kind === "TrackA") {
    const lic = String(args.licenceNo ?? "").trim();
    if (lic) return lic;
    const code = String(args.publicEntityCode ?? "").trim();
    return code || "—";
  }
  const code = String(args.publicEntityCode ?? "").trim();
  return code || "—";
}

/** e.g. `TB : ENT-2026-00001` */
export function formatDisplayEntityId(
  kind: UnifiedEntityKindLabel,
  publicEntityCode: string | null | undefined,
): string | null {
  const code = String(publicEntityCode ?? "").trim();
  if (!code) return null;
  const prefix = KIND_PREFIX[kind] ?? "UE";
  return `${prefix} : ${code}`;
}

/** Entity picker / grid: `ENT-2026-00001 — Firm name` (no internal nanoid). */
export function formatEntityMasterLabel(
  publicEntityCode: string | null | undefined,
  name: string | null | undefined,
): string {
  const code = String(publicEntityCode ?? "").trim();
  const n = String(name ?? "").trim();
  if (code && n) return `${code} — ${n}`;
  if (code) return code;
  return n || "—";
}

/** Outstanding dues / dropdown label. */
export function formatUnifiedEntityOptionLabel(args: {
  kind: UnifiedEntityKindLabel;
  publicEntityCode?: string | null;
  name?: string | null;
  trackLabel?: string;
}): string {
  const displayId = formatDisplayEntityId(args.kind, args.publicEntityCode);
  const n = String(args.name ?? "").trim() || "—";
  const track =
    args.trackLabel ??
    (args.kind === "TrackA" ? "Track A" : args.kind === "TrackB" ? "Track B" : "Ad-hoc");
  if (displayId) return `${displayId} — ${n} (${track})`;
  return `${n} (${track})`;
}
