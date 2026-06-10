/**
 * Apply scripts/migrations/054-m02-premises-master-fields.sql.
 * Usage: npm run db:apply-m02-premises-master-fields
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const { Client } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const sqlPath = path.join(__dirname, "migrations", "054-m02-premises-master-fields.sql");
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.error("DATABASE_URL is required (use dotenv / .env).");
    process.exit(1);
  }
  const sqlBuffer = fs.readFileSync(sqlPath, "utf8");
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(sqlBuffer);
    const cols = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'gapmc' AND table_name = 'assets'
        AND column_name IN ('premises_location','property_tax_authority','house_no','electricity_connection_type','water_connection_type','consumer_id')
      ORDER BY column_name
    `);
    const status = await client.query(`
      SELECT premises_status, count(*)::int AS cnt FROM gapmc.assets GROUP BY premises_status ORDER BY premises_status
    `);
    console.log("Applied:", sqlPath);
    console.log("New columns:", cols.rows.map((r) => r.column_name).join(", "));
    console.log("Premises status counts:", status.rows);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
