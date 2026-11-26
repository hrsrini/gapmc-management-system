/**
 * Track A trader licence ↔ location (yard) mapping helpers.
 */
import { and, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { Request } from "express";
import { db } from "./db";
import { traderLicenceLocationMappings, traderLicences, yards } from "@shared/db-schema";
import { yardInScope } from "./entity-location-mappings";

export type LicenceMappedYardDto = {
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

/** Licence is visible if home yard OR any Active mapping is in scope (ADMIN / checkpost bypass separate). */
export async function licenceAccessibleViaMappings(
  req: Request,
  traderLicenceId: string,
  homeYardId: string,
): Promise<boolean> {
  if (yardInScope(req, homeYardId)) return true;
  const scopedIds = (req as Request & { scopedLocationIds?: string[] }).scopedLocationIds;
  if (!scopedIds || scopedIds.length === 0) return true;
  const rows = await db
    .select({ yardId: traderLicenceLocationMappings.yardId })
    .from(traderLicenceLocationMappings)
    .where(
      and(
        eq(traderLicenceLocationMappings.traderLicenceId, traderLicenceId),
        eq(traderLicenceLocationMappings.status, "Active"),
        inArray(traderLicenceLocationMappings.yardId, scopedIds),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export async function listMappedYardsForLicence(traderLicenceId: string): Promise<LicenceMappedYardDto[]> {
  const rows = await db
    .select({
      id: traderLicenceLocationMappings.id,
      yardId: traderLicenceLocationMappings.yardId,
      status: traderLicenceLocationMappings.status,
      effectiveFrom: traderLicenceLocationMappings.effectiveFrom,
      effectiveTo: traderLicenceLocationMappings.effectiveTo,
      unmappedAt: traderLicenceLocationMappings.unmappedAt,
      unmappedReason: traderLicenceLocationMappings.unmappedReason,
      yardCode: yards.code,
      yardName: yards.name,
    })
    .from(traderLicenceLocationMappings)
    .leftJoin(yards, eq(yards.id, traderLicenceLocationMappings.yardId))
    .where(eq(traderLicenceLocationMappings.traderLicenceId, traderLicenceId));
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

export async function listActiveMappedYardIdsForLicence(traderLicenceId: string): Promise<string[]> {
  const rows = await db
    .select({ yardId: traderLicenceLocationMappings.yardId })
    .from(traderLicenceLocationMappings)
    .where(
      and(
        eq(traderLicenceLocationMappings.traderLicenceId, traderLicenceId),
        eq(traderLicenceLocationMappings.status, "Active"),
      ),
    );
  return rows.map((r) => r.yardId);
}

export async function licenceHasActiveMapping(traderLicenceId: string, yardId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: traderLicenceLocationMappings.id })
    .from(traderLicenceLocationMappings)
    .where(
      and(
        eq(traderLicenceLocationMappings.traderLicenceId, traderLicenceId),
        eq(traderLicenceLocationMappings.yardId, yardId),
        eq(traderLicenceLocationMappings.status, "Active"),
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

/** Ensure Home yard has an Active mapping row (idempotent). */
export async function ensureLicenceHomeMapping(
  traderLicenceId: string,
  homeYardId: string,
  opts?: { createdBy?: string | null; ts?: string },
): Promise<void> {
  const yardId = String(homeYardId ?? "").trim();
  if (!yardId) return;
  const ts = opts?.ts ?? new Date().toISOString();
  const [existing] = await db
    .select()
    .from(traderLicenceLocationMappings)
    .where(
      and(
        eq(traderLicenceLocationMappings.traderLicenceId, traderLicenceId),
        eq(traderLicenceLocationMappings.yardId, yardId),
      ),
    )
    .limit(1);
  if (existing) {
    if (existing.status !== "Active") {
      await db
        .update(traderLicenceLocationMappings)
        .set({
          status: "Active",
          effectiveTo: null,
          unmappedAt: null,
          unmappedReason: null,
          updatedAt: ts,
        })
        .where(eq(traderLicenceLocationMappings.id, existing.id));
    }
    return;
  }
  await db.insert(traderLicenceLocationMappings).values({
    id: nanoid(),
    traderLicenceId,
    yardId,
    status: "Active",
    effectiveFrom: ts,
    effectiveTo: null,
    unmappedAt: null,
    unmappedReason: null,
    createdBy: opts?.createdBy ?? null,
    createdAt: ts,
    updatedAt: ts,
  });
}

/** Insert or reactivate Active mappings for yardIds. */
export async function upsertActiveLicenceMappings(
  tx: TxLike,
  args: {
    traderLicenceId: string;
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
      .from(traderLicenceLocationMappings)
      .where(
        and(
          eq(traderLicenceLocationMappings.traderLicenceId, args.traderLicenceId),
          eq(traderLicenceLocationMappings.yardId, yardId),
        ),
      )
      .limit(1);
    if (existing) {
      await tx
        .update(traderLicenceLocationMappings)
        .set({
          status: "Active",
          effectiveFrom: existing.effectiveFrom ?? args.ts,
          effectiveTo: null,
          unmappedAt: null,
          unmappedReason: null,
          updatedAt: args.ts,
        })
        .where(eq(traderLicenceLocationMappings.id, existing.id));
    } else {
      await tx.insert(traderLicenceLocationMappings).values({
        id: nanoid(),
        traderLicenceId: args.traderLicenceId,
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
  if (args.setHomeYard === true && uniqueYards.length > 0) {
    await tx
      .update(traderLicences)
      .set({ yardId: uniqueYards[0], updatedAt: args.ts })
      .where(eq(traderLicences.id, args.traderLicenceId));
  }
}

export async function unmapLicenceLocation(args: {
  traderLicenceId: string;
  yardId: string;
  reason: string;
  effectiveTo?: string | null;
  ts: string;
}): Promise<"ok" | "not_found" | "already_inactive" | "last_active"> {
  const [row] = await db
    .select()
    .from(traderLicenceLocationMappings)
    .where(
      and(
        eq(traderLicenceLocationMappings.traderLicenceId, args.traderLicenceId),
        eq(traderLicenceLocationMappings.yardId, args.yardId),
      ),
    )
    .limit(1);
  if (!row) return "not_found";
  if (row.status !== "Active") return "already_inactive";

  const active = await listActiveMappedYardIdsForLicence(args.traderLicenceId);
  if (active.length <= 1) return "last_active";

  await db
    .update(traderLicenceLocationMappings)
    .set({
      status: "Inactive",
      effectiveTo: args.effectiveTo?.trim() || args.ts.slice(0, 10),
      unmappedAt: args.ts,
      unmappedReason: args.reason.trim() || null,
      updatedAt: args.ts,
    })
    .where(eq(traderLicenceLocationMappings.id, row.id));

  const [lic] = await db
    .select({ yardId: traderLicences.yardId })
    .from(traderLicences)
    .where(eq(traderLicences.id, args.traderLicenceId))
    .limit(1);
  if (lic && lic.yardId === args.yardId) {
    const remaining = (await listActiveMappedYardIdsForLicence(args.traderLicenceId)).filter(
      (y) => y !== args.yardId,
    );
    if (remaining[0]) {
      await db
        .update(traderLicences)
        .set({ yardId: remaining[0], updatedAt: args.ts })
        .where(eq(traderLicences.id, args.traderLicenceId));
    }
  }
  return "ok";
}
