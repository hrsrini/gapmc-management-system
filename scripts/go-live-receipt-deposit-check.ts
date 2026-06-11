/**
 * Orchestrates go-live checks for M-05 §8.4 (run on each environment after deploy).
 * Usage: npm run go-live:receipt-deposit-check
 *
 * Steps:
 *  1. Apply migrations 051+052 (skip with --verify-only)
 *  2. Verify schema
 *  3. SIT read-only pre-checks
 *  4. Notify smoke (skip with --no-notify)
 */
import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const args = new Set(process.argv.slice(2));
const verifyOnly = args.has("--verify-only");
const noNotify = args.has("--no-notify");

function run(label: string, script: string, extraArgs: string[] = []): void {
  console.log(`\n========== ${label} ==========\n`);
  const r = spawnSync("npx", ["tsx", script, ...extraArgs], {
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

console.log("GAPLMB IOMS — M-05 §8.4 receipt deposit go-live check");
console.log(`Environment DATABASE_URL: ${process.env.DATABASE_URL ? "(set)" : "(MISSING)"}`);

if (!process.env.DATABASE_URL?.trim()) {
  console.error("Set DATABASE_URL in .env before running.");
  process.exit(1);
}

if (!verifyOnly) {
  run("Step 1/4 — Apply migrations 051+052", "scripts/apply-receipt-deposit-all.ts");
} else {
  console.log("\nSkipping migration apply (--verify-only).\n");
}

run("Step 2/4 — Verify schema", "scripts/verify-receipt-deposit-schema.ts");
run("Step 3/4 — SIT pre-checks", "scripts/sit-receipt-deposit-workflow.ts");

if (!noNotify) {
  run("Step 4/4 — Notify smoke", "scripts/smoke-receipt-deposit-notify.ts");
} else {
  console.log("\nSkipping notify smoke (--no-notify).\n");
}

console.log("\n========== Go-live check complete ==========");
console.log("Next: manual UAT per docs/test_plan.csv TP-M05-007 through TP-M05-011");
console.log(
  "Staging/prod: configure Gmail SMTP under Admin → Config (enable, app password, default notify inbox) and redeploy.",
);
