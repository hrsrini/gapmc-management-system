import { eq, inArray } from "drizzle-orm";
import { db } from "./db";
import { entities, traderLicences, adHocEntities, rentInvoices } from "@shared/db-schema";
import type { InferSelectModel } from "drizzle-orm";
import { parseUnifiedEntityId, unifiedEntityIdFromTrackA, unifiedEntityIdFromTrackB } from "@shared/unified-entity-id";

export type InvoicePayerResolved = {
  payerName: string;
  payerType: string;
  payerRefId: string;
  unifiedEntityId: string;
  payerGstin: string | null;
};

/** Counterparty naming for receipts / dues from `rent_invoices` (Track A licence id vs Track B unified id). */
export async function resolveRentInvoiceCounterparty(inv: InferSelectModel<typeof rentInvoices>): Promise<InvoicePayerResolved> {
  const ue = parseUnifiedEntityId(inv.tenantLicenceId);
  if (ue?.kind === "TB") {
    const eid = String(inv.entityId ?? ue.refId).trim();
    const [ent] = await db.select().from(entities).where(eq(entities.id, eid)).limit(1);
    const gstin = ent?.gstin != null ? String(ent.gstin).trim() : "";
    return {
      payerName: ent?.name?.trim() ?? inv.tenantLicenceId,
      payerType: "TrackBEntity",
      payerRefId: eid,
      unifiedEntityId: unifiedEntityIdFromTrackB(eid),
      payerGstin: gstin || null,
    };
  }
  if (ue?.kind === "AH") {
    const [ah] = await db.select().from(adHocEntities).where(eq(adHocEntities.id, ue.refId)).limit(1);
    return {
      payerName: ah?.name?.trim() ?? inv.tenantLicenceId,
      payerType: "AdHocEntity",
      payerRefId: ue.refId,
      unifiedEntityId: inv.tenantLicenceId,
      payerGstin: ah?.gstin != null ? String(ah.gstin).trim() || null : null,
    };
  }
  const traderId = ue?.kind === "TA" ? ue.refId : inv.tenantLicenceId.trim();
  const [lic] = await db
    .select({ firmName: traderLicences.firmName, gstin: traderLicences.gstin })
    .from(traderLicences)
    .where(eq(traderLicences.id, traderId))
    .limit(1);
  const gstin = lic?.gstin != null ? String(lic.gstin).trim() : "";
  return {
    payerName: (lic?.firmName?.trim() && lic.firmName) || traderId,
    payerType: "TenantLicence",
    payerRefId: traderId,
    unifiedEntityId: unifiedEntityIdFromTrackA(traderId),
    payerGstin: gstin || null,
  };
}

/**
 * Batch-resolve display names for rent invoice list (avoids N+1).
 * Keyed by invoice id → trader / entity name.
 */
export async function resolveRentInvoiceTenantNames(
  invs: Array<Pick<InferSelectModel<typeof rentInvoices>, "id" | "tenantLicenceId" | "entityId">>,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (invs.length === 0) return out;

  const licenceIds = new Set<string>();
  const entityIds = new Set<string>();
  const adHocIds = new Set<string>();

  for (const inv of invs) {
    const tid = String(inv.tenantLicenceId ?? "").trim();
    const ue = parseUnifiedEntityId(tid);
    if (ue?.kind === "TB") {
      const eid = String(inv.entityId ?? ue.refId).trim();
      if (eid) entityIds.add(eid);
    } else if (ue?.kind === "AH") {
      if (ue.refId) adHocIds.add(ue.refId);
    } else {
      const traderId = ue?.kind === "TA" ? ue.refId : tid;
      if (traderId) licenceIds.add(traderId);
    }
    if (inv.entityId) entityIds.add(String(inv.entityId).trim());
  }

  const [licRows, entRows, ahRows] = await Promise.all([
    licenceIds.size
      ? db
          .select({ id: traderLicences.id, firmName: traderLicences.firmName })
          .from(traderLicences)
          .where(inArray(traderLicences.id, Array.from(licenceIds)))
      : Promise.resolve([] as Array<{ id: string; firmName: string }>),
    entityIds.size
      ? db
          .select({ id: entities.id, name: entities.name })
          .from(entities)
          .where(inArray(entities.id, Array.from(entityIds)))
      : Promise.resolve([] as Array<{ id: string; name: string }>),
    adHocIds.size
      ? db
          .select({ id: adHocEntities.id, name: adHocEntities.name })
          .from(adHocEntities)
          .where(inArray(adHocEntities.id, Array.from(adHocIds)))
      : Promise.resolve([] as Array<{ id: string; name: string }>),
  ]);

  const licName = new Map(licRows.map((r) => [r.id, String(r.firmName ?? "").trim()]));
  const entName = new Map(entRows.map((r) => [r.id, String(r.name ?? "").trim()]));
  const ahName = new Map(ahRows.map((r) => [r.id, String(r.name ?? "").trim()]));

  for (const inv of invs) {
    const tid = String(inv.tenantLicenceId ?? "").trim();
    const ue = parseUnifiedEntityId(tid);
    let name = "";
    if (ue?.kind === "TB") {
      const eid = String(inv.entityId ?? ue.refId).trim();
      name = entName.get(eid) ?? "";
    } else if (ue?.kind === "AH") {
      name = ahName.get(ue.refId) ?? "";
    } else {
      const traderId = ue?.kind === "TA" ? ue.refId : tid;
      name = licName.get(traderId) ?? "";
    }
    if (!name && inv.entityId) name = entName.get(String(inv.entityId).trim()) ?? "";
    out[inv.id] = name || tid || "—";
  }
  return out;
}
