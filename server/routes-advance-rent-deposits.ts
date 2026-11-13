import type { Express, Request } from "express";
import { sendApiError } from "./api-errors";
import { writeAuditLog } from "./audit";
import {
  applyAdvanceRentDepositsOnInvoiceApprove,
  approvePaymentAdjustment,
  collectAdvanceRentDeposit,
  createPaymentAdjustment,
  getAdvanceRentDepositDetail,
  listAdvanceAdjustmentsForInvoice,
  listAdvanceRentDeposits,
  listPaymentAdjustments,
} from "./advance-rent-deposit-service";

function yardInScope(req: Request, yardId: string): boolean {
  if (req.user?.roles?.some((r) => r.tier === "ADMIN")) return true;
  const scoped = req.scopedLocationIds;
  if (!scoped || scoped.length === 0) return true;
  return scoped.includes(yardId);
}

function routeParam(req: Request, name: string): string {
  const v = req.params[name];
  return Array.isArray(v) ? String(v[0] ?? "") : String(v ?? "");
}

export function registerAdvanceRentDepositRoutes(app: Express) {
  app.get("/api/ioms/rent/advance-deposits", async (req, res) => {
    try {
      const yardId = String(req.query.yardId ?? "").trim() || undefined;
      if (yardId && !yardInScope(req, yardId)) {
        return sendApiError(res, 403, "YARD_ACCESS_DENIED", "You do not have access to this yard");
      }
      const data = await listAdvanceRentDeposits({
        yardId,
        traderLicenceId: String(req.query.traderLicenceId ?? "").trim() || undefined,
        status: String(req.query.status ?? "").trim() || undefined,
        q: String(req.query.q ?? "").trim() || undefined,
      });
      // Scope filter when no yardId: drop out-of-scope yards for non-admin.
      const scoped = req.scopedLocationIds;
      if (scoped && scoped.length > 0 && !req.user?.roles?.some((r) => r.tier === "ADMIN") && !yardId) {
        const rows = data.rows.filter((r) => scoped.includes(r.yardId));
        const balanceHeld = Math.round(rows.filter((d) => d.status === "Active").reduce((s, d) => s + Number(d.balanceAmount ?? 0), 0) * 100) / 100;
        const totalReceived = Math.round(rows.reduce((s, d) => s + Number(d.depositAmount ?? 0), 0) * 100) / 100;
        const adjustedToDate = Math.round(rows.reduce((s, d) => s + Number(d.adjustedAmount ?? 0), 0) * 100) / 100;
        return res.json({
          rows,
          summary: {
            balanceHeld,
            totalReceived,
            adjustedToDate,
            activeCount: rows.filter((d) => d.status === "Active").length,
            totalCount: rows.length,
          },
        });
      }
      res.json(data);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to list advance deposits");
    }
  });

  app.get("/api/ioms/rent/advance-deposits/:id", async (req, res) => {
    try {
      const detail = await getAdvanceRentDepositDetail(routeParam(req, "id"));
      if (!detail) return sendApiError(res, 404, "ADV_DEPOSIT_NOT_FOUND", "Deposit not found");
      if (!yardInScope(req, detail.yardId)) {
        return sendApiError(res, 403, "YARD_ACCESS_DENIED", "You do not have access to this yard");
      }
      res.json(detail);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to load deposit");
    }
  });

  app.post("/api/ioms/rent/advance-deposits", async (req, res) => {
    try {
      const body = req.body as Record<string, unknown>;
      const yardId = String(body.yardId ?? "").trim();
      if (!yardId) return sendApiError(res, 400, "FIELDS_REQUIRED", "yardId is required");
      if (!yardInScope(req, yardId)) {
        return sendApiError(res, 403, "YARD_ACCESS_DENIED", "You do not have access to this yard");
      }
      const created = await collectAdvanceRentDeposit({
        yardId,
        traderLicenceId: String(body.traderLicenceId ?? "").trim(),
        assetId: String(body.assetId ?? "").trim(),
        allotmentId: body.allotmentId != null ? String(body.allotmentId) : null,
        amountInr: Number(body.amountInr ?? body.depositAmount ?? 0),
        depositDate: body.depositDate != null ? String(body.depositDate) : undefined,
        periodFrom: body.periodFrom != null ? String(body.periodFrom) : null,
        periodTo: body.periodTo != null ? String(body.periodTo) : null,
        paymentMode: String(body.paymentMode ?? "Cash"),
        paymentRef: body.paymentRef != null ? String(body.paymentRef) : null,
        chequeNo: body.chequeNo != null ? String(body.chequeNo) : null,
        bankName: body.bankName != null ? String(body.bankName) : null,
        receivedBy: body.receivedBy != null ? String(body.receivedBy) : req.user?.name ?? req.user?.id,
        remarks: body.remarks != null ? String(body.remarks) : null,
        createdBy: req.user?.id ?? "system",
      });
      if (created) {
        writeAuditLog(req, { module: "Rent/Tax", action: "AdvanceDepositCreate", recordId: created.id, afterValue: created }).catch(
          (e) => console.error("Audit log failed:", e),
        );
      }
      res.status(201).json(created);
    } catch (e) {
      console.error(e);
      const msg = e instanceof Error ? e.message : "Failed to collect deposit";
      sendApiError(res, 400, "ADV_DEPOSIT_FAILED", msg);
    }
  });

  app.get("/api/ioms/rent/invoices/:id/advance-adjustments", async (req, res) => {
    try {
      const rows = await listAdvanceAdjustmentsForInvoice(routeParam(req, "id"));
      res.json(rows);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to load adjustments");
    }
  });

  /** Manual re-run (idempotent for remaining balance). */
  app.post("/api/ioms/rent/invoices/:id/apply-advance-deposits", async (req, res) => {
    try {
      const result = await applyAdvanceRentDepositsOnInvoiceApprove({
        invoiceId: routeParam(req, "id"),
        userId: req.user?.id,
      });
      res.json(result);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to apply advance deposits");
    }
  });

  app.get("/api/ioms/payment-adjustments", async (req, res) => {
    try {
      const rows = await listPaymentAdjustments({
        traderLicenceId: String(req.query.traderLicenceId ?? "").trim() || undefined,
        status: String(req.query.status ?? "").trim() || undefined,
      });
      res.json(rows);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to list payment adjustments");
    }
  });

  app.post("/api/ioms/payment-adjustments", async (req, res) => {
    try {
      const body = req.body as Record<string, unknown>;
      const yardId = String(body.yardId ?? "").trim();
      if (!yardId) return sendApiError(res, 400, "FIELDS_REQUIRED", "yardId is required");
      if (!yardInScope(req, yardId)) {
        return sendApiError(res, 403, "YARD_ACCESS_DENIED", "You do not have access to this yard");
      }
      const row = await createPaymentAdjustment({
        yardId,
        traderLicenceId: String(body.traderLicenceId ?? "").trim(),
        againstInvoiceId: body.againstInvoiceId != null ? String(body.againstInvoiceId) : null,
        adjustmentType: String(body.adjustmentType ?? "").trim(),
        amountInr: Number(body.amountInr ?? 0),
        reason: body.reason != null ? String(body.reason) : null,
        createdBy: req.user?.id ?? "system",
        submitForApproval: body.submitForApproval !== false,
      });
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      const msg = e instanceof Error ? e.message : "Failed to create adjustment";
      sendApiError(res, 400, "PAYMENT_ADJ_FAILED", msg);
    }
  });

  app.put("/api/ioms/payment-adjustments/:id/approve", async (req, res) => {
    try {
      const isDa = Boolean(req.user?.roles?.some((r) => r.tier === "DA" || r.tier === "ADMIN"));
      if (!isDa) return sendApiError(res, 403, "APPROVE_DENIED", "Only DA or Admin can approve adjustments");
      const apply = String((req.body as { apply?: unknown })?.apply ?? "true") !== "false";
      const row = await approvePaymentAdjustment({
        id: routeParam(req, "id"),
        approvedBy: req.user?.id ?? "system",
        apply,
      });
      res.json(row);
    } catch (e) {
      console.error(e);
      const msg = e instanceof Error ? e.message : "Failed to approve";
      sendApiError(res, 400, "PAYMENT_ADJ_APPROVE_FAILED", msg);
    }
  });
}

export { applyAdvanceRentDepositsOnInvoiceApprove };
