import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "./db";
import {
  agreementPremisesLines,
  assetAllotments,
  assets,
  entityAllotments,
} from "@shared/db-schema";
import { isPremisesVacantForAllotment, normalizePremisesStatus } from "@shared/premises-allocation";

const OPEN_TENANCY = ["Active", "Pending"] as const;

export async function assertPremisesNotAlreadyAllocatedActive(params: {
  assetId: string;
  excludeEntityAllotmentId?: string;
  excludeAssetAllotmentId?: string;
}): Promise<{ ok: boolean; entityConflicts: string[]; traderConflicts: string[] }> {
  const assetId = params.assetId;
  const activeEntityAllotments = await db
    .select({ id: entityAllotments.id })
    .from(entityAllotments)
    .where(and(eq(entityAllotments.assetId, assetId), eq(entityAllotments.status, "Active")));
  const activeAssetAllotments = await db
    .select({ id: assetAllotments.id })
    .from(assetAllotments)
    .where(and(eq(assetAllotments.assetId, assetId), eq(assetAllotments.status, "Active")));

  const entityConflicts = activeEntityAllotments
    .map((r) => r.id)
    .filter((id) => !params.excludeEntityAllotmentId || id !== params.excludeEntityAllotmentId);
  const traderConflicts = activeAssetAllotments
    .map((r) => r.id)
    .filter((id) => !params.excludeAssetAllotmentId || id !== params.excludeAssetAllotmentId);

  return {
    ok: entityConflicts.length === 0 && traderConflicts.length === 0,
    entityConflicts,
    traderConflicts,
  };
}

/** Blocks new drafts when premises already has Active/Pending tenancy (legacy or agreement line). */
export async function assertPremisesFreeForDraftAllotment(params: {
  assetId: string;
  excludeEntityAllotmentId?: string;
  excludeAssetAllotmentId?: string;
  excludeAgreementLineId?: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const assetId = params.assetId;
  const openEntity = await db
    .select({ id: entityAllotments.id, status: entityAllotments.status })
    .from(entityAllotments)
    .where(and(eq(entityAllotments.assetId, assetId), inArray(entityAllotments.status, [...OPEN_TENANCY])));
  const openTrader = await db
    .select({ id: assetAllotments.id, status: assetAllotments.status })
    .from(assetAllotments)
    .where(and(eq(assetAllotments.assetId, assetId), inArray(assetAllotments.status, [...OPEN_TENANCY])));
  const openLines = await db
    .select({ id: agreementPremisesLines.id, tenancyStatus: agreementPremisesLines.tenancyStatus })
    .from(agreementPremisesLines)
    .where(
      and(
        eq(agreementPremisesLines.assetId, assetId),
        or(
          eq(agreementPremisesLines.tenancyStatus, "Active"),
          eq(agreementPremisesLines.tenancyStatus, "Pending"),
        ),
      ),
    );

  const entityHit = openEntity.find(
    (r) => !params.excludeEntityAllotmentId || r.id !== params.excludeEntityAllotmentId,
  );
  if (entityHit) {
    return {
      ok: false,
      message: `Premises already has an open entity allotment (${entityHit.status}).`,
    };
  }
  const traderHit = openTrader.find(
    (r) => !params.excludeAssetAllotmentId || r.id !== params.excludeAssetAllotmentId,
  );
  if (traderHit) {
    return {
      ok: false,
      message: `Premises already has an open trader allotment (${traderHit.status}).`,
    };
  }
  const lineHit = openLines.find(
    (r) => !params.excludeAgreementLineId || r.id !== params.excludeAgreementLineId,
  );
  if (lineHit) {
    return {
      ok: false,
      message: `Premises already listed on an open agreement (${lineHit.tenancyStatus}).`,
    };
  }
  return { ok: true };
}

/** Asset IDs in a yard that already have Active/Pending allotment or agreement line. */
export async function assetIdsWithOpenAllotmentInYard(yardId: string): Promise<Set<string>> {
  const yardAssets = await db.select({ id: assets.id }).from(assets).where(eq(assets.yardId, yardId));
  const ids = yardAssets.map((a) => a.id);
  if (ids.length === 0) return new Set();

  const [ent, tr, lines] = await Promise.all([
    db
      .select({ assetId: entityAllotments.assetId })
      .from(entityAllotments)
      .where(and(inArray(entityAllotments.assetId, ids), inArray(entityAllotments.status, [...OPEN_TENANCY]))),
    db
      .select({ assetId: assetAllotments.assetId })
      .from(assetAllotments)
      .where(and(inArray(assetAllotments.assetId, ids), inArray(assetAllotments.status, [...OPEN_TENANCY]))),
    db
      .select({ assetId: agreementPremisesLines.assetId })
      .from(agreementPremisesLines)
      .where(
        and(
          inArray(agreementPremisesLines.assetId, ids),
          or(
            eq(agreementPremisesLines.tenancyStatus, "Active"),
            eq(agreementPremisesLines.tenancyStatus, "Pending"),
          ),
        ),
      ),
  ]);

  return new Set([...ent, ...tr, ...lines].map((r) => r.assetId).filter(Boolean) as string[]);
}

/** True when premises master allows a new allotment (Vacant only). */
export function isPremisesAllocatable(asset: {
  isActive?: boolean | null;
  premisesStatus?: string | null;
}): { ok: true } | { ok: false; code: string; message: string } {
  if (asset.isActive === false) {
    return { ok: false, code: "E-PRE-004", message: "Premises is inactive; allocation is blocked." };
  }
  const ps = normalizePremisesStatus(asset.premisesStatus) ?? "Vacant";
  if (ps === "Demolished") {
    return { ok: false, code: "E-PRE-004", message: "Premises is marked Demolished; allocation is blocked." };
  }
  if (ps === "UnsafeForOccupation") {
    return { ok: false, code: "E-PRE-004", message: "Premises is marked Unsafe for Occupation; allocation is blocked." };
  }
  if (ps === "Vacating") {
    return { ok: false, code: "E-PRE-004", message: "Premises is Vacating; allocation is blocked until possession is handed over." };
  }
  if (ps === "Allocated") {
    return { ok: false, code: "E-PRE-004", message: "Premises is already Allocated; only Vacant premises can receive a new allotment." };
  }
  if (!isPremisesVacantForAllotment(ps)) {
    return { ok: false, code: "E-PRE-004", message: "Only Vacant premises are available for new allotment." };
  }
  return { ok: true };
}

export async function fetchAssetForAllocationGuard(assetId: string) {
  const [row] = await db.select().from(assets).where(eq(assets.id, assetId)).limit(1);
  return row ?? null;
}
