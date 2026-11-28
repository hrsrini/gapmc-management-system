import { eq, inArray, or } from "drizzle-orm";
import {
  adHocEntities,
  entities,
  purchaseTransactions,
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
  payerPartyType?: string | null;
  sourceModule?: string | null;
  sourceRecordId?: string | null;
};

/** Statutory PDF: licence line only for Track A (linked trader licence). */
export function isReceiptTrackAForPdf(receipt: ReceiptLicenceFields): boolean {
  const partyTyp = String(receipt.payerPartyType ?? "").trim();
  if (partyTyp === "NewParty") return false;

  const ue = parseUnifiedEntityId(String(receipt.unifiedEntityId ?? "").trim());
  if (ue?.kind === "TB" || ue?.kind === "AH") return false;
  if (ue?.kind === "TA") return true;

  const typ = String(receipt.payerType ?? "").trim().toLowerCase();
  if (typ === "trackbentity" || typ === "entity") return false;
  if (typ === "manualparty") return false;
  if (typ === "traderlicence" || typ === "tenantlicence") {
    return Boolean((receipt.payerRefId ?? "").trim());
  }

  return false;
}

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
      lmLicenseClass: string | null;
      linkedOldLicenceId: string | null;
      supersededByLicenceId: string | null;
    }
  >;
  entityCodeById: Map<string, string | null>;
  adHocCodeById: Map<string, string | null>;
};

/** Label + value for receipt face (same line as payer name). Null = omit entirely. */
export type ReceiptPartyIdLine = {
  kind: "licence" | "entity";
  /** e.g. `Licence No: 9314/A` or `Entity No: ENT-2026-00001` */
  label: string;
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
      lmLicenseClass: string | null;
      linkedOldLicenceId: string | null;
      supersededByLicenceId: string | null;
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
        lmLicenseClass: traderLicences.lmLicenseClass,
        linkedOldLicenceId: traderLicences.linkedOldLicenceId,
        supersededByLicenceId: traderLicences.supersededByLicenceId,
      })
      .from(traderLicences)
      .where(inArray(traderLicences.id, traderIds));
    for (const row of rows) {
      traderById.set(row.id, {
        licenceNo: row.licenceNo,
        entityPublicCode: row.entityPublicCode,
        provisionalLicenceNo: row.provisionalLicenceNo,
        lmLicenseClass: row.lmLicenseClass,
        linkedOldLicenceId: row.linkedOldLicenceId,
        supersededByLicenceId: row.supersededByLicenceId,
      });
    }
    // Ensure linked old/new rows are available for bracket labels on receipt face.
    const linkedIds = new Set<string>();
    for (const row of rows) {
      if (row.linkedOldLicenceId) linkedIds.add(row.linkedOldLicenceId);
      if (row.supersededByLicenceId) linkedIds.add(row.supersededByLicenceId);
    }
    const missingLinked = Array.from(linkedIds).filter((id) => !traderById.has(id));
    if (missingLinked.length > 0) {
      const linkedRows = await db
        .select({
          id: traderLicences.id,
          licenceNo: traderLicences.licenceNo,
          entityPublicCode: traderLicences.entityPublicCode,
          provisionalLicenceNo: traderLicences.provisionalLicenceNo,
          lmLicenseClass: traderLicences.lmLicenseClass,
          linkedOldLicenceId: traderLicences.linkedOldLicenceId,
          supersededByLicenceId: traderLicences.supersededByLicenceId,
        })
        .from(traderLicences)
        .where(inArray(traderLicences.id, missingLinked));
      for (const row of linkedRows) {
        traderById.set(row.id, {
          licenceNo: row.licenceNo,
          entityPublicCode: row.entityPublicCode,
          provisionalLicenceNo: row.provisionalLicenceNo,
          lmLicenseClass: row.lmLicenseClass,
          linkedOldLicenceId: row.linkedOldLicenceId,
          supersededByLicenceId: row.supersededByLicenceId,
        });
      }
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

type TraderLicenceDisplayRow = {
  licenceNo: string | null;
  entityPublicCode: string | null;
  provisionalLicenceNo: string | null;
  lmLicenseClass: string | null;
  linkedOldLicenceId: string | null;
  supersededByLicenceId: string | null;
};

function normalizeLicenceClass(raw: string | null | undefined): string {
  const c = String(raw ?? "").trim().toUpperCase();
  if (!c) return "";
  const letter = c.replace(/^CLASS\s*/i, "").replace(/^\//, "").charAt(0);
  return letter === "A" || letter === "B" || letter === "C" ? letter : "";
}

function formatLicenceNoWithClass(
  licenceNo: string | null | undefined,
  lmLicenseClass: string | null | undefined,
): string {
  const lic = String(licenceNo ?? "").trim();
  if (!lic) return "";
  const cls = normalizeLicenceClass(lmLicenseClass);
  return cls && !lic.includes("/") ? `${lic}/${cls}` : lic;
}

/**
 * When paying under a new licence for old-origin dues (or vice versa), show
 * `10282 (9871/A)` on the receipt face.
 */
function resolveBracketedLicenceDisplay(
  refs: ReceiptLicenceLookupRefs,
  maps: LicenceDisplayMaps,
): string | null {
  const traderIds = Array.from(refs.traderIds);
  if (traderIds.length === 0) return null;

  let primaryId: string | null = null;
  let primaryRow: TraderLicenceDisplayRow | null = null;
  for (const id of traderIds) {
    const row = maps.traderById.get(id);
    if (!row) continue;
    // Prefer the operational (new) licence when both are present.
    if (row.linkedOldLicenceId) {
      primaryId = id;
      primaryRow = row;
      break;
    }
    if (!primaryRow) {
      primaryId = id;
      primaryRow = row;
    }
  }
  if (!primaryRow || !primaryId) return null;

  const primaryNo = formatLicenceNoWithClass(primaryRow.licenceNo, primaryRow.lmLicenseClass);
  if (!primaryNo) return null;

  let originNo: string | null = null;
  if (primaryRow.linkedOldLicenceId) {
    const old = maps.traderById.get(primaryRow.linkedOldLicenceId);
    const oldNo = formatLicenceNoWithClass(old?.licenceNo, old?.lmLicenseClass);
    // Bracket when invoice/origin trader id is the linked old, or old is also in refs.
    if (oldNo && (refs.traderIds.has(primaryRow.linkedOldLicenceId) || traderIds.some((id) => id !== primaryId))) {
      originNo = oldNo;
    }
  }
  if (!originNo && primaryRow.supersededByLicenceId) {
    // Paying under old id while new exists — still prefer new (bracket old).
    const neu = maps.traderById.get(primaryRow.supersededByLicenceId);
    const newNo = formatLicenceNoWithClass(neu?.licenceNo, neu?.lmLicenseClass);
    if (newNo) {
      return `${newNo} (${primaryNo})`;
    }
  }

  if (originNo && originNo !== primaryNo) {
    return `${primaryNo} (${originNo})`;
  }
  return primaryNo;
}

export function resolveLicenceDisplayFromRefs(
  refs: ReceiptLicenceLookupRefs,
  maps: LicenceDisplayMaps,
): string | null {
  const bracketed = resolveBracketedLicenceDisplay(refs, maps);
  if (bracketed) return bracketed;

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

/** Resolve Licence No. (with /A|/B|/C) or Entity No. for receipt face — omit when absent. */
export function resolvePartyIdLineFromRefs(
  refs: ReceiptLicenceLookupRefs,
  maps: LicenceDisplayMaps,
): ReceiptPartyIdLine | null {
  const bracketed = resolveBracketedLicenceDisplay(refs, maps);
  if (bracketed) {
    return { kind: "licence", label: `Licence No: ${bracketed}` };
  }
  for (const id of refs.traderIds) {
    const row = maps.traderById.get(id);
    if (!row) continue;
    const lic = String(row.licenceNo ?? "").trim();
    if (lic) {
      const no = formatLicenceNoWithClass(row.licenceNo, row.lmLicenseClass);
      return { kind: "licence", label: `Licence No: ${no}` };
    }
    const entityCode = String(row.entityPublicCode ?? row.provisionalLicenceNo ?? "").trim();
    if (entityCode) {
      return { kind: "entity", label: `Entity No: ${entityCode}` };
    }
  }

  for (const id of refs.entityIds) {
    const code = maps.entityCodeById.get(id);
    const display = formatLicenceOrEntityIdDisplay("TrackB", { publicEntityCode: code });
    if (display === "—") continue;
    return { kind: "entity", label: `Entity No: ${display}` };
  }

  for (const id of refs.adHocIds) {
    const code = maps.adHocCodeById.get(id);
    const display = formatLicenceOrEntityIdDisplay("AdHoc", { publicEntityCode: code });
    if (display === "—") continue;
    return { kind: "entity", label: `Entity No: ${display}` };
  }

  return null;
}

async function loadRefsAndMapsForReceipt(receipt: ReceiptLicenceFields) {
  const refs = collectReceiptLicenceLookupRefs(receipt);
  const sourceModule = String(receipt.sourceModule ?? "").trim();
  if (sourceModule === "M-03" && receipt.sourceRecordId) {
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
  // M-04: include origin purchase trader licence so old→new bracket labels work when payer was remapped.
  if (sourceModule === "M-04" && receipt.sourceRecordId) {
    const [pt] = await db
      .select({ traderLicenceId: purchaseTransactions.traderLicenceId })
      .from(purchaseTransactions)
      .where(eq(purchaseTransactions.id, receipt.sourceRecordId))
      .limit(1);
    const tid = String(pt?.traderLicenceId ?? "").trim();
    if (tid) refs.traderIds.add(tid);
  }
  const maps = await loadLicenceDisplayMaps(refs);
  return { refs, maps };
}

export async function resolveReceiptLicenceNo(receipt: ReceiptLicenceFields): Promise<string | null> {
  const { refs, maps } = await loadRefsAndMapsForReceipt(receipt);
  return resolveLicenceDisplayFromRefs(refs, maps);
}

export async function resolveReceiptPartyIdLine(
  receipt: ReceiptLicenceFields,
): Promise<ReceiptPartyIdLine | null> {
  if (String(receipt.payerPartyType ?? "").trim() === "NewParty") return null;
  const { refs, maps } = await loadRefsAndMapsForReceipt(receipt);
  return resolvePartyIdLineFromRefs(refs, maps);
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
  const m04Ids = Array.from(
    new Set(
      rows
        .filter((r) => String(r.sourceModule ?? "").trim() === "M-04" && (r.sourceRecordId ?? "").trim())
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
  const purchaseTraderById = new Map<string, string>();
  if (m04Ids.length > 0) {
    const ptRows = await db
      .select({
        id: purchaseTransactions.id,
        traderLicenceId: purchaseTransactions.traderLicenceId,
      })
      .from(purchaseTransactions)
      .where(inArray(purchaseTransactions.id, m04Ids));
    for (const pt of ptRows) {
      const tid = String(pt.traderLicenceId ?? "").trim();
      if (tid) purchaseTraderById.set(pt.id, tid);
    }
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const mod = String(row.sourceModule ?? "").trim();
    if (mod === "M-03" && row.sourceRecordId) {
      const inv = invoiceById.get(String(row.sourceRecordId).trim());
      if (inv) addInvoiceTenantLicenceRefs(inv.tenantLicenceId, inv.entityId, refsByIndex[i]);
    }
    if (mod === "M-04" && row.sourceRecordId) {
      const tid = purchaseTraderById.get(String(row.sourceRecordId).trim());
      if (tid) refsByIndex[i].traderIds.add(tid);
    }
    mergeReceiptLicenceLookupRefs(merged, refsByIndex[i]);
  }

  const maps = await loadLicenceDisplayMaps(merged);
  return rows.map((row, i) => ({
    ...row,
    licenceNo: resolveLicenceDisplayFromRefs(refsByIndex[i], maps),
  }));
}
