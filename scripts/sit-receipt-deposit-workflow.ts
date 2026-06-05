/**
 * SIT checklist (read-only) for TP-M05-007–011 / FR-RCP-010–014.
 * Usage: npm run sit:receipt-deposit-workflow
 */
import pg from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const { Client } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

type Check = { id: string; label: string; ok: boolean; detail: string };

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.error("DATABASE_URL is required.");
    process.exit(1);
  }

  const checks: Check[] = [];

  const uiRoutes = [
    "client/src/pages/receipts/AdminBankAccounts.tsx",
    "client/src/pages/receipts/ReceiptDepositEntry.tsx",
    "client/src/pages/receipts/ReceiptCashInHand.tsx",
    "client/src/pages/receipts/ReceiptDepositRegister.tsx",
  ];
  for (const rel of uiRoutes) {
    const exists = fs.existsSync(path.join(root, rel));
    checks.push({
      id: "UI",
      label: rel,
      ok: exists,
      detail: exists ? "present" : "missing",
    });
  }

  const serverFiles = [
    "server/receipt-deposit-service.ts",
    "server/routes-receipt-deposits.ts",
    "server/cron-receipt-deposit.ts",
  ];
  for (const rel of serverFiles) {
    const exists = fs.existsSync(path.join(root, rel));
    checks.push({
      id: "API",
      label: rel,
      ok: exists,
      detail: exists ? "present" : "missing",
    });
  }

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const tables = await client.query<{ cnt: string }>(`
        SELECT count(*)::text AS cnt FROM information_schema.tables
        WHERE table_schema = 'gapmc' AND table_name = 'receipt_deposits'
      `);
    const hasDepositsTable = Number(tables.rows[0]?.cnt ?? 0) > 0;
    checks.push({
      id: "DB",
      label: "receipt_deposits table",
      ok: hasDepositsTable,
      detail: hasDepositsTable ? "exists" : "missing — run db:apply-receipt-deposit-all",
    });

    const workflow = await client.query<{
      bank_accounts: string;
      pending_verify: string;
      pending_approve: string;
      approved: string;
      reversed: string;
      undeposited: string;
      deferred: string;
      not_cleared: string;
    }>(`
      SELECT
        (SELECT count(*)::text FROM gapmc.gaplmb_bank_accounts WHERE is_active) AS bank_accounts,
        (SELECT count(*)::text FROM gapmc.receipt_deposits WHERE status = 'DepositedPendingVerification') AS pending_verify,
        (SELECT count(*)::text FROM gapmc.receipt_deposits WHERE status = 'VerifiedPendingApproval') AS pending_approve,
        (SELECT count(*)::text FROM gapmc.receipt_deposits WHERE status = 'ApprovedSettled') AS approved,
        (SELECT count(*)::text FROM gapmc.receipt_deposits WHERE status = 'Reversed') AS reversed,
        (SELECT count(*)::text FROM gapmc.ioms_receipts
          WHERE deposit_status = 'Undeposited' AND status IN ('Paid','Reconciled')
            AND payment_mode IN ('Cash','Cheque','DD')) AS undeposited,
        (SELECT count(*)::text FROM gapmc.ioms_receipts
          WHERE deposit_status = 'Undeposited' AND deposit_deferred_until > current_date::text) AS deferred,
        (SELECT count(*)::text FROM gapmc.ioms_receipts WHERE deposit_status = 'NotCleared') AS not_cleared
    `);
    const w = workflow.rows[0];
    console.log("=== M-05 Receipt deposit SIT (automated read-only) ===\n");
    console.log("Manual UI steps (TP-M05-007–011):");
    console.log("  1. /admin/bank-accounts — create/list bank account");
    console.log("  2. /receipts/ioms/deposit-entry — batch undeposited receipts");
    console.log("  3. /receipts/ioms/cash-in-hand — totals, defer, EOD summary");
    console.log("  4. /receipts/ioms/deposits — DV verify, DA approve/reject/reverse");
    console.log("  5. Receipt detail — mark cheque Reversed after settled deposit\n");

    console.log("Workflow counts:");
    console.log(`  active bank accounts: ${w.bank_accounts}`);
    console.log(`  deposits pending DV verify: ${w.pending_verify}`);
    console.log(`  deposits pending DA approve: ${w.pending_approve}`);
    console.log(`  deposits approved/settled: ${w.approved}`);
    console.log(`  deposits reversed: ${w.reversed}`);
    console.log(`  undeposited receipts (due): ${w.undeposited}`);
    console.log(`  deferred receipts: ${w.deferred}`);
    console.log(`  not-cleared receipts: ${w.not_cleared}\n`);

    if (Number(w.bank_accounts) === 0) {
      console.warn("\nWARN: No bank accounts yet — create one at /admin/bank-accounts before manual deposit UAT.");
    }

    console.log("\nFile / schema checks:");
    let failed = false;
    for (const c of checks) {
      const mark = c.ok ? "PASS" : "FAIL";
      console.log(`  [${mark}] ${c.label}: ${c.detail}`);
      if (!c.ok) failed = true;
    }

    if (failed) {
      console.error("\nSIT pre-checks FAILED (fix above before manual UAT).");
      process.exit(1);
    }
    console.log("\nSIT pre-checks PASSED — proceed with manual UI walkthrough.");
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
