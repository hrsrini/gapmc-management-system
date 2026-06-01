/**
 * Delete all M-09 correspondence (Dak) data and reset diary/despatch auto sequences.
 *
 * Usage:
 *   npm run db:purge-dak-m09-dry
 *   npm run db:purge-dak-m09
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import { resolveLocalUploadsRoot } from "../server/object-storage";

const SCHEMA = "gapmc";

const M09_TABLES = [
  "dak_escalations",
  "dak_action_log",
  "dak_outward",
  "dak_inward",
  "dak_diary_sequence",
] as const;

function parseArgs(argv: string[]) {
  const dryRun = argv.includes("--dry-run");
  const confirm = argv.includes("--confirm");
  return { dryRun, confirm };
}

async function countTable(client: import("pg").PoolClient, table: string): Promise<number> {
  const r = await client.query<{ c: string }>(`SELECT COUNT(*)::text AS c FROM ${SCHEMA}.${table}`);
  return Number(r.rows[0]?.c ?? 0);
}

function removeLocalDakUploads(dryRun: boolean): void {
  const root = path.join(resolveLocalUploadsRoot(), "dak");
  if (!fs.existsSync(root)) {
    console.log("No local uploads/dak directory — skip file cleanup.");
    return;
  }
  if (dryRun) {
    console.log(`[dry-run] Would remove directory: ${root}`);
    return;
  }
  fs.rmSync(root, { recursive: true, force: true });
  console.log(`Removed local uploads: ${root}`);
}

async function main() {
  const { dryRun, confirm } = parseArgs(process.argv.slice(2));
  if (!dryRun && !confirm) {
    console.error(
      "Refusing to run without --dry-run or --confirm.\n" +
        "  Preview: npm run db:purge-dak-m09-dry\n" +
        "  Execute: npm run db:purge-dak-m09",
    );
    process.exit(1);
  }

  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }

  const pool = new Pool({ connectionString });
  const client = await pool.connect();
  try {
    console.log(dryRun ? "=== DRY RUN: M-09 Dak purge ===" : "=== M-09 Dak purge ===");
    for (const table of M09_TABLES) {
      const n = await countTable(client, table);
      console.log(`  ${table}: ${n} row(s)`);
    }

    if (dryRun) {
      removeLocalDakUploads(true);
      console.log("[dry-run] Would TRUNCATE all M-09 tables listed above.");
      return;
    }

    await client.query("BEGIN");
    await client.query(
      `TRUNCATE TABLE ${M09_TABLES.map((t) => `${SCHEMA}.${t}`).join(", ")} RESTART IDENTITY`,
    );
    await client.query("COMMIT");
    console.log("Truncated M-09 tables (inward, outward, action log, escalations, diary sequence).");

    removeLocalDakUploads(false);
    console.log("Done. Next auto Tapal ref will start at 00001 per scope/year.");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(e);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
