/**
 * Apply scripts/migrations/002-land-records-immutable.sql (land_records append-only triggers).
 * Usage: npm run db:apply-land-immutable
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const { Client } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlPath = path.join(__dirname, "migrations", "002-land-records-immutable.sql");

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.error("DATABASE_URL is required (use npm run db:apply-land-immutable with .env).");
    process.exit(1);
  }

  const sql = fs.readFileSync(sqlPath, "utf8");
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(sql);
    console.log("Applied:", sqlPath);
    console.log("Triggers: tr_land_records_no_update, tr_land_records_no_delete");
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
