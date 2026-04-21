/**
 * Apply scripts/migrations/003-dak-attachments.sql (dak_inward / dak_outward attachments JSONB).
 * Usage: npm run db:apply-dak-attachments
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const { Client } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlPath = path.join(__dirname, "migrations", "003-dak-attachments.sql");

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.error("DATABASE_URL is required (use npm run db:apply-dak-attachments with .env).");
    process.exit(1);
  }

  const sql = fs.readFileSync(sqlPath, "utf8");
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(sql);
    console.log("Applied:", sqlPath);
    console.log("Columns: gapmc.dak_inward.attachments, gapmc.dak_outward.attachments");
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
