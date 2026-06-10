import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { assetAllotments, assets, entityAllotments } from "@shared/db-schema";
import { isPremisesVacantForAllotment, normalizePremisesStatus } from "@shared/premises-allocation";
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
