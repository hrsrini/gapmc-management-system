/**
 * Runs scripts/wipe-traders-unified-assets-audit.sql with edits:
 * - Strips header comments and the trailing ROLLBACK; uses COMMIT instead.
 * Or set env COMMIT_WIPE=1 to append COMMIT (file uses ROLLBACK by default for safety).
 *
 * Usage: node scripts/run-wipe-traders-entities-assets-audit.mjs
 *        COMMIT_WIPE=1 node scripts/run-wipe-traders-entities-assets-audit.mjs
 */
import dotenv from "dotenv";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import pg from "pg";

dotenv.config({ path: ".env" });

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqlPath = join(__dirname, "wipe-traders-unified-assets-audit.sql");

let sql = readFileSync(sqlPath, "utf8");
sql = sql.replace(/^--.*$/gm, "").trim();
if (process.env.COMMIT_WIPE === "1") {
  sql = sql.replace(/\bROLLBACK\s*;/i, "COMMIT;");
} else {
  // keep ROLLBACK from file (dry run)
}

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(sql);
    if (process.env.COMMIT_WIPE === "1") {
      console.log("Wipe committed.");
    } else {
      console.log("Dry run: script ended with ROLLBACK (set COMMIT_WIPE=1 to commit).");
    }
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
