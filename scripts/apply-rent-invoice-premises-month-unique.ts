/**
 * Apply scripts/migrations/045-rent-invoice-premises-month-unique.sql
 * (normalize asset_id + unique index on premises + billing month).
 *
 * If duplicate non-cancelled rows remain, exits with instructions to run
 * `COMMIT_CANCEL=1 npm run db:cancel-m03-duplicate-invoices` first.
 *
 * Usage: npm run db:apply-rent-invoice-premises-month-unique
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const { Client } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const sqlPath = path.join(__dirname, "migrations", "045-rent-invoice-premises-month-unique.sql");
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.error("DATABASE_URL is required (use dotenv / .env).");
    process.exit(1);
  }

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const normalizeSql = `
      UPDATE gapmc.rent_invoices ri
      SET asset_id = a.id
      FROM gapmc.assets a
      WHERE trim(ri.asset_id) = trim(a.asset_id)
        AND ri.asset_id IS DISTINCT FROM a.id;
    `;
    const norm = await client.query(normalizeSql);
    console.log(`Normalized rent_invoices.asset_id rows: ${norm.rowCount ?? 0}`);

    const dup = await client.query<{ asset_id: string; period_month: string; cnt: string }>(
      `SELECT asset_id, period_month, COUNT(*)::text AS cnt
       FROM gapmc.rent_invoices
       WHERE COALESCE(TRIM(status), '') <> 'Cancelled'
       GROUP BY asset_id, period_month
       HAVING COUNT(*) > 1`,
    );
    if (dup.rows.length > 0) {
      console.error(
        `\nCannot create unique index: ${dup.rows.length} duplicate premises/month group(s) still exist.`,
      );
      for (const r of dup.rows.slice(0, 20)) {
        console.error(`  asset_id=${r.asset_id} period_month=${r.period_month} count=${r.cnt}`);
      }
      if (dup.rows.length > 20) console.error(`  … and ${dup.rows.length - 20} more`);
      console.error(
        "\nResolve with:\n  npm run db:cancel-m03-duplicate-invoices\n  COMMIT_CANCEL=1 npm run db:cancel-m03-duplicate-invoices\n  npm run db:apply-rent-invoice-premises-month-unique",
      );
      process.exit(1);
    }

    const indexSql = `
      CREATE UNIQUE INDEX IF NOT EXISTS ux_rent_invoices_asset_period_active
        ON gapmc.rent_invoices (asset_id, period_month)
        WHERE status IS DISTINCT FROM 'Cancelled';
    `;
    await client.query(indexSql);
    console.log("Applied unique index ux_rent_invoices_asset_period_active");
    console.log("Done:", sqlPath);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
