/** Client helpers for M-03 rent UI — Track A asset allotments + Track B entity premises. */

export interface AssetAllotmentRow {
  id: string;
  assetId: string;
  traderLicenceId: string;
  allotteeName: string;
  fromDate: string;
  toDate: string;
  status: string;
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

export function activeAssetAllotmentsInYard(rows: AssetAllotmentRow[], yardAssetIds: Set<string>): AssetAllotmentRow[] {
  return rows.filter((a) => a.status === "Active" && yardAssetIds.has(a.assetId));
}

export function billableEntityAllotmentsInYard(rows: EntityAllotmentRow[], yardAssetIds: Set<string>): EntityAllotmentRow[] {
  return rows.filter(
    (e) =>
      String(e.approvalStatus ?? "") === "Approved" &&
      e.status === "Active" &&
      yardAssetIds.has(e.assetId),
  );
}

/** Merge allotments keyed by primary key — trader vs entity ids are distinct nanoids in practice. */
export function allotmentAssetIdByPk(
  assetAllotments: AssetAllotmentRow[],
  entityAllotments: EntityAllotmentRow[],
): Map<string, { assetId: string; label: string }> {
  const m = new Map<string, { assetId: string; label: string }>();
  for (const a of assetAllotments) {
    const label = a.allotteeName ? `${a.allotteeName} (trader allotment)` : a.id;
    m.set(a.id, { assetId: a.assetId, label });
  }
  for (const e of entityAllotments) {
    const ref = e.premisesRefNo?.trim();
    const label = `${e.allotteeName}${ref ? ` · ${ref}` : ""} (Track B premises)`;
    m.set(e.id, { assetId: e.assetId, label });
  }
  return m;
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
