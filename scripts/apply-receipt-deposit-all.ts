/**
 * Apply M-05 §8.4 migrations 051 + 052 (idempotent).
 * Usage: npm run db:apply-receipt-deposit-all
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const { Client } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, "migrations");

const FILES = ["051-receipt-deposit-workflow.sql", "052-receipt-deposit-extras.sql"] as const;

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.error("DATABASE_URL is required (use dotenv / .env).");
    process.exit(1);
  }
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    for (const file of FILES) {
      const sqlPath = path.join(migrationsDir, file);
      await client.query(fs.readFileSync(sqlPath, "utf8"));
      console.log("Applied:", sqlPath);
    }
    console.log("All receipt-deposit migrations applied.");
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
