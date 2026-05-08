/**
 * Apply scripts/migrations/040-m04-purchase-trader-snapshots.sql
 * Usage: npm run db:apply-m04-purchase-trader-snapshots
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const { Client } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlPath = path.join(__dirname, "migrations", "040-m04-purchase-trader-snapshots.sql");

function splitSqlStatements(sqlText: string): string[] {
  const noComments = sqlText
    .split(/\r?\n/)
    .filter((line) => !/^\s*--/.test(line))
    .join("\n");
  return noComments
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.error("DATABASE_URL is required (use dotenv / .env).");
    process.exit(1);
  }
  const sqlText = fs.readFileSync(sqlPath, "utf8");
  const statements = splitSqlStatements(sqlText);
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    let i = 0;
    for (const stmt of statements) {
      i += 1;
      try {
        const r = await client.query(stmt + ";");
        console.log(`Statement ${i}/${statements.length}: rows affected`, r.rowCount ?? 0);
      } catch (e: unknown) {
        const err = e as { code?: string; message?: string };
        if (err.code === "42703") {
          console.warn(
            `Statement ${i}/${statements.length}: failed (missing column). Apply 038 first: npm run db:apply-m02-us-m02-001-trader-licence-identity`,
          );
          console.warn(String(err.message ?? e));
          process.exit(1);
        }
        throw e;
      }
    }
    console.log("Done:", sqlPath);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
