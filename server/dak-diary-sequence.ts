import { and, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { dakDiarySequence, yards } from "@shared/db-schema";

/** India FY label from a received date (YYYY-MM-DD): April–March. */
export function financialYearFromReceivedDate(receivedDate: string): string {
  const d = receivedDate.slice(0, 10);
  const parts = d.split("-");
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  if (!Number.isFinite(y) || !Number.isFinite(m)) {
    const now = new Date();
    const cy = now.getFullYear();
    const cm = now.getMonth() + 1;
    if (cm >= 4) return `${cy}-${String(cy + 1).slice(-2)}`;
    return `${cy - 1}-${String(cy).slice(-2)}`;
  }
  if (m >= 4) return `${y}-${String(y + 1).slice(-2)}`;
  return `${y - 1}-${String(y).slice(-2)}`;
}

/**
 * Next unique diary number: `DAK/{LOC}/{FY}/{NNNNN}`.
 * LOC = yard code (per_yard) or HO (central / no yard).
 */
export async function generateNextDakDiaryNo(params: {
  yardId: string | null;
  receivedDate: string;
  scope: "per_yard" | "central";
}): Promise<string> {
  const fy = financialYearFromReceivedDate(params.receivedDate);
  let scopeKey: string;
  let locCode: string;

  if (params.scope === "central") {
    scopeKey = "__CENTRAL__";
    locCode = "HO";
  } else {
    const yid = params.yardId;
    scopeKey = yid ?? "__NO_YARD__";
    if (yid) {
      const [y] = await db.select({ code: yards.code }).from(yards).where(eq(yards.id, yid)).limit(1);
      locCode = (y?.code ?? "YRD").replace(/\s+/g, "") || "YRD";
    } else {
      locCode = "HO";
    }
  }

  const nextSeq = await db.transaction(async (tx) => {
    await tx.insert(dakDiarySequence).values({ scopeKey, financialYear: fy, lastSeq: 0 }).onConflictDoNothing();
    const [updated] = await tx
      .update(dakDiarySequence)
      .set({ lastSeq: sql`${dakDiarySequence.lastSeq} + 1` })
      .where(and(eq(dakDiarySequence.scopeKey, scopeKey), eq(dakDiarySequence.financialYear, fy)))
      .returning({ lastSeq: dakDiarySequence.lastSeq });
    return updated?.lastSeq ?? 1;
  });

  return `DAK/${locCode}/${fy}/${String(nextSeq).padStart(5, "0")}`;
}
