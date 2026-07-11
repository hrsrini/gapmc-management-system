/**
 * Apply scripts/migrations/060-lm-mobile-normalize.sql
 * Fixes LM→App2 mobile sync (no licence-number fake mobiles).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const { Client } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const sqlPath = path.join(__dirname, "migrations", "060-lm-mobile-normalize.sql");
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  const client = new Client({ connectionString: url, statement_timeout: 0 });
  await client.connect();
  try {
    await client.query(fs.readFileSync(sqlPath, "utf8"));
    console.log("Applied:", sqlPath);

    const stats = await client.query(`
      SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE mobile ~ '^[6-9][0-9]{9}$')::int AS valid_10,
        count(*) FILTER (WHERE mobile IS NULL OR btrim(mobile) = '')::int AS blank,
        count(*) FILTER (WHERE mobile ~ '^0+$' OR mobile ~ '^0000')::int AS fake_looking
      FROM gapmc.trader_licences
      WHERE lm_synced_at IS NOT NULL`);
    console.log("After repair:", stats.rows[0]);

    const sample = await client.query(`
      SELECT a.license_number, a.mobile_number AS lm_mobile, t.mobile AS app_mobile
      FROM public.applications a
      JOIN gapmc.trader_licences t ON t.licence_no = a.license_number
      WHERE a.status = 'License Issued'
      ORDER BY a.license_number DESC
      LIMIT 10`);
    console.log("Issued samples:");
    console.table(sample.rows);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
