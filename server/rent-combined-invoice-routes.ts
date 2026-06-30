/**
 * M-03 combined rent tax invoice API routes.
 */
import type { Express } from "express";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { rentCombinedInvoices, rentInvoices, assets, yards } from "@shared/db-schema";
import { sendApiError } from "./api-errors";
import { routeParamString } from "./route-params";
import { hasPermission } from "./auth";
import { canCreateRentInvoice } from "./workflow";
import { writeAuditLog } from "./audit";
import {
  createCombinedRentInvoice,
  getCombinedRentInvoice,
  listCombinedRentInvoices,
  recordCombinedBundlePayment,
  RENT_INVOICE_BUNDLE_ONLY_PDF_MESSAGE,
} from "./rent-combined-invoice-service";
import { resolveRentInvoiceCounterparty } from "./rent-invoice-payer";
import { DuesCounterPaymentError, parseCounterDuesPaymentBody, type ParsedCounterDuesPayment } from "./dues-counter-payment";

export function registerRentCombinedInvoiceRoutes(app: Express) {
  app.get("/api/ioms/rent/combined-invoices", async (req, res) => {
    try {
      const yardId = String(req.query.yardId ?? "").trim() || undefined;
      const tenantLicenceId = String(req.query.tenantLicenceId ?? "").trim() || undefined;
      const periodMonth = String(req.query.periodMonth ?? "").trim() || undefined;
      const scopedIds = req.scopedLocationIds;
      const rows = await listCombinedRentInvoices({
        yardId,
        tenantLicenceId,
        periodMonth,
        scopedYardIds: scopedIds,
      });
      res.json(rows);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to list combined rent invoices");
    }
  });

  app.get("/api/ioms/rent/combined-invoices/:id", async (req, res) => {
    try {
      const id = routeParamString(req.params.id);
      const row = await getCombinedRentInvoice(id);
      if (!row) return sendApiError(res, 404, "COMBINED_NOT_FOUND", "Combined rent invoice not found");
      const scopedIds = req.scopedLocationIds;
      if (scopedIds && scopedIds.length > 0 && !scopedIds.includes(row.yardId)) {
        return sendApiError(res, 404, "COMBINED_NOT_FOUND", "Combined rent invoice not found");
      }
      res.json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch combined rent invoice");
    }
  });

  app.post("/api/ioms/rent/combined-invoices", async (req, res) => {
    try {
      if (!canCreateRentInvoice(req.user)) {
        return sendApiError(res, 403, "FORBIDDEN", "Only Data Originator or Admin can create combined rent invoices");
      }
      const invoiceIds = Array.isArray(req.body?.invoiceIds) ? req.body.invoiceIds.map(String) : [];
      const createdBy = req.user?.id ?? "system";
      const result = await createCombinedRentInvoice({ invoiceIds, createdBy });
      if (!result.ok) {
        return sendApiError(res, 400, result.code, result.message);
      }
      await writeAuditLog(req, {
        module: "Rent/Tax",
        action: "Create",
        recordId: result.bundle.id,
        afterValue: result.bundle,
      }).catch((e) => console.error("Audit log failed:", e));
      res.status(201).json(result.bundle);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create combined rent invoice");
    }
  });

  app.get("/api/ioms/rent/combined-invoices/:id/pdf", async (req, res) => {
    try {
      const id = routeParamString(req.params.id);
      const [bundle] = await db.select().from(rentCombinedInvoices).where(eq(rentCombinedInvoices.id, id)).limit(1);
      if (!bundle) return sendApiError(res, 404, "COMBINED_NOT_FOUND", "Combined rent invoice not found");
      const scopedIds = req.scopedLocationIds;
      if (scopedIds && scopedIds.length > 0 && !scopedIds.includes(bundle.yardId)) {
        return sendApiError(res, 404, "COMBINED_NOT_FOUND", "Combined rent invoice not found");
      }

      const childrenInvoices = await db.select().from(rentInvoices).where(eq(rentInvoices.combinedBundleId, id));
      const [yard] = await db
        .select({ name: yards.name, code: yards.code, address: yards.address })
        .from(yards)
        .where(eq(yards.id, bundle.yardId))
        .limit(1);
      const yardName = String(yard?.name?.trim() || yard?.code?.trim() || bundle.yardId);
      const cp = childrenInvoices[0] ? await resolveRentInvoiceCounterparty(childrenInvoices[0]) : null;
      const { resolveRentAllotmentReferenceNo } = await import("./rent-allotment-reference");
      const { getMergedSystemConfig } = await import("./system-config");
      const sysCfg = await getMergedSystemConfig();
      const cgstPercent = parseFloat(String(sysCfg.rent_invoice_cgst_percent ?? ""));
      const sgstPercent = parseFloat(String(sysCfg.rent_invoice_sgst_percent ?? ""));

      const children = [];
      for (const inv of childrenInvoices) {
        const [asset] = await db
          .select({ assetId: assets.assetId })
          .from(assets)
          .where(eq(assets.id, inv.assetId))
          .limit(1);
        const assetCode = String(asset?.assetId ?? inv.assetId);
        const allotmentLabel = await resolveRentAllotmentReferenceNo(inv);
        children.push({ invoice: inv, assetCode, allotmentLabel });
      }

      const { buildCombinedRentInvoicePdfA4 } = await import("./rent-combined-invoice-pdf");
      const buf = await buildCombinedRentInvoicePdfA4({
        bundle,
        children,
        yardName,
        yardCode: yard?.code?.trim() || null,
        yardAddress: yard?.address?.trim() || null,
        counterpartyName: cp?.payerName ?? "Tenant",
        counterpartyGstin: cp?.payerGstin,
        cgstPercent,
        sgstPercent,
      });

      const filename = `combined-rent-invoice-${bundle.bundleInvoiceNo.replace(/[/\\]/g, "-")}.pdf`;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
      res.send(buf);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to generate combined rent invoice PDF");
    }
  });

  app.post("/api/ioms/rent/combined-invoices/:id/record-payment", async (req, res) => {
    try {
      if (!hasPermission(req.user, "M-03", "Update") && !hasPermission(req.user, "M-03", "Approve")) {
        return sendApiError(res, 403, "FORBIDDEN", "M-03 Update permission required");
      }
      const id = routeParamString(req.params.id);
      const amount = Number(req.body?.amount);
      const allocations = Array.isArray(req.body?.allocations) ? req.body.allocations : [];
      let counterPayment: ParsedCounterDuesPayment | null = null;
      if (req.body?.paymentMode != null) {
        try {
          counterPayment = parseCounterDuesPaymentBody(req.body);
        } catch (e) {
          if (e instanceof DuesCounterPaymentError) {
            return sendApiError(res, 400, e.code, e.message);
          }
          throw e;
        }
      }
      const createdBy = req.user?.id ?? "system";
      const result = await recordCombinedBundlePayment({
        bundleId: id,
        amount,
        allocations: allocations.map((a: { invoiceId?: string; amount?: number }) => ({
          invoiceId: String(a.invoiceId ?? ""),
          amount: Number(a.amount),
        })),
        createdBy,
        counterPayment,
      });
      if (!result.ok) {
        return sendApiError(res, 400, result.code, result.message, result.details);
      }
      res.json(result);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to record combined invoice payment");
    }
  });
}

export { RENT_INVOICE_BUNDLE_ONLY_PDF_MESSAGE };
