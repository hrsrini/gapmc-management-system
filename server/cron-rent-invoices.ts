/**
 * M-03 Rent invoice auto-generation: 1st of each month at 00:01.
 * For each active allotment, creates a Draft rent invoice for the current month if none exists (idempotent).
 * Rent amounts are copied from the latest invoice for the same allotment, or 0 if none.
 */
import { eq, and, desc, gte, lte } from "drizzle-orm";
import { db } from "./db";
import { assetAllotments, assets, entities, entityAllotments, rentInvoices, yards } from "@shared/db-schema";
import { formatRentInvoiceNo } from "./rent-invoice-number";
import { resolveRentForAllotmentPeriodMonth } from "./rent-allotment-rent-resolve";
import { nanoid } from "nanoid";
import { writeAuditLogSystem } from "./audit";
import { tenantLicenceIsGstExempt } from "./gst-exempt";
import { resolveRentInvoiceTdsFields } from "./rent-invoice-tds";
import { isTrackBGovtSubType } from "@shared/track-b-entity";
import { unifiedEntityIdFromTrackB } from "@shared/unified-entity-id";

function gstComponentsFromMonthlyRent(monthlyRent: number, gstApplicable: boolean): { cgst: number; sgst: number; total: number } {
  const r = Number(monthlyRent);
  if (!Number.isFinite(r) || r <= 0 || !gstApplicable) return { cgst: 0, sgst: 0, total: Math.max(0, r) };
  const half = Math.round(r * 0.09 * 100) / 100;
  return { cgst: half, sgst: half, total: Math.round((r + 2 * half) * 100) / 100 };
}

function getFirstAndLastDayOfMonth(yyyy: number, mm: number): { first: string; last: string } {
  const first = `${yyyy}-${String(mm).padStart(2, "0")}-01`;
  const lastDate = new Date(yyyy, mm, 0);
  const last = `${yyyy}-${String(mm).padStart(2, "0")}-${String(lastDate.getDate()).padStart(2, "0")}`;
  return { first, last };
}

export async function generateRentInvoicesForCurrentMonth(options?: {
  /** When true (e.g. manual API), caller writes user audit; skip system/cron audit row. */
  skipSystemAudit?: boolean;
}): Promise<{
  created: number;
  skipped: number;
  periodMonth: string;
}> {
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

  const assetRows = await db.select({ id: assets.id, assetId: assets.assetId, yardId: assets.yardId }).from(assets);
  const yardByAssetPk = Object.fromEntries(assetRows.map((a) => [a.id, a.yardId]));
  const yardCodeRows = await db.select({ id: yards.id, code: yards.code }).from(yards);
  const yardCodeById = new Map(yardCodeRows.map((y) => [y.id, y.code]));

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
    // US-M02-003: only generate rent invoices after DA approval + agreement upload.
    if (String((allotment as unknown as { approvalStatus?: string }).approvalStatus ?? "Approved") !== "Approved") {
      skipped += 1;
      continue;
    }
    if (!(allotment as unknown as { agreementDocFile?: string | null }).agreementDocFile) {
      skipped += 1;
      continue;
    }
    const configuredRent = Number((allotment as unknown as { monthlyRent?: number | null }).monthlyRent ?? 0);
    if (!Number.isFinite(configuredRent) || configuredRent <= 0.01) {
      skipped += 1;
      continue;
    }
    const yardId = yardByAssetPk[allotment.assetId];
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

    const gstExempt = Boolean(allotment.traderLicenceId && (await tenantLicenceIsGstExempt(allotment.traderLicenceId)));
    const tdsRes = await resolveRentInvoiceTdsFields({
      tenantLicenceId: allotment.traderLicenceId,
      rentAmount,
      periodMonth,
      isGstExemptTenant: gstExempt,
    });
    const tdsApplicable = "error" in tdsRes ? false : tdsRes.tdsApplicable;
    const tdsAmount = "error" in tdsRes ? 0 : tdsRes.tdsAmount;

    const id = nanoid();
    const invoiceNo = formatRentInvoiceNo(yardCodeById.get(yardId), periodMonth, id);
    await db.insert(rentInvoices).values({
      id,
      allotmentId: allotment.id,
      allotmentKind: "TraderLicence",
      tenantLicenceId: allotment.traderLicenceId,
      entityId: null,
      assetId: allotment.assetId,
      yardId,
      periodMonth,
      rentAmount,
      nonGstChargesJson: null,
      cgst,
      sgst,
      totalAmount,
      isGovtEntity,
      tdsApplicable,
      tdsAmount,
      status: "Draft",
      invoiceNo,
      doUser: null,
      dvUser: null,
      daUser: null,
      generatedAt: null,
      approvedAt: null,
    });
    createdInvoiceIds.push(id);
    created += 1;
  }

  // Track B Entity premises allocations (US-M02-003): Govt sub-type skips M-03 (pre-receipt path).
  const activeEntityRows = await db
    .select()
    .from(entityAllotments)
    .where(
      and(
        eq(entityAllotments.status, "Active"),
        eq(entityAllotments.approvalStatus, "Approved"),
        gte(entityAllotments.toDate, firstDay),
        lte(entityAllotments.fromDate, lastDay),
      ),
    );

  const entityRows = await db.select().from(entities);
  const entityById = Object.fromEntries(entityRows.map((e) => [e.id, e]));

  for (const ea of activeEntityRows) {
    const ent = entityById[ea.entityId];
    if (!ent || isTrackBGovtSubType(ent.subType)) {
      skipped += 1;
      continue;
    }
    if (!ea.agreementDocFile) {
      skipped += 1;
      continue;
    }
    const baseRentNum = Number(ea.monthlyRent ?? 0);
    if (!Number.isFinite(baseRentNum) || baseRentNum <= 0.01) {
      skipped += 1;
      continue;
    }

    if (existingAllotmentIds.has(ea.id)) {
      skipped += 1;
      continue;
    }
    const yardId = yardByAssetPk[ea.assetId];
    if (!yardId) continue;

    const [lastInvoice] = await db
      .select()
      .from(rentInvoices)
      .where(eq(rentInvoices.allotmentId, ea.id))
      .orderBy(desc(rentInvoices.periodMonth))
      .limit(1);

    const { rentAmount } = await resolveRentForAllotmentPeriodMonth(ea.id, periodMonth);
    let cgst = lastInvoice?.cgst ?? null;
    let sgst = lastInvoice?.sgst ?? null;
    let totalAmount = lastInvoice?.totalAmount ?? null;
    let isGovtEntity = Boolean(lastInvoice?.isGovtEntity ?? false);

    if (!lastInvoice) {
      const g = gstComponentsFromMonthlyRent(rentAmount, Boolean(ea.gstApplicable));
      cgst = g.cgst;
      sgst = g.sgst;
      totalAmount = rentAmount + cgst + sgst;
      isGovtEntity = !ea.gstApplicable;
    }

    const gstExempt = !ea.gstApplicable;
    const tdsRes = await resolveRentInvoiceTdsFields({
      tenantLicenceId: unifiedEntityIdFromTrackB(ea.entityId),
      rentAmount,
      periodMonth,
      isGstExemptTenant: gstExempt,
    });
    const tdsApplicable = "error" in tdsRes ? false : tdsRes.tdsApplicable;
    const tdsAmount = "error" in tdsRes ? 0 : tdsRes.tdsAmount;

    const id = nanoid();
    const invoiceNo = formatRentInvoiceNo(yardCodeById.get(yardId), periodMonth, id);

    await db.insert(rentInvoices).values({
      id,
      allotmentId: ea.id,
      allotmentKind: "Entity",
      tenantLicenceId: unifiedEntityIdFromTrackB(ea.entityId),
      entityId: ea.entityId,
      assetId: ea.assetId,
      yardId,
      periodMonth,
      rentAmount,
      nonGstChargesJson: null,
      cgst: cgst ?? 0,
      sgst: sgst ?? 0,
      totalAmount: totalAmount ?? rentAmount + (cgst ?? 0) + (sgst ?? 0),
      isGovtEntity,
      tdsApplicable,
      tdsAmount,
      status: "Draft",
      invoiceNo,
      doUser: null,
      dvUser: null,
      daUser: null,
      generatedAt: null,
      approvedAt: null,
    });

    existingAllotmentIds.add(ea.id);
    createdInvoiceIds.push(id);
    created += 1;
  }

  if (createdInvoiceIds.length > 0 && !options?.skipSystemAudit) {
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

  return { created, skipped, periodMonth };
}
