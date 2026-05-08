/**
 * Cancel historical M-03 duplicate rent invoices: same premises (`asset_id`) + `period_month`
 * with more than one non-Cancelled row. Keeps one canonical invoice per group and sets others to Cancelled.
 *
 * Keeper priority:
 *   1. Unique invoice with Paid/Reconciled M-03 receipt (if exactly one such invoice).
 *   2. Else unique row with status Paid (if exactly one).
 *   3. Else earliest `approved_at`, then lexicographically smallest `id`.
 *
 * Skips cancelling any invoice that has its own Paid/Reconciled receipt when it is not the keeper
 *   (manual resolution required). Skips groups where multiple invoices each have settled receipts.
 *
 * Dry-run by default. Execute: COMMIT_CANCEL=1 npm run db:cancel-m03-duplicate-invoices
 */
import pg from "pg";

const { Client } = pg;

type InvRow = {
  id: string;
  invoice_no: string | null;
  asset_id: string;
  period_month: string;
  status: string;
  approved_at: string | null;
};

async function hasPaidM03Receipt(client: InstanceType<typeof Client>, invoiceId: string): Promise<boolean> {
  const r = await client.query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM gapmc.ioms_receipts
     WHERE source_module = 'M-03' AND source_record_id = $1
       AND status IN ('Paid', 'Reconciled')`,
    [invoiceId],
  );
  return Number(r.rows[0]?.c ?? 0) > 0;
}

async function pendingM03ReceiptIds(client: InstanceType<typeof Client>, invoiceId: string): Promise<string[]> {
  const r = await client.query<{ id: string }>(
    `SELECT id FROM gapmc.ioms_receipts
     WHERE source_module = 'M-03' AND source_record_id = $1 AND status = 'Pending'`,
    [invoiceId],
  );
  return r.rows.map((x) => x.id);
}

function pickKeeper(rows: InvRow[], paidReceiptById: Map<string, boolean>): string | null {
  const withPaid = rows.filter((r) => paidReceiptById.get(r.id));
  if (withPaid.length === 1) return withPaid[0]!.id;
  if (withPaid.length > 1) return null; // conflict

  const statusPaid = rows.filter((r) => String(r.status) === "Paid");
  if (statusPaid.length === 1) return statusPaid[0]!.id;
  if (statusPaid.length > 1) return null;

  const sorted = [...rows].sort((a, b) => {
    const ta = a.approved_at ? Date.parse(a.approved_at) : Number.MAX_SAFE_INTEGER;
    const tb = b.approved_at ? Date.parse(b.approved_at) : Number.MAX_SAFE_INTEGER;
    if (ta !== tb) return ta - tb;
    return a.id.localeCompare(b.id);
  });
  return sorted[0]!.id;
}

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.error("DATABASE_URL is required.");
    process.exit(1);
  }
  const commit = String(process.env.COMMIT_CANCEL ?? "").trim() === "1";

  const client = new Client({ connectionString: url });
  await client.connect();

  try {
    const groups = await client.query<{ asset_id: string; period_month: string; cnt: string }>(
      `SELECT asset_id, period_month, COUNT(*)::text AS cnt
       FROM gapmc.rent_invoices
       WHERE COALESCE(TRIM(status), '') <> 'Cancelled'
       GROUP BY asset_id, period_month
       HAVING COUNT(*) > 1`,
    );

    console.log(`Duplicate premise/month groups (non-Cancelled): ${groups.rows.length}\n`);

    const toCancel: { id: string; invoice_no: string | null; reason: string }[] = [];
    const skippedGroups: string[] = [];

    for (const g of groups.rows) {
      const inv = await client.query<InvRow>(
        `SELECT id, invoice_no, asset_id, period_month, status, approved_at
         FROM gapmc.rent_invoices
         WHERE asset_id = $1 AND period_month = $2 AND COALESCE(TRIM(status), '') <> 'Cancelled'
         ORDER BY id`,
        [g.asset_id, g.period_month],
      );

      const rows = inv.rows;
      const paidMap = new Map<string, boolean>();
      for (const r of rows) {
        paidMap.set(r.id, await hasPaidM03Receipt(client, r.id));
      }

      const keeperId = pickKeeper(rows, paidMap);
      if (!keeperId) {
        skippedGroups.push(
          `${g.asset_id} ${g.period_month}: ambiguous keeper (${rows.length} rows; multiple Paid receipts or multiple Paid-status invoices)`,
        );
        continue;
      }

      const keeper = rows.find((r) => r.id === keeperId)!;
      console.log(
        `KEEP ${keeperId} (${keeper.invoice_no ?? "no no"}) asset=${g.asset_id} month=${g.period_month} status=${keeper.status}`,
      );

      for (const r of rows) {
        if (r.id === keeperId) continue;
        if (paidMap.get(r.id)) {
          skippedGroups.push(
            `${r.id} (${r.invoice_no}): has Paid/Reconciled receipt but not chosen keeper — cancel manually`,
          );
          continue;
        }
        toCancel.push({
          id: r.id,
          invoice_no: r.invoice_no,
          reason: `duplicate of ${keeperId} (${keeper.invoice_no ?? keeperId})`,
        });
        console.log(`  CANCEL ${r.id} (${r.invoice_no ?? "no no"}) status=${r.status}`);
      }
    }

    if (skippedGroups.length > 0) {
      console.log("\nSkipped / needs manual review:");
      for (const s of skippedGroups) console.log(`  ${s}`);
    }

    if (toCancel.length === 0) {
      console.log("\nNo invoices to cancel.");
      return;
    }

    if (!commit) {
      console.log(`\nDry run: would cancel ${toCancel.length} invoice(s). COMMIT_CANCEL=1 to apply.`);
      return;
    }

    await client.query("BEGIN");
    try {
      const remark =
        "Cancelled as historical duplicate (same premises + billing month); canonical invoice retained.";
      for (const c of toCancel) {
        const pend = await pendingM03ReceiptIds(client, c.id);
        for (const rid of pend) {
          await client.query(
            `UPDATE gapmc.ioms_receipts SET status = 'Failed', gateway_ref = 'InvoiceCancelled' WHERE id = $1`,
            [rid],
          );
        }
        await client.query(
          `UPDATE gapmc.rent_invoices
           SET status = 'Cancelled',
               dv_return_remarks = CASE
                 WHEN dv_return_remarks IS NULL OR TRIM(COALESCE(dv_return_remarks, '')) = '' THEN $2::text
                 ELSE TRIM(dv_return_remarks) || chr(10) || $2::text
               END
           WHERE id = $1`,
          [c.id, remark],
        );
      }
      await client.query("COMMIT");
      console.log(`\nCommitted: cancelled ${toCancel.length} duplicate invoice(s).`);
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
