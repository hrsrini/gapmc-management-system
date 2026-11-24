/**
 * Ensure Admin Config rent_arrears_interest_percent_per_annum = 15,
 * then run M-03 arrears & interest (same as UI "Run arrears & interest").
 *
 * Usage: dotenv -e .env -- tsx scripts/set-rent-interest-rate-and-run-arrears.ts
 */
import { eq } from "drizzle-orm";
import { db } from "../server/db";
import { systemConfig } from "@shared/db-schema";
import { getMergedSystemConfig, parseSystemConfigNumber } from "../server/system-config";
import { runM03RentArrearsInterest } from "../server/cron-m03-rent-arrears-interest";

const KEY = "rent_arrears_interest_percent_per_annum";
const TARGET = "15";

async function main() {
  const before = await getMergedSystemConfig();
  const beforeRate = parseSystemConfigNumber(before, KEY);
  console.log(`Config ${KEY} before: ${before[KEY]} (parsed ${beforeRate})`);

  if (String(before[KEY] ?? "").trim() !== TARGET) {
    const now = new Date().toISOString();
    await db
      .insert(systemConfig)
      .values({
        key: KEY,
        value: TARGET,
        updatedBy: "script:set-rent-interest-rate-and-run-arrears",
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: systemConfig.key,
        set: {
          value: TARGET,
          updatedBy: "script:set-rent-interest-rate-and-run-arrears",
          updatedAt: now,
        },
      });
    console.log(`Updated ${KEY} → ${TARGET}`);
  } else {
    console.log(`Config already ${TARGET}; no update needed.`);
  }

  // Confirm row
  const [row] = await db.select().from(systemConfig).where(eq(systemConfig.key, KEY)).limit(1);
  console.log(`DB row: ${row ? `${row.key}=${row.value}` : "(defaults only)"}`);

  const after = await getMergedSystemConfig();
  console.log(`Merged rate now: ${after[KEY]}`);

  console.log("Running M-03 arrears & interest…");
  const result = await runM03RentArrearsInterest();
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
