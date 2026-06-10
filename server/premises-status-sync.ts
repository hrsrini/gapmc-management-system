import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { assetAllotments, assets, entityAllotments } from "@shared/db-schema";
import type { PremisesStatus } from "@shared/premises-allocation";

async function hasActiveTenancy(assetId: string): Promise<boolean> {
  const [ent] = await db
    .select({ id: entityAllotments.id })
    .from(entityAllotments)
    .where(and(eq(entityAllotments.assetId, assetId), eq(entityAllotments.status, "Active")))
    .limit(1);
  if (ent) return true;
  const [tr] = await db
    .select({ id: assetAllotments.id })
    .from(assetAllotments)
    .where(and(eq(assetAllotments.assetId, assetId), eq(assetAllotments.status, "Active")))
    .limit(1);
  return Boolean(tr);
}

async function hasVacatingTenancy(assetId: string): Promise<boolean> {
  const [ent] = await db
    .select({ id: entityAllotments.id })
    .from(entityAllotments)
    .where(and(eq(entityAllotments.assetId, assetId), eq(entityAllotments.status, "Vacating")))
    .limit(1);
  if (ent) return true;
  const [tr] = await db
    .select({ id: assetAllotments.id })
    .from(assetAllotments)
    .where(and(eq(assetAllotments.assetId, assetId), eq(assetAllotments.status, "Vacating")))
    .limit(1);
  return Boolean(tr);
}

/** Recompute premises_status from tenancy rows (skips Unsafe / Demolished). */
export async function syncPremisesStatusFromTenancy(assetId: string): Promise<void> {
  const [asset] = await db.select().from(assets).where(eq(assets.id, assetId)).limit(1);
  if (!asset) return;
  const ps = String(asset.premisesStatus ?? "").trim();
  if (ps === "UnsafeForOccupation" || ps === "Demolished") return;

  let next: PremisesStatus = "Vacant";
  if (await hasActiveTenancy(assetId)) next = "Allocated";
  else if (await hasVacatingTenancy(assetId)) next = "Vacating";

  if (next !== ps) {
    await db.update(assets).set({ premisesStatus: next }).where(eq(assets.id, assetId));
  }
}

export async function setPremisesMasterStatus(assetId: string, status: PremisesStatus): Promise<void> {
  await db.update(assets).set({ premisesStatus: status }).where(eq(assets.id, assetId));
}
