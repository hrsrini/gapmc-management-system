/**
 * 1) Backs up all `gapmc` table data (INSERT dump + timestamped copy under db_backups/).
 * 2) TRUNCATEs every other `gapmc` table.
 *
 * Preserved (user retain list):
 * 1. Roles — roles, permissions, role_permissions, user_roles, users, user_yards
 * 2. Locations — yards
 * 3. Config & PDF Logo — system_config, sla_config
 * 4. Unit Master — measurement_units
 * 5. Finance Mapping — tally_ledgers, govt_gst_exempt_categories, ioms_revenue_head_ledger_map
 * 6. Designation Master — designation_master
 * 7. Employee data — employees + HR satellite tables
 * 8. Commodities (M-04) — commodities
 * 9–10. Tapal Inward/Outward (M-09) — dak_inward, dak_outward + related dak logs/sequence
 *
 * Usage:
 *   npm run db:purge-retain-core-dry
 *   npm run db:purge-retain-core
 */
import "dotenv/config";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { Pool } from "pg";

const SCHEMA = "gapmc";

/** Tables whose rows are kept (snake_case, as in PostgreSQL). */
const KEEP_TABLES = new Set([
  // 1. Roles / RBAC (+ login users & yard scope)
  "roles",
  "permissions",
  "role_permissions",
  "user_roles",
  "users",
  "user_yards",
  // 2. Locations
  "yards",
  // 3. Config & PDF Logo
  "system_config",
  "sla_config",
  // 4. Unit Master
  "measurement_units",
  // 5. Finance Mapping
  "tally_ledgers",
  "govt_gst_exempt_categories",
  "ioms_revenue_head_ledger_map",
  // 6. Designation Master
  "designation_master",
  // 7. Employee data
  "employees",
  "employee_contracts",
  "employee_documents",
  "service_book_entries",
  "leave_requests",
  "employee_leave_balances",
  "attendances",
  "timesheets",
  "tour_programmes",
  "ltc_claims",
  "ta_da_claims",
  // 8. Commodities (IOMS M-04)
  "commodities",
  // 9–10. Tapal Inward / Outward (IOMS M-09) live data
  "dak_inward",
  "dak_outward",
  "dak_action_log",
  "dak_escalations",
  "dak_diary_sequence",
]);

function quoteIdent(ident: string): string {
  return `"${ident.replace(/"/g, '""')}"`;
}

function parseArgs(argv: string[]) {
  const dryRun = argv.includes("--dry-run");
  const confirm = argv.includes("--confirm");
  return { dryRun, confirm };
}

async function main() {
  const { dryRun, confirm } = parseArgs(process.argv.slice(2));
  if (!dryRun && !confirm) {
    console.error(
      "Refusing to run without --dry-run or --confirm.\n" +
        "  Preview: npm run db:purge-retain-core-dry\n" +
        "  Execute: npm run db:purge-retain-core"
    );
    process.exit(1);
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }

  const pool = new Pool({ connectionString });
  const client = await pool.connect();
  try {
    const tablesResult = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = $1 AND table_type = 'BASE TABLE'
       ORDER BY table_name`,
      [SCHEMA]
    );
    const allTables = tablesResult.rows.map((r) => r.table_name);
    const keepPresent = allTables.filter((t) => KEEP_TABLES.has(t));
    const truncateTables = allTables.filter((t) => !KEEP_TABLES.has(t));

    console.log(`Schema ${SCHEMA}: ${allTables.length} base table(s).`);
    console.log(`Keeping ${keepPresent.length} table(s): ${keepPresent.join(", ")}`);
    console.log(`Truncating ${truncateTables.length} table(s).`);
    if (truncateTables.length > 0) {
      console.log("Truncate:", truncateTables.join(", "));
    }

    if (dryRun) {
      console.log("\nDry run only — no backup and no TRUNCATE.");
      return;
    }

    const root = process.cwd();
    const backupDir = path.join(root, "db_backups");
    fs.mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");

    console.log("\nRunning npm run db:backup-data …");
    execSync("npm run db:backup-data", { cwd: root, stdio: "inherit", env: process.env });

    const defaultDump = path.join(root, "db_table_backup.sql");
    if (!fs.existsSync(defaultDump)) {
      console.error("Expected db_table_backup.sql after backup; aborting without TRUNCATE.");
      process.exit(1);
    }
    const stamped = path.join(backupDir, `gapmc-data-before-purge-${stamp}.sql`);
    fs.copyFileSync(defaultDump, stamped);
    console.log("Timestamped copy:", stamped);

    if (truncateTables.length === 0) {
      console.log("Nothing to truncate.");
      return;
    }

    const qualified = truncateTables.map((t) => `${quoteIdent(SCHEMA)}.${quoteIdent(t)}`).join(", ");
    const sql = `TRUNCATE TABLE ${qualified} RESTART IDENTITY CASCADE`;
    console.log("\nExecuting TRUNCATE …");
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    }
    console.log("Done. Retained masters / employees / RBAC / config / commodities / Tapal are unchanged.");
    console.log("All other gapmc tables are empty.");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
