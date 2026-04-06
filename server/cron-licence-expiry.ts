/**
 * M-02: Auto-block trader licences when validTo is before today (Active → Expired, isBlocked, blocking log).
 * Idempotent per run: only Active licences that are not already blocked.
 */
import { eq, or, isNull, and, isNotNull, ne } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./db";
import { traderLicences, traderBlockingLog } from "@shared/db-schema";
import { writeAuditLogSystem } from "./audit";

function validToDatePart(validTo: string | null): string | null {
  if (validTo == null || String(validTo).trim() === "") return null;
  return String(validTo).trim().slice(0, 10);
}

export async function autoBlockExpiredTraderLicences(): Promise<{ blocked: number }> {
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();

  const rows = await db
    .select()
    .from(traderLicences)
    .where(
      and(
        eq(traderLicences.status, "Active"),
        isNotNull(traderLicences.validTo),
        ne(traderLicences.validTo, ""),
        or(eq(traderLicences.isBlocked, false), isNull(traderLicences.isBlocked)),
      ),
    );

  const candidates = rows.filter((r) => {
    const d = validToDatePart(r.validTo);
    return d != null && d.length === 10 && d < today;
  });

  const licenceIds: string[] = [];

  for (const lic of candidates) {
    await db
      .update(traderLicences)
      .set({
        status: "Expired",
        isBlocked: true,
        blockReason: "Licence validity ended (automated)",
        updatedAt: now,
      })
      .where(eq(traderLicences.id, lic.id));

    await db.insert(traderBlockingLog).values({
      id: nanoid(),
      traderLicenceId: lic.id,
      action: "Blocked",
      reason: "Licence validity ended (automated)",
      actionedBy: "system",
      actionedAt: now,
    });
    licenceIds.push(lic.id);
  }

  if (licenceIds.length > 0) {
    writeAuditLogSystem({
      module: "Traders",
      action: "CronAutoBlockExpiredLicences",
      recordId: today,
      afterValue: { date: today, count: licenceIds.length, licenceIds },
    }).catch((e) => console.error("Audit log failed:", e));
  }

  return { blocked: licenceIds.length };
}
