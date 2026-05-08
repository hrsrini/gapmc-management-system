/**
 * Backfill gapmc.purchase_transactions.transaction_no where null/blank,
 * and seed gapmc.purchase_transaction_sequence so new numbers continue after max.
 *
 * Run after: npm run db:apply-m04-purchase-transaction-sequence
 * Usage: npm run db:apply-m04-purchase-transaction-no-backfill
 */
import pg from "pg";
import {
  financialYearFromIsoTransactionDate,
} from "../server/market-purchase-transaction-no";

const { Client } = pg;

const TXN_NO_RE = /^GAPLMB\/[^/]+\/([^/]+)\/PT\/(\d+)$/;

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.error("DATABASE_URL is required.");
    process.exit(1);
  }
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const { rows: existing } = await client.query<{
      id: string;
      yard_id: string;
      transaction_date: string;
      transaction_no: string | null;
    }>(
      `SELECT id, yard_id, transaction_date, transaction_no
       FROM gapmc.purchase_transactions
       WHERE transaction_no IS NOT NULL AND trim(transaction_no) <> ''`,
    );

    const maxByKey = new Map<string, number>();
    for (const r of existing) {
      const m = String(r.transaction_no).trim().match(TXN_NO_RE);
      if (!m) continue;
      const fy = m[1];
      const seq = parseInt(m[2], 10);
      if (!Number.isFinite(seq)) continue;
      const k = `${r.yard_id}\t${fy}`;
      maxByKey.set(k, Math.max(maxByKey.get(k) ?? 0, seq));
    }

    const { rows: missing } = await client.query<{
      id: string;
      yard_id: string;
      transaction_date: string;
    }>(
      `SELECT id, yard_id, transaction_date
       FROM gapmc.purchase_transactions
       WHERE transaction_no IS NULL OR trim(transaction_no) = ''
       ORDER BY transaction_date ASC, id ASC`,
    );

    let assigned = 0;
    for (const r of missing) {
      const fy = financialYearFromIsoTransactionDate(String(r.transaction_date).slice(0, 10));
      const k = `${r.yard_id}\t${fy}`;
      const next = (maxByKey.get(k) ?? 0) + 1;
      maxByKey.set(k, next);

      const [yardRow] = (
        await client.query<{ code: string | null }>(`SELECT code FROM gapmc.yards WHERE id = $1 LIMIT 1`, [r.yard_id])
      ).rows;
      const locRaw =
        yardRow?.code != null && String(yardRow.code).trim() !== "" ? String(yardRow.code).trim() : "LOC";
      const loc = locRaw.replace(/[^\w-]+/g, "").toUpperCase() || "LOC";
      const transactionNo = `GAPLMB/${loc}/${fy}/PT/${String(next).padStart(5, "0")}`;

      await client.query(`UPDATE gapmc.purchase_transactions SET transaction_no = $1 WHERE id = $2`, [
        transactionNo,
        r.id,
      ]);
      assigned += 1;
    }

    for (const [k, lastSeq] of maxByKey) {
      const [yardId, fy] = k.split("\t");
      await client.query(
        `INSERT INTO gapmc.purchase_transaction_sequence (yard_id, financial_year, last_seq)
         VALUES ($1, $2, $3)
         ON CONFLICT (yard_id, financial_year) DO UPDATE SET last_seq = GREATEST(
           gapmc.purchase_transaction_sequence.last_seq,
           EXCLUDED.last_seq
         )`,
        [yardId, fy, lastSeq],
      );
    }

    console.log(`Backfill: assigned transaction_no to ${assigned} row(s); sequence keys updated: ${maxByKey.size}`);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
