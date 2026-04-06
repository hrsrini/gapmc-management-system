/**
 * Full PostgreSQL backup (schema + data) via pg_dump → backup_20260404.sql
 * Requires: DATABASE_URL in .env, and `pg_dump` on PATH (PostgreSQL client tools).
 * Run: dotenv -e .env -- npx tsx scripts/backup-full-pg-dump.ts
 */
import "dotenv/config";
import { spawnSync } from "node:child_process";
import * as path from "node:path";

const url = process.env.DATABASE_URL;
if (!url || !String(url).trim()) {
  console.error("DATABASE_URL is not set in .env");
  process.exit(1);
}

const outFile = path.join(process.cwd(), "backup_20260404.sql");

const args = [
  "-d",
  url,
  "--no-owner",
  "--no-acl",
  "--clean",
  "--if-exists",
  "-f",
  outFile,
];

const r = spawnSync("pg_dump", args, {
  stdio: "inherit",
  env: { ...process.env },
  shell: process.platform === "win32",
});

if (r.error) {
  console.error(r.error.message);
  console.error("Install PostgreSQL client tools and ensure pg_dump is on PATH.");
  process.exit(1);
}

if (r.status !== 0) {
  process.exit(r.status ?? 1);
}

console.log("Written:", outFile);
