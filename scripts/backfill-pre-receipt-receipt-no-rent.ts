/**
 * Renumber M-02 govt pre-receipt settlement receipts issued under /MISC/ to /RENT/.
 * Targets rows with source_module M-02 and receipt_no containing /MISC/ (typically revenue_head Rent).
 *
 * Usage: npm run db:backfill-pre-receipt-receipt-no-rent
 *
 * Uses a two-phase update to satisfy receipt_no UNIQUE. Syncs receipt_sequence for Rent per yard + FY.
 */
import "dotenv/config";
import { and, asc, eq, inArray, like } from "drizzle-orm";
import { db } from "../server/db";
import { iomsReceipts, receiptSequence, yards } from "@shared/db-schema";

const RENT_HEAD = "Rent";
const RENT_CODE = "RENT";

type Row = {
  id: string;
  receiptNo: string;
  yardId: string;
  createdAt: string;
};

function parseUnifiedReceiptNo(receiptNo: string): { loc: string; fy: string; headCode: string; seq: number } | null {
  const m = String(receiptNo ?? "")
    .trim()
    .match(/^GAPLMB\/([^/]+)\/([^/]+)\/([^/]+)\/(\d+)$/i);
  if (!m) return null;
  return { loc: m[1], fy: m[2], headCode: m[3].toUpperCase(), seq: Number(m[4]) };
}

function formatReceiptNo(loc: string, fy: string, headCode: string, seq: number): string {
  return `GAPLMB/${loc}/${fy}/${headCode}/${String(seq).padStart(4, "0")}`;
}

async function maxRentSeqForYardFy(yardId: string, fy: string, locCode: string): Promise<number> {
  const pattern = `GAPLMB/${locCode}/${fy}/${RENT_CODE}/%`;
  const rentRows = await db
    .select({ receiptNo: iomsReceipts.receiptNo })
    .from(iomsReceipts)
    .where(and(eq(iomsReceipts.yardId, yardId), like(iomsReceipts.receiptNo, pattern)));

  let maxFromReceipts = 0;
  for (const r of rentRows) {
    const p = parseUnifiedReceiptNo(r.receiptNo);
    if (p?.headCode === RENT_CODE && p.seq > maxFromReceipts) maxFromReceipts = p.seq;
  }

  const [seqRow] = await db
    .select({ lastSeq: receiptSequence.lastSeq })
    .from(receiptSequence)
    .where(
      and(
        eq(receiptSequence.yardId, yardId),
        eq(receiptSequence.revenueHead, RENT_HEAD),
        eq(receiptSequence.financialYear, fy),
      ),
    )
    .limit(1);

  const maxFromCounter = Number(seqRow?.lastSeq ?? 0);
  return Math.max(maxFromReceipts, maxFromCounter);
}

async function main() {
  const candidates = await db
    .select({
      id: iomsReceipts.id,
      receiptNo: iomsReceipts.receiptNo,
      yardId: iomsReceipts.yardId,
      createdAt: iomsReceipts.createdAt,
    })
    .from(iomsReceipts)
    .where(
      and(eq(iomsReceipts.sourceModule, "M-02"), like(iomsReceipts.receiptNo, "%/MISC/%")),
    )
    .orderBy(asc(iomsReceipts.yardId), asc(iomsReceipts.createdAt));

  if (candidates.length === 0) {
    console.log(
      "No M-02 receipts with /MISC/ in receipt_no — already on RENT segment (or none issued).",
    );
    console.log("Run: npm run db:check-pre-receipt-receipt-state");
    return;
  }

  const yardRows = await db.select({ id: yards.id, code: yards.code }).from(yards);
  const locByYardId = new Map(yardRows.map((y) => [y.id, String(y.code ?? "LOC").trim() || "LOC"]));

  const byGroup = new Map<string, Row[]>();
  for (const r of candidates) {
    const parsed = parseUnifiedReceiptNo(r.receiptNo);
    if (!parsed) {
      console.warn(`Skip (unparseable): ${r.receiptNo} (${r.id})`);
      continue;
    }
    const key = `${r.yardId}\t${parsed.fy}`;
    const list = byGroup.get(key) ?? [];
    list.push(r);
    byGroup.set(key, list);
  }

  const assignments: { id: string; oldNo: string; newNo: string; yardId: string; fy: string }[] = [];

  for (const [key, rows] of byGroup) {
    const [yardId, fy] = key.split("\t");
    const loc = locByYardId.get(yardId) ?? "LOC";
    let nextSeq = await maxRentSeqForYardFy(yardId, fy, loc);
    const sorted = [...rows].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    for (const row of sorted) {
      nextSeq += 1;
      const newNo = formatReceiptNo(loc, fy, RENT_CODE, nextSeq);
      assignments.push({ id: row.id, oldNo: row.receiptNo, newNo, yardId, fy });
    }
  }

  const newNos = assignments.map((a) => a.newNo);
  const clash = await db
    .select({ id: iomsReceipts.id, receiptNo: iomsReceipts.receiptNo })
    .from(iomsReceipts)
    .where(inArray(iomsReceipts.receiptNo, newNos));
  const clashIds = new Set(assignments.map((a) => a.id));
  const blocking = clash.filter((c) => !clashIds.has(c.id));
  if (blocking.length > 0) {
    console.error("Target receipt numbers already exist:");
    for (const b of blocking) console.error(`  ${b.receiptNo} (${b.id})`);
    process.exit(1);
  }

  await db.transaction(async (tx) => {
    for (const a of assignments) {
      await tx
        .update(iomsReceipts)
        .set({ receiptNo: `GAPLMB/_REN_${a.id}` })
        .where(eq(iomsReceipts.id, a.id));
    }
    for (const a of assignments) {
      await tx.update(iomsReceipts).set({ receiptNo: a.newNo }).where(eq(iomsReceipts.id, a.id));
    }

    const counterUpdates = new Map<string, { yardId: string; fy: string; lastSeq: number }>();
    for (const a of assignments) {
      const p = parseUnifiedReceiptNo(a.newNo);
      if (!p) continue;
      const k = `${a.yardId}\t${a.fy}`;
      const cur = counterUpdates.get(k);
      if (!cur || p.seq > cur.lastSeq) counterUpdates.set(k, { yardId: a.yardId, fy: a.fy, lastSeq: p.seq });
    }

    for (const { yardId, fy, lastSeq } of counterUpdates.values()) {
      const [existing] = await tx
        .select({ lastSeq: receiptSequence.lastSeq })
        .from(receiptSequence)
        .where(
          and(
            eq(receiptSequence.yardId, yardId),
            eq(receiptSequence.revenueHead, RENT_HEAD),
            eq(receiptSequence.financialYear, fy),
          ),
        )
        .limit(1);
      const nextCounter = Math.max(Number(existing?.lastSeq ?? 0), lastSeq);
      if (existing) {
        await tx
          .update(receiptSequence)
          .set({ lastSeq: nextCounter })
          .where(
            and(
              eq(receiptSequence.yardId, yardId),
              eq(receiptSequence.revenueHead, RENT_HEAD),
              eq(receiptSequence.financialYear, fy),
            ),
          );
      } else {
        await tx.insert(receiptSequence).values({
          yardId,
          revenueHead: RENT_HEAD,
          financialYear: fy,
          lastSeq: nextCounter,
        });
      }
    }
  });

  console.log(`Renumbered ${assignments.length} M-02 pre-receipt settlement receipt(s):`);
  for (const a of assignments) {
    console.log(`  ${a.oldNo} → ${a.newNo}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
