/** Human-readable premises code (e.g. MAP/OFFICE-003), never internal asset row id. */
export function formatPremisesAssetLabel(
  assetRowId: string,
  displayByAssetRowId: Record<string, string>,
  premisesRefNo?: string | null,
): string {
  const code = displayByAssetRowId[assetRowId]?.trim();
  if (code) return code;
  const ref = premisesRefNo?.trim();
  if (ref) return ref;
  return "—";
}

export function buildAssetDisplayByRowId(
  assets: ReadonlyArray<{ id: string; assetId: string }>,
): Record<string, string> {
  return Object.fromEntries(assets.map((a) => [a.id, a.assetId]));
}

/** Premises code + formal allotment ref (M-03 invoice detail; no tenant name). */
export function formatAllotmentReferenceNo(
  assetRowId: string,
  displayByAssetRowId: Record<string, string>,
  premisesRefNo?: string | null,
): string {
  const label = formatPremisesAssetLabel(assetRowId, displayByAssetRowId, premisesRefNo);
  const ref = premisesRefNo?.trim();
  if (ref && label !== ref) return `${label} · ${ref}`;
  return label;
}
