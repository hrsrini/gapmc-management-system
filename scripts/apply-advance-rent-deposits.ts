/**
 * Apply migration 083 (advance rent deposits + payment adjustments).
 * Usage: npm run db:apply-advance-rent-deposits
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const { Client } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.error("DATABASE_URL is required.");
    process.exit(1);
  }
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const sqlPath = path.join(__dirname, "migrations", "083-advance-rent-deposits.sql");
    await client.query(fs.readFileSync(sqlPath, "utf8"));
    console.log("Applied:", sqlPath);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
