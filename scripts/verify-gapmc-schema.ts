/**
 * Read-only: verify expected IOMS columns/tables/triggers exist in gapmc schema.
 * Usage: npm run db:verify-schema  (requires .env with DATABASE_URL)
 */
import pg from "pg";

const { Client } = pg;

const REQUIRED_TABLES = [
  "leave_requests",
  "employee_leave_balances",
  "purchase_transactions",
  "dak_escalations",
  "land_records",
  "users",
  "employees",
] as const;

const COLUMN_CHECKS: { table: string; columns: string[] }[] = [
  {
    table: "leave_requests",
    columns: ["do_user", "dv_user", "workflow_revision_count", "dv_return_remarks", "reason", "supporting_document_url"],
  },
  {
    table: "purchase_transactions",
    columns: ["parent_transaction_id", "entry_kind"],
  },
  {
    table: "rent_invoices",
    columns: ["tds_applicable", "tds_amount"],
  },
  {
    table: "ioms_receipts",
    columns: ["tds_amount"],
  },
  {
    table: "ltc_claims",
    columns: ["do_user", "dv_user", "approved_by", "rejection_reason_code", "workflow_revision_count", "dv_return_remarks"],
  },
  {
    table: "employees",
    columns: ["gender", "reporting_officer_employee_id"],
  },
];

const LAND_IMMUTABILITY_TRIGGERS = ["tr_land_records_no_update", "tr_land_records_no_delete"];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url?.trim()) {
    console.error("DATABASE_URL is not set. Use: npm run db:verify-schema (with .env).");
    process.exit(1);
  }

  const client = new Client({ connectionString: url });
  await client.connect();

  try {
    const tables = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'gapmc' AND table_name = ANY($1::text[])`,
      [REQUIRED_TABLES],
    );
    const foundTables = new Set(tables.rows.map((r) => r.table_name));
    const missingTables = REQUIRED_TABLES.filter((t) => !foundTables.has(t));
    if (missingTables.length) {
      console.error("FAIL: Missing tables:", missingTables.join(", "));
      process.exitCode = 1;
    } else {
      console.log("OK: Required tables present:", REQUIRED_TABLES.join(", "));
    }

    for (const { table, columns } of COLUMN_CHECKS) {
      const res = await client.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'gapmc' AND table_name = $1 AND column_name = ANY($2::text[])`,
        [table, columns],
      );
      const have = new Set(res.rows.map((r) => r.column_name));
      const miss = columns.filter((c) => !have.has(c));
      if (miss.length) {
        console.error(`FAIL: gapmc.${table} missing columns:`, miss.join(", "));
        process.exitCode = 1;
      } else {
        console.log(`OK: gapmc.${table} columns:`, columns.join(", "));
      }
    }

    const tr = await client.query<{ tgname: string }>(
      `SELECT t.tgname
       FROM pg_trigger t
       JOIN pg_class c ON t.tgrelid = c.oid
       JOIN pg_namespace n ON c.relnamespace = n.oid
       WHERE n.nspname = 'gapmc' AND c.relname = 'land_records'
         AND NOT t.tgisinternal AND t.tgname = ANY($1::text[])`,
      [LAND_IMMUTABILITY_TRIGGERS],
    );
    const trigNames = new Set(tr.rows.map((r) => r.tgname));
    const missingTr = LAND_IMMUTABILITY_TRIGGERS.filter((n) => !trigNames.has(n));
    if (missingTr.length === LAND_IMMUTABILITY_TRIGGERS.length) {
      console.log(
        "INFO: Land immutability triggers not installed (optional). Apply scripts/migrations/002-land-records-immutable.sql if desired.",
      );
    } else if (missingTr.length) {
      console.warn("WARN: Partial land triggers; missing:", missingTr.join(", "));
    } else {
      console.log("OK: Land immutability triggers:", LAND_IMMUTABILITY_TRIGGERS.join(", "));
    }
  } finally {
    await client.end();
  }

  if (process.exitCode === 1) {
    console.error("\nFix: run npm run db:push (and 001 SQL only if you cannot use push).");
    process.exit(1);
  }
  console.log("\nSchema verification passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
