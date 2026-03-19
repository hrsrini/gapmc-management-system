/**
 * Resolve gapmc.users row for login identifier (email, local-part, or username).
 * Avoids one complex SQL that breaks if `username` column is missing before db:push.
 */
import { and, isNotNull, sql } from "drizzle-orm";
import { db } from "./db";
import { users } from "@shared/db-schema";

export type LoginUserRow = typeof users.$inferSelect;

export async function findUserForLogin(identifierLower: string): Promise<{
  user: LoginUserRow | undefined;
  ambiguousLocalPart?: boolean;
}> {
  // 1) Full email (case-insensitive)
  const byEmail = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${identifierLower}`)
    .limit(1);
  if (byEmail[0]) return { user: byEmail[0] };

  if (identifierLower.includes("@")) {
    return { user: undefined };
  }

  // 2) Local part before @ — e.g. "admin" → admin@gapmc.local (PostgreSQL)
  const byLocal = await db
    .select()
    .from(users)
    .where(sql`lower(split_part(${users.email}, '@', 1)) = ${identifierLower}`)
    .limit(2);
  if (byLocal.length > 1) {
    return { user: undefined, ambiguousLocalPart: true };
  }
  if (byLocal[0]) return { user: byLocal[0] };

  // 3) Explicit username column (may not exist until db:push)
  try {
    const byUsername = await db
      .select()
      .from(users)
      .where(and(isNotNull(users.username), sql`lower(${users.username}) = ${identifierLower}`))
      .limit(1);
    if (byUsername[0]) return { user: byUsername[0] };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/username|column .* does not exist|42703/i.test(msg)) {
      console.warn("[auth] users.username column missing or unusable; email/local-part login only:", msg);
    } else {
      throw e;
    }
  }

  return { user: undefined };
}
