/**
 * M-02: Daily alerts for upcoming licence expiry + overdue dues (notify stub).
 * Keeps output lightweight; avoids spamming by writing an audit_log marker once per day.
 */
import { and, eq, isNotNull, ne, sql } from "drizzle-orm";
import { db } from "./db";
import { auditLog, preReceipts, rentInvoices, traderLicences } from "@shared/db-schema";
import { sendNotificationStub } from "./notify";
import { writeAuditLogSystem } from "./audit";

async function alreadySent(asOfDate: string): Promise<boolean> {
  const recordId = `m02_entity_alerts:${asOfDate}`;
  const [row] = await db
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(and(eq(auditLog.action, "M02EntityAlertsSent"), eq(auditLog.recordId, recordId)))
    .limit(1);
  return Boolean(row?.id);
}

export async function runM02EntityAlerts(): Promise<{
  asOfDate: string;
  expiring60d: number;
  expiring30d: number;
  overdueRentInvoices: number;
  overduePreReceipts: number;
  skippedAlreadySent: boolean;
}> {
  const asOfDate = new Date().toISOString().slice(0, 10);
  if (await alreadySent(asOfDate)) {
    return {
      asOfDate,
      expiring60d: 0,
      expiring30d: 0,
      overdueRentInvoices: 0,
      overduePreReceipts: 0,
      skippedAlreadySent: true,
    };
  }

  // Licence expiry windows (based on validTo date part).
  // Narrow windows using string date compare on YYYY-MM-DD slice. validTo is stored as text but normally iso.
  const plusDays = (days: number) => {
    const d = new Date(`${asOfDate}T12:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };
  const iso60 = plusDays(60);
  const iso30 = plusDays(30);

  const [expiring60] = await db
    .select({ c: sql<number>`COUNT(*)` })
    .from(traderLicences)
    .where(
      and(
        eq(traderLicences.status, "Active"),
        isNotNull(traderLicences.validTo),
        ne(traderLicences.validTo, ""),
        sql`SUBSTR(${traderLicences.validTo}, 1, 10) >= ${asOfDate} AND SUBSTR(${traderLicences.validTo}, 1, 10) <= ${iso60}`,
      ),
    );
  const [expiring30] = await db
    .select({ c: sql<number>`COUNT(*)` })
    .from(traderLicences)
    .where(
      and(
        eq(traderLicences.status, "Active"),
        isNotNull(traderLicences.validTo),
        ne(traderLicences.validTo, ""),
        sql`SUBSTR(${traderLicences.validTo}, 1, 10) >= ${asOfDate} AND SUBSTR(${traderLicences.validTo}, 1, 10) <= ${iso30}`,
      ),
    );

  // Overdue dues (best-effort): rent invoices marked Overdue; pre-receipts issued but not settled older than 30 days.
  const [overdueRent] = await db.select({ c: sql<number>`COUNT(*)` }).from(rentInvoices).where(eq(rentInvoices.status, "Overdue"));

  const oldLimit = plusDays(-30);
  const [overduePre] = await db
    .select({ c: sql<number>`COUNT(*)` })
    .from(preReceipts)
    .where(
      and(
        eq(preReceipts.status, "Issued"),
        isNotNull(preReceipts.issuedAt),
        ne(preReceipts.issuedAt, ""),
        sql`SUBSTR(${preReceipts.issuedAt}, 1, 10) <= ${oldLimit}`,
      ),
    );

  const expiring60d = Number(expiring60?.c ?? 0);
  const expiring30d = Number(expiring30?.c ?? 0);
  const overdueRentInvoices = Number(overdueRent?.c ?? 0);
  const overduePreReceipts = Number(overduePre?.c ?? 0);

  sendNotificationStub({
    kind: "m02_entity_alerts",
    asOfDate,
    expiringLicences60d: expiring60d,
    expiringLicences30d: expiring30d,
    expiredLicencesBlockedToday: 0, // handled in licence expiry cron; included here as digest placeholder
    overdueRentInvoices,
    overduePreReceipts,
  });

  await writeAuditLogSystem({
    module: "M-02",
    action: "M02EntityAlertsSent",
    recordId: `m02_entity_alerts:${asOfDate}`,
    afterValue: { asOfDate, expiring60d, expiring30d, overdueRentInvoices, overduePreReceipts },
  });

  return { asOfDate, expiring60d, expiring30d, overdueRentInvoices, overduePreReceipts, skippedAlreadySent: false };
}

