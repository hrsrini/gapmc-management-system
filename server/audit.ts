/**
 * Write an entry to gapmc.audit_log for state changes (who, when, before/after, IP).
 * Call from mutation handlers after successful create/update/delete.
 */
import type { Request } from "express";
import { nanoid } from "nanoid";
import { db } from "./db";
import { auditLog } from "@shared/db-schema";

export interface AuditEntry {
  module: string;
  action: string;
  recordId?: string;
  beforeValue?: unknown;
  afterValue?: unknown;
}

function getClientIp(req: Request): string | null {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    const first = typeof forwarded === "string" ? forwarded.split(",")[0] : forwarded[0];
    return first?.trim() ?? null;
  }
  return req.socket?.remoteAddress ?? req.ip ?? null;
}

export async function writeAuditLog(req: Request, entry: AuditEntry): Promise<void> {
  const userId = req.user?.id;
  if (!userId) return;

  const ip = getClientIp(req);
  const now = new Date().toISOString();
  await db.insert(auditLog).values({
    id: nanoid(),
    userId,
    module: entry.module,
    action: entry.action,
    recordId: entry.recordId ?? null,
    beforeValue: entry.beforeValue != null ? JSON.parse(JSON.stringify(entry.beforeValue)) : null,
    afterValue: entry.afterValue != null ? JSON.parse(JSON.stringify(entry.afterValue)) : null,
    ip,
    createdAt: now,
  });
}
