/**
 * Approve legacy Draft/Verified purchase transactions and finalize wizard Draft rows.
 * Usage: npm run db:backfill-m04-immediate-commodity-transactions
 * Dry run: npm run db:backfill-m04-immediate-commodity-transactions -- --dry-run
 */
import { backfillM04ImmediateCommodityTransactions } from "../server/m04-immediate-transaction-backfill";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const result = await backfillM04ImmediateCommodityTransactions({ dryRun });
  console.log(dryRun ? "Dry run complete:" : "Backfill complete:", JSON.stringify(result, null, 2));
  if (result.errors.length > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
