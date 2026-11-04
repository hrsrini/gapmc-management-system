/**
 * Apply scripts/migrations/079-vehicle-categories.sql
 * Usage: npm run db:apply-vehicle-categories
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const { Client } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlPath = path.join(__dirname, "migrations", "079-vehicle-categories.sql");

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.error("DATABASE_URL is required (use dotenv / .env).");
    process.exit(1);
  }
  const sql = fs.readFileSync(sqlPath, "utf8");
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 30000 });
  await client.connect();
  try {
    await client.query(sql);
    const cnt = await client.query(`SELECT COUNT(*)::int AS n FROM gapmc.vehicle_categories`);
    console.log("Applied:", sqlPath);
    console.log("vehicle_categories rows:", cnt.rows[0]?.n);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
