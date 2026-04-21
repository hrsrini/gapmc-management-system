/**
 * M-08: idempotent monthly AMC bill rows for **Monthly** period contracts only.
 * Quarterly/Annual remain manual until client confirms cadence (pending Q42).
 */
import { and, eq, gte, lte } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./db";
import { amcBills, amcContracts } from "@shared/db-schema";
import { writeAuditLogSystem } from "./audit";
import { getMergedSystemConfig } from "./system-config";

export async function generateMonthlyAmcBillsIfMissing(reference: Date = new Date()): Promise<{
  created: number;
  skipped: number;
  disabled?: boolean;
}> {
  const cfg = await getMergedSystemConfig();
  if (String(cfg.amc_monthly_auto_generate ?? "").trim().toLowerCase() !== "true") {
    return { created: 0, skipped: 0, disabled: true };
  }

  const y = reference.getUTCFullYear();
  const m = String(reference.getUTCMonth() + 1).padStart(2, "0");
  const monthPrefix = `${y}-${m}`;
  const monthStart = `${monthPrefix}-01`;
  const lastDay = new Date(Date.UTC(y, reference.getUTCMonth() + 1, 0)).getUTCDate();
  const monthEnd = `${monthPrefix}-${String(lastDay).padStart(2, "0")}`;
  const contracts = await db
    .select()
    .from(amcContracts)
    .where(
      and(
        eq(amcContracts.status, "Active"),
        lte(amcContracts.contractStart, monthEnd),
        gte(amcContracts.contractEnd, monthStart),
      ),
    );

  let created = 0;
  let skipped = 0;

  for (const c of contracts) {
    const p = String(c.periodType ?? "Monthly").toLowerCase();
    if (p !== "monthly") {
      skipped += 1;
      continue;
    }

    const existing = await db
      .select({ id: amcBills.id })
      .from(amcBills)
      .where(
        and(
          eq(amcBills.amcId, c.id),
          gte(amcBills.billDate, monthStart),
          lte(amcBills.billDate, monthEnd),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      skipped += 1;
      continue;
    }

    await db.insert(amcBills).values({
      id: nanoid(),
      amcId: c.id,
      billDate: monthStart,
      amount: Number(c.amountPerPeriod ?? 0),
      voucherId: null,
    });
    created += 1;
  }

  await writeAuditLogSystem({
    module: "Construction",
    action: "CronAmcMonthlyBills",
    recordId: monthPrefix,
    afterValue: { created, skipped, monthPrefix },
  });

  return { created, skipped };
}
