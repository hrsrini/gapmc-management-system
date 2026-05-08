/**
 * One-off: remove IOMS M-03 rent invoices with zero (or negligible) rent.
 * Skips rows that are Paid, or have an M-03 receipt in Paid/Reconciled (data integrity).
 *
 * Dry-run by default. To execute: COMMIT_DELETE=1 npm run db:delete-m03-zero-rent-invoices
 */
import pg from "pg";

const { Client } = pg;

/** Aligns with shared/rent-invoice-amount-validation.ts */
const RENT_EPS = 0.01;

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.error("DATABASE_URL is required (dotenv via npm script).");
    process.exit(1);
  }
  const commit = String(process.env.COMMIT_DELETE ?? "").trim() === "1";

  const client = new Client({ connectionString: url });
  await client.connect();

  try {
    const candidates = await client.query<{
      id: string;
      invoice_no: string | null;
      period_month: string;
      rent_amount: string;
      total_amount: string;
      status: string;
    }>(
      `SELECT id, invoice_no, period_month, rent_amount::text, total_amount::text, status
       FROM gapmc.rent_invoices
       WHERE coalesce(rent_amount, 0) <= $1`,
      [RENT_EPS],
    );

    const blocked: typeof candidates.rows = [];
    const deletable: typeof candidates.rows = [];

    for (const row of candidates.rows) {
      if (String(row.status) === "Paid") {
        blocked.push(row);
        continue;
      }
      const paidRec = await client.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM gapmc.ioms_receipts
         WHERE source_module = 'M-03'
           AND source_record_id = $1
           AND status IN ('Paid', 'Reconciled')`,
        [row.id],
      );
      if (Number(paidRec.rows[0]?.c ?? 0) > 0) {
        blocked.push(row);
        continue;
      }
      deletable.push(row);
    }

    console.log(`Found ${candidates.rows.length} invoice(s) with rent ≤ ${RENT_EPS} INR.`);
    console.log(`${deletable.length} eligible for deletion; ${blocked.length} skipped (Paid invoice or Paid/Reconciled receipt).`);

    if (blocked.length > 0) {
      console.log("\nSkipped (not deleted):");
      for (const r of blocked) {
        console.log(`  ${r.id}  ${r.invoice_no ?? "(no number)"}  ${r.period_month}  status=${r.status}`);
      }
    }

    if (deletable.length > 0) {
      console.log("\nEligible for deletion:");
      for (const r of deletable) {
        console.log(`  ${r.id}  ${r.invoice_no ?? "(no number)"}  ${r.period_month}  rent=${r.rent_amount} total=${r.total_amount}  status=${r.status}`);
      }
    }

    if (!commit) {
      console.log("\nDry run only. Re-run with COMMIT_DELETE=1 to delete eligible rows.");
      return;
    }

    const ids = deletable.map((r) => r.id);
    if (ids.length === 0) {
      console.log("\nNothing to delete.");
      return;
    }

    await client.query("BEGIN");
    try {
      const delRc = await client.query(
        `DELETE FROM gapmc.ioms_receipts
         WHERE source_module = 'M-03' AND source_record_id = ANY($1::text[])`,
        [ids],
      );
      const delLd = await client.query(
        `DELETE FROM gapmc.rent_deposit_ledger WHERE invoice_id = ANY($1::text[])`,
        [ids],
      );
      const delCn = await client.query(
        `DELETE FROM gapmc.credit_notes WHERE invoice_id = ANY($1::text[])`,
        [ids],
      );
      const delInv = await client.query(`DELETE FROM gapmc.rent_invoices WHERE id = ANY($1::text[])`, [ids]);

      await client.query("COMMIT");
      console.log("\nCommitted:");
      console.log(`  ioms_receipts removed: ${delRc.rowCount ?? 0}`);
      console.log(`  rent_deposit_ledger removed: ${delLd.rowCount ?? 0}`);
      console.log(`  credit_notes removed: ${delCn.rowCount ?? 0}`);
      console.log(`  rent_invoices removed: ${delInv.rowCount ?? 0}`);
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    }
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
