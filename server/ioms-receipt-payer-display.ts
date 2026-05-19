import { inArray, or } from "drizzle-orm";
import { db } from "./db";
import { traderLicences, entities, adHocEntities } from "@shared/db-schema";
import { finalizeEntityDisplayName, isTechnicalEntityToken } from "@shared/receipt-entity-display";
import { parseUnifiedEntityId } from "@shared/unified-entity-id";

export { finalizeEntityDisplayName, isTechnicalEntityToken } from "@shared/receipt-entity-display";

export type PayerDisplayFields = {
  payerName: string | null;
  payerType: string | null;
  payerRefId: string | null;
  unifiedEntityId?: string | null;
};

export type WithPayerDisplayName = {
  payerDisplayName: string;
  /** Resolved entity / occupant name (never TA:/TB:/AH: tokens or raw record ids). */
  entityDisplayName: string;
  /** When `unifiedEntityId` is set: friendly label (e.g. Track A: firm) or raw id if unresolved. */
  unifiedEntityDisplayName?: string | null;
};

function normalizePayerType(typ: string): string {
  const t = typ.trim().toLowerCase();
  if (t === "traderlicence" || t === "tenantlicence") return "TraderLicence";
  if (t === "entity") return "Entity";
  return typ.trim();
}

function looksLikeOpaqueRecordId(s: string): boolean {
  const t = s.trim();
  if (t.length < 10) return false;
  return /^[a-zA-Z0-9_-]+$/.test(t);
}

function addUnifiedRefIds(raw: string | null | undefined, traderIds: Set<string>, entityIds: Set<string>, adHocIds: Set<string>) {
  const u = parseUnifiedEntityId(String(raw ?? "").trim());
  if (!u) return;
  if (u.kind === "TA") traderIds.add(u.refId);
  else if (u.kind === "TB") entityIds.add(u.refId);
  else adHocIds.add(u.refId);
}

/**
 * Resolves human-readable payer labels for IOMS receipts (M-05) using payerType + payerRefId,
 * unifiedEntityId (TA:/TB:/AH:), and plain ids in payer_name when type/ref are missing.
 */
export async function attachPayerDisplayNames<T extends PayerDisplayFields>(
  rows: T[],
): Promise<Array<T & WithPayerDisplayName>> {
  if (rows.length === 0) return [];

  const traderIds = new Set<string>();
  const entityIds = new Set<string>();
  const adHocIds = new Set<string>();
  const ambiguousPlainIds = new Set<string>();

  for (const r of rows) {
    const ref = (r.payerRefId ?? "").trim();
    const typ = normalizePayerType(String(r.payerType ?? ""));
    if (ref) {
      if (typ === "TraderLicence" || typ === "TenantLicence") traderIds.add(ref);
      else if (typ === "Entity") entityIds.add(ref);
      else {
        traderIds.add(ref);
        entityIds.add(ref);
      }
    }
    const ue = (r as { unifiedEntityId?: string | null }).unifiedEntityId;
    addUnifiedRefIds(ue, traderIds, entityIds, adHocIds);
    addUnifiedRefIds(r.payerName, traderIds, entityIds, adHocIds);

    const pn = (r.payerName ?? "").trim();
    if (!typ && !ref && looksLikeOpaqueRecordId(pn) && !parseUnifiedEntityId(pn)) {
      ambiguousPlainIds.add(pn);
    }
  }

  for (const id of Array.from(ambiguousPlainIds)) {
    traderIds.add(id);
    entityIds.add(id);
    adHocIds.add(id);
  }

  const traderMap = new Map<string, string>();
  const tid = Array.from(traderIds);
  if (tid.length > 0) {
    const licRows = await db
      .select({ id: traderLicences.id, firmName: traderLicences.firmName, licenceNo: traderLicences.licenceNo })
      .from(traderLicences)
      .where(or(inArray(traderLicences.id, tid), inArray(traderLicences.licenceNo, tid)));
    for (const x of licRows) {
      const label =
        (x.firmName?.trim() && x.firmName) || (x.licenceNo?.trim() && x.licenceNo) || x.id;
      traderMap.set(x.id, label);
      if (x.licenceNo?.trim()) traderMap.set(x.licenceNo.trim(), label);
    }
  }

  const entityMap = new Map<string, string>();
  const entityCodeMap = new Map<string, string>();
  const eid = Array.from(entityIds);
  if (eid.length > 0) {
    const entRows = await db
      .select({ id: entities.id, entityCode: entities.entityCode, name: entities.name })
      .from(entities)
      .where(or(inArray(entities.id, eid), inArray(entities.entityCode, eid)));
    for (const x of entRows) {
      const label = (x.name?.trim() && x.name) || x.id;
      entityMap.set(x.id, label);
      const code = x.entityCode != null ? String(x.entityCode).trim() : "";
      if (code) entityCodeMap.set(code, label);
    }
  }

  const adHocMap = new Map<string, string>();
  const aid = Array.from(adHocIds);
  if (aid.length > 0) {
    const ahRows = await db
      .select({ id: adHocEntities.id, name: adHocEntities.name })
      .from(adHocEntities)
      .where(inArray(adHocEntities.id, aid));
    for (const x of ahRows) {
      adHocMap.set(x.id, (x.name?.trim() && x.name) || x.id);
    }
  }

  function resolveTraderRef(refId: string): string | null {
    return traderMap.get(refId) ?? null;
  }

  function resolveEntityRef(refId: string): string | null {
    return entityMap.get(refId) ?? entityCodeMap.get(refId) ?? null;
  }

  function resolveFromUnifiedString(raw: string): string | null {
    const u = parseUnifiedEntityId(raw.trim());
    if (!u) return null;
    if (u.kind === "TA") return resolveTraderRef(u.refId);
    if (u.kind === "TB") return resolveEntityRef(u.refId);
    return adHocMap.get(u.refId) ?? null;
  }

  function resolvePlainId(id: string): string | null {
    return resolveTraderRef(id) ?? resolveEntityRef(id) ?? adHocMap.get(id) ?? null;
  }

  return rows.map((r) => {
    const ref = (r.payerRefId ?? "").trim();
    const typ = normalizePayerType(String(r.payerType ?? ""));
    const pn = (r.payerName ?? "").trim();
    const ueRaw = String((r as { unifiedEntityId?: string | null }).unifiedEntityId ?? "").trim();

    let fromTypeRef: string | null = null;
    if (ref && (typ === "TraderLicence" || typ === "TenantLicence")) {
      fromTypeRef = resolveTraderRef(ref);
    } else if (ref && typ === "Entity") {
      fromTypeRef = resolveEntityRef(ref);
    } else if (ref) {
      fromTypeRef = resolvePlainId(ref);
    }

    let fromUnifiedOrPlain: string | null = null;
    if (ueRaw) {
      fromUnifiedOrPlain = resolveFromUnifiedString(ueRaw);
    }
    if (!fromUnifiedOrPlain && pn) {
      fromUnifiedOrPlain = resolveFromUnifiedString(pn) ?? resolvePlainId(pn);
    }

    let payerDisplayName: string;
    if (pn && ref && pn !== ref && typ && !isTechnicalEntityToken(pn)) {
      payerDisplayName = pn;
    } else if (fromTypeRef) {
      payerDisplayName = fromTypeRef;
    } else if (fromUnifiedOrPlain) {
      payerDisplayName = fromUnifiedOrPlain;
    } else if (pn && !isTechnicalEntityToken(pn)) {
      payerDisplayName = pn;
    } else if (ref && !isTechnicalEntityToken(ref)) {
      payerDisplayName = ref;
    } else {
      payerDisplayName = "—";
    }

    let entityResolved: string | null = null;
    if (ueRaw) entityResolved = resolveFromUnifiedString(ueRaw);
    if (!entityResolved && ref) {
      if (typ === "TraderLicence" || typ === "TenantLicence") entityResolved = resolveTraderRef(ref);
      else if (typ === "Entity") entityResolved = resolveEntityRef(ref);
      else entityResolved = resolvePlainId(ref);
    }
    if (!entityResolved) entityResolved = fromUnifiedOrPlain ?? fromTypeRef;

    let unifiedEntityDisplayName: string | null = null;
    if (ueRaw) {
      const u = parseUnifiedEntityId(ueRaw);
      const resolved = entityResolved;
      if (u?.kind === "TA" && resolved) unifiedEntityDisplayName = `Track A: ${resolved}`;
      else if (u?.kind === "TB" && resolved) unifiedEntityDisplayName = `Track B: ${resolved}`;
      else if (u?.kind === "AH" && resolved) unifiedEntityDisplayName = `Ad hoc: ${resolved}`;
      else if (resolved) unifiedEntityDisplayName = resolved;
    }

    const entityDisplayName = finalizeEntityDisplayName([
      entityResolved,
      unifiedEntityDisplayName,
      payerDisplayName,
      pn,
    ]);

    return {
      ...r,
      payerDisplayName,
      entityDisplayName,
      ...(ueRaw ? { unifiedEntityDisplayName } : {}),
    };
  });
}
