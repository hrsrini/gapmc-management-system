/**
 * Apply scripts/migrations/058-lm-trader-licence-sync.sql
 * License Manager (public.applications) → gapmc.trader_licences direct sync.
 * Usage: npm run db:apply-m02-lm-trader-licence-sync
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const { Client } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const sqlPath = path.join(__dirname, "migrations", "058-lm-trader-licence-sync.sql");
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.error("DATABASE_URL is required (use dotenv / .env).");
    process.exit(1);
  }
  const sql = fs.readFileSync(sqlPath, "utf8");
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(sql);
    console.log("Applied:", sqlPath);

    const apps = await client.query(`SELECT to_regclass('public.applications') AS reg`);
    const hasApps = Boolean(apps.rows[0]?.reg);
    console.log("public.applications present:", hasApps);

    const cols = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'gapmc' AND table_name = 'trader_licences'
        AND column_name IN ('commodities','lm_status','lm_is_active','lm_license_class','lm_synced_at')
      ORDER BY column_name
    `);
    console.log("LM columns:", cols.rows.map((r) => r.column_name).join(", "));

    if (hasApps) {
      const linked = await client.query(`
        SELECT count(*)::int AS n FROM gapmc.trader_licences WHERE lm_synced_at IS NOT NULL
      `);
      console.log("Linked trader_licences rows:", linked.rows[0]?.n ?? 0);
    }
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
