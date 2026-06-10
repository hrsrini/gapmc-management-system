/**
 * Apply scripts/migrations/055-m02-allotment-date.sql.
 * Usage: npm run db:apply-m02-allotment-date
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const { Client } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const sqlPath = path.join(__dirname, "migrations", "055-m02-allotment-date.sql");
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
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'gapmc'
        AND table_name IN ('entity_allotments', 'asset_allotments')
        AND column_name = 'allotment_date'
      ORDER BY table_name
    `);
    console.log("Applied:", sqlPath);
    console.log("allotment_date columns:", cols.rows);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
