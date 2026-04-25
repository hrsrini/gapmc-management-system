/**
 * M-03 Rent invoice auto-generation: 1st of each month at 00:01.
 * For each active allotment, creates a Draft rent invoice for the current month if none exists (idempotent).
 * Rent amounts are copied from the latest invoice for the same allotment, or 0 if none.
 */
import { eq, and, desc, gte, lte } from "drizzle-orm";
import { db } from "./db";
import { assetAllotments, assets, rentInvoices } from "@shared/db-schema";
import { resolveRentForAllotmentPeriodMonth } from "./rent-allotment-rent-resolve";
import { nanoid } from "nanoid";
import { writeAuditLogSystem } from "./audit";

function getFirstAndLastDayOfMonth(yyyy: number, mm: number): { first: string; last: string } {
  const first = `${yyyy}-${String(mm).padStart(2, "0")}-01`;
  const lastDate = new Date(yyyy, mm, 0);
  const last = `${yyyy}-${String(mm).padStart(2, "0")}-${String(lastDate.getDate()).padStart(2, "0")}`;
  return { first, last };
}

export async function generateRentInvoicesForCurrentMonth(): Promise<{ created: number; skipped: number }> {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = now.getMonth() + 1;
  const periodMonth = `${yyyy}-${String(mm).padStart(2, "0")}`;
  const { first: firstDay, last: lastDay } = getFirstAndLastDayOfMonth(yyyy, mm);

  const activeAllotments = await db
    .select()
    .from(assetAllotments)
    .where(
      and(
        eq(assetAllotments.status, "Active"),
        gte(assetAllotments.toDate, firstDay),
        lte(assetAllotments.fromDate, lastDay)
      )
    );

  const assetRows = await db.select({ assetId: assets.assetId, yardId: assets.yardId }).from(assets);
  const yardByAssetId = Object.fromEntries(assetRows.map((a) => [a.assetId, a.yardId]));

  const existingByAllotment = await db
    .select({ allotmentId: rentInvoices.allotmentId })
    .from(rentInvoices)
    .where(eq(rentInvoices.periodMonth, periodMonth));
  const existingAllotmentIds = new Set(existingByAllotment.map((r) => r.allotmentId));

  let created = 0;
  let skipped = 0;
  const createdInvoiceIds: string[] = [];

  for (const allotment of activeAllotments) {
    if (existingAllotmentIds.has(allotment.id)) {
      skipped += 1;
      continue;
    }
    const yardId = yardByAssetId[allotment.assetId];
    if (!yardId) continue;

    const [lastInvoice] = await db
      .select()
      .from(rentInvoices)
      .where(eq(rentInvoices.allotmentId, allotment.id))
      .orderBy(desc(rentInvoices.periodMonth))
      .limit(1);

    const { rentAmount } = await resolveRentForAllotmentPeriodMonth(allotment.id, periodMonth);
    const cgst = lastInvoice?.cgst ?? 0;
    const sgst = lastInvoice?.sgst ?? 0;
    const totalAmount = lastInvoice?.totalAmount ?? rentAmount + cgst + sgst;
    const isGovtEntity = lastInvoice?.isGovtEntity ?? false;

    const id = nanoid();
    await db.insert(rentInvoices).values({
      id,
      allotmentId: allotment.id,
      tenantLicenceId: allotment.traderLicenceId,
      assetId: allotment.assetId,
      yardId,
      periodMonth,
      rentAmount,
      nonGstChargesJson: null,
      cgst,
      sgst,
      totalAmount,
      isGovtEntity,
      status: "Draft",
      invoiceNo: null,
      doUser: null,
      dvUser: null,
      daUser: null,
      generatedAt: null,
      approvedAt: null,
    });
    createdInvoiceIds.push(id);
    created += 1;
  }

  if (createdInvoiceIds.length > 0) {
    writeAuditLogSystem({
      module: "Rent/Tax",
      action: "CronGenerateMonthlyDrafts",
      recordId: periodMonth,
      afterValue: {
        periodMonth,
        createdCount: createdInvoiceIds.length,
        invoiceIds: createdInvoiceIds,
      },
    }).catch((e) => console.error("Audit log failed:", e));
  }

  return { created, skipped };
}
