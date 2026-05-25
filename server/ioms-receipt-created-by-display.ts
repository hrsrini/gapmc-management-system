import { inArray } from "drizzle-orm";
import { db } from "./db";
import { users } from "@shared/db-schema";

export type WithCreatedByDisplayName = {
  /** Human-readable issuer (user name, System, or script label). */
  createdByDisplayName: string;
};

function labelForCreatedBy(createdBy: string, nameById: Map<string, string>): string {
  const id = String(createdBy ?? "").trim();
  if (!id) return "—";
  if (id === "system") return "System";
  if (id.startsWith("script:")) {
    const slug = id.slice("script:".length).trim();
    return slug ? slug.replace(/-/g, " ") : "Script";
  }
  return nameById.get(id) ?? id;
}

/** Batch-resolve `created_by` user ids to `users.name` for receipt lists. */
export async function attachCreatedByDisplayNames<T extends { createdBy: string }>(
  rows: T[],
): Promise<(T & WithCreatedByDisplayName)[]> {
  if (rows.length === 0) return [];

  const ids = [
    ...new Set(
      rows
        .map((r) => String(r.createdBy ?? "").trim())
        .filter((id) => id && id !== "system" && !id.startsWith("script:")),
    ),
  ];

  const nameById = new Map<string, string>();
  if (ids.length > 0) {
    const userRows = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(inArray(users.id, ids));
    for (const u of userRows) {
      const name = String(u.name ?? "").trim();
      if (name) nameById.set(u.id, name);
    }
  }

  return rows.map((r) => ({
    ...r,
    createdByDisplayName: labelForCreatedBy(r.createdBy, nameById),
  }));
}
