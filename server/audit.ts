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

function serializeAuditField(value: unknown): unknown {
  return value != null ? JSON.parse(JSON.stringify(value)) : null;
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
    beforeValue: serializeAuditField(entry.beforeValue) as Record<string, unknown> | null,
    afterValue: serializeAuditField(entry.afterValue) as Record<string, unknown> | null,
    ip,
    createdAt: now,
  });
}

/**
 * Cron / batch audit actor id. Default literal `"system"` (no `users` row required).
 * Set `AUDIT_SYSTEM_USER_ID` to a real `users.id` if compliance requires a FK-capable actor.
 */
export function getAuditSystemUserId(): string {
  return process.env.AUDIT_SYSTEM_USER_ID?.trim() || "system";
}

/** For cron/batch jobs with no authenticated user. */
export async function writeAuditLogSystem(entry: AuditEntry): Promise<void> {
  const userId = getAuditSystemUserId();
  const now = new Date().toISOString();
  await db.insert(auditLog).values({
    id: nanoid(),
    userId,
    module: entry.module,
    action: entry.action,
    recordId: entry.recordId ?? null,
    beforeValue: serializeAuditField(entry.beforeValue) as Record<string, unknown> | null,
    afterValue: serializeAuditField(entry.afterValue) as Record<string, unknown> | null,
    ip: null,
    createdAt: now,
  });
}
