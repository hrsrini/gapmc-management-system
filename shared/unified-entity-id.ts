/** Unified entity id: `TA:<trader_licence_id>` | `TB:<entity_id>` | `AH:<ad_hoc_entity_id>`. */

export type UnifiedEntityKind = "TA" | "TB" | "AH";

export function parseUnifiedEntityId(id: string): { kind: UnifiedEntityKind; refId: string } | null {
  const m = /^(TA|TB|AH):(.+)$/.exec(String(id ?? "").trim());
  if (!m) return null;
  const kind = m[1] as UnifiedEntityKind;
  const refId = m[2] ?? "";
  if (!refId) return null;
  return { kind, refId };
}

export function unifiedEntityIdFromTrackA(traderLicenceId: string): string {
  return `TA:${String(traderLicenceId).trim()}`;
}

export function unifiedEntityIdFromTrackB(entityId: string): string {
  return `TB:${String(entityId).trim()}`;
}

export function unifiedEntityIdFromAdHoc(adHocEntityId: string): string {
  return `AH:${String(adHocEntityId).trim()}`;
}
