/**
 * M-04: Human-readable purchase transaction numbers (unique, per yard + FY).
 * Format: GAPLMB/{LOC}/{FY}/PT/{NNNNN} (aligned with M-05 receipt style).
 *
 * Uses a single Postgres UPSERT so sequence allocation cannot "miss" (no empty UPDATE).
 */
import { eq } from "drizzle-orm";
import { db, pool } from "./db";
import { yards } from "@shared/db-schema";

/** Indian FY label from calendar date (April–March): e.g. 2025-04-01 → 2025-26 */
export function financialYearFromIsoTransactionDate(iso: string): string {
  const t = String(iso ?? "").trim().slice(0, 10);
  const parts = t.split("-");
  if (parts.length !== 3) {
    const d = new Date();
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    if (m >= 4) return `${y}-${String(y + 1).slice(-2)}`;
    return `${y - 1}-${String(y).slice(-2)}`;
  }
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) {
    const d = new Date();
    const cy = d.getFullYear();
    const cm = d.getMonth() + 1;
    if (cm >= 4) return `${cy}-${String(cy + 1).slice(-2)}`;
    return `${cy - 1}-${String(cy).slice(-2)}`;
  }
  if (m >= 4) return `${y}-${String(y + 1).slice(-2)}`;
  return `${y - 1}-${String(y).slice(-2)}`;
}

export async function generateNextPurchaseTransactionNo(params: {
  yardId: string;
  transactionDateIso: string;
}): Promise<string> {
  const fy = financialYearFromIsoTransactionDate(params.transactionDateIso);
  const [yard] = await db.select({ code: yards.code }).from(yards).where(eq(yards.id, params.yardId)).limit(1);
  const locRaw = yard?.code != null && String(yard.code).trim() !== "" ? String(yard.code).trim() : "LOC";
  const loc = locRaw.replace(/[^\w-]+/g, "").toUpperCase() || "LOC";

  const { rows } = await pool.query<{ last_seq: number }>(
    `INSERT INTO gapmc.purchase_transaction_sequence (yard_id, financial_year, last_seq)
     VALUES ($1::text, $2::text, 1)
     ON CONFLICT (yard_id, financial_year)
     DO UPDATE SET last_seq = gapmc.purchase_transaction_sequence.last_seq + 1
     RETURNING last_seq`,
    [params.yardId, fy],
  );
  const nextSeq = rows[0]?.last_seq;
  if (nextSeq == null || !Number.isFinite(Number(nextSeq))) {
    throw new Error(
      "M-04: purchase_transaction_sequence allocation failed (missing table? run npm run db:apply-m04-purchase-transaction-sequence)",
    );
  }
  return `GAPLMB/${loc}/${fy}/PT/${String(nextSeq).padStart(5, "0")}`;
}

/** If INSERT omitted transaction_no (schema drift / driver quirk), force the pre-allocated number. */
export async function persistAllocatedTransactionNoIfMissing(rowId: string, allocated: string): Promise<void> {
  const t = String(allocated ?? "").trim();
  if (!t) throw new Error("M-04: allocated transaction number is empty");
  const { rows } = await pool.query<{ transaction_no: string | null }>(
    `SELECT transaction_no FROM gapmc.purchase_transactions WHERE id = $1::text`,
    [rowId],
  );
  const current = rows[0]?.transaction_no;
  if (current != null && String(current).trim() !== "") return;
  const upd = await pool.query(`UPDATE gapmc.purchase_transactions SET transaction_no = $1::text WHERE id = $2::text`, [
    t,
    rowId,
  ]);
  if ((upd.rowCount ?? 0) < 1) {
    console.error("M-04: persistAllocatedTransactionNoIfMissing UPDATE matched 0 rows", { rowId });
  }
}

/**
 * List/read self-heal: allocate and persist when `transaction_no` is still null (legacy rows or failed insert).
 */
export async function ensurePurchaseTransactionNoForRow(row: {
  id: string;
  yardId: string;
  transactionDate: string;
}): Promise<string | null> {
  const read = async (): Promise<string | null> => {
    const { rows } = await pool.query<{ transaction_no: string | null }>(
      `SELECT transaction_no FROM gapmc.purchase_transactions WHERE id = $1::text`,
      [row.id],
    );
    const c = rows[0]?.transaction_no;
    return c != null && String(c).trim() !== "" ? String(c).trim() : null;
  };
  const existing = await read();
  if (existing) return existing;
  const allocated = await generateNextPurchaseTransactionNo({
    yardId: row.yardId,
    transactionDateIso: row.transactionDate,
  });
  const upd = await pool.query(
    `UPDATE gapmc.purchase_transactions SET transaction_no = $1::text
     WHERE id = $2::text AND (transaction_no IS NULL OR btrim(transaction_no::text) = '')`,
    [allocated, row.id],
  );
  if ((upd.rowCount ?? 0) > 0) return allocated;
  return await read();
}
