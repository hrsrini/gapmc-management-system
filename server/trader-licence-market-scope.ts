/**
 * Trader licences are treated as organisation-wide (not tied to a single yard for operations).
 * Scoped users may still work with a licence if they have a relationship in their assigned locations:
 * registration yard, prior yard purchases, checkpost inward, or an active premises allocation.
 */
import type { Request } from "express";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  assetAllotments,
  assets,
  checkPostInward,
  purchaseTransactions,
  traderLicences,
} from "@shared/db-schema";
import type * as schema from "@shared/db-schema";

type Db = NodePgDatabase<typeof schema>;
type LicRow = typeof traderLicences.$inferSelect;

export type TraderLicenceScopeResult =
  | { ok: true }
  | { ok: false; status: number; code: string; message: string };

export async function assertTraderLicenceAccessibleInUserScope(db: Db, req: Request, lic: LicRow): Promise<TraderLicenceScopeResult> {
  const scopedIds = (req as Request & { scopedLocationIds?: string[] }).scopedLocationIds;
  if (!scopedIds || scopedIds.length === 0) {
    return { ok: true };
  }
  if (req.user?.roles.some((r) => r.tier === "ADMIN")) {
    return { ok: true };
  }
  if (scopedIds.includes(lic.yardId)) {
    return { ok: true };
  }

  const [pt] = await db
    .select({ id: purchaseTransactions.id })
    .from(purchaseTransactions)
    .where(and(eq(purchaseTransactions.traderLicenceId, lic.id), inArray(purchaseTransactions.yardId, scopedIds)))
    .limit(1);
  if (pt) return { ok: true };

  const [cpi] = await db
    .select({ id: checkPostInward.id })
    .from(checkPostInward)
    .where(
      and(
        eq(checkPostInward.traderLicenceId, lic.id),
        isNotNull(checkPostInward.traderLicenceId),
        inArray(checkPostInward.checkPostId, scopedIds),
      ),
    )
    .limit(1);
  if (cpi) return { ok: true };

  const [aa] = await db
    .select({ id: assetAllotments.id })
    .from(assetAllotments)
    .innerJoin(assets, eq(assetAllotments.assetId, assets.id))
    .where(
      and(
        eq(assetAllotments.traderLicenceId, lic.id),
        eq(assetAllotments.status, "Active"),
        inArray(assets.yardId, scopedIds),
      ),
    )
    .limit(1);
  if (aa) return { ok: true };

  return {
    ok: false,
    status: 404,
    code: "LICENCE_NOT_FOUND",
    message: "Trader licence not found in your location scope.",
  };
}
