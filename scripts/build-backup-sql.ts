/**
 * Builds backup_20260404.sql: gapmc schema (drizzle-kit export) + live data (INSERTs)
 * + public.session DDL/data when present. No pg_dump required.
 *
 * Run: npx dotenv-cli -e .env -- npx tsx scripts/build-backup-sql.ts
 */
import "dotenv/config";
import { execSync } from "node:child_process";
import { Pool } from "pg";
import * as fs from "node:fs";
import * as path from "node:path";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const outPath = path.join(process.cwd(), "backup_20260404.sql");

function escapeSqlValue(val: unknown): string {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "boolean") return val ? "true" : "false";
  if (typeof val === "number" && !Number.isNaN(val)) return String(val);
  if (val instanceof Date) return "'" + val.toISOString().replace(/'/g, "''") + "'";
  if (typeof val === "object") return "'" + String(JSON.stringify(val)).replace(/'/g, "''") + "'";
  return "'" + String(val).replace(/'/g, "''") + "'";
}

function quoteIdent(name: string): string {
  return '"' + name.replace(/"/g, '""') + '"';
}

function drizzleExportSql(): string {
  return execSync("npx drizzle-kit export --config drizzle.config.ts", {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
  }).trim();
}

async function main() {
  const lines: string[] = [
    "-- GAPMC full backup (schema + data)",
    `-- Generated: ${new Date().toISOString()}`,
    "-- Schema: gapmc from drizzle-kit export (matches shared/db-schema.ts)",
    "-- Data: live rows from DATABASE_URL",
    "",
    "-- Restore on empty DB: run as superuser or owner of database.",
    "BEGIN;",
    "",
    "DROP SCHEMA IF EXISTS gapmc CASCADE;",
    "",
  ];

  let schemaSql = drizzleExportSql();
  if (schemaSql.startsWith('CREATE SCHEMA "gapmc"')) {
    schemaSql = schemaSql.replace(/^CREATE SCHEMA "gapmc";/m, "").trim();
  }
  lines.push('CREATE SCHEMA "gapmc";');
  lines.push("");
  lines.push(schemaSql);
  lines.push("");

  const pool = new Pool({ connectionString });
  const client = await pool.connect();

  try {
    const sess = await client.query(`SELECT to_regclass('public.session') AS t`);
    if (sess.rows[0]?.t) {
      lines.push("-- ----- public.session (express-session / connect-pg-simple) -----");
      lines.push(`CREATE TABLE IF NOT EXISTS public.session (
  sid varchar NOT NULL,
  sess json NOT NULL,
  expire timestamp(6) NOT NULL,
  CONSTRAINT session_pkey PRIMARY KEY (sid)
);
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON public.session (expire);`);
      lines.push("");

      const colsResult = await client.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'session'
         ORDER BY ordinal_position`
      );
      const sCols = colsResult.rows.map((r: { column_name: string }) => r.column_name);
      if (sCols.length > 0) {
        const quotedCols = sCols.map(quoteIdent).join(", ");
        const res = await client.query(`SELECT * FROM public.session`);
        const sRows = res.rows as Record<string, unknown>[];
        lines.push(`-- public.session: ${sRows.length} rows`);
        if (sRows.length > 0) {
          lines.push("TRUNCATE TABLE public.session;");
          for (const row of sRows) {
            const values = sCols.map((col) => escapeSqlValue(row[col]));
            lines.push(`INSERT INTO public.session (${quotedCols}) VALUES (${values.join(", ")});`);
          }
        }
        lines.push("");
      }
    } else {
      lines.push("-- public.session: not present (sessions not using Postgres store in this DB)");
      lines.push("");
    }

    lines.push("-- ----- gapmc data -----");
    const tablesResult = await client.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'gapmc'
       ORDER BY table_name`
    );
    const tables = tablesResult.rows.map((r: { table_name: string }) => r.table_name);

    lines.push("SET session_replication_role = replica;");

    for (const table of tables) {
      const colsResult = await client.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'gapmc' AND table_name = $1
         ORDER BY ordinal_position`,
        [table]
      );
      const columns = colsResult.rows.map((r: { column_name: string }) => r.column_name);
      const quotedCols = columns.map(quoteIdent).join(", ");
      const tableRef = `gapmc.${quoteIdent(table)}`;

      const res = await client.query(`SELECT * FROM ${tableRef}`);
      const rows = res.rows as Record<string, unknown>[];

      lines.push(`-- gapmc.${table}: ${rows.length} rows`);
      for (const row of rows) {
        const values = columns.map((col) => escapeSqlValue(row[col]));
        lines.push(`INSERT INTO ${tableRef} (${quotedCols}) VALUES (${values.join(", ")});`);
      }
      lines.push("");
    }

    lines.push("SET session_replication_role = DEFAULT;");
    lines.push("");
    lines.push("COMMIT;");
    lines.push("");
  } finally {
    client.release();
    await pool.end();
  }

  fs.writeFileSync(outPath, lines.join("\n"), "utf8");
  console.log("Written:", outPath, `(${Math.round(fs.statSync(outPath).size / 1024)} KB)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
