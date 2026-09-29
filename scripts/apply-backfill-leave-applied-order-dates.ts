/**
 * Apply scripts/migrations/072-backfill-leave-applied-order-dates.sql
 * Backfills applied_at / order_date from audit_log (and from_date last-resort for applied_at).
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const { Client } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlPath = path.join(__dirname, "migrations", "072-backfill-leave-applied-order-dates.sql");

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.error("DATABASE_URL is required (use dotenv / .env).");
    process.exit(1);
  }
  const sql = fs.readFileSync(sqlPath, "utf8");
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const before = await client.query(`
      SELECT
        COUNT(*) FILTER (WHERE applied_at IS NULL OR btrim(applied_at) = '')::int AS no_applied,
        COUNT(*) FILTER (
          WHERE status IN ('Approved', 'Superseded')
            AND (order_date IS NULL OR btrim(order_date) = '')
        )::int AS no_order
      FROM gapmc.leave_requests
    `);
    console.log("Before:", before.rows[0]);

    await client.query(sql);
    console.log("Applied:", sqlPath);

    const after = await client.query(`
      SELECT
        COUNT(*) FILTER (WHERE applied_at IS NULL OR btrim(applied_at) = '')::int AS no_applied,
        COUNT(*) FILTER (
          WHERE status IN ('Approved', 'Superseded')
            AND (order_date IS NULL OR btrim(order_date) = '')
        )::int AS no_order,
        COUNT(*) FILTER (WHERE applied_at IS NOT NULL AND btrim(applied_at) <> '')::int AS with_applied,
        COUNT(*) FILTER (WHERE order_date IS NOT NULL AND btrim(order_date) <> '')::int AS with_order
      FROM gapmc.leave_requests
    `);
    console.log("After:", after.rows[0]);

    const sample = await client.query(`
      SELECT id, status, from_date, applied_at, order_date, file_no
      FROM gapmc.leave_requests
      ORDER BY from_date DESC
      LIMIT 8
    `);
    console.log("Sample:");
    for (const r of sample.rows) console.log(r);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
