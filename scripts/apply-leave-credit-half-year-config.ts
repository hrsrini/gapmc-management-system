/**
 * Migrate leave credit System Config keys:
 * - leave_hpl_credit_year_days (20) → leave_hpl_credit_half_year_days (10)
 * - ensure leave_cl_credit_year_days_pwd / leave_spl_h_credit_year_days exist
 *
 * Usage: npm run db:apply-leave-credit-half-year-config
 */
import { eq } from "drizzle-orm";
import { db } from "../server/db";
import { systemConfig } from "@shared/db-schema";
import { SYSTEM_CONFIG_DEFAULTS } from "@shared/system-config-defaults";

async function upsert(key: string, value: string) {
  const [existing] = await db.select().from(systemConfig).where(eq(systemConfig.key, key)).limit(1);
  if (existing) {
    await db.update(systemConfig).set({ value }).where(eq(systemConfig.key, key));
    console.log(`updated ${key}=${value}`);
  } else {
    await db.insert(systemConfig).values({ key, value });
    console.log(`inserted ${key}=${value}`);
  }
}

async function main() {
  const [oldHpl] = await db
    .select()
    .from(systemConfig)
    .where(eq(systemConfig.key, "leave_hpl_credit_year_days"))
    .limit(1);

  const [newHpl] = await db
    .select()
    .from(systemConfig)
    .where(eq(systemConfig.key, "leave_hpl_credit_half_year_days"))
    .limit(1);

  if (!newHpl) {
    let half = SYSTEM_CONFIG_DEFAULTS.leave_hpl_credit_half_year_days;
    if (oldHpl) {
      const yearVal = parseFloat(String(oldHpl.value ?? ""));
      // Legacy "per year" 20 → half-year 10; otherwise use half of year value when even.
      if (Number.isFinite(yearVal) && yearVal === 20) half = "10";
      else if (Number.isFinite(yearVal) && yearVal > 0) half = String(Math.round((yearVal / 2) * 100) / 100);
    }
    await upsert("leave_hpl_credit_half_year_days", half);
  } else {
    console.log(`keep leave_hpl_credit_half_year_days=${newHpl.value}`);
  }

  if (oldHpl) {
    await db.delete(systemConfig).where(eq(systemConfig.key, "leave_hpl_credit_year_days"));
    console.log("removed obsolete leave_hpl_credit_year_days");
  }

  const ensureKeys: Array<keyof typeof SYSTEM_CONFIG_DEFAULTS> = [
    "leave_cl_credit_year_days_pwd",
    "leave_spl_h_credit_year_days",
    "leave_cl_credit_year_days",
    "leave_rh_entitlement_per_year",
  ];
  for (const key of ensureKeys) {
    const [row] = await db.select().from(systemConfig).where(eq(systemConfig.key, key)).limit(1);
    if (!row) await upsert(key, SYSTEM_CONFIG_DEFAULTS[key]);
    else console.log(`keep ${key}=${row.value}`);
  }

  console.log("Done.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
