/**
 * Apply scripts/migrations/090-licence-old-new-link.sql then backfill links from LM.
 * Usage: npm run db:apply-licence-old-new-link
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const { Client } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlPath = path.join(__dirname, "migrations", "090-licence-old-new-link.sql");

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
    console.log("Applied:", sqlPath);

    // Dynamic import after columns exist
    const { backfillLicenceOldNewLinks } = await import("../server/licence-old-new-link");
    const result = await backfillLicenceOldNewLinks();
    console.log("Backfill:", result);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
