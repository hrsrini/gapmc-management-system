/**
 * Read-only: verify M-05 §8.4 receipt deposit schema in gapmc.
 * Usage: npm run db:verify-receipt-deposit-schema
 */
import pg from "pg";

const { Client } = pg;

const REQUIRED_TABLES = [
  "gaplmb_bank_accounts",
  "gaplmb_bank_account_yards",
  "gaplmb_bank_account_roles",
  "gaplmb_bank_account_versions",
  "gaplmb_bank_account_yard_mapping_log",
  "receipt_deposit_sequence",
  "receipt_deposits",
  "receipt_deposit_lines",
] as const;

const RECEIPT_COLUMNS = ["deposit_status", "deposit_id", "deposit_deferred_until"] as const;

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.error("DATABASE_URL is required.");
    process.exit(1);
  }

  const client = new Client({ connectionString: url });
  await client.connect();
  let failed = false;

  try {
    const tables = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'gapmc' AND table_name = ANY($1::text[])`,
      [REQUIRED_TABLES],
    );
    const found = new Set(tables.rows.map((r) => r.table_name));
    for (const t of REQUIRED_TABLES) {
      if (found.has(t)) console.log(`OK  table gapmc.${t}`);
      else {
        console.error(`MISSING table gapmc.${t}`);
        failed = true;
      }
    }

    const cols = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'gapmc' AND table_name = 'ioms_receipts'
         AND column_name = ANY($1::text[])`,
      [RECEIPT_COLUMNS],
    );
    const foundCols = new Set(cols.rows.map((r) => r.column_name));
    for (const c of RECEIPT_COLUMNS) {
      if (foundCols.has(c)) console.log(`OK  column ioms_receipts.${c}`);
      else {
        console.error(`MISSING column ioms_receipts.${c}`);
        failed = true;
      }
    }

    const counts = await client.query<{
      bank_accounts: string;
      deposits: string;
      undeposited: string;
      settled: string;
    }>(`
      SELECT
        (SELECT count(*)::text FROM gapmc.gaplmb_bank_accounts) AS bank_accounts,
        (SELECT count(*)::text FROM gapmc.receipt_deposits) AS deposits,
        (SELECT count(*)::text FROM gapmc.ioms_receipts
          WHERE deposit_status = 'Undeposited' AND status IN ('Paid','Reconciled')) AS undeposited,
        (SELECT count(*)::text FROM gapmc.ioms_receipts
          WHERE deposit_status IN ('DepositSettled','AutoSettled')) AS settled
    `);
    const s = counts.rows[0];
    console.log("\nData snapshot:");
    console.log(`  bank_accounts: ${s.bank_accounts}`);
    console.log(`  deposit_batches: ${s.deposits}`);
    console.log(`  undeposited_receipts: ${s.undeposited}`);
    console.log(`  settled_receipts: ${s.settled}`);

    if (failed) {
      console.error("\nSchema verification FAILED — run: npm run db:apply-receipt-deposit-all");
      process.exit(1);
    }
    console.log("\nSchema verification PASSED.");
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
