/**
 * 1) Backs up all `gapmc` table data (INSERT dump + timestamped copy under db_backups/).
 * 2) TRUNCATEs every other `gapmc` table — removes traders, portal users, transactions, audit, etc.
 *
 * Preserved: yards, commodities, employees (+ HR satellite tables), RBAC (users, roles, …),
 * system_config, sla_config.
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
  "yards",
  "commodities",
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
  "roles",
  "permissions",
  "role_permissions",
  "user_roles",
  "users",
  "user_yards",
  "system_config",
  "sla_config",
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
    const truncateTables = allTables.filter((t) => !KEEP_TABLES.has(t));

    console.log(`Schema ${SCHEMA}: ${allTables.length} base table(s).`);
    console.log(`Keeping ${KEEP_TABLES.size} table name(s) if present; truncating ${truncateTables.length} table(s).`);
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
    console.log("Done. Core masters, employees, RBAC, and configuration rows are unchanged.");
    console.log("portal_users and all other truncated tables are empty.");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
