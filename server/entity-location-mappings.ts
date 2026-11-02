/**
 * Track B Entity ↔ location (yard) mapping helpers.
 */
import { and, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { Request } from "express";
import { db } from "./db";
import { entities, entityLocationMappings, yards } from "@shared/db-schema";

export type MappedYardDto = {
  id: string;
  mappingId: string;
  yardId: string;
  yardCode: string | null;
  yardName: string | null;
  status: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  unmappedAt: string | null;
  unmappedReason: string | null;
};

export function yardInScope(req: Request, yardId: string): boolean {
  const scopedIds = (req as Request & { scopedLocationIds?: string[] }).scopedLocationIds;
  return !scopedIds || scopedIds.length === 0 || scopedIds.includes(yardId);
}

export function allYardsInScope(req: Request, yardIds: string[]): boolean {
  return yardIds.every((y) => yardInScope(req, y));
}

/** Entity is visible if home yard OR any Active mapping is in scope. */
export async function entityAccessibleInScope(req: Request, entityId: string, homeYardId: string): Promise<boolean> {
  if (yardInScope(req, homeYardId)) return true;
  const scopedIds = (req as Request & { scopedLocationIds?: string[] }).scopedLocationIds;
  if (!scopedIds || scopedIds.length === 0) return true;
  const rows = await db
    .select({ yardId: entityLocationMappings.yardId })
    .from(entityLocationMappings)
    .where(
      and(
        eq(entityLocationMappings.entityId, entityId),
        eq(entityLocationMappings.status, "Active"),
        inArray(entityLocationMappings.yardId, scopedIds),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export async function listMappedYardsForEntity(entityId: string): Promise<MappedYardDto[]> {
  const rows = await db
    .select({
      id: entityLocationMappings.id,
      yardId: entityLocationMappings.yardId,
      status: entityLocationMappings.status,
      effectiveFrom: entityLocationMappings.effectiveFrom,
      effectiveTo: entityLocationMappings.effectiveTo,
      unmappedAt: entityLocationMappings.unmappedAt,
      unmappedReason: entityLocationMappings.unmappedReason,
      yardCode: yards.code,
      yardName: yards.name,
    })
    .from(entityLocationMappings)
    .leftJoin(yards, eq(yards.id, entityLocationMappings.yardId))
    .where(eq(entityLocationMappings.entityId, entityId));
  return rows.map((r) => ({
    mappingId: r.id,
    id: r.yardId,
    yardId: r.yardId,
    yardCode: r.yardCode ?? null,
    yardName: r.yardName ?? null,
    status: r.status,
    effectiveFrom: r.effectiveFrom ?? null,
    effectiveTo: r.effectiveTo ?? null,
    unmappedAt: r.unmappedAt ?? null,
    unmappedReason: r.unmappedReason ?? null,
  }));
}

export async function listActiveMappedYardIds(entityId: string): Promise<string[]> {
  const rows = await db
    .select({ yardId: entityLocationMappings.yardId })
    .from(entityLocationMappings)
    .where(and(eq(entityLocationMappings.entityId, entityId), eq(entityLocationMappings.status, "Active")));
  return rows.map((r) => r.yardId);
}

export async function entityHasActiveMapping(entityId: string, yardId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: entityLocationMappings.id })
    .from(entityLocationMappings)
    .where(
      and(
        eq(entityLocationMappings.entityId, entityId),
        eq(entityLocationMappings.yardId, yardId),
        eq(entityLocationMappings.status, "Active"),
      ),
    )
    .limit(1);
  return Boolean(row);
}

type TxLike = {
  insert: typeof db.insert;
  update: typeof db.update;
  select: typeof db.select;
};

/** Insert or reactivate Active mappings for yardIds; sync entities.yardId to first yard. */
export async function upsertActiveMappings(
  tx: TxLike,
  args: {
    entityId: string;
    yardIds: string[];
    createdBy: string | null;
    ts: string;
    setHomeYard?: boolean;
  },
): Promise<void> {
  const uniqueYards = [...new Set(args.yardIds.map((y) => String(y).trim()).filter(Boolean))];
  for (const yardId of uniqueYards) {
    const [existing] = await tx
      .select()
      .from(entityLocationMappings)
      .where(and(eq(entityLocationMappings.entityId, args.entityId), eq(entityLocationMappings.yardId, yardId)))
      .limit(1);
    if (existing) {
      await tx
        .update(entityLocationMappings)
        .set({
          status: "Active",
          effectiveFrom: existing.effectiveFrom ?? args.ts,
          effectiveTo: null,
          unmappedAt: null,
          unmappedReason: null,
          updatedAt: args.ts,
        })
        .where(eq(entityLocationMappings.id, existing.id));
    } else {
      await tx.insert(entityLocationMappings).values({
        id: nanoid(),
        entityId: args.entityId,
        yardId,
        status: "Active",
        effectiveFrom: args.ts,
        effectiveTo: null,
        unmappedAt: null,
        unmappedReason: null,
        createdBy: args.createdBy,
        createdAt: args.ts,
        updatedAt: args.ts,
      });
    }
  }
  if (args.setHomeYard !== false && uniqueYards.length > 0) {
    await tx
      .update(entities)
      .set({ yardId: uniqueYards[0], updatedAt: args.ts })
      .where(eq(entities.id, args.entityId));
  }
}

export async function unmapEntityLocation(
  args: {
    entityId: string;
    yardId: string;
    reason: string;
    effectiveTo?: string | null;
    ts: string;
  },
): Promise<"ok" | "not_found" | "already_inactive" | "last_active"> {
  const [row] = await db
    .select()
    .from(entityLocationMappings)
    .where(and(eq(entityLocationMappings.entityId, args.entityId), eq(entityLocationMappings.yardId, args.yardId)))
    .limit(1);
  if (!row) return "not_found";
  if (row.status !== "Active") return "already_inactive";

  const active = await listActiveMappedYardIds(args.entityId);
  if (active.length <= 1) return "last_active";

  await db
    .update(entityLocationMappings)
    .set({
      status: "Inactive",
      effectiveTo: args.effectiveTo?.trim() || args.ts.slice(0, 10),
      unmappedAt: args.ts,
      unmappedReason: args.reason.trim() || null,
      updatedAt: args.ts,
    })
    .where(eq(entityLocationMappings.id, row.id));

  // If home yard was unmapped, point home to another Active mapping.
  const [ent] = await db.select({ yardId: entities.yardId }).from(entities).where(eq(entities.id, args.entityId)).limit(1);
  if (ent && ent.yardId === args.yardId) {
    const remaining = (await listActiveMappedYardIds(args.entityId)).filter((y) => y !== args.yardId);
    if (remaining[0]) {
      await db.update(entities).set({ yardId: remaining[0], updatedAt: args.ts }).where(eq(entities.id, args.entityId));
    }
  }
  return "ok";
}

/** Entity IDs that have an Active mapping in any of the given yards. */
export async function entityIdsWithActiveMappingInYards(yardIds: string[]): Promise<string[]> {
  if (yardIds.length === 0) return [];
  const rows = await db
    .select({ entityId: entityLocationMappings.entityId })
    .from(entityLocationMappings)
    .where(and(eq(entityLocationMappings.status, "Active"), inArray(entityLocationMappings.yardId, yardIds)));
  return [...new Set(rows.map((r) => r.entityId))];
}
