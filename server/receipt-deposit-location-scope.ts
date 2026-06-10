/**
 * Cash-in-hand / deposit entry location scope (HO → all yards; yard users → assigned only).
 */
import type { Request } from "express";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "./db";
import { yards } from "@shared/db-schema";

export type CashInHandYardRef = {
  id: string;
  name: string;
  code: string;
  type: string;
};

export type CashInHandLocationContext = {
  canSelectAll: boolean;
  /** null = default to all locations (HO); otherwise a single yard id. */
  defaultYardId: string | null;
  yards: CashInHandYardRef[];
};

declare global {
  namespace Express {
    interface Request {
      /** Cached per request — true when user is assigned to a Head Office location. */
      _headOfficeScoped?: boolean;
    }
  }
}

const activeYardCond = or(eq(yards.isActive, true), isNull(yards.isActive));

export async function userHasHeadOfficeScope(assignedYardIds: string[]): Promise<boolean> {
  if (assignedYardIds.length === 0) return false;
  const rows = await db
    .select({ type: yards.type })
    .from(yards)
    .where(inArray(yards.id, assignedYardIds));
  return rows.some((r) => String(r.type ?? "").trim() === "HO");
}

export async function isHeadOfficeScopedRequest(req: Request): Promise<boolean> {
  if (req._headOfficeScoped !== undefined) return req._headOfficeScoped;
  const assigned = req.scopedLocationIds ?? [];
  req._headOfficeScoped = await userHasHeadOfficeScope(assigned);
  return req._headOfficeScoped;
}

export async function listYardsForCashInHandUser(assignedYardIds: string[]): Promise<CashInHandYardRef[]> {
  const ho = await userHasHeadOfficeScope(assignedYardIds);
  if (ho) {
    return db
      .select({
        id: yards.id,
        name: yards.name,
        code: yards.code,
        type: yards.type,
      })
      .from(yards)
      .where(activeYardCond)
      .orderBy(yards.name);
  }
  if (assignedYardIds.length === 0) return [];
  return db
    .select({
      id: yards.id,
      name: yards.name,
      code: yards.code,
      type: yards.type,
    })
    .from(yards)
    .where(and(inArray(yards.id, assignedYardIds), activeYardCond))
    .orderBy(yards.name);
}

export function resolveCashInHandDefaultYardId(
  canSelectAll: boolean,
  assignedYardIds: string[],
): string | null {
  if (canSelectAll) return null;
  if (assignedYardIds.length === 1) return assignedYardIds[0] ?? null;
  return assignedYardIds[0] ?? null;
}

export async function buildCashInHandLocationContext(req: Request): Promise<CashInHandLocationContext> {
  const assigned = req.scopedLocationIds ?? [];
  const canSelectAll = await isHeadOfficeScopedRequest(req);
  const yardList = await listYardsForCashInHandUser(assigned);
  return {
    canSelectAll,
    defaultYardId: resolveCashInHandDefaultYardId(canSelectAll, assigned),
    yards: yardList,
  };
}

/** Yard ids for queries: [] = no filter (all yards). Throws when access denied. */
export async function resolveCashInHandYardIds(
  req: Request,
  selectedYardId?: string,
): Promise<string[]> {
  const assigned = req.scopedLocationIds ?? [];
  const ho = await isHeadOfficeScopedRequest(req);
  const yardId = String(selectedYardId ?? "").trim();

  if (yardId) {
    if (!ho && assigned.length > 0 && !assigned.includes(yardId)) {
      throw new CashInHandYardAccessError(yardId);
    }
    return [yardId];
  }

  if (ho) return [];
  return assigned;
}

export class CashInHandYardAccessError extends Error {
  constructor(public readonly yardId: string) {
    super("Yard access denied");
    this.name = "CashInHandYardAccessError";
  }
}

export async function yardAllowedForCashInHand(req: Request, yardId: string): Promise<boolean> {
  const assigned = req.scopedLocationIds ?? [];
  const ho = await isHeadOfficeScopedRequest(req);
  if (ho) return true;
  return assigned.length === 0 || assigned.includes(yardId);
}
