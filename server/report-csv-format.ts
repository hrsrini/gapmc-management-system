import { inArray } from "drizzle-orm";
import { db } from "./db";
import { yards } from "@shared/db-schema";

/** Receipt register CSV: `DD-MM-YYYY HH:MM:SS` without timezone conversion. */
export function formatCreatedAtCsv(iso: string | null | undefined): string {
  if (iso == null || String(iso).trim() === "") return "";
  const t = String(iso).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(t);
  if (m) {
    const sec = m[6] ?? "00";
    return `${m[3]}-${m[2]}-${m[1]} ${m[4]}:${m[5]}:${sec.padStart(2, "0")}`;
  }
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t.slice(0, 10));
  if (d) return `${d[3]}-${d[2]}-${d[1]} 00:00:00`;
  return t;
}

export async function yardDisplayNameByIds(yardIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const ids = Array.from(new Set(yardIds.map((id) => String(id ?? "").trim()).filter(Boolean)));
  if (ids.length === 0) return map;
  const rows = await db
    .select({ id: yards.id, name: yards.name, code: yards.code })
    .from(yards)
    .where(inArray(yards.id, ids));
  for (const y of rows) {
    map.set(y.id, String(y.name ?? "").trim() || String(y.code ?? "").trim() || y.id);
  }
  return map;
}

export async function enrichReceiptRegisterRows<T extends { yardId: string }>(
  rows: T[],
): Promise<Array<T & { yardName: string }>> {
  const yardNameById = await yardDisplayNameByIds(rows.map((r) => String(r.yardId ?? "")));
  return rows.map((r) => ({
    ...r,
    yardName: yardNameById.get(String(r.yardId ?? "")) ?? "—",
  }));
}
