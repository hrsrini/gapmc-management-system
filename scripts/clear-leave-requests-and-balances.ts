/**
 * Backup then clear gapmc.leave_requests and gapmc.employee_leave_balances.
 * Usage: dotenv -e .env -- tsx scripts/clear-leave-requests-and-balances.ts
 */
import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { Pool } from "pg";

const TABLES = ["leave_requests", "employee_leave_balances"] as const;

function escapeSqlValue(val: unknown): string {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "boolean") return val ? "true" : "false";
  if (typeof val === "number" && !Number.isNaN(val)) return String(val);
  if (typeof val === "object") return "'" + String(JSON.stringify(val)).replace(/'/g, "''") + "'";
  return "'" + String(val).replace(/'/g, "''") + "'";
}

function quoteIdent(name: string): string {
  return '"' + name.replace(/"/g, '""') + '"';
}

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url, statement_timeout: 0 });
  const client = await pool.connect();
  try {
    await client.query("SET statement_timeout = 0");

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const outDir = path.join(process.cwd(), "db_backups");
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `leave-requests-balances-before-clear-${stamp}.sql`);
    const lines: string[] = [
      "-- Backup of leave_requests + employee_leave_balances before clear",
      `-- Generated: ${new Date().toISOString()}`,
      "",
      "BEGIN;",
      "",
    ];

    for (const table of TABLES) {
      const colsResult = await client.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'gapmc' AND table_name = $1
         ORDER BY ordinal_position`,
        [table],
      );
      const columns = colsResult.rows.map((r: { column_name: string }) => r.column_name);
      const quotedCols = columns.map(quoteIdent).join(", ");
      const tableRef = `gapmc.${quoteIdent(table)}`;
      const res = await client.query(`SELECT * FROM ${tableRef}`);
      const rows = res.rows as Record<string, unknown>[];
      lines.push(`-- Table ${tableRef}: ${rows.length} row(s)`);
      for (const row of rows) {
        const values = columns.map((col) => escapeSqlValue(row[col]));
        lines.push(`INSERT INTO ${tableRef} (${quotedCols}) VALUES (${values.join(", ")});`);
      }
      lines.push("");
      console.log(`${table}: ${rows.length} rows backed up`);
    }

    lines.push("COMMIT;", "");
    fs.writeFileSync(outPath, lines.join("\n"), "utf8");
    console.log("Backup written:", outPath);

    await client.query("BEGIN");
    await client.query("TRUNCATE TABLE gapmc.leave_requests RESTART IDENTITY CASCADE");
    await client.query("TRUNCATE TABLE gapmc.employee_leave_balances RESTART IDENTITY CASCADE");
    await client.query("COMMIT");

    for (const table of TABLES) {
      const r = await client.query(`SELECT count(*)::int AS c FROM gapmc.${table}`);
      console.log(`${table} after clear: ${r.rows[0].c}`);
    }
    console.log("Done.");
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
