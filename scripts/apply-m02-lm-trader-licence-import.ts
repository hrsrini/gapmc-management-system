/**
 * Apply scripts/migrations/059-lm-trader-licence-import.sql
 * Completes License Manager → gapmc.trader_licences: INSERT missing rows + yard map.
 * Usage: npm run db:apply-m02-lm-trader-licence-import
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const { Client } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const sqlPath = path.join(__dirname, "migrations", "059-lm-trader-licence-import.sql");
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.error("DATABASE_URL is required (use dotenv / .env).");
    process.exit(1);
  }
  const sql = fs.readFileSync(sqlPath, "utf8");
  const client = new Client({ connectionString: url, statement_timeout: 0 });
  await client.connect();
  try {
    await client.query("SET statement_timeout = 0");
    await client.query(sql);
    console.log("Applied:", sqlPath);

    const apps = await client.query(`SELECT to_regclass('public.applications') AS reg`);
    const hasApps = Boolean(apps.rows[0]?.reg);
    console.log("public.applications present:", hasApps);

    if (hasApps) {
      const lm = await client.query(`
        SELECT count(*)::int AS n
        FROM public.applications
        WHERE license_number IS NOT NULL
          AND btrim(license_number::text) <> ''
          AND status IN ('License Issued', 'License Expired')`);
      const tl = await client.query(`SELECT count(*)::int AS n FROM gapmc.trader_licences`);
      const linked = await client.query(`
        SELECT count(*)::int AS n FROM gapmc.trader_licences WHERE lm_synced_at IS NOT NULL`);
      const active = await client.query(`
        SELECT count(*)::int AS n FROM gapmc.trader_licences WHERE lm_is_active = true`);
      const gap = await client.query(`
        SELECT count(*)::int AS n
        FROM public.applications a
        LEFT JOIN gapmc.trader_licences t ON t.licence_no = a.license_number
        WHERE a.license_number IS NOT NULL
          AND btrim(a.license_number::text) <> ''
          AND a.status IN ('License Issued', 'License Expired')
          AND t.licence_no IS NULL`);
      console.log("LM issued/expired:", lm.rows[0]?.n ?? 0);
      console.log("trader_licences total:", tl.rows[0]?.n ?? 0);
      console.log("LM-linked rows:", linked.rows[0]?.n ?? 0);
      console.log("lm_is_active=true:", active.rows[0]?.n ?? 0);
      console.log("LM still missing in App 2:", gap.rows[0]?.n ?? 0);

      const sample = await client.query(`
        SELECT licence_no, firm_name, status, lm_status, lm_is_active, lm_license_class, yard_id, valid_to
        FROM gapmc.trader_licences
        WHERE lm_synced_at IS NOT NULL
        ORDER BY lm_is_active DESC NULLS LAST, licence_no DESC
        LIMIT 5`);
      console.log("Sample linked:");
      console.table(sample.rows);
    }
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
