/**
 * Dry-run pre-receipt billing + M-03 GST backfills (no writes).
 * Usage: npm run go-live:data-backfill-dry-run
 */
import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

function run(label: string, script: string, args: string[]): void {
  console.log(`\n========== ${label} ==========\n`);
  const r = spawnSync("npx", ["tsx", script, ...args], {
    cwd: root,
    stdio: "inherit",
    shell: true,
    env: process.env,
  });
  if (r.status !== 0) {
    console.error(`\nFAILED: ${label}`);
    process.exit(r.status ?? 1);
  }
}

if (!process.env.DATABASE_URL?.trim()) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

console.log("Data backfill dry-run (no changes written)\n");

run("Pre-receipt billing", "scripts/backfill-pre-receipt-billing.ts", ["--dry-run"]);
run("M-03 receipt GST split", "scripts/backfill-m03-receipt-gst-split.ts", ["--dry-run"]);
run("M-03 rent invoice GST", "scripts/backfill-m03-rent-invoice-gst.ts", ["--dry-run"]);

console.log("\nDry-run complete. If fixes are needed, run:");
console.log("  npm run db:backfill-pre-receipt-billing");
console.log("  npm run db:backfill-m03-receipt-gst-split");
console.log("  npm run db:backfill-m03-rent-invoice-gst");
