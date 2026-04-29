/**
 * Runs scripts/wipe-traders-unified-assets-audit.sql (transaction ends ROLLBACK unless COMMIT_WIPE=1).
 *
 * You must set exactly one persistence mode:
 *   COMMIT_WIPE=1  — apply wipe permanently
 *   DRY_RUN=1      — execute same deletes then ROLLBACK (database unchanged)
 *
 * Usage:
 *   npm run db:wipe-traders-entities-audit
 *   npm run db:wipe-traders-entities-audit-dry
 */
import dotenv from "dotenv";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import pg from "pg";

dotenv.config({ path: ".env" });

const commitWipe = process.env.COMMIT_WIPE === "1";
const dryRun = process.env.DRY_RUN === "1";

if (commitWipe && dryRun) {
  console.error("Use either COMMIT_WIPE=1 or DRY_RUN=1, not both.");
  process.exit(1);
}
if (!commitWipe && !dryRun) {
  console.error(`
Refusing to run: persistence is ambiguous (nothing would be saved if we defaulted wrong).

  Persist wipe:  COMMIT_WIPE=1 node scripts/run-wipe-traders-entities-assets-audit.mjs
  Dry run only:  DRY_RUN=1     node scripts/run-wipe-traders-entities-assets-audit.mjs

Or: npm run db:wipe-traders-entities-audit  /  npm run db:wipe-traders-entities-audit-dry
`);
  process.exit(1);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqlPath = join(__dirname, "wipe-traders-unified-assets-audit.sql");

let sql = readFileSync(sqlPath, "utf8");
sql = sql.replace(/^--.*$/gm, "").trim();
if (commitWipe) {
  sql = sql.replace(/\bROLLBACK\s*;/i, "COMMIT;");
}

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(sql);
    if (commitWipe) {
      console.log("Wipe committed.");
    } else {
      console.log(
        "\n*** DRY RUN: transaction ROLLBACK — trader_licences, assets, and related tables were NOT changed. ***\n" +
          "Run: npm run db:wipe-traders-entities-audit  (or COMMIT_WIPE=1) to persist the wipe.\n"
      );
    }
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
