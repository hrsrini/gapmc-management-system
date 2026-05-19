/**
 * Apply migration 049: M-03 rent invoice billing types + rent_billing_config.
 * Run: npm run db:apply-m03-rent-invoice-billing-types
 */
import { readFileSync } from "fs";
import { join } from "path";
import { pool } from "../server/db";

async function main() {
  const sql = readFileSync(
    join(process.cwd(), "scripts/migrations/049-m03-rent-invoice-billing-types.sql"),
    "utf8",
  );
  await pool.query(sql);
  console.log("Applied 049-m03-rent-invoice-billing-types.sql");
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
