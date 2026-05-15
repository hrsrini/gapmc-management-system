/**
 * Apply designation master migrations:
 *   044-designation-master.sql (table + legacy ADMIN/STAFF seeds)
 *   045-designation-master-gapmc-reference.sql (official GAPMC reference rows)
 * Usage: npm run db:apply-designation-master
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const { Client } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const FILES = ["044-designation-master.sql", "045-designation-master-gapmc-reference.sql"] as const;

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
      const sqlPath = path.join(__dirname, "migrations", file);
      const sql = fs.readFileSync(sqlPath, "utf8");
      await client.query(sql);
      console.log("Applied:", sqlPath);
    }
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
