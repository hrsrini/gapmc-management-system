import { eq, inArray, or } from "drizzle-orm";
import {
  adHocEntities,
  entities,
  rentInvoices,
  traderLicences,
} from "@shared/db-schema";
import { formatLicenceOrEntityIdDisplay } from "@shared/unified-entity-display";
import { parseUnifiedEntityId } from "@shared/unified-entity-id";
import { db } from "./db";

export type ReceiptLicenceFields = {
  payerRefId?: string | null;
  payerType?: string | null;
  unifiedEntityId?: string | null;
  sourceModule?: string | null;
  sourceRecordId?: string | null;
};

export type ReceiptLicenceLookupRefs = {
  traderIds: Set<string>;
  entityIds: Set<string>;
  adHocIds: Set<string>;
};

export type LicenceDisplayMaps = {
  traderById: Map<
    string,
    {
      licenceNo: string | null;
      entityPublicCode: string | null;
      provisionalLicenceNo: string | null;
    }
  >;
  entityCodeById: Map<string, string | null>;
  adHocCodeById: Map<string, string | null>;
};

function emptyRefs(): ReceiptLicenceLookupRefs {
  return { traderIds: new Set(), entityIds: new Set(), adHocIds: new Set() };
}

export function collectReceiptLicenceLookupRefs(receipt: ReceiptLicenceFields): ReceiptLicenceLookupRefs {
  const refs = emptyRefs();

  const addTrader = (id: string) => {
    const t = id.trim();
    if (t) refs.traderIds.add(t);
  };
  const addEntity = (id: string) => {
    const t = id.trim();
    if (t) refs.entityIds.add(t);
  };
  const addAdHoc = (id: string) => {
    const t = id.trim();
    if (t) refs.adHocIds.add(t);
  };
  const addUnified = (raw: string) => {
    const ue = parseUnifiedEntityId(raw.trim());
    if (!ue) return;
    if (ue.kind === "TA") addTrader(ue.refId);
    else if (ue.kind === "TB") addEntity(ue.refId);
    else addAdHoc(ue.refId);
  };

  const ref = (receipt.payerRefId ?? "").trim();
  const typ = String(receipt.payerType ?? "").trim().toLowerCase();
  if (ref) {
    if (typ === "traderlicence" || typ === "tenantlicence") addTrader(ref);
    else if (typ === "trackbentity" || typ === "entity") addEntity(ref);
    else if (typ === "adhocentity" || typ === "adhoc") addAdHoc(ref);
    else {
      addTrader(ref);
      addEntity(ref);
    }
  }

  addUnified(String(receipt.unifiedEntityId ?? ""));
  return refs;
}

export function mergeReceiptLicenceLookupRefs(
  target: ReceiptLicenceLookupRefs,
  source: ReceiptLicenceLookupRefs,
): void {
  for (const id of source.traderIds) target.traderIds.add(id);
  for (const id of source.entityIds) target.entityIds.add(id);
  for (const id of source.adHocIds) target.adHocIds.add(id);
}

export function addInvoiceTenantLicenceRefs(
  tenantLicenceId: string | null | undefined,
  entityId: string | null | undefined,
  refs: ReceiptLicenceLookupRefs,
): void {
  const tid = String(tenantLicenceId ?? "").trim();
  if (tid) {
    const invUe = parseUnifiedEntityId(tid);
    if (invUe?.kind === "TA") refs.traderIds.add(invUe.refId);
    else if (invUe?.kind === "TB") refs.entityIds.add(invUe.refId);
    else if (invUe?.kind === "AH") refs.adHocIds.add(invUe.refId);
    else if (!/^(TA|TB|AH):/i.test(tid)) refs.traderIds.add(tid);
  }
  const eid = String(entityId ?? "").trim();
  if (eid) refs.entityIds.add(eid);
}

export async function loadLicenceDisplayMaps(refs: ReceiptLicenceLookupRefs): Promise<LicenceDisplayMaps> {
  const traderById = new Map<
    string,
    {
      licenceNo: string | null;
      entityPublicCode: string | null;
      provisionalLicenceNo: string | null;
    }
  >();
  const entityCodeById = new Map<string, string | null>();
  const adHocCodeById = new Map<string, string | null>();

  const traderIds = Array.from(refs.traderIds);
  if (traderIds.length > 0) {
    const rows = await db
      .select({
        id: traderLicences.id,
        licenceNo: traderLicences.licenceNo,
        entityPublicCode: traderLicences.entityPublicCode,
        provisionalLicenceNo: traderLicences.provisionalLicenceNo,
      })
      .from(traderLicences)
      .where(inArray(traderLicences.id, traderIds));
    for (const row of rows) {
      traderById.set(row.id, {
        licenceNo: row.licenceNo,
        entityPublicCode: row.entityPublicCode,
        provisionalLicenceNo: row.provisionalLicenceNo,
      });
    }
  }

  const entityIds = Array.from(refs.entityIds);
  if (entityIds.length > 0) {
    const rows = await db
      .select({ id: entities.id, entityCode: entities.entityCode })
      .from(entities)
      .where(or(inArray(entities.id, entityIds), inArray(entities.entityCode, entityIds)));
    for (const row of rows) {
      const code = row.entityCode != null ? String(row.entityCode).trim() : "";
      entityCodeById.set(row.id, code || null);
      if (code) entityCodeById.set(code, code);
    }
  }

  const adHocIds = Array.from(refs.adHocIds);
  if (adHocIds.length > 0) {
    const rows = await db
      .select({ id: adHocEntities.id, entityCode: adHocEntities.entityCode })
      .from(adHocEntities)
      .where(or(inArray(adHocEntities.id, adHocIds), inArray(adHocEntities.entityCode, adHocIds)));
    for (const row of rows) {
      const code = row.entityCode != null ? String(row.entityCode).trim() : "";
      adHocCodeById.set(row.id, code || null);
      if (code) adHocCodeById.set(code, code);
    }
  }

  return { traderById, entityCodeById, adHocCodeById };
}

export function resolveLicenceDisplayFromRefs(
  refs: ReceiptLicenceLookupRefs,
  maps: LicenceDisplayMaps,
): string | null {
  for (const id of refs.traderIds) {
    const row = maps.traderById.get(id);
    if (!row) continue;
    const display = formatLicenceOrEntityIdDisplay("TrackA", {
      licenceNo: row.licenceNo,
      publicEntityCode: row.entityPublicCode ?? row.provisionalLicenceNo,
    });
    if (display !== "—") return display;
  }

  for (const id of refs.entityIds) {
    const code = maps.entityCodeById.get(id);
    const display = formatLicenceOrEntityIdDisplay("TrackB", { publicEntityCode: code });
    if (display !== "—") return display;
  }

  for (const id of refs.adHocIds) {
    const code = maps.adHocCodeById.get(id);
    const display = formatLicenceOrEntityIdDisplay("AdHoc", { publicEntityCode: code });
    if (display !== "—") return display;
  }

  return null;
}

export async function resolveReceiptLicenceNo(receipt: ReceiptLicenceFields): Promise<string | null> {
  const refs = collectReceiptLicenceLookupRefs(receipt);
  if (String(receipt.sourceModule ?? "").trim() === "M-03" && receipt.sourceRecordId) {
    const [inv] = await db
      .select({
        tenantLicenceId: rentInvoices.tenantLicenceId,
        entityId: rentInvoices.entityId,
      })
      .from(rentInvoices)
      .where(eq(rentInvoices.id, receipt.sourceRecordId))
      .limit(1);
    if (inv) addInvoiceTenantLicenceRefs(inv.tenantLicenceId, inv.entityId, refs);
  }
  const maps = await loadLicenceDisplayMaps(refs);
  return resolveLicenceDisplayFromRefs(refs, maps);
}

export async function attachReceiptLicenceNos<T extends ReceiptLicenceFields>(
  rows: T[],
): Promise<Array<T & { licenceNo: string | null }>> {
  if (rows.length === 0) return [];

  const refsByIndex: ReceiptLicenceLookupRefs[] = rows.map((row) => collectReceiptLicenceLookupRefs(row));
  const merged = emptyRefs();

  const m03Ids = Array.from(
    new Set(
      rows
        .filter((r) => String(r.sourceModule ?? "").trim() === "M-03" && (r.sourceRecordId ?? "").trim())
        .map((r) => String(r.sourceRecordId).trim()),
    ),
  );
  const invoiceById = new Map<string, { tenantLicenceId: string; entityId: string | null }>();
  if (m03Ids.length > 0) {
    const invRows = await db
      .select({
        id: rentInvoices.id,
        tenantLicenceId: rentInvoices.tenantLicenceId,
        entityId: rentInvoices.entityId,
      })
      .from(rentInvoices)
      .where(inArray(rentInvoices.id, m03Ids));
    for (const inv of invRows) {
      invoiceById.set(inv.id, {
        tenantLicenceId: inv.tenantLicenceId,
        entityId: inv.entityId,
      });
    }
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (String(row.sourceModule ?? "").trim() === "M-03" && row.sourceRecordId) {
      const inv = invoiceById.get(String(row.sourceRecordId).trim());
      if (inv) addInvoiceTenantLicenceRefs(inv.tenantLicenceId, inv.entityId, refsByIndex[i]);
    }
    mergeReceiptLicenceLookupRefs(merged, refsByIndex[i]);
  }

  const maps = await loadLicenceDisplayMaps(merged);
  return rows.map((row, i) => ({
    ...row,
    licenceNo: resolveLicenceDisplayFromRefs(refsByIndex[i], maps),
  }));
}
