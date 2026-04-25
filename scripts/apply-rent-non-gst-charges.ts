import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { db } from "../server/db";

async function main() {
  const sqlPath = resolve("scripts/migrations/030-rent-non-gst-charges.sql");
  const sql = readFileSync(sqlPath, "utf8");
  await db.execute(sql);
  // eslint-disable-next-line no-console
  console.log("Applied migration 030-rent-non-gst-charges.sql");
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});

