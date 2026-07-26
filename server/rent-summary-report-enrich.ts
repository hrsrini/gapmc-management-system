/**
 * Enrich M-03 rent invoice rows for Rent Summary report (IOMS Reports).
 */
import { inArray, or } from "drizzle-orm";
import { db } from "./db";
import { assets, entities, rentInvoices, traderLicences, yards, adHocEntities } from "@shared/db-schema";
import type { InferSelectModel } from "drizzle-orm";
import { parseUnifiedEntityId } from "@shared/unified-entity-id";

export type RentSummaryRow = InferSelectModel<typeof rentInvoices> & {
  yardName: string;
  premisesId: string;
  occupantName: string;
};

export async function enrichRentSummaryRows(
  rows: InferSelectModel<typeof rentInvoices>[],
): Promise<RentSummaryRow[]> {
  if (rows.length === 0) return [];

  const assetPks = Array.from(new Set(rows.map((r) => String(r.assetId ?? "").trim()).filter(Boolean)));
  const yardIds = Array.from(new Set(rows.map((r) => String(r.yardId ?? "").trim()).filter(Boolean)));

  const premisesByPk = new Map<string, string>();
  if (assetPks.length > 0) {
    const assetRows = await db
      .select({ id: assets.id, assetId: assets.assetId })
      .from(assets)
      .where(or(inArray(assets.id, assetPks), inArray(assets.assetId, assetPks)));
    for (const a of assetRows) {
      const code = String(a.assetId ?? "").trim();
      if (code) premisesByPk.set(a.id, code);
    }
  }

  const yardNameById = new Map<string, string>();
  if (yardIds.length > 0) {
    const yardRows = await db
      .select({ id: yards.id, name: yards.name, code: yards.code })
      .from(yards)
      .where(inArray(yards.id, yardIds));
    for (const y of yardRows) {
      yardNameById.set(y.id, String(y.name ?? "").trim() || String(y.code ?? "").trim() || y.id);
    }
  }

  const traderIds = new Set<string>();
  const entityIds = new Set<string>();
  const adHocIds = new Set<string>();
  for (const r of rows) {
    const tl = String(r.tenantLicenceId ?? "").trim();
    const parsed = parseUnifiedEntityId(tl);
    if (parsed?.kind === "TB") entityIds.add(parsed.refId);
    else if (parsed?.kind === "TA") traderIds.add(parsed.refId);
    else if (parsed?.kind === "AH") adHocIds.add(parsed.refId);
    else if (tl && !tl.startsWith("TB:") && !tl.startsWith("AH:")) traderIds.add(tl);
    const eid = r.entityId != null ? String(r.entityId).trim() : "";
    if (eid) entityIds.add(eid);
  }

  const firmByTraderId = new Map<string, string>();
  if (traderIds.size > 0) {
    const licRows = await db
      .select({ id: traderLicences.id, firmName: traderLicences.firmName })
      .from(traderLicences)
      .where(inArray(traderLicences.id, Array.from(traderIds)));
    for (const l of licRows) {
      firmByTraderId.set(l.id, String(l.firmName ?? "").trim() || l.id);
    }
  }

  const nameByEntityId = new Map<string, string>();
  if (entityIds.size > 0) {
    const entRows = await db
      .select({ id: entities.id, name: entities.name })
      .from(entities)
      .where(inArray(entities.id, Array.from(entityIds)));
    for (const e of entRows) {
      nameByEntityId.set(e.id, String(e.name ?? "").trim() || e.id);
    }
  }

  const nameByAdHocId = new Map<string, string>();
  if (adHocIds.size > 0) {
    const ahRows = await db
      .select({ id: adHocEntities.id, name: adHocEntities.name })
      .from(adHocEntities)
      .where(inArray(adHocEntities.id, Array.from(adHocIds)));
    for (const a of ahRows) {
      nameByAdHocId.set(a.id, String(a.name ?? "").trim() || a.id);
    }
  }

  return rows.map((r) => {
    const pk = String(r.assetId ?? "").trim();
    const premisesId = premisesByPk.get(pk) ?? pk;
    const yardName = yardNameById.get(String(r.yardId ?? "").trim()) ?? String(r.yardId ?? "—");

    const tl = String(r.tenantLicenceId ?? "").trim();
    const parsed = parseUnifiedEntityId(tl);
    let occupantName = "—";
    if (parsed?.kind === "TB") {
      occupantName =
        nameByEntityId.get(parsed.refId) ??
        (r.entityId ? nameByEntityId.get(String(r.entityId).trim()) : undefined) ??
        tl;
    } else if (parsed?.kind === "TA") {
      occupantName = firmByTraderId.get(parsed.refId) ?? tl;
    } else if (parsed?.kind === "AH") {
      occupantName = nameByAdHocId.get(parsed.refId) ?? tl;
    } else if (tl.startsWith("TB:")) {
      const ref = tl.slice(3);
      occupantName = nameByEntityId.get(ref) ?? tl;
    } else if (tl) {
      occupantName = firmByTraderId.get(tl) ?? tl;
    }

    return { ...r, yardName, premisesId, occupantName };
  });
}
