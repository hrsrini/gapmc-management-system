/**
 * M-02 godown premises security deposit register, consolidated receipt, refund workflow, ledger.
 */
import type { Express, Request } from "express";
import { desc, eq } from "drizzle-orm";
import { sdRefundProposals, traderLicences, entities } from "@shared/db-schema";
import { db } from "./db";
import { sendApiError } from "./api-errors";
import { hasPermission } from "./auth";
import { SecurityDepositReceiptError } from "./allotment-security-deposit-receipt";
import {
  approveSdRefundProposal,
  createOrUpdateSdRefundProposal,
  generateConsolidatedSecdepReceipt,
  getSdLedgerForPayer,
  getSdRefundProposalDetail,
  listDepositsForPayer,
  listRefundableDepositsForPayer,
  listSdDepositRegister,
  rejectSdRefundProposal,
  returnSdRefundProposal,
  verifySdRefundProposal,
} from "./premises-security-deposit";

function yardInScope(req: Request, yardId: string): boolean {
  const scopedIds = (req as Request & { scopedLocationIds?: string[] }).scopedLocationIds;
  return !scopedIds || scopedIds.length === 0 || scopedIds.includes(yardId);
}

export function registerPremisesSecurityDepositRoutes(app: Express) {
  app.get("/api/ioms/premises-security-deposits", async (req, res) => {
    try {
      if (!hasPermission(req.user, "M-02", "Read")) {
        return sendApiError(res, 403, "SD_READ_DENIED", "No permission to read security deposits.");
      }
      const status = req.query.status ? String(req.query.status) : undefined;
      const yardId = req.query.yardId ? String(req.query.yardId) : undefined;
      if (yardId && !yardInScope(req, yardId)) {
        return sendApiError(res, 403, "M02_YARD_ACCESS_DENIED", "Yard not in scope.");
      }
      let list = await listSdDepositRegister({ status, yardId });
      const scopedIds = (req as Request & { scopedLocationIds?: string[] }).scopedLocationIds;
      if (scopedIds && scopedIds.length > 0) {
        list = list.filter((r) => scopedIds.includes(r.yardId));
      }
      const collected = list.reduce((s, r) => s + (r.depositReceiptId ? Number(r.amount) : 0), 0);
      const refunded = list
        .filter((r) => r.status === "Refunded")
        .reduce((s, r) => s + Number(r.amount), 0);
      const held = list.filter((r) => r.status === "Held" && r.depositReceiptId).reduce((s, r) => s + Number(r.amount), 0);
      const pending = list.filter((r) => r.status === "Reserved").reduce((s, r) => s + Number(r.amount), 0);
      res.json({
        rows: list,
        summary: { collected, refunded, held, refundPending: pending },
      });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to list security deposits");
    }
  });

  app.get("/api/ioms/premises-security-deposits/for-payer", async (req, res) => {
    try {
      if (!hasPermission(req.user, "M-02", "Read")) {
        return sendApiError(res, 403, "SD_READ_DENIED", "No permission.");
      }
      const payerType = String(req.query.payerType ?? "");
      const payerRefId = String(req.query.payerRefId ?? "");
      if (!payerType || !payerRefId) {
        return sendApiError(res, 400, "PAYER_REQUIRED", "payerType and payerRefId are required.");
      }
      const mode = String(req.query.mode ?? "all");
      const rows =
        mode === "refundable"
          ? await listRefundableDepositsForPayer({ payerType, payerRefId })
          : await listDepositsForPayer({ payerType, payerRefId });
      res.json(rows);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to list deposits for payer");
    }
  });

  app.post("/api/ioms/premises-security-deposits/consolidated-receipt", async (req, res) => {
    try {
      if (!hasPermission(req.user, "M-02", "Create") && !hasPermission(req.user, "M-05", "Create")) {
        return sendApiError(res, 403, "SD_CREATE_DENIED", "No permission to generate SD receipt.");
      }
      const body = req.body as { depositIds?: string[] } & Record<string, unknown>;
      const depositIds = Array.isArray(body.depositIds) ? body.depositIds.map(String) : [];
      const result = await generateConsolidatedSecdepReceipt({
        req,
        depositIds,
        paymentBody: body,
      });
      res.status(201).json(result);
    } catch (e) {
      if (e instanceof SecurityDepositReceiptError) {
        return sendApiError(res, 400, e.code, e.message);
      }
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to generate consolidated SD receipt");
    }
  });

  app.get("/api/ioms/sd-refund-proposals", async (req, res) => {
    try {
      if (!hasPermission(req.user, "M-02", "Read")) {
        return sendApiError(res, 403, "SD_READ_DENIED", "No permission.");
      }
      const list = await db.select().from(sdRefundProposals).orderBy(desc(sdRefundProposals.createdAt));
      const scopedIds = (req as Request & { scopedLocationIds?: string[] }).scopedLocationIds;
      const filtered =
        scopedIds && scopedIds.length > 0 ? list.filter((r) => scopedIds.includes(r.yardId)) : list;
      res.json(filtered);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to list refund proposals");
    }
  });

  app.get("/api/ioms/sd-refund-proposals/:id", async (req, res) => {
    try {
      if (!hasPermission(req.user, "M-02", "Read")) {
        return sendApiError(res, 403, "SD_READ_DENIED", "No permission.");
      }
      const detail = await getSdRefundProposalDetail(req.params.id);
      if (!detail) return sendApiError(res, 404, "SD_REFUND_NOT_FOUND", "Proposal not found");
      if (!yardInScope(req, detail.yardId)) {
        return sendApiError(res, 404, "SD_REFUND_NOT_FOUND", "Proposal not found");
      }
      res.json(detail);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch refund proposal");
    }
  });

  app.post("/api/ioms/sd-refund-proposals", async (req, res) => {
    try {
      if (!hasPermission(req.user, "M-02", "Create") && !hasPermission(req.user, "M-02", "Update")) {
        return sendApiError(res, 403, "SD_WRITE_DENIED", "No permission.");
      }
      const body = req.body as Record<string, unknown>;
      const payerType = String(body.payerType ?? "");
      const payerRefId = String(body.payerRefId ?? "");
      const yardId = String(body.yardId ?? "");
      if (!payerType || !payerRefId || !yardId) {
        return sendApiError(res, 400, "SD_REFUND_REQUIRED", "payerType, payerRefId and yardId are required.");
      }
      if (!yardInScope(req, yardId)) {
        return sendApiError(res, 403, "M02_YARD_ACCESS_DENIED", "Yard not in scope.");
      }
      let payerName = body.payerName != null ? String(body.payerName) : "";
      if (!payerName) {
        if (payerType === "TraderLicence") {
          const [lic] = await db.select().from(traderLicences).where(eq(traderLicences.id, payerRefId)).limit(1);
          payerName = lic?.firmName ?? lic?.contactName ?? payerRefId;
        } else {
          const [ent] = await db.select().from(entities).where(eq(entities.id, payerRefId)).limit(1);
          payerName = ent?.name ?? payerRefId;
        }
      }
      const detail = await createOrUpdateSdRefundProposal({
        req,
        id: body.id ? String(body.id) : undefined,
        payerType,
        payerRefId,
        payerName,
        unifiedEntityId: body.unifiedEntityId != null ? String(body.unifiedEntityId) : null,
        yardId,
        proposalDate: String(body.proposalDate ?? new Date().toISOString().slice(0, 10)),
        depositIds: Array.isArray(body.depositIds) ? body.depositIds.map(String) : [],
        deductions: Array.isArray(body.deductions)
          ? (body.deductions as Array<{ reason: string; amount: number }>)
          : [],
        payment: {
          paymentMode: String(body.paymentMode ?? "Cash"),
          paymentDate: String(body.paymentDate ?? ""),
          chequeNo: body.chequeNo != null ? String(body.chequeNo) : null,
          bankName: body.bankName != null ? String(body.bankName) : null,
          chequeDate: body.chequeDate != null ? String(body.chequeDate) : null,
          utrRef: body.utrRef != null ? String(body.utrRef) : null,
          paymentRemarks: body.paymentRemarks != null ? String(body.paymentRemarks) : null,
        },
        submit: Boolean(body.submit),
      });
      res.status(body.id ? 200 : 201).json(detail);
    } catch (e) {
      if (e instanceof SecurityDepositReceiptError) {
        return sendApiError(res, 400, e.code, e.message);
      }
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to save refund proposal");
    }
  });

  app.post("/api/ioms/sd-refund-proposals/:id/verify", async (req, res) => {
    try {
      if (!hasPermission(req.user, "M-02", "Update") && !hasPermission(req.user, "M-02", "Approve")) {
        return sendApiError(res, 403, "SD_VERIFY_DENIED", "No permission to verify.");
      }
      const detail = await verifySdRefundProposal({ req, id: req.params.id });
      res.json(detail);
    } catch (e) {
      if (e instanceof SecurityDepositReceiptError) {
        return sendApiError(res, 400, e.code, e.message);
      }
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to verify refund proposal");
    }
  });

  app.post("/api/ioms/sd-refund-proposals/:id/return", async (req, res) => {
    try {
      if (!hasPermission(req.user, "M-02", "Update") && !hasPermission(req.user, "M-02", "Approve")) {
        return sendApiError(res, 403, "SD_RETURN_DENIED", "No permission.");
      }
      const remarks = String((req.body as { remarks?: string })?.remarks ?? "");
      const detail = await returnSdRefundProposal({ req, id: req.params.id, remarks });
      res.json(detail);
    } catch (e) {
      if (e instanceof SecurityDepositReceiptError) {
        return sendApiError(res, 400, e.code, e.message);
      }
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to return refund proposal");
    }
  });

  app.post("/api/ioms/sd-refund-proposals/:id/approve", async (req, res) => {
    try {
      if (!hasPermission(req.user, "M-02", "Approve")) {
        return sendApiError(res, 403, "SD_APPROVE_DENIED", "DA Approve permission required.");
      }
      const detail = await approveSdRefundProposal({ req, id: req.params.id });
      res.json(detail);
    } catch (e) {
      if (e instanceof SecurityDepositReceiptError) {
        return sendApiError(res, 400, e.code, e.message);
      }
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to approve refund proposal");
    }
  });

  app.post("/api/ioms/sd-refund-proposals/:id/reject", async (req, res) => {
    try {
      if (!hasPermission(req.user, "M-02", "Approve")) {
        return sendApiError(res, 403, "SD_REJECT_DENIED", "DA Approve permission required.");
      }
      const remarks = String((req.body as { remarks?: string })?.remarks ?? "");
      const detail = await rejectSdRefundProposal({ req, id: req.params.id, remarks });
      res.json(detail);
    } catch (e) {
      if (e instanceof SecurityDepositReceiptError) {
        return sendApiError(res, 400, e.code, e.message);
      }
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to reject refund proposal");
    }
  });

  app.get("/api/ioms/premises-sd-ledger", async (req, res) => {
    try {
      if (!hasPermission(req.user, "M-02", "Read")) {
        return sendApiError(res, 403, "SD_READ_DENIED", "No permission.");
      }
      const payerType = String(req.query.payerType ?? "");
      const payerRefId = String(req.query.payerRefId ?? "");
      if (!payerType || !payerRefId) {
        return sendApiError(res, 400, "PAYER_REQUIRED", "payerType and payerRefId are required.");
      }
      const ledger = await getSdLedgerForPayer({ payerType, payerRefId });
      res.json(ledger);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to load SD ledger");
    }
  });
}
