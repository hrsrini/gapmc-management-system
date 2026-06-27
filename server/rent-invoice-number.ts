/**
 * M-03 rent tax invoice numbers: human-readable, unique per yard + billing month.
 * Format (SRS F.9): Jan/2026/PND/011 — month / year / yard code / 3-digit sequence.
 */
import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db } from "./db";
import { yards } from "@shared/db-schema";

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function firstCell(r: unknown): string | number | bigint | null {
  if (r && typeof r === "object" && "rows" in r) {
    const rows = (r as { rows: Record<string, unknown>[] }).rows;
    const row = rows?.[0];
    if (!row) return null;
    const v = Object.values(row)[0];
    if (typeof v === "bigint") return v;
    if (typeof v === "number" || typeof v === "string") return v;
    return v != null ? String(v) : null;
  }
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function execTx(tx: any, fragment: ReturnType<typeof sql>) {
  return tx.execute(fragment);
}

export function sanitizeYardCodeForInvoiceNo(code: string | null | undefined): string {
  const t = String(code ?? "")
    .trim()
    .replace(/[^\w-]+/g, "");
  return (t || "YARD").slice(0, 12);
}

export function sanitizePeriodMonthForInvoiceNo(periodMonth: string | null | undefined): string {
  const t = String(periodMonth ?? "")
    .trim()
    .replace(/[^\d-]/g, "");
  return t || "0000-00";
}

/** Build display invoice number from yard code, accrual month, and sequence (1-based). */
export function formatRentInvoiceNo(
  yardCode: string | null | undefined,
  periodMonth: string | null | undefined,
  seq: number,
): string {
  const n = Number(seq);
  const safeSeq = Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
  const pm = sanitizePeriodMonthForInvoiceNo(periodMonth);
  const m = /^(\d{4})-(\d{2})$/.exec(pm);
  const year = m?.[1] ?? "0000";
  const moIdx = m ? Number(m[2]) - 1 : 0;
  const mon = moIdx >= 0 && moIdx < 12 ? MONTH_SHORT[moIdx] : "Jan";
  const yc = sanitizeYardCodeForInvoiceNo(yardCode);
  return `${mon}/${year}/${yc}/${String(safeSeq).padStart(3, "0")}`;
}

/** @deprecated Old suffix was `rent_invoices.id`; use numeric seq only. */
export function isLegacyRentInvoiceNoSuffix(suffix: string): boolean {
  const s = String(suffix ?? "").trim();
  if (/^\d{5}$/.test(s)) return false;
  return s.length > 5;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function nextRentInvoiceSeqTx(tx: any, yardId: string, periodMonth: string): Promise<number> {
  const yid = String(yardId ?? "").trim();
  const pm = sanitizePeriodMonthForInvoiceNo(periodMonth);
  if (!yid || !pm || pm === "0000-00") {
    throw new Error("yardId and periodMonth (YYYY-MM) are required for rent invoice numbering.");
  }
  const r = await execTx(
    tx,
    sql`
      INSERT INTO gapmc.m03_rent_invoice_counters (yard_id, period_month, last_n)
      VALUES (${yid}, ${pm}, 1)
      ON CONFLICT (yard_id, period_month) DO UPDATE
        SET last_n = gapmc.m03_rent_invoice_counters.last_n + 1
      RETURNING last_n
    `,
  );
  const n = Number(firstCell(r));
  return Number.isFinite(n) && n > 0 ? n : 1;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function allocateRentInvoiceNoInTx(
  tx: any,
  args: { yardId: string; periodMonth: string; yardCode?: string | null },
): Promise<string> {
  const yardId = String(args.yardId ?? "").trim();
  const periodMonth = sanitizePeriodMonthForInvoiceNo(args.periodMonth);
  let yardCode = args.yardCode != null ? String(args.yardCode).trim() : "";
  if (!yardCode) {
    const [y] = await tx.select({ code: yards.code }).from(yards).where(eq(yards.id, yardId)).limit(1);
    yardCode = y?.code ?? "YARD";
  }
  const seq = await nextRentInvoiceSeqTx(tx, yardId, periodMonth);
  return formatRentInvoiceNo(yardCode, periodMonth, seq);
}

/** Allocate next M-03 invoice number (yard + billing month sequence). */
export async function allocateRentInvoiceNo(args: {
  yardId: string;
  periodMonth: string;
  yardCode?: string | null;
}): Promise<string> {
  return db.transaction(async (tx: unknown) => allocateRentInvoiceNoInTx(tx, args));
}

/** Set counter to at least `lastN` for a yard/month (backfill / migration). */
export async function syncRentInvoiceCounter(yardId: string, periodMonth: string, lastN: number): Promise<void> {
  const yid = String(yardId ?? "").trim();
  const pm = sanitizePeriodMonthForInvoiceNo(periodMonth);
  const n = Math.max(0, Math.floor(Number(lastN) || 0));
  if (!yid || !pm) return;
  await db.execute(sql`
    INSERT INTO gapmc.m03_rent_invoice_counters (yard_id, period_month, last_n)
    VALUES (${yid}, ${pm}, ${n})
    ON CONFLICT (yard_id, period_month) DO UPDATE
      SET last_n = GREATEST(gapmc.m03_rent_invoice_counters.last_n, EXCLUDED.last_n)
  `);
}
