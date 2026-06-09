import { desc, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  gaplmbBankAccountYardMappingLog,
  gaplmbBankAccountYards,
  users,
} from "@shared/db-schema";
import { db } from "./db";

export type YardMappingActionType = "Link" | "DeLink" | "AddYard" | "RemoveYard" | "Modify";

function nowIso(): string {
  return new Date().toISOString();
}

function mappingLabel(yardIds: string[]): string {
  return JSON.stringify(yardIds.slice().sort());
}

export async function getBankAccountYardIds(bankAccountId: string): Promise<string[]> {
  const rows = await db
    .select({ yardId: gaplmbBankAccountYards.yardId })
    .from(gaplmbBankAccountYards)
    .where(eq(gaplmbBankAccountYards.bankAccountId, bankAccountId));
  return rows.map((r) => r.yardId);
}

async function insertMappingLog(args: {
  bankAccountId: string;
  actionType: YardMappingActionType;
  yardId?: string | null;
  previousYardIds: string[];
  newYardIds: string[];
  changedBy: string | null;
  remarks?: string | null;
}): Promise<void> {
  await db.insert(gaplmbBankAccountYardMappingLog).values({
    id: nanoid(),
    bankAccountId: args.bankAccountId,
    actionType: args.actionType,
    yardId: args.yardId ?? null,
    previousMappingJson: mappingLabel(args.previousYardIds),
    newMappingJson: mappingLabel(args.newYardIds),
    remarks: args.remarks?.trim() || null,
    changedBy: args.changedBy,
    changedAt: nowIso(),
  });
}

/** Diff previous → new yard sets and append audit rows (never deletes log history). */
export async function recordYardMappingChanges(args: {
  bankAccountId: string;
  previousYardIds: string[];
  newYardIds: string[];
  changedBy: string | null;
  remarks?: string | null;
}): Promise<void> {
  const prevSet = new Set(args.previousYardIds);
  const added = args.newYardIds.filter((y) => !prevSet.has(y));
  const removed = args.previousYardIds.filter((y) => !args.newYardIds.includes(y));

  if (added.length === 0 && removed.length === 0) return;

  const remarks = args.remarks?.trim() || null;

  if (args.previousYardIds.length === 0 && args.newYardIds.length > 0 && removed.length === 0) {
    await insertMappingLog({
      bankAccountId: args.bankAccountId,
      actionType: "Link",
      previousYardIds: args.previousYardIds,
      newYardIds: args.newYardIds,
      changedBy: args.changedBy,
      remarks,
    });
    return;
  }

  if (args.newYardIds.length === 0 && args.previousYardIds.length > 0 && added.length === 0) {
    await insertMappingLog({
      bankAccountId: args.bankAccountId,
      actionType: "DeLink",
      previousYardIds: args.previousYardIds,
      newYardIds: args.newYardIds,
      changedBy: args.changedBy,
      remarks,
    });
    return;
  }

  if (added.length > 0 && removed.length > 0) {
    await insertMappingLog({
      bankAccountId: args.bankAccountId,
      actionType: "Modify",
      previousYardIds: args.previousYardIds,
      newYardIds: args.newYardIds,
      changedBy: args.changedBy,
      remarks,
    });
    return;
  }

  let current = [...args.previousYardIds];
  for (const yardId of removed) {
    const next = current.filter((y) => y !== yardId);
    await insertMappingLog({
      bankAccountId: args.bankAccountId,
      actionType: "RemoveYard",
      yardId,
      previousYardIds: current,
      newYardIds: next,
      changedBy: args.changedBy,
      remarks,
    });
    current = next;
  }

  for (const yardId of added) {
    const next = [...current, yardId];
    await insertMappingLog({
      bankAccountId: args.bankAccountId,
      actionType: "AddYard",
      yardId,
      previousYardIds: current,
      newYardIds: next,
      changedBy: args.changedBy,
      remarks,
    });
    current = next;
  }
}

/** Apply yard mapping to junction table and write audit log entries. */
export async function syncBankAccountYardMappings(args: {
  bankAccountId: string;
  newYardIds: string[];
  changedBy: string | null;
  remarks?: string | null;
}): Promise<{ previousYardIds: string[]; newYardIds: string[] }> {
  const previousYardIds = await getBankAccountYardIds(args.bankAccountId);
  const newYardIds = Array.from(new Set(args.newYardIds.map((y) => String(y).trim()).filter(Boolean)));

  const prevKey = mappingLabel(previousYardIds);
  const nextKey = mappingLabel(newYardIds);
  if (prevKey === nextKey) {
    return { previousYardIds, newYardIds };
  }

  await recordYardMappingChanges({
    bankAccountId: args.bankAccountId,
    previousYardIds,
    newYardIds,
    changedBy: args.changedBy,
    remarks: args.remarks,
  });

  await db.delete(gaplmbBankAccountYards).where(eq(gaplmbBankAccountYards.bankAccountId, args.bankAccountId));
  for (const yardId of newYardIds) {
    await db.insert(gaplmbBankAccountYards).values({ bankAccountId: args.bankAccountId, yardId });
  }

  return { previousYardIds, newYardIds };
}

export type YardMappingHistoryRow = {
  id: string;
  bankAccountId: string;
  actionType: string;
  yardId: string | null;
  previousMapping: string[];
  newMapping: string[];
  remarks: string | null;
  changedBy: string | null;
  changedByName: string | null;
  changedAt: string;
};

function parseMappingJson(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export async function listYardMappingHistory(bankAccountId: string): Promise<YardMappingHistoryRow[]> {
  const rows = await db
    .select()
    .from(gaplmbBankAccountYardMappingLog)
    .where(eq(gaplmbBankAccountYardMappingLog.bankAccountId, bankAccountId))
    .orderBy(desc(gaplmbBankAccountYardMappingLog.changedAt));

  const userIds = Array.from(new Set(rows.map((r) => r.changedBy).filter(Boolean))) as string[];
  const nameById = new Map<string, string>();
  if (userIds.length > 0) {
    const userRows = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(inArray(users.id, userIds));
    for (const u of userRows) {
      if (u.name?.trim()) nameById.set(u.id, u.name.trim());
    }
  }

  return rows.map((r) => ({
    id: r.id,
    bankAccountId: r.bankAccountId,
    actionType: r.actionType,
    yardId: r.yardId,
    previousMapping: parseMappingJson(r.previousMappingJson),
    newMapping: parseMappingJson(r.newMappingJson),
    remarks: r.remarks,
    changedBy: r.changedBy,
    changedByName: r.changedBy ? (nameById.get(r.changedBy) ?? r.changedBy) : null,
    changedAt: r.changedAt,
  }));
}
