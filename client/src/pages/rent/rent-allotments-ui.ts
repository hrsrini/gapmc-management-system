import { formatAllotmentReferenceNo } from "@/lib/asset-premises-display";

/** Client helpers for M-03 rent UI — Track A asset allotments + Track B entity premises. */

export interface AssetAllotmentRow {
  id: string;
  /** FK to `assets.id` (primary key), not the human-readable `assets.asset_id` code. */
  assetId: string;
  traderLicenceId: string;
  allotteeName: string;
  fromDate: string;
  toDate: string;
  status: string;
  approvalStatus?: string | null;
  premisesRefNo?: string | null;
}

export interface YardRef {
  id: string;
  name: string;
  code: string;
  type?: string | null;
}

export interface EntityAllotmentRow {
  id: string;
  assetId: string;
  entityId: string;
  allotteeName: string;
  fromDate: string;
  toDate: string;
  status: string;
  approvalStatus?: string | null;
  premisesRefNo?: string | null;
  monthlyRent?: number | null;
  gstApplicable?: boolean | null;
}

/** Premises exist only at market yards — exclude check posts and HO from rent-invoice yard filters. */
export function yardsWithPremises(yards: YardRef[]): YardRef[] {
  return yards.filter((y) => String(y.type ?? "Yard").trim() === "Yard");
}

/** Primary keys (`assets.id`) for premises in the selected yard. */
export function buildYardAssetPrimaryKeySet(
  assets: { id: string; yardId: string }[],
  yardId: string,
): Set<string> {
  return new Set(assets.filter((a) => a.yardId === yardId).map((a) => a.id));
}

export function billableAssetAllotments(rows: AssetAllotmentRow[]): AssetAllotmentRow[] {
  return rows.filter(
    (a) => a.status === "Active" && String(a.approvalStatus ?? "Approved") === "Approved",
  );
}

export function billableEntityAllotments(rows: EntityAllotmentRow[]): EntityAllotmentRow[] {
  return rows.filter(
    (e) => String(e.approvalStatus ?? "") === "Approved" && e.status === "Active",
  );
}

export function activeAssetAllotmentsInYard(
  rows: AssetAllotmentRow[],
  yardAssetPrimaryKeys: Set<string>,
): AssetAllotmentRow[] {
  return billableAssetAllotments(rows).filter((a) => yardAssetPrimaryKeys.has(a.assetId));
}

export function billableEntityAllotmentsInYard(
  rows: EntityAllotmentRow[],
  yardAssetPrimaryKeys: Set<string>,
): EntityAllotmentRow[] {
  return billableEntityAllotments(rows).filter((e) => yardAssetPrimaryKeys.has(e.assetId));
}

/** Merge allotments keyed by primary key — trader vs entity ids are distinct nanoids in practice. */
export function allotmentAssetIdByPk(
  assetAllotments: AssetAllotmentRow[],
  entityAllotments: EntityAllotmentRow[],
): Map<string, { assetId: string; label: string }> {
  const m = new Map<string, { assetId: string; label: string }>();
  for (const a of assetAllotments) {
    const ref = a.premisesRefNo?.trim();
    m.set(a.id, { assetId: a.assetId, label: ref || a.id });
  }
  for (const e of entityAllotments) {
    const ref = e.premisesRefNo?.trim();
    m.set(e.id, { assetId: e.assetId, label: ref || e.id });
  }
  return m;
}

/** Premises name + allotment ref (no duplicate entity / trader name). */
export function formatRentInvoiceAllotmentReference(
  allotmentId: string,
  entityAllotments: EntityAllotmentRow[],
  assetAllotments: AssetAllotmentRow[],
  /** Human-readable `assets.asset_id` keyed by `assets.id` (allotment `assetId` FK). */
  assetPublicByPk?: Record<string, string>,
  /** Invoice `assetId` FK when allotment row is not yet in cached lists. */
  fallbackAssetRowId?: string,
): string {
  const byPk = assetPublicByPk ?? {};
  const eRow = entityAllotments.find((e) => e.id === allotmentId);
  if (eRow) {
    return formatAllotmentReferenceNo(eRow.assetId, byPk, eRow.premisesRefNo);
  }
  const aRow = assetAllotments.find((a) => a.id === allotmentId);
  if (aRow) {
    return formatAllotmentReferenceNo(aRow.assetId, byPk, aRow.premisesRefNo);
  }
  if (fallbackAssetRowId?.trim()) {
    return formatAllotmentReferenceNo(fallbackAssetRowId, byPk, null);
  }
  return allotmentId;
}

/** Tenant / counterparty once — entity name or licence, without TB:/TA: technical id suffix. */
export function formatRentInvoiceTenantCounterparty(
  tenantLicenceId: string,
  entityMaster: { name?: string | null; entityCode?: string | null } | null | undefined,
  licenceById: Record<string, string>,
): string {
  const tl = tenantLicenceId.trim();
  if (tl.startsWith("TB:")) {
    const ec = entityMaster?.entityCode?.trim();
    const nm = entityMaster?.name?.trim();
    if (nm && ec && ec !== nm) return `${nm} (${ec})`;
    return nm ?? ec ?? "—";
  }
  const lk = tl.startsWith("TA:") ? tl.slice(3) : tl;
  return licenceById[lk] ?? tl;
}

export function entityIdFromRentInvoice(inv: {
  entityId?: string | null;
  tenantLicenceId?: string | null;
}): string | null {
  const eid = inv.entityId != null ? String(inv.entityId).trim() : "";
  if (eid) return eid;
  const tl = String(inv.tenantLicenceId ?? "").trim();
  if (tl.startsWith("TB:")) return tl.slice(3).trim() || null;
  return null;
}
