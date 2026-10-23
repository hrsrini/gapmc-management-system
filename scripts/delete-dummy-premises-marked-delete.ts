/**
 * Remove dummy premises whose Premises ID contains "delete" and have no linked transactions.
 * Usage: npx dotenv -e .env -- tsx scripts/delete-dummy-premises-marked-delete.ts [--apply]
 */
import "dotenv/config";
import pg from "pg";

const { Client } = pg;

async function main() {
  const apply = process.argv.includes("--apply");
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query(`
      SELECT id, asset_id, yard_id, premises_status, is_active
      FROM gapmc.assets
      WHERE lower(asset_id) LIKE '%delete%'
         OR lower(trim(asset_id)) = 'delete'
      ORDER BY asset_id
    `);
    console.log(`Candidates: ${rows.length}`);
    for (const row of rows) {
      const linkRes = await client.query(
        `
        SELECT (
          (SELECT count(*)::int FROM gapmc.asset_allotments WHERE asset_id = $1 OR asset_id = $2)
          + (SELECT count(*)::int FROM gapmc.entity_allotments WHERE asset_id = $1 OR asset_id = $2)
          + (SELECT count(*)::int FROM gapmc.rent_invoices WHERE asset_id = $1 OR asset_id = $2)
          + (SELECT count(*)::int FROM gapmc.rent_deposit_ledger WHERE asset_id = $1 OR asset_id = $2)
          + (SELECT count(*)::int FROM gapmc.ioms_receipts WHERE premises_asset_id = $1 OR premises_asset_id = $2)
        ) AS linked
        `,
        [row.id, row.asset_id],
      );
      const linked = Number(linkRes.rows[0]?.linked ?? 0);
      console.log(`${row.asset_id}: linked=${linked}`);
      if (apply && linked === 0) {
        await client.query(`DELETE FROM gapmc.assets WHERE id = $1`, [row.id]);
        console.log(`  deleted`);
      } else if (apply) {
        console.log(`  skipped (has links)`);
      }
    }
    if (!apply) console.log("\nDry run. Re-run with --apply to delete unlinked dummies.");
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
