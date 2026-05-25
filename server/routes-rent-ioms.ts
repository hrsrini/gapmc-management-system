/**
 * IOMS M-03: Rent / GST Tax Invoice API routes.
 * Tables: rent_invoices, rent_deposit_ledger, credit_notes.
 * Workflow: DO creates Draft; DV verifies (Draft→Verified); DA approves (Verified→Approved).
 */
import type { Express, Request } from "express";
import { eq, desc, and, inArray, gte, lte, or, isNull } from "drizzle-orm";
import { db } from "./db";
import {
  rentInvoices,
  rentDepositLedger,
  creditNotes,
  iomsReceipts,
  traderLicences,
  entities,
  adHocEntities,
  rentRevisionOverrides,
  assetAllotments,
  entityAllotments,
  assets,
  yards,
} from "@shared/db-schema";
import { nanoid } from "nanoid";
import {
  canCreateRentInvoice,
  canRunM03RentArrearsInterest,
  canEditDraftRentInvoice,
  canTransitionRentInvoice,
  assertSegregationDoDvDa,
  canCreateRentRevision,
  canEditDraftRentRevision,
  canTransitionRentRevision,
} from "./workflow";
import { tenantLicenceIsGstExempt } from "./gst-exempt";
import { validateDvReturnToDraft } from "@shared/workflow-rejection";
import { sendApiError } from "./api-errors";
import { writeAuditLog } from "./audit";
import { routeParamString } from "./route-params";
import { resolveRentInvoiceTdsFields } from "./rent-invoice-tds";
import { isValidYearMonthYm } from "./rent-gstr1";
import { createIomsReceipt } from "./routes-receipts-ioms";
import { assertTraderLicenceAccessibleInUserScope } from "./trader-licence-market-scope";
import { applyM03ReceiptToRentDepositLedger } from "./rent-deposit-ledger-from-receipt";
import { listRentDepositLedgerEnriched } from "./rent-deposit-ledger-display";
import { parseUnifiedEntityId, unifiedEntityIdFromTrackA, unifiedEntityIdFromTrackB, unifiedEntityIdFromAdHoc } from "@shared/unified-entity-id";
import { ledgerRowMatchesUnifiedEntityFilter } from "./rent-ledger-scope";
import { resolveRentInvoiceCounterparty } from "./rent-invoice-payer";
import { normalizeRentRevisionBasis, yearMonthMinusOne } from "@shared/rent-revision-basis";
import { resolveRentForAllotmentPeriodMonth } from "./rent-allotment-rent-resolve";
import { rentPeriodMonthEndIso } from "./rent-interest";
import { allocateRentInvoiceNo, allocateRentInvoiceNoInTx } from "./rent-invoice-number";
import { getMergedSystemConfig, parseSystemConfigNumber } from "./system-config";
import { m03ReceiptPrincipalTowardInvoice, stringifyM03ReceiptBreakdown } from "@shared/m03-receipt-breakdown";
import { computeRentInvoiceGstInr, rentInvoiceTotalInr } from "@shared/rent-invoice-gst";
import {
  MIN_RENT_INVOICE_AMOUNT_INR,
  rentInvoiceValidationErrorMessage,
} from "@shared/rent-invoice-amount-validation";
import {
  findBlockingRentInvoiceForPremisesMonth,
  normalizeRentInvoiceAssetId,
  RENT_INVOICE_PREMISES_MONTH_DUPLICATE_MESSAGE,
} from "./rent-invoice-premises-month-uniqueness";
import {
  defaultOccupancyForBillingType,
  inferBillingTypeForMonth,
  type RentBillingType,
} from "@shared/rent-invoice-billing";
import {
  buildRentInvoiceBillingCalculation,
  fetchAllotmentAgreement,
  findOverlappingRentInvoiceForAllotment,
} from "./rent-invoice-billing-service";

function currentYearMonthUtc(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function fetchYardScopeForAllotmentId(
  allotmentId: string,
): Promise<{ yardId: string; assetId: string } | null> {
  const [aa] = await db.select().from(assetAllotments).where(eq(assetAllotments.id, allotmentId)).limit(1);
  const assetIdPk = aa?.assetId;
  if (assetIdPk) {
    const [ar] = await db
      .select({ yardId: assets.yardId, assetId: assets.id })
      .from(assets)
      .where(eq(assets.id, assetIdPk))
      .limit(1);
    return ar ?? null;
  }
  const [ea] = await db.select().from(entityAllotments).where(eq(entityAllotments.id, allotmentId)).limit(1);
  if (ea?.assetId) {
    const [ar] = await db
      .select({ yardId: assets.yardId, assetId: assets.id })
      .from(assets)
      .where(eq(assets.id, ea.assetId))
      .limit(1);
    return ar ?? null;
  }
  return null;
}

type NonGstChargeLine = { label: string; amount: number };

function parseNonGstCharges(v: unknown): { ok: true; lines: NonGstChargeLine[]; sum: number; json: string | null } | { ok: false; error: string } {
  if (v == null || v === "") return { ok: true, lines: [], sum: 0, json: null };
  if (!Array.isArray(v)) return { ok: false, error: "nonGstCharges must be an array of {label, amount}." };
  const lines: NonGstChargeLine[] = [];
  let sum = 0;
  for (const raw of v) {
    const o = raw as Record<string, unknown>;
    const label = String(o?.label ?? "").trim();
    const amount = Number(o?.amount ?? NaN);
    if (!label) return { ok: false, error: "nonGstCharges.label is required." };
    if (!Number.isFinite(amount) || amount < 0) return { ok: false, error: "nonGstCharges.amount must be a number >= 0." };
    // Keep labels short (UI + exports); avoid bloating DB.
    const safeLabel = label.slice(0, 80);
    const safeAmount = Math.round(amount * 100) / 100;
    lines.push({ label: safeLabel, amount: safeAmount });
    sum += safeAmount;
  }
  sum = Math.round(sum * 100) / 100;
  const json = JSON.stringify(lines);
  if (json.length > 4000) return { ok: false, error: "nonGstCharges payload too large." };
  return { ok: true, lines, sum, json };
}

function escapeCsvCell(val: unknown): string {
  if (val == null) return "";
  const s = String(val);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsvRow(arr: unknown[]): string {
  return arr.map(escapeCsvCell).join(",");
}

async function sumPaidM03ByInvoiceIds(invoiceIds: string[]): Promise<Map<string, number>> {
  const m = new Map<string, number>();
  if (invoiceIds.length === 0) return m;
  const recs = await db
    .select({
      sourceRecordId: iomsReceipts.sourceRecordId,
      totalAmount: iomsReceipts.totalAmount,
      status: iomsReceipts.status,
      revenueHead: iomsReceipts.revenueHead,
      sourceModule: iomsReceipts.sourceModule,
      m03BreakdownJson: iomsReceipts.m03BreakdownJson,
    })
    .from(iomsReceipts)
    .where(and(eq(iomsReceipts.sourceModule, "M-03"), inArray(iomsReceipts.sourceRecordId, invoiceIds)));
  for (const r of recs) {
    const id = String(r.sourceRecordId ?? "");
    if (!id) continue;
    const principal = m03ReceiptPrincipalTowardInvoice(r);
    if (principal <= 0) continue;
    m.set(id, (m.get(id) ?? 0) + principal);
  }
  return m;
}

export function registerRentIomsRoutes(app: Express) {
  const nowIso = () => new Date().toISOString();
  // ----- Rent invoices (IOMS M-03; distinct from gapmc.invoices; scoped by user yards) -----
  app.get("/api/ioms/rent/invoices", async (req, res) => {
    try {
      const yardId = req.query.yardId as string | undefined;
      const status = req.query.status as string | undefined;
      const unifiedRaw = String(req.query.unifiedEntityId ?? "").trim();
      const conditions = [];
      const scopedIds = req.scopedLocationIds;
      if (scopedIds && scopedIds.length > 0) conditions.push(inArray(rentInvoices.yardId, scopedIds));
      if (yardId) conditions.push(eq(rentInvoices.yardId, yardId));
      if (status) conditions.push(eq(rentInvoices.status, status));
      if (unifiedRaw) {
        const parsed = parseUnifiedEntityId(unifiedRaw);
        if (!parsed) {
          return sendApiError(res, 400, "INVOICE_UNIFIED_ID", "unifiedEntityId must be TA:<id> | TB:<id> | AH:<id>");
        }
        if (parsed.kind === "TB") {
          conditions.push(
            or(
              eq(rentInvoices.tenantLicenceId, unifiedEntityIdFromTrackB(parsed.refId)),
              eq(rentInvoices.entityId, parsed.refId),
            )!,
          );
        } else if (parsed.kind === "TA") {
          conditions.push(
            or(eq(rentInvoices.tenantLicenceId, parsed.refId), eq(rentInvoices.tenantLicenceId, unifiedEntityIdFromTrackA(parsed.refId)))!,
          );
        } else {
          conditions.push(eq(rentInvoices.tenantLicenceId, unifiedEntityIdFromAdHoc(parsed.refId)));
        }
      }
      const base = db.select().from(rentInvoices).orderBy(desc(rentInvoices.periodMonth));
      const list = conditions.length > 0 ? await base.where(and(...conditions)) : await base;
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch rent invoices");
    }
  });

  /** M-03: same job as cron (1st of month) — idempotent Draft rows for current month; DO/ADMIN + M-03:Create. */
  app.post("/api/ioms/rent/invoices/generate-monthly-drafts", async (req, res) => {
    try {
      if (!canCreateRentInvoice(req.user)) {
        return sendApiError(
          res,
          403,
          "RENT_INVOICE_GENERATE_DENIED",
          "Only Data Originator or Admin can generate monthly draft invoices",
        );
      }
      const { generateRentInvoicesForCurrentMonth } = await import("./cron-rent-invoices");
      const { created, skipped, periodMonth } = await generateRentInvoicesForCurrentMonth({ skipSystemAudit: true });
      writeAuditLog(req, {
        module: "Rent/Tax",
        action: "GenerateMonthlyDrafts",
        recordId: periodMonth,
        afterValue: { created, skipped, periodMonth, source: "manual" },
      }).catch((e) => console.error("Audit log failed:", e));
      return res.json({ ok: true, created, skipped, periodMonth });
    } catch (e) {
      console.error(e);
      return sendApiError(res, 500, "INTERNAL_ERROR", "Failed to generate monthly draft invoices");
    }
  });

  /**
   * M-03 US-M03-002: same batch as daily cron (`runM03RentArrearsInterest`):
   * Approved → Overdue when past due and outstanding; post incremental Interest on rent_deposit_ledger.
   */
  app.post("/api/ioms/rent/run-arrears-interest", async (req, res) => {
    try {
      if (!canRunM03RentArrearsInterest(req.user)) {
        return sendApiError(
          res,
          403,
          "RENT_ARREARS_INTEREST_DENIED",
          "Only Data Originator, Data Approver, or Admin can run arrears interest",
        );
      }
      const { runM03RentArrearsInterest } = await import("./cron-m03-rent-arrears-interest");
      const result = await runM03RentArrearsInterest();
      writeAuditLog(req, {
        module: "Rent/Tax",
        action: "RunArrearsInterest",
        recordId: result.asOfDate,
        afterValue: { ...result, source: "manual" },
      }).catch((e) => console.error("Audit log failed:", e));
      return res.json({ ok: true, ...result });
    } catch (e) {
      console.error(e);
      return sendApiError(res, 500, "INTERNAL_ERROR", "Failed to run M-03 arrears interest");
    }
  });

  app.get("/api/ioms/rent/invoices/:id", async (req, res) => {
    try {
      const [row] = await db.select().from(rentInvoices).where(eq(rentInvoices.id, routeParamString(req.params.id))).limit(1);
      if (!row) return sendApiError(res, 404, "RENT_INVOICE_NOT_FOUND", "Rent invoice not found");
      const scopedIds = req.scopedLocationIds;
      if (scopedIds && scopedIds.length > 0 && !scopedIds.includes(row.yardId)) {
        return sendApiError(res, 404, "RENT_INVOICE_NOT_FOUND", "Rent invoice not found");
      }
      res.json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch rent invoice");
    }
  });

  app.get("/api/ioms/rent/invoices/:id/pdf", async (req, res) => {
    try {
      const id = routeParamString(req.params.id);
      const [inv] = await db.select().from(rentInvoices).where(eq(rentInvoices.id, id)).limit(1);
      if (!inv) return sendApiError(res, 404, "RENT_INVOICE_NOT_FOUND", "Rent invoice not found");
      const scopedIds = req.scopedLocationIds;
      if (scopedIds && scopedIds.length > 0 && !scopedIds.includes(inv.yardId)) {
        return sendApiError(res, 404, "RENT_INVOICE_NOT_FOUND", "Rent invoice not found");
      }
      const [yard] = await db
        .select({ name: yards.name, code: yards.code, address: yards.address })
        .from(yards)
        .where(eq(yards.id, inv.yardId))
        .limit(1);
      const yardName = String(yard?.name?.trim() || yard?.code?.trim() || inv.yardId);
      const yardCode = yard?.code?.trim() || null;
      const yardAddress = yard?.address?.trim() || null;
      const [asset] = await db
        .select({ assetId: assets.assetId })
        .from(assets)
        .where(eq(assets.id, inv.assetId))
        .limit(1);
      const assetCode = String(asset?.assetId ?? inv.assetId);
      const counterparty = await resolveRentInvoiceCounterparty(inv);
      const { resolveRentAllotmentReferenceNo } = await import("./rent-allotment-reference");
      const allotmentLabel = await resolveRentAllotmentReferenceNo(inv);
      const { getMergedSystemConfig } = await import("./system-config");
      const sysCfg = await getMergedSystemConfig();
      const cgstPercent = parseFloat(String(sysCfg.rent_invoice_cgst_percent ?? ""));
      const sgstPercent = parseFloat(String(sysCfg.rent_invoice_sgst_percent ?? ""));
      const { buildRentInvoicePdfA4 } = await import("./rent-invoice-pdf");
      const buf = await buildRentInvoicePdfA4({
        invoice: inv,
        yardName,
        yardCode,
        yardAddress,
        counterpartyName: counterparty.payerName,
        assetCode,
        allotmentLabel,
        cgstPercent: Number.isFinite(cgstPercent) ? cgstPercent : null,
        sgstPercent: Number.isFinite(sgstPercent) ? sgstPercent : null,
      });
      const safeNo = String(inv.invoiceNo ?? id).replace(/[^\w.-]+/g, "_");
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="rent-invoice-${safeNo}.pdf"`);
      return res.send(buf);
    } catch (e) {
      console.error(e);
      return sendApiError(res, 500, "INTERNAL_ERROR", "Failed to generate rent invoice PDF");
    }
  });

  /** Outstanding rent (excludes arrears-interest-only receipts) for ledger payment UI. */
  app.get("/api/ioms/rent/invoices/:id/ledger-payment-context", async (req, res) => {
    try {
      const id = routeParamString(req.params.id);
      const [inv] = await db.select().from(rentInvoices).where(eq(rentInvoices.id, id)).limit(1);
      if (!inv) return sendApiError(res, 404, "RENT_INVOICE_NOT_FOUND", "Rent invoice not found");
      const scopedIds = req.scopedLocationIds;
      if (scopedIds && scopedIds.length > 0 && !scopedIds.includes(inv.yardId)) {
        return sendApiError(res, 404, "RENT_INVOICE_NOT_FOUND", "Rent invoice not found");
      }
      const paidMap = await sumPaidM03ByInvoiceIds([id]);
      const paid = paidMap.get(id) ?? 0;
      const total = Number(inv.totalAmount ?? 0);
      const outstandingRent = Math.max(0, Math.round((total - paid) * 100) / 100);
      res.json({
        invoiceId: id,
        invoiceNo: inv.invoiceNo ?? null,
        outstandingRent,
        isGovtEntity: Boolean(inv.isGovtEntity),
        status: inv.status,
      });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to load payment context");
    }
  });

  app.post("/api/ioms/rent/invoices/calculate", async (req, res) => {
    try {
      const body = req.body as Record<string, unknown>;
      const allotmentId = String(body.allotmentId ?? "").trim();
      const periodMonth = String(body.periodMonth ?? "").trim().slice(0, 7);
      const billingType = String(body.billingType ?? "FullMonth").trim() as RentBillingType;
      if (!allotmentId) return sendApiError(res, 400, "ALLOTMENT_ID", "allotmentId is required");
      if (!isValidYearMonthYm(periodMonth)) {
        return sendApiError(res, 400, "PERIOD_MONTH", "periodMonth must be YYYY-MM");
      }
      if (!["FullMonth", "Prorated", "Overstay"].includes(billingType)) {
        return sendApiError(res, 400, "BILLING_TYPE", "billingType must be FullMonth, Prorated, or Overstay");
      }
      const assetRow = await fetchYardScopeForAllotmentId(allotmentId);
      if (!assetRow) return sendApiError(res, 404, "ALLOTMENT_NOT_FOUND", "Allotment not found");
      const scopedIds = req.scopedLocationIds;
      if (scopedIds && scopedIds.length > 0 && !scopedIds.includes(assetRow.yardId)) {
        return sendApiError(res, 403, "RENT_CALC_YARD_DENIED", "You do not have access to this yard");
      }
      let occupancyFrom = body.occupancyFrom != null ? String(body.occupancyFrom).trim() : null;
      let occupancyTo = body.occupancyTo != null ? String(body.occupancyTo).trim() : null;
      const agreement = await fetchAllotmentAgreement(allotmentId);
      if (!agreement) return sendApiError(res, 404, "ALLOTMENT_NOT_FOUND", "Allotment not found");
      if (!occupancyFrom || !occupancyTo) {
        const defaults = defaultOccupancyForBillingType({
          billingType,
          periodMonth,
          agreementFrom: agreement.fromDate,
          agreementTo: agreement.toDate,
        });
        if (!defaults) {
          return sendApiError(res, 400, "BILLING_OCCUPANCY", "Cannot derive occupancy dates for this billing type and month.");
        }
        occupancyFrom = defaults.occupancyFrom;
        occupancyTo = defaults.occupancyTo;
      }
      const built = await buildRentInvoiceBillingCalculation({
        allotmentId,
        periodMonth,
        billingType,
        occupancyFrom,
        occupancyTo,
      });
      if (!built.ok) return sendApiError(res, 400, "RENT_BILLING_CALC", built.error);
      const overlap = await findOverlappingRentInvoiceForAllotment({
        allotmentId,
        periodMonth,
        occupancyFrom: built.calculation.occupancyFrom!,
        occupancyTo: built.calculation.occupancyTo!,
      });
      const mergedCfg = await getMergedSystemConfig();
      const gstExempt = false;
      const cgstPct = parseSystemConfigNumber(mergedCfg, "rent_invoice_cgst_percent");
      const sgstPct = parseSystemConfigNumber(mergedCfg, "rent_invoice_sgst_percent");
      const g = computeRentInvoiceGstInr(built.calculation.rentAmount, gstExempt, cgstPct, sgstPct);
      return res.json({
        ...built.calculation,
        agreementFrom: built.agreementFrom,
        agreementTo: built.agreementTo,
        monthlyRent: built.monthlyRent,
        cgst: g.cgst,
        sgst: g.sgst,
        totalAmount: rentInvoiceTotalInr(built.calculation.rentAmount, 0, g.cgst, g.sgst),
        overlappingInvoice: overlap,
      });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to calculate rent invoice");
    }
  });

  app.post("/api/ioms/rent/invoices", async (req, res) => {
    try {
      if (!canCreateRentInvoice(req.user)) {
        return sendApiError(
          res,
          403,
          "RENT_INVOICE_CREATE_DENIED",
          "Only Data Originator or Admin can create rent invoices",
        );
      }
      const body = req.body;
      const yardId = String(body.yardId ?? "");
      const scopedIds = req.scopedLocationIds;
      if (scopedIds && scopedIds.length > 0 && !scopedIds.includes(yardId)) {
        return sendApiError(res, 403, "RENT_INVOICE_YARD_ACCESS_DENIED", "You do not have access to this yard");
      }
      const id = nanoid();
      let tenantLicenceId = String(body.tenantLicenceId ?? "");
      let rentAmount = Number(body.rentAmount ?? 0);
      let allotmentKindInsert: string = String((body as Record<string, unknown>).allotmentKind ?? "").trim() || "TraderLicence";
      let entityIdInsert: string | null = body.entityId ? String(body.entityId) : null;
      const nonGst = parseNonGstCharges((body as Record<string, unknown>).nonGstCharges);
      if (!nonGst.ok) return sendApiError(res, 400, "RENT_INVOICE_NON_GST_CHARGES", nonGst.error);
      let cgst = 0;
      let sgst = 0;
      let totalAmount = 0;
      let isGovtEntity = Boolean(body.isGovtEntity ?? false);
      const allotmentIdPre = String((body as Record<string, unknown>).allotmentId ?? "").trim();
      if (allotmentIdPre) {
        const [ea] = await db.select().from(entityAllotments).where(eq(entityAllotments.id, allotmentIdPre)).limit(1);
        if (ea?.approvalStatus === "Approved") {
          if (!ea.agreementDocFile) {
            return sendApiError(res, 400, "E-AST-011", "Scanned agreement is required before invoicing this Track B premises allocation.");
          }
          allotmentKindInsert = "Entity";
          entityIdInsert = ea.entityId;
          tenantLicenceId = unifiedEntityIdFromTrackB(ea.entityId);
          isGovtEntity = !ea.gstApplicable;
        }
      }
      const gstExempt = tenantLicenceId.startsWith("TB:")
        ? isGovtEntity
        : Boolean(tenantLicenceId && (await tenantLicenceIsGstExempt(tenantLicenceId)));
      if (gstExempt) {
        isGovtEntity = true;
      }
      const periodMonth = String(body.periodMonth ?? "").trim();
      if (!isValidYearMonthYm(periodMonth)) {
        return sendApiError(res, 400, "RENT_INVOICE_PERIOD_MONTH", "periodMonth must be YYYY-MM (required for GST / TDS FY logic).");
      }

      const allotmentId = String((body as Record<string, unknown>).allotmentId ?? "").trim();
      const useManualRentAmount = Boolean((body as Record<string, unknown>).useManualRentAmount ?? false);
      let billingTypeInsert: RentBillingType = "FullMonth";
      let occupancyFromInsert: string | null = null;
      let occupancyToInsert: string | null = null;
      let daysInMonthInsert: number | null = null;
      let billableDaysInsert: number | null = null;
      let billingFactorInsert: number | null = null;
      let baseMonthlyRentInsert: number | null = null;
      let billingConfigJsonInsert: string | null = null;

      if (allotmentId && !useManualRentAmount) {
        const agreement = await fetchAllotmentAgreement(allotmentId);
        if (!agreement) {
          return sendApiError(res, 404, "ALLOTMENT_NOT_FOUND", "Allotment not found");
        }
        let billingType = String((body as Record<string, unknown>).billingType ?? "").trim() as RentBillingType;
        if (!["FullMonth", "Prorated", "Overstay"].includes(billingType)) {
          billingType = inferBillingTypeForMonth({
            periodMonth,
            agreementFrom: agreement.fromDate,
            agreementTo: agreement.toDate,
          });
        }
        let occupancyFrom =
          (body as Record<string, unknown>).occupancyFrom != null
            ? String((body as Record<string, unknown>).occupancyFrom).trim()
            : null;
        let occupancyTo =
          (body as Record<string, unknown>).occupancyTo != null
            ? String((body as Record<string, unknown>).occupancyTo).trim()
            : null;
        if (!occupancyFrom || !occupancyTo) {
          const defaults = defaultOccupancyForBillingType({
            billingType,
            periodMonth,
            agreementFrom: agreement.fromDate,
            agreementTo: agreement.toDate,
          });
          if (!defaults) {
            return sendApiError(
              res,
              400,
              "BILLING_OCCUPANCY",
              "Cannot derive occupancy dates for this billing type and month.",
            );
          }
          occupancyFrom = defaults.occupancyFrom;
          occupancyTo = defaults.occupancyTo;
        }
        const built = await buildRentInvoiceBillingCalculation({
          allotmentId,
          periodMonth,
          billingType,
          occupancyFrom,
          occupancyTo,
        });
        if (!built.ok) return sendApiError(res, 400, "RENT_BILLING_CALC", built.error);
        const overlap = await findOverlappingRentInvoiceForAllotment({
          allotmentId,
          periodMonth,
          occupancyFrom: built.calculation.occupancyFrom!,
          occupancyTo: built.calculation.occupancyTo!,
        });
        if (overlap) {
          return sendApiError(
            res,
            409,
            "RENT_INVOICE_OCCUPANCY_OVERLAP",
            "A rent invoice already exists for this allotment, billing month, and overlapping occupancy dates.",
            { existingId: overlap.id, existingInvoiceNo: overlap.invoiceNo },
          );
        }
        rentAmount = built.calculation.rentAmount;
        billingTypeInsert = built.calculation.billingType;
        occupancyFromInsert = built.calculation.occupancyFrom;
        occupancyToInsert = built.calculation.occupancyTo;
        daysInMonthInsert = built.calculation.daysInMonth;
        billableDaysInsert = built.calculation.billableDays;
        billingFactorInsert = built.calculation.billingFactor;
        baseMonthlyRentInsert = built.calculation.baseMonthlyRent;
        billingConfigJsonInsert = JSON.stringify(built.calculation.configSnapshot);
      } else if (allotmentId && useManualRentAmount) {
        const resolved = await resolveRentForAllotmentPeriodMonth(allotmentId, periodMonth);
        if (
          Number.isFinite(resolved.rentAmount) &&
          resolved.rentAmount > MIN_RENT_INVOICE_AMOUNT_INR
        ) {
          rentAmount = resolved.rentAmount;
        }
      }

      const tdsRes = await resolveRentInvoiceTdsFields({
        tenantLicenceId,
        rentAmount,
        periodMonth,
        isGstExemptTenant: gstExempt,
      });
      if ("error" in tdsRes) {
        return sendApiError(res, 400, "RENT_INVOICE_TDS", tdsRes.error);
      }
      const mergedCfg = await getMergedSystemConfig();
      if (gstExempt) {
        cgst = 0;
        sgst = 0;
        totalAmount = rentInvoiceTotalInr(rentAmount, nonGst.sum, 0, 0);
      } else {
        const cgstPct = parseSystemConfigNumber(mergedCfg, "rent_invoice_cgst_percent");
        const sgstPct = parseSystemConfigNumber(mergedCfg, "rent_invoice_sgst_percent");
        const g = computeRentInvoiceGstInr(rentAmount, false, cgstPct, sgstPct);
        cgst = g.cgst;
        sgst = g.sgst;
        totalAmount = rentInvoiceTotalInr(rentAmount, nonGst.sum, cgst, sgst);
      }
      const zeroMsg = rentInvoiceValidationErrorMessage(rentAmount, totalAmount);
      if (zeroMsg) {
        return sendApiError(res, 400, "RENT_INVOICE_ZERO_AMOUNT", zeroMsg);
      }
      let assetIdForInvoice = String(body.assetId ?? "").trim();
      if (allotmentId) {
        const [aa] = await db
          .select({ assetId: assetAllotments.assetId })
          .from(assetAllotments)
          .where(eq(assetAllotments.id, allotmentId))
          .limit(1);
        if (aa?.assetId) assetIdForInvoice = aa.assetId;
        if (!aa?.assetId) {
          const [ea] = await db
            .select({ assetId: entityAllotments.assetId })
            .from(entityAllotments)
            .where(eq(entityAllotments.id, allotmentId))
            .limit(1);
          if (ea?.assetId) assetIdForInvoice = ea.assetId;
        }
      }
      const assetIdCanonical = await normalizeRentInvoiceAssetId(assetIdForInvoice);
      if (!assetIdCanonical) {
        return sendApiError(res, 400, "RENT_INVOICE_ASSET_REQUIRED", "Premises (asset) is required for the rent invoice.");
      }
      if (!occupancyFromInsert || !occupancyToInsert) {
        const premisesClash = await findBlockingRentInvoiceForPremisesMonth(assetIdCanonical, periodMonth);
        if (premisesClash) {
          return sendApiError(res, 409, "RENT_INVOICE_PREMISES_MONTH_DUPLICATE", RENT_INVOICE_PREMISES_MONTH_DUPLICATE_MESSAGE);
        }
      }
      const manualInvoiceNo = body.invoiceNo ? String(body.invoiceNo).trim() : "";
      const [row] = await db.transaction(async (tx) => {
        const invoiceNo =
          manualInvoiceNo ||
          (await allocateRentInvoiceNoInTx(tx, { yardId, periodMonth }));
        await tx.insert(rentInvoices).values({
          id,
          allotmentId,
          allotmentKind: allotmentKindInsert,
          entityId: entityIdInsert,
          tenantLicenceId,
          assetId: assetIdCanonical,
          yardId,
          periodMonth,
          billingType: billingTypeInsert,
          occupancyFrom: occupancyFromInsert,
          occupancyTo: occupancyToInsert,
          daysInMonth: daysInMonthInsert,
          billableDays: billableDaysInsert,
          billingFactor: billingFactorInsert,
          baseMonthlyRent: baseMonthlyRentInsert,
          billingConfigJson: billingConfigJsonInsert,
          rentAmount,
          nonGstChargesJson: nonGst.json,
          cgst,
          sgst,
          totalAmount,
          tdsApplicable: tdsRes.tdsApplicable,
          tdsAmount: tdsRes.tdsAmount,
          status: "Draft",
          isGovtEntity,
          invoiceNo,
          doUser: req.user?.id ?? null,
          dvUser: null,
          daUser: null,
          generatedAt: null,
          approvedAt: null,
        });
        return tx.select().from(rentInvoices).where(eq(rentInvoices.id, id));
      });
      writeAuditLog(req, { module: "Rent/Tax", action: "Create", recordId: id, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create rent invoice");
    }
  });

  // ----- M-03 Sr.17: rent context for revision drafts (aligns with invoice/cron resolution) -----
  app.get("/api/ioms/rent/allotments/:allotmentId/rent-context", async (req, res) => {
    try {
      const allotmentId = routeParamString(req.params.allotmentId);
      const pmRaw = req.query.periodMonth as string | undefined;
      const emRaw = req.query.effectiveMonth as string | undefined;
      const assetRow = await fetchYardScopeForAllotmentId(allotmentId);
      if (!assetRow) return sendApiError(res, 404, "ALLOTMENT_NOT_FOUND", "Allotment not found");
      const scopedIds = req.scopedLocationIds;
      if (scopedIds && scopedIds.length > 0 && !scopedIds.includes(assetRow.yardId)) {
        return sendApiError(res, 403, "RENT_CONTEXT_YARD_ACCESS_DENIED", "You do not have access to this yard");
      }

      if (pmRaw != null && String(pmRaw).trim() !== "") {
        const pm = String(pmRaw).trim();
        if (!isValidYearMonthYm(pm)) {
          return sendApiError(res, 400, "RENT_CONTEXT_MONTH", "periodMonth must be YYYY-MM");
        }
        const resolved = await resolveRentForAllotmentPeriodMonth(allotmentId, pm);
        const agreement = await fetchAllotmentAgreement(allotmentId);
        const suggestedBillingType = agreement
          ? inferBillingTypeForMonth({
              periodMonth: pm,
              agreementFrom: agreement.fromDate,
              agreementTo: agreement.toDate,
            })
          : "FullMonth";
        const defaultOccupancy = agreement
          ? defaultOccupancyForBillingType({
              billingType: suggestedBillingType,
              periodMonth: pm,
              agreementFrom: agreement.fromDate,
              agreementTo: agreement.toDate,
            })
          : null;
        const blockingInvoice =
          assetRow.assetId != null
            ? await findBlockingRentInvoiceForPremisesMonth(assetRow.assetId, pm)
            : null;
        return res.json({
          allotmentId,
          periodMonth: pm,
          resolvedRent: resolved.rentAmount,
          source: resolved.source,
          matchedRevisionId: resolved.matchedRevisionId,
          matchedInvoiceId: resolved.matchedInvoiceId,
          blockingInvoice,
          agreementFrom: agreement?.fromDate ?? null,
          agreementTo: agreement?.toDate ?? null,
          suggestedBillingType,
          defaultOccupancy,
        });
      }

      let referenceMonth: string;
      let effectiveMonth: string | null = null;
      if (emRaw != null && String(emRaw).trim() !== "") {
        const em = String(emRaw).trim();
        if (!isValidYearMonthYm(em)) {
          return sendApiError(res, 400, "RENT_CONTEXT_MONTH", "effectiveMonth must be YYYY-MM when provided");
        }
        effectiveMonth = em;
        const prior = yearMonthMinusOne(em);
        if (!prior) return sendApiError(res, 400, "RENT_CONTEXT_MONTH", "effectiveMonth must be YYYY-MM");
        referenceMonth = prior;
      } else {
        referenceMonth = currentYearMonthUtc();
      }

      const resolved = await resolveRentForAllotmentPeriodMonth(allotmentId, referenceMonth);
      res.json({
        allotmentId,
        effectiveMonth,
        referenceMonth,
        resolvedRent: resolved.rentAmount,
        source: resolved.source,
        matchedRevisionId: resolved.matchedRevisionId,
        matchedInvoiceId: resolved.matchedInvoiceId,
      });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to resolve rent context");
    }
  });

  // ----- M-03 Sr.17: Rent revision overrides -----
  app.get("/api/ioms/rent/revisions", async (req, res) => {
    try {
      const allotmentId = req.query.allotmentId as string | undefined;
      let list = await db.select().from(rentRevisionOverrides).orderBy(desc(rentRevisionOverrides.effectiveMonth));
      if (allotmentId) list = list.filter((r) => r.allotmentId === allotmentId);
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch rent revisions");
    }
  });

  app.post("/api/ioms/rent/revisions", async (req, res) => {
    try {
      const body = req.body as Record<string, unknown>;
      const allotmentId = String(body.allotmentId ?? "");
      const effectiveMonth = String(body.effectiveMonth ?? "").trim();
      const rentAmount = Number(body.rentAmount ?? NaN);
      if (!allotmentId || !effectiveMonth || !Number.isFinite(rentAmount)) {
        return sendApiError(res, 400, "RENT_REV_FIELDS", "allotmentId, effectiveMonth (YYYY-MM), rentAmount (number) required");
      }
      if (rentAmount <= MIN_RENT_INVOICE_AMOUNT_INR) {
        return sendApiError(
          res,
          400,
          "RENT_REV_ZERO_AMOUNT",
          "Rent revision amount must be greater than zero.",
        );
      }
      if (!isValidYearMonthYm(effectiveMonth)) {
        return sendApiError(res, 400, "RENT_REV_MONTH", "effectiveMonth must be YYYY-MM");
      }
      const assetScope = await fetchYardScopeForAllotmentId(allotmentId);
      if (!assetScope) return sendApiError(res, 404, "ALLOTMENT_NOT_FOUND", "Allotment not found");
      const scopedIds = req.scopedLocationIds;
      if (scopedIds && scopedIds.length > 0 && !scopedIds.includes(assetScope.yardId)) {
        return sendApiError(res, 403, "RENT_REV_YARD_ACCESS_DENIED", "You do not have access to this yard");
      }

      if (!canCreateRentRevision(req.user)) {
        return sendApiError(res, 403, "RENT_REV_CREATE_DENIED", "Only Data Originator or Admin can create rent revision drafts");
      }

      const revisionBasis = normalizeRentRevisionBasis(body.revisionBasis);
      const remarksStr = body.remarks ? String(body.remarks).trim() : "";
      if (revisionBasis === "OtherDocumented" && remarksStr.length < 20) {
        return sendApiError(
          res,
          400,
          "RENT_REV_REMARKS_OTHER",
          "When revision basis is Other (documented), remarks must be at least 20 characters.",
        );
      }

      const id = nanoid();
      const uid = req.user?.id ?? null;
      await db.insert(rentRevisionOverrides).values({
        id,
        allotmentId,
        effectiveMonth,
        rentAmount,
        revisionBasis,
        remarks: remarksStr ? remarksStr : null,
        status: "Draft",
        doUser: uid,
        dvUser: null,
        daUser: null,
        verifiedAt: null,
        approvedAt: null,
        workflowRevisionCount: 0,
        dvReturnRemarks: null,
        createdAt: nowIso(),
        createdBy: uid,
      });
      const [row] = await db.select().from(rentRevisionOverrides).where(eq(rentRevisionOverrides.id, id)).limit(1);
      if (row) writeAuditLog(req, { module: "Rent/Tax", action: "Create", recordId: id, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create rent revision");
    }
  });

  app.put("/api/ioms/rent/revisions/:id", async (req, res) => {
    try {
      const id = routeParamString(req.params.id);
      const body = req.body as Record<string, unknown>;
      const [existing] = await db.select().from(rentRevisionOverrides).where(eq(rentRevisionOverrides.id, id)).limit(1);
      if (!existing) return sendApiError(res, 404, "RENT_REV_NOT_FOUND", "Not found");
      const assetScope = await fetchYardScopeForAllotmentId(existing.allotmentId);
      if (!assetScope) return sendApiError(res, 404, "ALLOTMENT_NOT_FOUND", "Allotment not found");
      const scopedIds = req.scopedLocationIds;
      if (scopedIds && scopedIds.length > 0 && !scopedIds.includes(assetScope.yardId)) {
        return sendApiError(res, 403, "RENT_REV_YARD_ACCESS_DENIED", "You do not have access to this yard");
      }

      const newStatus = body.status !== undefined ? String(body.status) : String(existing.status ?? "Draft");
      const statusChange = newStatus !== String(existing.status ?? "Draft");
      const transition = statusChange ? canTransitionRentRevision(req.user, String(existing.status ?? "Draft"), newStatus) : null;

      let dvReturnRemarks: string | null = null;
      if (statusChange) {
        if (!transition?.allowed) {
          return sendApiError(
            res,
            403,
            "RENT_REV_STATUS_TRANSITION_DENIED",
            `You cannot change status from ${String(existing.status)} to ${newStatus}.`,
          );
        }
        const seg = assertSegregationDoDvDa(
          req.user,
          {
            doUser: existing.doUser ?? existing.createdBy,
            dvUser: existing.dvUser,
            daUser: existing.daUser,
          },
          { setDvUser: transition?.setDvUser, setDaUser: transition?.setDaUser },
        );
        if (!seg.ok) {
          return sendApiError(res, 403, "RENT_REV_DO_DV_DA_SEGREGATION", seg.error);
        }
        if (String(existing.status ?? "Draft") === "Verified" && newStatus === "Draft") {
          const ret = validateDvReturnToDraft(body);
          if (!ret.ok) return sendApiError(res, 400, "RENT_REV_DV_RETURN_INVALID", ret.error);
          dvReturnRemarks = ret.remarks;
        }
      } else if (!canEditDraftRentRevision(req.user, { status: String(existing.status ?? "Draft"), doUser: existing.doUser ?? existing.createdBy })) {
        return sendApiError(res, 403, "RENT_REV_DRAFT_EDIT_DENIED", "Only the originating DO (or Admin) can edit draft revision fields");
      }

      const updates: Record<string, unknown> = {};
      if (!statusChange) {
        if (String(existing.status ?? "Draft") !== "Draft") {
          return sendApiError(res, 400, "RENT_REV_NOT_DRAFT", "Only Draft revisions can be edited");
        }
        if (body.effectiveMonth !== undefined) {
          const em = String(body.effectiveMonth ?? "").trim();
          if (!isValidYearMonthYm(em)) return sendApiError(res, 400, "RENT_REV_MONTH", "effectiveMonth must be YYYY-MM");
          updates.effectiveMonth = em;
        }
        if (body.rentAmount !== undefined) {
          const ra = Number(body.rentAmount);
          if (!Number.isFinite(ra)) return sendApiError(res, 400, "RENT_REV_AMOUNT", "rentAmount must be a number");
          if (ra <= MIN_RENT_INVOICE_AMOUNT_INR) {
            return sendApiError(
              res,
              400,
              "RENT_REV_ZERO_AMOUNT",
              "Rent revision amount must be greater than zero.",
            );
          }
          updates.rentAmount = ra;
        }
        if (body.revisionBasis !== undefined) {
          updates.revisionBasis = normalizeRentRevisionBasis(body.revisionBasis);
        }
        if (body.remarks !== undefined) updates.remarks = body.remarks == null ? null : String(body.remarks);
        const mergedBasis =
          updates.revisionBasis !== undefined ? String(updates.revisionBasis) : String(existing.revisionBasis ?? "FixedMonthlyRent");
        const mergedRemarks =
          updates.remarks !== undefined ? (updates.remarks as string | null) : (existing.remarks ?? null);
        const mergedRemarksTrim = mergedRemarks != null ? String(mergedRemarks).trim() : "";
        if (mergedBasis === "OtherDocumented" && mergedRemarksTrim.length < 20) {
          return sendApiError(
            res,
            400,
            "RENT_REV_REMARKS_OTHER",
            "When revision basis is Other (documented), remarks must be at least 20 characters.",
          );
        }
      } else {
        updates.status = newStatus;
        const now = nowIso();
        if (String(existing.status ?? "Draft") === "Draft" && newStatus === "Verified") {
          updates.dvUser = req.user?.id ?? null;
          updates.verifiedAt = now;
          updates.dvReturnRemarks = null;
        }
        if (String(existing.status ?? "Draft") === "Verified" && newStatus === "Approved") {
          updates.daUser = req.user?.id ?? null;
          updates.approvedAt = now;
        }
        if (String(existing.status ?? "Draft") === "Verified" && newStatus === "Draft") {
          updates.dvReturnRemarks = dvReturnRemarks;
          updates.workflowRevisionCount = Number(existing.workflowRevisionCount ?? 0) + 1;
          updates.daUser = null;
          updates.approvedAt = null;
        }
      }

      if (Object.keys(updates).length === 0) {
        return sendApiError(res, 400, "RENT_REV_NO_CHANGES", "No changes supplied");
      }

      await db.update(rentRevisionOverrides).set(updates as Record<string, never>).where(eq(rentRevisionOverrides.id, id));
      const [row] = await db.select().from(rentRevisionOverrides).where(eq(rentRevisionOverrides.id, id)).limit(1);
      const action = statusChange ? "Workflow" : "Update";
      if (row) writeAuditLog(req, { module: "Rent/Tax", action, recordId: id, beforeValue: existing, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to update rent revision");
    }
  });

  app.delete("/api/ioms/rent/revisions/:id", async (req, res) => {
    try {
      const id = routeParamString(req.params.id);
      const [existing] = await db.select().from(rentRevisionOverrides).where(eq(rentRevisionOverrides.id, id)).limit(1);
      if (!existing) return sendApiError(res, 404, "RENT_REV_NOT_FOUND", "Not found");
      const assetScope = await fetchYardScopeForAllotmentId(existing.allotmentId);
      if (!assetScope) return sendApiError(res, 404, "ALLOTMENT_NOT_FOUND", "Allotment not found");
      const scopedIds = req.scopedLocationIds;
      if (scopedIds && scopedIds.length > 0 && !scopedIds.includes(assetScope.yardId)) {
        return sendApiError(res, 403, "RENT_REV_YARD_ACCESS_DENIED", "You do not have access to this yard");
      }
      const st = String(existing.status ?? "Draft");
      const isAdmin = Boolean(req.user?.roles?.some((r) => r.tier === "ADMIN"));
      if (!isAdmin && st !== "Draft") {
        return sendApiError(res, 400, "RENT_REV_DELETE_NOT_DRAFT", "Only Draft revisions can be deleted");
      }
      if (!isAdmin && st === "Draft") {
        const doUid = existing.doUser ?? existing.createdBy;
        if (!doUid || doUid !== req.user?.id) {
          return sendApiError(res, 403, "RENT_REV_DELETE_DENIED", "Only the originating DO can delete their Draft revision");
        }
      }
      await db.delete(rentRevisionOverrides).where(eq(rentRevisionOverrides.id, id));
      writeAuditLog(req, { module: "Rent/Tax", action: "Delete", recordId: id, beforeValue: existing }).catch((e) => console.error("Audit log failed:", e));
      res.status(204).send();
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to delete rent revision");
    }
  });

  app.put("/api/ioms/rent/invoices/:id", async (req, res) => {
    try {
      const id = routeParamString(req.params.id);
      const [existing] = await db.select().from(rentInvoices).where(eq(rentInvoices.id, id)).limit(1);
      if (!existing) {
        return sendApiError(res, 404, "RENT_INVOICE_NOT_FOUND", "Rent invoice not found");
      }
      const scopedIds = req.scopedLocationIds;
      if (scopedIds && scopedIds.length > 0 && !scopedIds.includes(existing.yardId)) {
        return sendApiError(res, 404, "RENT_INVOICE_NOT_FOUND", "Rent invoice not found");
      }
      const body = req.body;
      const newStatus = body.status !== undefined ? String(body.status) : existing.status;
      const statusChange = newStatus !== existing.status;
      const transition = statusChange ? canTransitionRentInvoice(req.user, existing.status, newStatus) : null;

      let dvReturnRemarks: string | null = null;
      if (statusChange) {
        if (!transition?.allowed) {
          return sendApiError(
            res,
            403,
            "RENT_INVOICE_STATUS_TRANSITION_DENIED",
            `You cannot change status from ${existing.status} to ${newStatus}. Only DV can verify; only DA can approve.`,
          );
        }
        const seg = assertSegregationDoDvDa(req.user, existing, {
          setDvUser: transition?.setDvUser,
          setDaUser: transition?.setDaUser,
        });
        if (!seg.ok) {
          return sendApiError(res, 403, "RENT_INVOICE_DO_DV_DA_SEGREGATION", seg.error);
        }
        if (existing.status === "Verified" && newStatus === "Draft") {
          const ret = validateDvReturnToDraft(body as Record<string, unknown>);
          if (!ret.ok) return sendApiError(res, 400, "RENT_INVOICE_DV_RETURN_INVALID", ret.error);
          dvReturnRemarks = ret.remarks;
        }
        if (newStatus === "Cancelled") {
          const linkedReceipts = await db
            .select()
            .from(iomsReceipts)
            .where(and(eq(iomsReceipts.sourceModule, "M-03"), eq(iomsReceipts.sourceRecordId, id)));
          const hasSettled = linkedReceipts.some(
            (r) => String(r.status ?? "") === "Paid" || String(r.status ?? "") === "Reconciled",
          );
          if (hasSettled) {
            return sendApiError(
              res,
              400,
              "RENT_INVOICE_CANCEL_HAS_PAYMENT",
              "Cannot cancel: this invoice has a Paid or Reconciled M-03 receipt. Use credit note or receipt reversal per policy.",
            );
          }
          for (const r of linkedReceipts) {
            if (String(r.status ?? "") === "Pending") {
              await db
                .update(iomsReceipts)
                .set({ status: "Failed", gatewayRef: "InvoiceCancelled" })
                .where(eq(iomsReceipts.id, r.id));
            }
          }
        }
      } else if (existing.status === "Draft" && !canEditDraftRentInvoice(req.user)) {
        return sendApiError(
          res,
          403,
          "RENT_INVOICE_DRAFT_EDIT_DENIED",
          "Only Data Originator or Admin can edit draft invoices",
        );
      }

      const updates: Record<string, unknown> = {};
      ["invoiceNo", "allotmentId", "tenantLicenceId", "assetId", "yardId", "periodMonth", "rentAmount", "cgst", "sgst", "totalAmount", "isGovtEntity", "status", "doUser", "dvUser", "daUser", "generatedAt", "approvedAt"].forEach((k) => {
        if (body[k] === undefined) return;
        if (["rentAmount", "cgst", "sgst", "totalAmount"].includes(k)) updates[k] = Number(body[k]);
        else if (k === "isGovtEntity") updates.isGovtEntity = Boolean(body.isGovtEntity);
        else updates[k] = body[k] == null ? null : String(body[k]);
      });
      if ((body as Record<string, unknown>).nonGstCharges !== undefined) {
        const parsed = parseNonGstCharges((body as Record<string, unknown>).nonGstCharges);
        if (!parsed.ok) return sendApiError(res, 400, "RENT_INVOICE_NON_GST_CHARGES", parsed.error);
        updates.nonGstChargesJson = parsed.json;
      }

      const now = new Date().toISOString();
      if (transition?.setDvUser) updates.dvUser = req.user?.id ?? null;
      if (transition?.setDaUser) {
        updates.daUser = req.user?.id ?? null;
        if (newStatus === "Approved") updates.approvedAt = now;
      }

      if (dvReturnRemarks !== null) {
        updates.dvReturnRemarks = dvReturnRemarks;
        updates.workflowRevisionCount = Number(existing.workflowRevisionCount ?? 0) + 1;
      }

      const finalTenant =
        (updates.tenantLicenceId as string | undefined) ?? existing.tenantLicenceId;
      const finalRent =
        updates.rentAmount != null ? Number(updates.rentAmount) : Number(existing.rentAmount ?? 0);
      let rawNonGstMerge: unknown = null;
      if ((updates as Record<string, unknown>).nonGstChargesJson !== undefined) {
        const j = (updates as Record<string, unknown>).nonGstChargesJson;
        if (j == null) rawNonGstMerge = null;
        else {
          try {
            rawNonGstMerge = typeof j === "string" ? JSON.parse(j) : j;
          } catch {
            rawNonGstMerge = null;
          }
        }
      } else if (existing.nonGstChargesJson) {
        try {
          rawNonGstMerge = JSON.parse(String(existing.nonGstChargesJson));
        } catch {
          rawNonGstMerge = null;
        }
      }
      const nonGstLines = parseNonGstCharges(rawNonGstMerge);
      const nonGstSum = nonGstLines.ok ? nonGstLines.sum : 0;
      if (existing.status === "Draft" && !statusChange) {
        const trackAExempt =
          finalTenant && !String(finalTenant).startsWith("TB:")
            ? await tenantLicenceIsGstExempt(finalTenant)
            : false;
        const gstExemptDraft = Boolean(trackAExempt || existing.isGovtEntity);
        if (gstExemptDraft) {
          updates.cgst = 0;
          updates.sgst = 0;
          updates.totalAmount = rentInvoiceTotalInr(finalRent, nonGstSum, 0, 0);
          if (trackAExempt) updates.isGovtEntity = true;
        } else {
          const mergedPatch = await getMergedSystemConfig();
          const cgstPct = parseSystemConfigNumber(mergedPatch, "rent_invoice_cgst_percent");
          const sgstPct = parseSystemConfigNumber(mergedPatch, "rent_invoice_sgst_percent");
          const g = computeRentInvoiceGstInr(finalRent, false, cgstPct, sgstPct);
          updates.cgst = g.cgst;
          updates.sgst = g.sgst;
          updates.totalAmount = rentInvoiceTotalInr(finalRent, nonGstSum, g.cgst, g.sgst);
        }
      }

      const effectiveStatus = statusChange ? newStatus : existing.status;
      const mergeTenant = ((updates.tenantLicenceId as string | undefined) ?? existing.tenantLicenceId) || "";
      const mergeRent =
        updates.rentAmount != null ? Number(updates.rentAmount) : Number(existing.rentAmount ?? 0);
      const mergePeriodMonth =
        (updates.periodMonth as string | undefined) ?? existing.periodMonth ?? "";
      const shouldRecomputeTds =
        existing.status === "Draft" && (effectiveStatus === "Draft" || effectiveStatus === "Verified");
      if (shouldRecomputeTds) {
        if (!isValidYearMonthYm(String(mergePeriodMonth ?? "").trim())) {
          return sendApiError(res, 400, "RENT_INVOICE_PERIOD_MONTH", "periodMonth must be YYYY-MM for rent TDS / FY cumulative logic.");
        }
        const exempt = mergeTenant ? await tenantLicenceIsGstExempt(mergeTenant) : false;
        const tdsRes = await resolveRentInvoiceTdsFields({
          tenantLicenceId: mergeTenant,
          rentAmount: mergeRent,
          periodMonth: mergePeriodMonth,
          isGstExemptTenant: exempt,
          excludeInvoiceId: id,
        });
        if ("error" in tdsRes) {
          return sendApiError(res, 400, "RENT_INVOICE_TDS", tdsRes.error);
        }
        updates.tdsApplicable = tdsRes.tdsApplicable;
        updates.tdsAmount = tdsRes.tdsAmount;
      }

      const mergedRentForValidation =
        updates.rentAmount != null ? Number(updates.rentAmount) : Number(existing.rentAmount ?? 0);
      const mergedTotalForValidation =
        updates.totalAmount != null ? Number(updates.totalAmount) : Number(existing.totalAmount ?? 0);
      if (effectiveStatus !== "Cancelled") {
        const zeroPutMsg = rentInvoiceValidationErrorMessage(mergedRentForValidation, mergedTotalForValidation);
        if (zeroPutMsg) {
          return sendApiError(res, 400, "RENT_INVOICE_ZERO_AMOUNT", zeroPutMsg);
        }
      }

      let mergedAssetIdPut =
        updates.assetId !== undefined ? String(updates.assetId ?? "").trim() : String(existing.assetId ?? "").trim();
      if (updates.assetId !== undefined && mergedAssetIdPut) {
        const normalizedPut = await normalizeRentInvoiceAssetId(mergedAssetIdPut);
        if (normalizedPut) {
          mergedAssetIdPut = normalizedPut;
          updates.assetId = normalizedPut;
        }
      }
      const mergedPeriodMonthPut =
        updates.periodMonth !== undefined ? String(updates.periodMonth ?? "").trim() : String(existing.periodMonth ?? "").trim();
      const mergedStatusPut =
        updates.status !== undefined ? String(updates.status ?? "").trim() : String(existing.status ?? "").trim();
      if (mergedStatusPut !== "Cancelled" && mergedAssetIdPut && mergedPeriodMonthPut) {
        const clashPut = await findBlockingRentInvoiceForPremisesMonth(mergedAssetIdPut, mergedPeriodMonthPut, id);
        if (clashPut) {
          return sendApiError(res, 409, "RENT_INVOICE_PREMISES_MONTH_DUPLICATE", RENT_INVOICE_PREMISES_MONTH_DUPLICATE_MESSAGE);
        }
      }

      const mergedInvoiceNo =
        updates.invoiceNo !== undefined
          ? String(updates.invoiceNo ?? "").trim() || null
          : String(existing.invoiceNo ?? "").trim() || null;
      if (
        !mergedInvoiceNo &&
        statusChange &&
        ["Verified", "Approved", "Paid", "Overdue"].includes(String(newStatus))
      ) {
        updates.invoiceNo = await allocateRentInvoiceNo({
          yardId: existing.yardId,
          periodMonth: mergedPeriodMonthPut || existing.periodMonth,
        });
      }

      await db.update(rentInvoices).set(updates as Record<string, string | number | boolean | null>).where(eq(rentInvoices.id, id));
      const [row] = await db.select().from(rentInvoices).where(eq(rentInvoices.id, id));
      if (!row) return sendApiError(res, 404, "RENT_INVOICE_NOT_FOUND", "Not found");

      // Phase-1 linkage: when a rent invoice becomes Approved/Paid, ensure a matching IOMS receipt exists.
      // Note: current UI doesn't expose a "Mark Paid" flow for M-03 yet; this keeps receipts ready for later payment wiring.
      if (statusChange && (newStatus === "Approved" || newStatus === "Paid")) {
        const [existingReceipt] = await db
          .select()
          .from(iomsReceipts)
          .where(and(eq(iomsReceipts.sourceModule, "M-03"), eq(iomsReceipts.sourceRecordId, id)))
          .limit(1);

        let receiptRow = existingReceipt ?? null;

        if (!receiptRow) {
          const createdBy = req.user?.id ?? "system";
          const revenueHead = row.isGovtEntity ? "GSTInvoice" : "Rent";
          const cp = await resolveRentInvoiceCounterparty(row);

          const created = await createIomsReceipt({
            yardId: row.yardId,
            revenueHead,
            payerName: cp.payerName,
            payerType: cp.payerType,
            payerRefId: cp.payerRefId,
            amount: Number(row.rentAmount ?? 0) + Number(nonGstSum || 0),
            cgst: row.cgst,
            sgst: row.sgst,
            tdsAmount: Number(row.tdsAmount ?? 0) || 0,
            paymentMode: "Cash",
            sourceModule: "M-03",
            sourceRecordId: row.id,
            unifiedEntityId: cp.unifiedEntityId,
            createdBy,
          });

          const [createdRow] = await db.select().from(iomsReceipts).where(eq(iomsReceipts.id, created.id)).limit(1);
          receiptRow = createdRow ?? null;
          if (createdRow) {
            await writeAuditLog(req, { module: "Receipts", action: "Create", recordId: createdRow.id, afterValue: createdRow }).catch((e) => {
              console.error("Audit log failed:", e);
            });
          }
        } else {
          const tds = Number(row.tdsAmount ?? 0) || 0;
          if (Number(receiptRow.tdsAmount ?? 0) !== tds) {
            await db.update(iomsReceipts).set({ tdsAmount: tds }).where(eq(iomsReceipts.id, receiptRow.id));
            const [synced] = await db.select().from(iomsReceipts).where(eq(iomsReceipts.id, receiptRow.id)).limit(1);
            if (synced) receiptRow = synced;
          }
        }

        if (newStatus === "Paid" && receiptRow && receiptRow.status !== "Paid") {
          const beforeReceipt = receiptRow;
          await db
            .update(iomsReceipts)
            .set({ status: "Paid", gatewayRef: "Manual" })
            .where(eq(iomsReceipts.id, receiptRow.id));

          const [paidRow] = await db.select().from(iomsReceipts).where(eq(iomsReceipts.id, receiptRow.id)).limit(1);
          if (paidRow) {
            await writeAuditLog(req, {
              module: "Receipts",
              action: "Update",
              recordId: paidRow.id,
              beforeValue: beforeReceipt,
              afterValue: paidRow,
            }).catch((e) => console.error("Audit log failed:", e));
            try {
              await applyM03ReceiptToRentDepositLedger(paidRow);
            } catch (e) {
              console.error("[rent-invoice] rent deposit Collection hook failed:", e);
            }
          }
        }
      }

      writeAuditLog(req, { module: "Rent/Tax", action: "Update", recordId: id, beforeValue: existing, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to update rent invoice");
    }
  });

  // ----- Rent deposit ledger -----
  /** IOMS receipts (any module) where payer is this Track A trader licence — read-only context beside deposit ledger rows. */
  app.get("/api/ioms/rent/ledger/trader-receipts", async (req, res) => {
    try {
      const unifiedRaw = String(req.query.unifiedEntityId ?? "").trim();
      const tenantLicenceId = String(req.query.tenantLicenceId ?? "").trim();
      let tid: string | null = tenantLicenceId || null;
      if (unifiedRaw) {
        const parsed = parseUnifiedEntityId(unifiedRaw);
        if (!parsed) {
          return sendApiError(res, 400, "LEDGER_UNIFIED_ID", "unifiedEntityId must be TA:<id> | TB:<id> | AH:<id>");
        }
        if (parsed.kind !== "TA") {
          const rows = await db
            .select()
            .from(iomsReceipts)
            .where(eq(iomsReceipts.unifiedEntityId, unifiedRaw))
            .orderBy(desc(iomsReceipts.createdAt))
            .limit(200);
          return res.json(rows);
        }
        tid = parsed.refId;
      }
      if (!tid) {
        return sendApiError(res, 400, "LEDGER_TENANT_REQUIRED", "tenantLicenceId or unifiedEntityId is required");
      }
      const [lic] = await db.select().from(traderLicences).where(eq(traderLicences.id, tid)).limit(1);
      if (!lic) return sendApiError(res, 404, "LICENCE_NOT_FOUND", "Licence not found");
      const scopeRentRcpt = await assertTraderLicenceAccessibleInUserScope(db, req, lic);
      if (!scopeRentRcpt.ok) return sendApiError(res, 404, "LICENCE_NOT_FOUND", "Licence not found");
      const rows = await db
        .select()
        .from(iomsReceipts)
        .where(and(eq(iomsReceipts.payerType, "TraderLicence"), eq(iomsReceipts.payerRefId, tid)))
        .orderBy(desc(iomsReceipts.createdAt))
        .limit(200);
      res.json(rows);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch trader-linked receipts");
    }
  });

  app.get("/api/ioms/rent/ledger", async (req, res) => {
    try {
      const unifiedRaw = String(req.query.unifiedEntityId ?? "").trim();
      const tenantLicenceId = req.query.tenantLicenceId as string | undefined;
      const assetId = req.query.assetId as string | undefined;
      let list = await listRentDepositLedgerEnriched();
      if (unifiedRaw) {
        const parsed = parseUnifiedEntityId(unifiedRaw);
        if (!parsed) {
          return sendApiError(res, 400, "LEDGER_UNIFIED_ID", "unifiedEntityId must be TA:<id> | TB:<id> | AH:<id>");
        }
        list = list.filter((r) => ledgerRowMatchesUnifiedEntityFilter(r, unifiedRaw));
      } else if (tenantLicenceId) {
        list = list.filter((r) => r.tenantLicenceId === tenantLicenceId);
      }
      if (assetId) list = list.filter((r) => r.assetId === assetId);
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch ledger");
    }
  });

  app.post("/api/ioms/rent/ledger", async (req, res) => {
    try {
      const body = req.body;
      const id = nanoid();
      const tid = String(body.tenantLicenceId ?? "").trim();
      await db.insert(rentDepositLedger).values({
        id,
        tenantLicenceId: tid,
        unifiedEntityId: tid ? unifiedEntityIdFromTrackA(tid) : null,
        assetId: String(body.assetId ?? ""),
        entryDate: String(body.entryDate ?? ""),
        entryType: String(body.entryType ?? "Rent"),
        debit: body.debit != null ? Number(body.debit) : 0,
        credit: body.credit != null ? Number(body.credit) : 0,
        balance: Number(body.balance ?? 0),
        invoiceId: body.invoiceId ? String(body.invoiceId) : null,
        receiptId: body.receiptId ? String(body.receiptId) : null,
        interestPaymentStatus: body.interestPaymentStatus != null ? String(body.interestPaymentStatus) : null,
        settledReceiptId: body.settledReceiptId != null ? String(body.settledReceiptId) : null,
      });
      const [row] = await db.select().from(rentDepositLedger).where(eq(rentDepositLedger.id, id));
      if (row) writeAuditLog(req, { module: "Rent/Tax", action: "Create", recordId: id, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create ledger entry");
    }
  });

  /**
   * Record counter payment against M-03 rent invoice outstanding and/or unpaid interest accrual lines on the deposit ledger.
   * Creates a Paid IOMS receipt and posts Collection / InterestCollection ledger rows (same hooks as receipt status flow).
   */
  app.post("/api/ioms/rent/ledger/record-payment", async (req, res) => {
    try {
      if (!canRunM03RentArrearsInterest(req.user) && !canCreateRentInvoice(req.user)) {
        return sendApiError(
          res,
          403,
          "LEDGER_PAYMENT_DENIED",
          "Only Data Originator, Data Approver, or Admin can record rent deposit ledger payments",
        );
      }
      const body = req.body as Record<string, unknown>;
      const mode = String(body.mode ?? "").trim();
      const invoiceId = String(body.invoiceId ?? "").trim();
      const paymentMode = String(body.paymentMode ?? "Cash").trim();
      if (!invoiceId || !["rent_only", "interest_only", "combined"].includes(mode)) {
        return sendApiError(res, 400, "LEDGER_PAY_FIELDS", "invoiceId and mode (rent_only | interest_only | combined) are required");
      }

      const [inv] = await db.select().from(rentInvoices).where(eq(rentInvoices.id, invoiceId)).limit(1);
      if (!inv) return sendApiError(res, 404, "RENT_INVOICE_NOT_FOUND", "Rent invoice not found");
      const scopedIds = req.scopedLocationIds;
      if (scopedIds && scopedIds.length > 0 && !scopedIds.includes(inv.yardId)) {
        return sendApiError(res, 404, "RENT_INVOICE_NOT_FOUND", "Rent invoice not found");
      }
      if (String(inv.status) !== "Approved" && String(inv.status) !== "Overdue" && String(inv.status) !== "Paid") {
        return sendApiError(res, 400, "LEDGER_PAY_INVOICE_STATUS", "Invoice must be Approved, Overdue, or Paid to record payment");
      }

      const idsRaw = body.interestLedgerEntryIds;
      const interestLedgerEntryIds = Array.isArray(idsRaw)
        ? idsRaw.map((x) => String(x ?? "").trim()).filter(Boolean)
        : typeof idsRaw === "string" && String(idsRaw).trim()
          ? String(idsRaw)
              .split(/[\s,]+/)
              .map((s) => s.trim())
              .filter(Boolean)
          : [];

      const paidMap = await sumPaidM03ByInvoiceIds([inv.id]);
      const paidSoFar = paidMap.get(inv.id) ?? 0;
      const invoiceTotal = Number(inv.totalAmount ?? 0);
      const outstandingRent = Math.max(0, Math.round((invoiceTotal - paidSoFar) * 100) / 100);

      let rentAmt = body.rentAmount != null ? Number(body.rentAmount) : 0;
      rentAmt = Math.round(rentAmt * 100) / 100;

      let interestAmt = 0;
      if (mode !== "rent_only") {
        if (interestLedgerEntryIds.length === 0) {
          return sendApiError(
            res,
            400,
            "LEDGER_INTEREST_IDS",
            "interestLedgerEntryIds is required for interest_only or combined",
          );
        }
        const rows = await db.select().from(rentDepositLedger).where(inArray(rentDepositLedger.id, interestLedgerEntryIds));
        if (rows.length !== interestLedgerEntryIds.length) {
          return sendApiError(res, 400, "LEDGER_INTEREST_ROWS", "One or more interest ledger ids not found");
        }
        for (const row of rows) {
          if (String(row.entryType) !== "Interest" || String(row.invoiceId ?? "") !== inv.id) {
            return sendApiError(res, 400, "LEDGER_INTEREST_ROW", "Invalid interest ledger row for this invoice");
          }
          if (String(row.interestPaymentStatus ?? "").trim() === "Paid") {
            return sendApiError(res, 400, "LEDGER_INTEREST_PAID", "An interest line is already paid");
          }
          interestAmt += Number(row.debit ?? 0);
        }
        interestAmt = Math.round(interestAmt * 100) / 100;
      }

      if (mode === "rent_only") {
        if (!Number.isFinite(rentAmt) || rentAmt <= 0) {
          return sendApiError(res, 400, "LEDGER_RENT_AMT", "rentAmount is required for rent_only");
        }
        if (rentAmt > outstandingRent + 0.02) {
          return sendApiError(res, 400, "LEDGER_RENT_TOO_MUCH", "Rent amount exceeds invoice outstanding", {
            outstandingRent,
          });
        }
      } else if (mode === "interest_only") {
        if (!Number.isFinite(interestAmt) || interestAmt <= 0.01) {
          return sendApiError(res, 400, "LEDGER_INTEREST_AMT", "Could not derive interest amount from ledger rows");
        }
        rentAmt = 0;
      } else {
        // combined
        if (!Number.isFinite(rentAmt) || rentAmt <= 0) {
          return sendApiError(res, 400, "LEDGER_RENT_AMT", "rentAmount is required for combined");
        }
        if (rentAmt > outstandingRent + 0.02) {
          return sendApiError(res, 400, "LEDGER_RENT_TOO_MUCH", "Rent amount exceeds invoice outstanding", {
            outstandingRent,
          });
        }
        if (!Number.isFinite(interestAmt) || interestAmt <= 0.01) {
          return sendApiError(res, 400, "LEDGER_INTEREST_AMT", "Interest amount invalid for combined payment");
        }
      }

      const payer = await resolveRentInvoiceCounterparty(inv);
      const createdBy = req.user?.id ?? "system";

      const splitGstForRentPay = (rentPay: number): { amount: number; cgst: number; sgst: number } => {
        const t = Number(inv.totalAmount ?? 0) || 1;
        const ra = Number(inv.rentAmount ?? 0);
        const c = Number(inv.cgst ?? 0);
        const s = Number(inv.sgst ?? 0);
        const f = rentPay / t;
        let amount = Math.round(ra * f * 100) / 100;
        let cgst = Math.round(c * f * 100) / 100;
        let sgst = Math.round(s * f * 100) / 100;
        const drift = Math.round((rentPay - (amount + cgst + sgst)) * 100) / 100;
        amount = Math.round((amount + drift) * 100) / 100;
        return { amount, cgst, sgst };
      };

      let created: { id: string; receiptNo: string };
      if (mode === "interest_only") {
        const brJson = stringifyM03ReceiptBreakdown({
          interestAmount: interestAmt,
          interestLedgerEntryIds,
        });
        created = await createIomsReceipt({
          yardId: inv.yardId,
          revenueHead: "RentArrearsInterest",
          payerName: payer.payerName,
          payerType: payer.payerType,
          payerRefId: payer.payerRefId,
          amount: interestAmt,
          cgst: 0,
          sgst: 0,
          tdsAmount: 0,
          paymentMode,
          sourceModule: "M-03",
          sourceRecordId: inv.id,
          unifiedEntityId: payer.unifiedEntityId,
          m03BreakdownJson: brJson,
          createdBy,
        });
      } else if (mode === "rent_only") {
        const revenueHead = inv.isGovtEntity ? "GSTInvoice" : "Rent";
        const parts = inv.isGovtEntity ? splitGstForRentPay(rentAmt) : { amount: rentAmt, cgst: 0, sgst: 0 };
        created = await createIomsReceipt({
          yardId: inv.yardId,
          revenueHead,
          payerName: payer.payerName,
          payerType: payer.payerType,
          payerRefId: payer.payerRefId,
          amount: parts.amount,
          cgst: parts.cgst,
          sgst: parts.sgst,
          tdsAmount: 0,
          paymentMode,
          sourceModule: "M-03",
          sourceRecordId: inv.id,
          unifiedEntityId: payer.unifiedEntityId,
          createdBy,
        });
      } else {
        const revenueHead = inv.isGovtEntity ? "GSTInvoice" : "Rent";
        const parts = inv.isGovtEntity ? splitGstForRentPay(rentAmt) : { amount: rentAmt, cgst: 0, sgst: 0 };
        const totalIn = Math.round((rentAmt + interestAmt) * 100) / 100;
        const baseParts = Math.round((parts.amount + parts.cgst + parts.sgst) * 100) / 100;
        if (Math.abs(baseParts - rentAmt) > 0.05) {
          return sendApiError(res, 500, "LEDGER_SPLIT", "Internal: GST split does not match rent amount");
        }
        const brJson = stringifyM03ReceiptBreakdown({
          rentAmount: rentAmt,
          interestAmount: interestAmt,
          interestLedgerEntryIds,
        });
        created = await createIomsReceipt({
          yardId: inv.yardId,
          revenueHead,
          payerName: payer.payerName,
          payerType: payer.payerType,
          payerRefId: payer.payerRefId,
          amount: parts.amount,
          cgst: parts.cgst,
          sgst: parts.sgst,
          tdsAmount: 0,
          paymentMode,
          sourceModule: "M-03",
          sourceRecordId: inv.id,
          unifiedEntityId: payer.unifiedEntityId,
          m03BreakdownJson: brJson,
          totalAmountOverride: totalIn,
          createdBy,
        });
      }

      await db.update(iomsReceipts).set({ status: "Paid", gatewayRef: "Manual" }).where(eq(iomsReceipts.id, created.id));
      const [paidRow] = await db.select().from(iomsReceipts).where(eq(iomsReceipts.id, created.id)).limit(1);
      let ledgerMessages: string[] = [];
      if (paidRow) {
        ledgerMessages = (await applyM03ReceiptToRentDepositLedger(paidRow)).messages.filter(Boolean);
      }

      const paidMap2 = await sumPaidM03ByInvoiceIds([inv.id]);
      const paidSum2 = paidMap2.get(inv.id) ?? 0;
      if (paidSum2 >= invoiceTotal - 0.01 && String(inv.status ?? "") !== "Paid") {
        await db.update(rentInvoices).set({ status: "Paid" }).where(eq(rentInvoices.id, invoiceId));
      }

      writeAuditLog(req, {
        module: "Rent/Tax",
        action: "RentDepositLedgerPayment",
        recordId: created.id,
        afterValue: { invoiceId, mode, rentAmt, interestAmt, receiptNo: created.receiptNo },
      }).catch((e) => console.error("Audit log failed:", e));

      res.status(201).json({
        receiptId: created.id,
        receiptNo: created.receiptNo,
        ledgerMessages,
      });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to record ledger payment");
    }
  });

  /** Parse DD-MM-YYYY or YYYY-MM-DD to API calendar date. */
  function normalizeAgeingAsOfDate(raw: string): string {
    const t = String(raw ?? "").trim();
    const dmy = /^(\d{2})-(\d{2})-(\d{4})$/.exec(t);
    if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
    if (/^\d{4}-\d{2}-\d{2}$/.test(t.slice(0, 10))) return t.slice(0, 10);
    return new Date().toISOString().slice(0, 10);
  }

  /** US-M03-006: past-due outstanding rent with simple ageing buckets (days after period-month end). */
  app.get("/api/ioms/rent/reports/ageing", async (req, res) => {
    try {
      const asOfRaw = String(req.query.asOf ?? "").trim();
      const asOfDate = asOfRaw ? normalizeAgeingAsOfDate(asOfRaw) : new Date().toISOString().slice(0, 10);
      const yardQ = String(req.query.yardId ?? "").trim();
      const format = String(req.query.format ?? "").toLowerCase();
      const conditions = [inArray(rentInvoices.status, ["Approved", "Overdue"])];
      const scopedIds = req.scopedLocationIds;
      if (scopedIds && scopedIds.length > 0) conditions.push(inArray(rentInvoices.yardId, scopedIds));
      if (yardQ && yardQ !== "all") conditions.push(eq(rentInvoices.yardId, yardQ));

      const list = await db.select().from(rentInvoices).where(and(...conditions));
      const paidMap = await sumPaidM03ByInvoiceIds(list.map((r) => r.id));
      const MS_PER_DAY = 86_400_000;
      const rows: {
        invoiceId: string;
        invoiceNo: string;
        periodMonth: string;
        dueDate: string;
        /** Invoice total (amount due for the period). */
        dueAmount: number;
        daysPastDue: number;
        ageingBucket: string;
        outstandingAmount: number;
        status: string;
        yardId: string;
        tenantLicenceId: string;
      }[] = [];

      for (const inv of list) {
        const due = rentPeriodMonthEndIso(inv.periodMonth);
        if (!due) continue;
        const paid = paidMap.get(inv.id) ?? 0;
        const outstanding = Number(inv.totalAmount ?? 0) - paid;
        if (outstanding <= 0.01) continue;
        if (asOfDate <= due) continue;
        const dueT = Date.parse(`${due}T00:00:00.000Z`);
        const asT = Date.parse(`${asOfDate}T00:00:00.000Z`);
        const daysPastDue = Math.max(0, Math.floor((asT - dueT) / MS_PER_DAY));
        const ageingBucket =
          daysPastDue <= 30 ? "0-30" : daysPastDue <= 60 ? "31-60" : daysPastDue <= 90 ? "61-90" : "90+";
        rows.push({
          invoiceId: inv.id,
          invoiceNo: (inv.invoiceNo ?? inv.id) as string,
          periodMonth: String(inv.periodMonth),
          dueDate: due,
          dueAmount: Math.round(Number(inv.totalAmount ?? 0) * 100) / 100,
          daysPastDue,
          ageingBucket,
          outstandingAmount: Math.round(outstanding * 100) / 100,
          status: String(inv.status),
          yardId: inv.yardId,
          tenantLicenceId: inv.tenantLicenceId,
        });
      }
      rows.sort((a, b) => b.daysPastDue - a.daysPastDue);
      const totOut = Math.round(rows.reduce((s, r) => s + r.outstandingAmount, 0) * 100) / 100;
      const bucketTotals = ["0-30", "31-60", "61-90", "90+"].map((b) => ({
        bucket: b,
        count: rows.filter((r) => r.ageingBucket === b).length,
        outstanding: Math.round(
          rows.filter((r) => r.ageingBucket === b).reduce((s, r) => s + r.outstandingAmount, 0) * 100,
        ) / 100,
      }));

      if (format === "csv") {
        const formatCsvYmd = (ymd: string) => {
          const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd).slice(0, 10));
          return m ? `${m[3]}-${m[2]}-${m[1]}` : ymd;
        };
        const header = [
          "asOfDate",
          "invoiceId",
          "invoiceNo",
          "yardId",
          "tenantLicenceId",
          "periodMonth",
          "dueDate",
          "dueAmount",
          "daysPastDue",
          "ageingBucket",
          "outstandingAmount",
          "status",
        ];
        const dataLines = rows.map((r) =>
          toCsvRow([
            formatCsvYmd(asOfDate),
            r.invoiceId,
            r.invoiceNo,
            r.yardId,
            r.tenantLicenceId,
            r.periodMonth,
            formatCsvYmd(r.dueDate),
            r.dueAmount,
            r.daysPastDue,
            r.ageingBucket,
            r.outstandingAmount,
            r.status,
          ]),
        );
        const summaryLines: string[] = [
          "",
          toCsvRow(["# summary", "asOfDate", asOfDate, "rowCount", rows.length, "totalOutstanding", totOut]),
          toCsvRow(["# buckets", "bucket", "count", "outstanding"]),
          ...bucketTotals.map((b) => toCsvRow([b.bucket, b.count, b.outstanding])),
        ];
        const csv = [toCsvRow(header), ...dataLines, ...summaryLines].join("\r\n");
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", "attachment; filename=rent-outstanding-ageing.csv");
        return res.send("\uFEFF" + csv);
      }

      return res.json({
        asOfDate,
        rows,
        totals: { count: rows.length, outstanding: totOut },
        bucketTotals,
      });
    } catch (e) {
      console.error(e);
      return sendApiError(res, 500, "INTERNAL_ERROR", "Failed to build rent ageing report");
    }
  });

  // ----- GSTR-1 export (outward supplies JSON for GSTN) -----
  app.get("/api/ioms/rent/gstr1", async (req, res) => {
    try {
      const fromMonth = (req.query.fromMonth as string) || "";
      const toMonth = (req.query.toMonth as string) || "";
      const format = String(req.query.format ?? "")
        .trim()
        .toLowerCase();
      if (!fromMonth || !toMonth) {
        return sendApiError(
          res,
          400,
          "RENT_GSTR1_QUERY_INVALID",
          "Query params fromMonth and toMonth required (YYYY-MM)",
        );
      }
      const {
        validateGstr1MonthRange,
        gstr1ExportWarnings,
        gstr1CounterpartyGstinIssues,
        buildRentGstr1DraftGstnMapping,
      } = await import("./rent-gstr1");
      const vr = validateGstr1MonthRange(fromMonth, toMonth);
      if (!vr.ok) {
        return sendApiError(res, 400, "RENT_GSTR1_QUERY_INVALID", vr.error);
      }
      const scopedIds = req.scopedLocationIds;
      const conditions = [
        inArray(rentInvoices.status, ["Approved", "Paid"]),
        gte(rentInvoices.periodMonth, fromMonth),
        lte(rentInvoices.periodMonth, toMonth),
        eq(rentInvoices.isGovtEntity, false),
      ];
      if (scopedIds && scopedIds.length > 0) conditions.push(inArray(rentInvoices.yardId, scopedIds));
      const list = await db
        .select({
          invoiceNo: rentInvoices.invoiceNo,
          id: rentInvoices.id,
          periodMonth: rentInvoices.periodMonth,
          tenantLicenceId: rentInvoices.tenantLicenceId,
          assetId: rentInvoices.assetId,
          yardId: rentInvoices.yardId,
          entityId: rentInvoices.entityId,
          rentAmount: rentInvoices.rentAmount,
          cgst: rentInvoices.cgst,
          sgst: rentInvoices.sgst,
          totalAmount: rentInvoices.totalAmount,
          tdsApplicable: rentInvoices.tdsApplicable,
          tdsAmount: rentInvoices.tdsAmount,
        })
        .from(rentInvoices)
        .where(and(...conditions))
        .orderBy(desc(rentInvoices.periodMonth));

      const traderLicenceKeyForGstr = (tenantLicenceId: string): string | null => {
        const ue = parseUnifiedEntityId(tenantLicenceId);
        if (ue?.kind === "TB") return null;
        if (ue?.kind === "TA") return ue.refId.trim() || null;
        const t = String(tenantLicenceId ?? "").trim();
        return t || null;
      };

      const trackBEntityIdForGstrInvoice = (r: { tenantLicenceId: string; entityId: string | null }): string | null => {
        const ue = parseUnifiedEntityId(r.tenantLicenceId);
        if (ue?.kind === "TB") return ue.refId.trim() || null;
        const eid = r.entityId != null ? String(r.entityId).trim() : "";
        return eid || null;
      };

      const traderKeys = Array.from(
        new Set(list.map((r) => traderLicenceKeyForGstr(r.tenantLicenceId)).filter((k): k is string => Boolean(k))),
      );
      const tenantRows =
        traderKeys.length > 0
          ? await db
              .select({
                id: traderLicences.id,
                gstin: traderLicences.gstin,
                isNonGstEntity: traderLicences.isNonGstEntity,
              })
              .from(traderLicences)
              .where(inArray(traderLicences.id, traderKeys))
          : [];
      const tenantById = new Map(tenantRows.map((t) => [t.id, t]));

      const entityIds = Array.from(
        new Set(list.map((r) => trackBEntityIdForGstrInvoice(r)).filter((k): k is string => Boolean(k))),
      );
      const entityRows =
        entityIds.length > 0
          ? await db.select({ id: entities.id, gstin: entities.gstin }).from(entities).where(inArray(entities.id, entityIds))
          : [];
      const entityById = new Map(entityRows.map((e) => [e.id, e]));

      const gstin = process.env.GSTIN?.trim() || null;
      const supplies = list.map((r) => {
        const eid = trackBEntityIdForGstrInvoice(r);
        if (eid) {
          const ent = entityById.get(eid);
          const rawGstin = ent?.gstin != null && String(ent.gstin).trim() ? String(ent.gstin).trim() : null;
          return {
            invoiceNo: r.invoiceNo ?? r.id,
            periodMonth: r.periodMonth,
            tenantLicenceId: r.tenantLicenceId,
            counterpartyGstin: rawGstin,
            counterpartyGstinSource: "trackBEntity" as const,
            isNonGstEntity: false,
            customerRef: r.tenantLicenceId,
            assetId: r.assetId,
            yardId: r.yardId,
            taxableValue: r.rentAmount,
            cgst: r.cgst,
            sgst: r.sgst,
            totalAmount: r.totalAmount,
            tdsApplicable: r.tdsApplicable,
            tdsAmount: r.tdsAmount,
          };
        }
        const tKey = traderLicenceKeyForGstr(r.tenantLicenceId);
        const tl = tKey ? tenantById.get(tKey) : undefined;
        const rawGstin = tl?.gstin != null && String(tl.gstin).trim() ? String(tl.gstin).trim() : null;
        return {
          invoiceNo: r.invoiceNo ?? r.id,
          periodMonth: r.periodMonth,
          tenantLicenceId: r.tenantLicenceId,
          counterpartyGstin: rawGstin,
          counterpartyGstinSource: "traderLicence" as const,
          isNonGstEntity: Boolean(tl?.isNonGstEntity),
          customerRef: r.tenantLicenceId,
          assetId: r.assetId,
          yardId: r.yardId,
          taxableValue: r.rentAmount,
          cgst: r.cgst,
          sgst: r.sgst,
          totalAmount: r.totalAmount,
          tdsApplicable: r.tdsApplicable,
          tdsAmount: r.tdsAmount,
        };
      });
      const warnings = [...gstr1ExportWarnings(gstin), ...gstr1CounterpartyGstinIssues(supplies)];

      if (format === "csv") {
        const header = [
          "invoiceNo",
          "periodMonth",
          "tenantLicenceId",
          "counterpartyGstin",
          "isNonGstEntity",
          "customerRef",
          "assetId",
          "yardId",
          "taxableValue",
          "cgst",
          "sgst",
          "totalAmount",
          "tdsApplicable",
          "tdsAmount",
        ];
        const dataLines = supplies.map((s) =>
          toCsvRow([
            s.invoiceNo,
            s.periodMonth,
            s.tenantLicenceId,
            s.counterpartyGstin,
            s.isNonGstEntity,
            s.customerRef,
            s.assetId,
            s.yardId,
            s.taxableValue,
            s.cgst,
            s.sgst,
            s.totalAmount,
            s.tdsApplicable,
            s.tdsAmount,
          ]),
        );
        const tail: string[] = [
          "",
          toCsvRow(["#", "meta", "fromMonth", fromMonth, "toMonth", toMonth, "gstrSupplierGstin", gstin ?? ""]),
          toCsvRow(["#", "warnings"]),
        ];
        for (const w of warnings) {
          tail.push(toCsvRow(["#", w]));
        }
        const csv = [toCsvRow(header), ...dataLines, ...tail].join("\r\n");
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename=gstr1-rent-outward-${fromMonth}-${toMonth}.csv`);
        return res.send("\uFEFF" + csv);
      }

      const gstnDraftMapping = buildRentGstr1DraftGstnMapping({
        gstin,
        filingPeriodMonth: toMonth,
        supplies,
      });
      res.json({
        gstin,
        fromMonth,
        toMonth,
        warnings,
        tdsFyRule:
          "Rent TDS (194-I style): threshold applies if monthly×12 exceeds limit OR Indian FY (Apr–Mar) approved/paid rent before this period plus current month exceeds limit OR prior FY YTD already at/above limit; PAN required when TDS applies.",
        supplies,
        gstnDraftMapping,
      });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to generate GSTR-1 export");
    }
  });

  // ----- Credit notes -----
  app.get("/api/ioms/rent/credit-notes", async (req, res) => {
    try {
      const invoiceId = req.query.invoiceId as string | undefined;
      let list = await db.select().from(creditNotes).orderBy(desc(creditNotes.creditNoteNo));
      if (invoiceId) list = list.filter((r) => r.invoiceId === invoiceId);
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch credit notes");
    }
  });

  app.get("/api/ioms/rent/credit-notes/:id", async (req, res) => {
    try {
      const [row] = await db.select().from(creditNotes).where(eq(creditNotes.id, routeParamString(req.params.id))).limit(1);
      if (!row) return sendApiError(res, 404, "RENT_CREDIT_NOTE_NOT_FOUND", "Credit note not found");
      res.json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch credit note");
    }
  });

  app.post("/api/ioms/rent/credit-notes", async (req, res) => {
    try {
      if (!canCreateRentInvoice(req.user)) {
        return sendApiError(
          res,
          403,
          "RENT_CREDIT_NOTE_CREATE_DENIED",
          "Only Data Originator or Admin can create rent credit notes",
        );
      }
      const body = req.body;
      const invoiceId = String(body.invoiceId ?? "");
      if (!invoiceId) {
        return sendApiError(res, 400, "RENT_CREDIT_NOTE_INVOICE_ID_REQUIRED", "invoiceId is required");
      }
      const [inv] = await db.select().from(rentInvoices).where(eq(rentInvoices.id, invoiceId)).limit(1);
      if (!inv) return sendApiError(res, 404, "RENT_INVOICE_NOT_FOUND", "Rent invoice not found");
      if (inv.status === "Paid") {
        return sendApiError(res, 400, "RENT_CREDIT_NOTE_PAID_INVOICE", "Credit note not allowed for paid invoice");
      }
      if (inv.status !== "Approved" && inv.status !== "Overdue") {
        return sendApiError(
          res,
          400,
          "RENT_CREDIT_NOTE_INVOICE_NOT_APPROVED",
          "Credit note only for Approved or Overdue invoices (unsettled).",
        );
      }
      const scopedIds = req.scopedLocationIds;
      if (scopedIds && scopedIds.length > 0 && !scopedIds.includes(inv.yardId)) {
        return sendApiError(res, 404, "RENT_INVOICE_NOT_FOUND", "Rent invoice not found");
      }
      const reason = String(body.reason ?? "").trim();
      if (reason.length < 10) {
        return sendApiError(res, 400, "RENT_CREDIT_NOTE_REASON", "reason must be at least 10 characters.");
      }
      const amount = Number(body.amount ?? NaN);
      if (!Number.isFinite(amount) || amount <= 0) {
        return sendApiError(res, 400, "RENT_CREDIT_NOTE_AMOUNT", "amount must be a positive number.");
      }
      let creditNoteNo = String(body.creditNoteNo ?? "").trim();
      if (!creditNoteNo) {
        creditNoteNo = `M03-CN-${nanoid(10)}`;
      }
      const id = nanoid();
      await db.insert(creditNotes).values({
        id,
        creditNoteNo,
        invoiceId,
        reason,
        amount,
        status: String(body.status ?? "Draft"),
        daUser: body.daUser ? String(body.daUser) : null,
        approvedAt: body.approvedAt ? String(body.approvedAt) : null,
      });
      const [row] = await db.select().from(creditNotes).where(eq(creditNotes.id, id));
      if (row) writeAuditLog(req, { module: "Rent/Tax", action: "Create", recordId: id, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create credit note");
    }
  });

  app.put("/api/ioms/rent/credit-notes/:id", async (req, res) => {
    try {
      const id = routeParamString(req.params.id);
      const [existingCn] = await db.select().from(creditNotes).where(eq(creditNotes.id, id)).limit(1);
      if (!existingCn) return sendApiError(res, 404, "RENT_CREDIT_NOTE_NOT_FOUND", "Not found");
      const body = req.body;
      const updates: Record<string, unknown> = {};
      ["creditNoteNo", "invoiceId", "reason", "amount", "status", "daUser", "approvedAt"].forEach((k) => {
        if (body[k] === undefined) return;
        if (k === "amount") updates.amount = Number(body.amount);
        else updates[k] = body[k] == null ? null : String(body[k]);
      });
      const targetInvoiceId =
        updates.invoiceId != null ? String(updates.invoiceId) : existingCn.invoiceId;
      const [inv] = await db.select().from(rentInvoices).where(eq(rentInvoices.id, targetInvoiceId)).limit(1);
      if (!inv) return sendApiError(res, 404, "RENT_INVOICE_NOT_FOUND", "Rent invoice not found");
      if (inv.status === "Paid") {
        return sendApiError(res, 400, "RENT_CREDIT_NOTE_PAID_INVOICE", "Credit note not allowed for paid invoice");
      }
      if (inv.status !== "Approved" && inv.status !== "Overdue") {
        return sendApiError(
          res,
          400,
          "RENT_CREDIT_NOTE_INVOICE_NOT_APPROVED",
          "Credit note only for Approved or Overdue invoices (unsettled).",
        );
      }
      const scopedIds = req.scopedLocationIds;
      if (scopedIds && scopedIds.length > 0 && !scopedIds.includes(inv.yardId)) {
        return sendApiError(res, 404, "RENT_INVOICE_NOT_FOUND", "Rent invoice not found");
      }
      await db.update(creditNotes).set(updates as Record<string, string | number | null>).where(eq(creditNotes.id, id));
      const [row] = await db.select().from(creditNotes).where(eq(creditNotes.id, id));
      if (!row) return sendApiError(res, 404, "RENT_CREDIT_NOTE_NOT_FOUND", "Not found");
      writeAuditLog(req, { module: "Rent/Tax", action: "Update", recordId: id, beforeValue: existingCn, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to update credit note");
    }
  });
}
