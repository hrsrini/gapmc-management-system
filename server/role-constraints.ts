/**
 * M-10: business rule — a single app user must not hold both DV and DA roles (client clarification).
 * DO+DV on the same user is allowed.
 */
import { inArray } from "drizzle-orm";
import { db } from "./db";
import { roles } from "@shared/db-schema";

export async function assertRoleIdsNoDvDaConflict(
  roleIds: string[],
): Promise<{ ok: true } | { ok: false; message: string }> {
  const ids = Array.from(new Set(roleIds.map((id) => String(id).trim()).filter(Boolean)));
  if (ids.length === 0) return { ok: true };
  const rows = await db.select({ tier: roles.tier }).from(roles).where(inArray(roles.id, ids));
  const tiers = new Set(rows.map((r) => r.tier));
  if (tiers.has("DV") && tiers.has("DA")) {
    return {
      ok: false,
      message: "A user cannot hold both Data Verifier (DV) and Data Approver (DA) roles.",
    };
  }
  return { ok: true };
}
