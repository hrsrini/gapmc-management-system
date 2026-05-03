import { inArray } from "drizzle-orm";
import { db } from "./db";
import { traderLicences, entities, adHocEntities } from "@shared/db-schema";
import { parseUnifiedEntityId } from "@shared/unified-entity-id";

export type PayerDisplayFields = {
  payerName: string | null;
  payerType: string | null;
  payerRefId: string | null;
  unifiedEntityId?: string | null;
};

export type WithPayerDisplayName = {
  payerDisplayName: string;
  /** When `unifiedEntityId` is set: friendly label (e.g. Track A: firm) or raw id if unresolved. */
  unifiedEntityDisplayName?: string | null;
};

function addUnifiedRefIds(raw: string | null | undefined, traderIds: Set<string>, entityIds: Set<string>, adHocIds: Set<string>) {
  const u = parseUnifiedEntityId(String(raw ?? "").trim());
  if (!u) return;
  if (u.kind === "TA") traderIds.add(u.refId);
  else if (u.kind === "TB") entityIds.add(u.refId);
  else adHocIds.add(u.refId);
}

function looksLikeOpaqueRecordId(s: string): boolean {
  const t = s.trim();
  if (t.length < 10) return false;
  return /^[a-zA-Z0-9_-]+$/.test(t);
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
    const typ = (r.payerType ?? "").trim();
    if (ref) {
      if (typ === "TraderLicence" || typ === "TenantLicence") traderIds.add(ref);
      else if (typ === "Entity") entityIds.add(ref);
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
      .select({ id: traderLicences.id, firmName: traderLicences.firmName })
      .from(traderLicences)
      .where(inArray(traderLicences.id, tid));
    for (const x of licRows) {
      traderMap.set(x.id, (x.firmName?.trim() && x.firmName) || x.id);
    }
  }

  const entityMap = new Map<string, string>();
  const eid = Array.from(entityIds);
  if (eid.length > 0) {
    const entRows = await db
      .select({ id: entities.id, name: entities.name })
      .from(entities)
      .where(inArray(entities.id, eid));
    for (const x of entRows) {
      entityMap.set(x.id, (x.name?.trim() && x.name) || x.id);
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

  function resolveFromUnifiedString(raw: string): string | null {
    const u = parseUnifiedEntityId(raw.trim());
    if (!u) return null;
    if (u.kind === "TA") return traderMap.get(u.refId) ?? null;
    if (u.kind === "TB") return entityMap.get(u.refId) ?? null;
    return adHocMap.get(u.refId) ?? null;
  }

  function resolvePlainId(id: string): string | null {
    return traderMap.get(id) ?? entityMap.get(id) ?? adHocMap.get(id) ?? null;
  }

  return rows.map((r) => {
    const ref = (r.payerRefId ?? "").trim();
    const typ = (r.payerType ?? "").trim();
    const pn = (r.payerName ?? "").trim();
    const ueRaw = String((r as { unifiedEntityId?: string | null }).unifiedEntityId ?? "").trim();

    let fromTypeRef: string | null = null;
    if (ref && (typ === "TraderLicence" || typ === "TenantLicence")) {
      fromTypeRef = traderMap.get(ref) ?? null;
    } else if (ref && typ === "Entity") {
      fromTypeRef = entityMap.get(ref) ?? null;
    } else if (ref && (!typ || typ === "Other")) {
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
    if (pn && ref && pn !== ref && typ) {
      payerDisplayName = pn;
    } else if (fromTypeRef) {
      payerDisplayName = fromTypeRef;
    } else if (fromUnifiedOrPlain) {
      payerDisplayName = fromUnifiedOrPlain;
    } else if (pn) {
      payerDisplayName = pn;
    } else if (ref) {
      payerDisplayName = ref;
    } else {
      payerDisplayName = "—";
    }

    let unifiedEntityDisplayName: string | null = null;
    if (ueRaw) {
      const u = parseUnifiedEntityId(ueRaw);
      const resolved = resolveFromUnifiedString(ueRaw);
      if (u?.kind === "TA" && resolved) unifiedEntityDisplayName = `Track A: ${resolved}`;
      else if (u?.kind === "TB" && resolved) unifiedEntityDisplayName = `Track B: ${resolved}`;
      else if (u?.kind === "AH" && resolved) unifiedEntityDisplayName = `Ad hoc: ${resolved}`;
      else unifiedEntityDisplayName = ueRaw;
    }

    return { ...r, payerDisplayName, ...(ueRaw ? { unifiedEntityDisplayName } : {}) };
  });
}
