import type { Express, Request } from "express";
import { eq } from "drizzle-orm";
import multer from "multer";
import { nanoid } from "nanoid";
import { db } from "./db";
import { assets, renewalNotices } from "@shared/db-schema";
import { sendApiError } from "./api-errors";
import { writeAuditLog } from "./audit";
import { isPremisesVacantForAllotment } from "@shared/premises-allocation";
import {
  approveSettlement,
  completeRenewal,
  createAgreementDraft,
  createFinalDemandNotice,
  createRenewalNotice,
  createRevisionBatch,
  getAgreementDetail,
  getAgreementHistory,
  getRevisionBatch,
  listApprovalsQueue,
  listPremisesAgreements,
  misReport,
  recordVacation,
  startRenewal,
  summaryCards,
  transitionAgreementApproval,
  transitionPenalty,
  transitionRevisionBatch,
  updateAgreementDraft,
} from "./premises-agreement-service";
import {
  contentTypeForAssetAllotmentAgreement,
  extFromAssetAllotmentAgreementMime,
  isAllowedAssetAllotmentAgreementFileName,
  readAssetAllotmentAgreementBuffer,
  writeAssetAllotmentAgreementBuffer,
} from "./asset-allotment-agreement-storage";
import { buildRenewalNoticePdf } from "./renewal-notice-pdf";
import { buildFinalDemandNoticePdf } from "./final-demand-notice-pdf";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

function routeParam(req: Request, name: string): string {
  const v = req.params[name];
  return Array.isArray(v) ? String(v[0] ?? "") : String(v ?? "");
}

export function registerPremisesAgreementRoutes(app: Express) {
  app.get("/api/ioms/premises-agreements/summary", async (_req, res) => {
    try {
      res.json(await summaryCards());
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to load summary");
    }
  });

  app.get("/api/ioms/premises-agreements", async (req, res) => {
    try {
      const rows = await listPremisesAgreements({
        yardId: String(req.query.yardId ?? ""),
        renewalStatus: String(req.query.renewalStatus ?? ""),
        search: String(req.query.search ?? ""),
        traderLicenceId: String(req.query.traderLicenceId ?? "") || undefined,
        entityId: String(req.query.entityId ?? "") || undefined,
      });
      const scoped = req.scopedLocationIds;
      const filtered =
        scoped && scoped.length > 0 ? rows.filter((r) => scoped.includes(r.yardId)) : rows;
      res.json({ total: filtered.length, rows: filtered });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to list agreements");
    }
  });

  app.get("/api/ioms/premises-agreements/vacant-premises", async (req, res) => {
    try {
      const yardId = String(req.query.yardId ?? "").trim();
      if (!yardId) return sendApiError(res, 400, "YARD_REQUIRED", "yardId is required");
      const rows = await db.select().from(assets).where(eq(assets.yardId, yardId));
      const eligible = rows.filter(
        (a) => a.isActive !== false && isPremisesVacantForAllotment(a.premisesStatus),
      );
      const unavailable = rows
        .filter((a) => a.isActive !== false && !isPremisesVacantForAllotment(a.premisesStatus))
        .map((a) => ({
          id: a.id,
          premisesId: a.assetId,
          assetType: a.assetType,
          area: a.plinthAreaSqft ?? a.area,
          location: a.premisesLocation,
          reason: a.premisesStatus,
        }));
      res.json({
        eligible: eligible.map((a) => ({
          id: a.id,
          premisesId: a.assetId,
          assetType: a.assetType,
          area: a.plinthAreaSqft ?? a.area,
          location: a.premisesLocation,
          premisesStatus: a.premisesStatus,
        })),
        unavailable,
      });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to list vacant premises");
    }
  });

  app.post("/api/ioms/premises-agreements", async (req, res) => {
    try {
      const body = req.body as Record<string, unknown>;
      const track = String(body.track ?? "TrackA") === "TrackB" ? "TrackB" : "TrackA";
      const premisesRaw = Array.isArray(body.premises) ? body.premises : [];
      const premises = premisesRaw.map((p) => {
        const row = p as Record<string, unknown>;
        return {
          assetId: String(row.assetId ?? ""),
          monthlyRent: Number(row.monthlyRent ?? 0),
          areaSqm: row.areaSqm != null ? Number(row.areaSqm) : undefined,
        };
      });
      const created = await createAgreementDraft({
        track,
        traderLicenceId: body.traderLicenceId ? String(body.traderLicenceId) : undefined,
        entityId: body.entityId ? String(body.entityId) : undefined,
        yardId: String(body.yardId ?? ""),
        allotteeName: String(body.allotteeName ?? ""),
        allotmentDate: body.allotmentDate ? String(body.allotmentDate).slice(0, 10) : undefined,
        fromDate: String(body.fromDate ?? "").slice(0, 10),
        toDate: String(body.toDate ?? "").slice(0, 10),
        agreementType: body.agreementType ? String(body.agreementType) : undefined,
        agreementRef: body.agreementRef ? String(body.agreementRef) : undefined,
        rentRevisionMode: body.rentRevisionMode ? String(body.rentRevisionMode) : undefined,
        agreementPeriodNumber: body.agreementPeriodNumber != null ? Number(body.agreementPeriodNumber) : 1,
        rentRevisionFrequency: body.rentRevisionFrequency != null ? Number(body.rentRevisionFrequency) : 3,
        renewalTenureMonths: body.renewalTenureMonths != null ? Number(body.renewalTenureMonths) : undefined,
        penaltyClauseRef: body.penaltyClauseRef ? String(body.penaltyClauseRef) : undefined,
        penaltyMethod: body.penaltyMethod ? String(body.penaltyMethod) : undefined,
        penaltyRate: body.penaltyRate != null ? Number(body.penaltyRate) : undefined,
        totalSecurityDeposit: Number(body.totalSecurityDeposit ?? 0),
        gstApplicable: body.gstApplicable !== false,
        premises,
        createdBy: req.user?.id,
      });
      writeAuditLog(req, {
        module: "PremisesAgreements",
        action: "Create",
        recordId: created?.id ?? "",
        afterValue: created,
      }).catch(() => undefined);
      res.status(201).json(created);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to create agreement";
      sendApiError(res, 400, "AGREEMENT_CREATE_FAILED", msg);
    }
  });

  app.get("/api/ioms/premises-agreements/:id", async (req, res) => {
    try {
      const row = await getAgreementDetail(routeParam(req, "id"));
      if (!row) return sendApiError(res, 404, "NOT_FOUND", "Agreement not found");
      res.json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to load agreement");
    }
  });

  app.put("/api/ioms/premises-agreements/:id", async (req, res) => {
    try {
      const id = routeParam(req, "id");
      const body = req.body as Record<string, unknown>;
      if (body.approvalStatus) {
        const updated = await transitionAgreementApproval({
          id,
          newStatus: String(body.approvalStatus) as "Verified" | "Approved" | "Draft" | "Rejected",
          userId: req.user?.id,
          remarks: body.remarks ? String(body.remarks) : undefined,
        });
        writeAuditLog(req, {
          module: "PremisesAgreements",
          action: "Workflow",
          recordId: id,
          afterValue: updated,
        }).catch(() => undefined);
        return res.json(updated);
      }
      const updated = await updateAgreementDraft(id, {
        fromDate: body.fromDate ? String(body.fromDate).slice(0, 10) : undefined,
        toDate: body.toDate ? String(body.toDate).slice(0, 10) : undefined,
        agreementRef: body.agreementRef != null ? String(body.agreementRef) : undefined,
        allotmentDate: body.allotmentDate ? String(body.allotmentDate).slice(0, 10) : undefined,
        rentRevisionMode: body.rentRevisionMode ? String(body.rentRevisionMode) : undefined,
        agreementPeriodNumber:
          body.agreementPeriodNumber != null ? Number(body.agreementPeriodNumber) : undefined,
        rentRevisionFrequency:
          body.rentRevisionFrequency != null ? Number(body.rentRevisionFrequency) : undefined,
        renewalTenureMonths:
          body.renewalTenureMonths != null ? Number(body.renewalTenureMonths) : undefined,
        penaltyClauseRef: body.penaltyClauseRef != null ? String(body.penaltyClauseRef) : undefined,
        penaltyMethod: body.penaltyMethod != null ? String(body.penaltyMethod) : undefined,
        penaltyRate: body.penaltyRate != null ? Number(body.penaltyRate) : undefined,
        totalSecurityDeposit:
          body.totalSecurityDeposit != null ? Number(body.totalSecurityDeposit) : undefined,
      });
      res.json(updated);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Update failed";
      sendApiError(res, 400, "AGREEMENT_UPDATE_FAILED", msg);
    }
  });

  app.post("/api/ioms/premises-agreements/:id/agreement-doc", upload.single("file"), async (req, res) => {
    try {
      const id = routeParam(req, "id");
      const file = req.file;
      if (!file) return sendApiError(res, 400, "FILE_REQUIRED", "PDF file required");
      const ext = extFromAssetAllotmentAgreementMime(file.mimetype, file.originalname);
      // Storage helpers validate and serve PDF only.
      if (ext !== ".pdf") return sendApiError(res, 400, "FILE_TYPE", "Only PDF allowed for agreement documents");
      // Same naming as legacy asset allotment uploads (validator requires timestamp + nanoid).
      const storedName = `agreement-${Date.now()}-${nanoid(10)}${ext}`;
      if (!isAllowedAssetAllotmentAgreementFileName(storedName)) {
        return sendApiError(res, 400, "FILE_NAME", "Invalid file name");
      }
      await writeAssetAllotmentAgreementBuffer(id, storedName, file.buffer);
      const updated = await updateAgreementDraft(id, {
        agreementDocFile: storedName,
        agreementDocUploadedAt: new Date().toISOString(),
      });
      res.json(updated);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Upload failed");
    }
  });

  app.get("/api/ioms/premises-agreements/:id/agreement-doc", async (req, res) => {
    try {
      const id = routeParam(req, "id");
      const detail = await getAgreementDetail(id);
      if (!detail?.agreementDocFile) {
        return sendApiError(res, 404, "AGREEMENT_NOT_FOUND", "No agreement PDF recorded.");
      }
      const buf = await readAssetAllotmentAgreementBuffer(id, String(detail.agreementDocFile));
      if (!buf) return sendApiError(res, 404, "FILE_MISSING", "Stored agreement file not found.");
      res.setHeader("Content-Type", contentTypeForAssetAllotmentAgreement(String(detail.agreementDocFile)));
      res.setHeader("Content-Disposition", `inline; filename="${String(detail.agreementDocFile)}"`);
      res.send(buf);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Download failed");
    }
  });

  app.get("/api/ioms/premises-agreements/:id/history", async (req, res) => {
    try {
      const hist = await getAgreementHistory(routeParam(req, "id"));
      if (!hist) return sendApiError(res, 404, "NOT_FOUND", "Agreement not found");
      res.json(hist);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to load history");
    }
  });

  app.post("/api/ioms/premises-agreements/:id/renewals", async (req, res) => {
    try {
      const body = req.body as Record<string, unknown>;
      const result = await startRenewal({
        agreementId: routeParam(req, "id"),
        renewalDate: body.renewalDate ? String(body.renewalDate).slice(0, 10) : undefined,
        renewalFromDate: body.renewalFromDate ? String(body.renewalFromDate).slice(0, 10) : undefined,
        renewalToDate: body.renewalToDate ? String(body.renewalToDate).slice(0, 10) : undefined,
        createdBy: req.user?.id,
      });
      writeAuditLog(req, {
        module: "PremisesAgreements",
        action: "RenewalStart",
        recordId: routeParam(req, "id"),
        afterValue: result,
      }).catch(() => undefined);
      res.status(201).json(result);
    } catch (e) {
      sendApiError(res, 400, "RENEWAL_START_FAILED", e instanceof Error ? e.message : "Failed");
    }
  });

  app.post("/api/ioms/agreement-renewals/:id/complete", async (req, res) => {
    try {
      const result = await completeRenewal({ renewalId: routeParam(req, "id"), userId: req.user?.id });
      writeAuditLog(req, {
        module: "PremisesAgreements",
        action: "RenewalComplete",
        recordId: routeParam(req, "id"),
        afterValue: result,
      }).catch(() => undefined);
      res.json(result);
    } catch (e) {
      sendApiError(res, 400, "RENEWAL_COMPLETE_FAILED", e instanceof Error ? e.message : "Failed");
    }
  });

  app.post("/api/ioms/premises-agreements/:id/notices", async (req, res) => {
    try {
      const body = req.body as Record<string, unknown>;
      const notice = await createRenewalNotice({
        agreementId: routeParam(req, "id"),
        lastDateToRenew: body.lastDateToRenew ? String(body.lastDateToRenew).slice(0, 10) : undefined,
        generatedBy: req.user?.id,
        isReprint: Boolean(body.isReprint),
      });
      writeAuditLog(req, {
        module: "PremisesAgreements",
        action: "RenewalNotice",
        recordId: notice.id,
        afterValue: notice,
      }).catch(() => undefined);
      res.status(201).json(notice);
    } catch (e) {
      sendApiError(res, 400, "NOTICE_FAILED", e instanceof Error ? e.message : "Failed");
    }
  });

  app.get("/api/ioms/renewal-notices/:id/pdf", async (req, res) => {
    try {
      const id = routeParam(req, "id");
      const [notice] = await db.select().from(renewalNotices).where(eq(renewalNotices.id, id)).limit(1);
      if (!notice) return sendApiError(res, 404, "NOT_FOUND", "Notice not found");
      const agr = await getAgreementDetail(notice.agreementId);
      if (!agr) return sendApiError(res, 404, "NOT_FOUND", "Agreement not found");
      const pdf = await buildRenewalNoticePdf({ notice, agreement: agr });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${notice.noticeNo}.pdf"`);
      res.send(pdf);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "PDF failed");
    }
  });

  app.put("/api/ioms/renewal-notices/:id/dispatch", async (req, res) => {
    try {
      const id = routeParam(req, "id");
      const body = req.body as Record<string, unknown>;
      await db
        .update(renewalNotices)
        .set({
          dispatchDate: body.dispatchDate ? String(body.dispatchDate).slice(0, 10) : new Date().toISOString().slice(0, 10),
          dispatchRemarks: body.remarks ? String(body.remarks) : null,
        })
        .where(eq(renewalNotices.id, id));
      const [row] = await db.select().from(renewalNotices).where(eq(renewalNotices.id, id)).limit(1);
      res.json(row);
    } catch (e) {
      sendApiError(res, 400, "DISPATCH_FAILED", e instanceof Error ? e.message : "Failed");
    }
  });

  app.post("/api/ioms/premises-agreements/:id/revisions", async (req, res) => {
    try {
      const body = req.body as Record<string, unknown>;
      const linesRaw = Array.isArray(body.lines) ? body.lines : [];
      const batch = await createRevisionBatch({
        agreementId: routeParam(req, "id"),
        effectiveDate: String(body.effectiveDate ?? "").slice(0, 10),
        revisionBasis: body.revisionBasis ? String(body.revisionBasis) : undefined,
        renewalId: body.renewalId ? String(body.renewalId) : undefined,
        remarks: body.remarks ? String(body.remarks) : undefined,
        createdBy: req.user?.id,
        lines: linesRaw.map((l) => {
          const row = l as Record<string, unknown>;
          return {
            agreementLineId: String(row.agreementLineId ?? ""),
            revisedRent: Number(row.revisedRent ?? 0),
          };
        }),
      });
      res.status(201).json(batch);
    } catch (e) {
      sendApiError(res, 400, "REVISION_FAILED", e instanceof Error ? e.message : "Failed");
    }
  });

  app.put("/api/ioms/rent-revision-batches/:id", async (req, res) => {
    try {
      const body = req.body as Record<string, unknown>;
      const status = String(body.status ?? "");
      if (!["Verified", "Approved", "Returned", "Rejected"].includes(status)) {
        return sendApiError(res, 400, "STATUS_INVALID", "Invalid status");
      }
      const batch = await transitionRevisionBatch({
        batchId: routeParam(req, "id"),
        newStatus: status as "Verified" | "Approved" | "Returned" | "Rejected",
        userId: req.user?.id,
        remarks: body.remarks ? String(body.remarks) : undefined,
      });
      res.json(batch);
    } catch (e) {
      sendApiError(res, 400, "REVISION_WORKFLOW_FAILED", e instanceof Error ? e.message : "Failed");
    }
  });

  app.get("/api/ioms/rent-revision-batches/:id", async (req, res) => {
    try {
      const batch = await getRevisionBatch(routeParam(req, "id"));
      if (!batch) return sendApiError(res, 404, "NOT_FOUND", "Not found");
      res.json(batch);
    } catch (e) {
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed");
    }
  });

  app.put("/api/ioms/delay-penalties/:id", async (req, res) => {
    try {
      const body = req.body as Record<string, unknown>;
      const status = String(body.status ?? "");
      if (!["Verified", "Approved", "Returned", "Rejected"].includes(status)) {
        return sendApiError(res, 400, "STATUS_INVALID", "Invalid status");
      }
      const row = await transitionPenalty({
        penaltyId: routeParam(req, "id"),
        newStatus: status as "Verified" | "Approved" | "Returned" | "Rejected",
        userId: req.user?.id,
        remarks: body.remarks ? String(body.remarks) : undefined,
      });
      res.json(row);
    } catch (e) {
      sendApiError(res, 400, "PENALTY_WORKFLOW_FAILED", e instanceof Error ? e.message : "Failed");
    }
  });

  app.get("/api/ioms/premises-agreements-approvals", async (_req, res) => {
    try {
      res.json(await listApprovalsQueue());
    } catch (e) {
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed");
    }
  });

  app.get("/api/ioms/premises-agreements-mis/:reportKey", async (req, res) => {
    try {
      const rows = await misReport(routeParam(req, "reportKey"));
      res.json({ rows });
    } catch (e) {
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed");
    }
  });

  app.post("/api/ioms/premises-agreements/:id/lines/:lineId/vacation", async (req, res) => {
    try {
      const body = req.body as Record<string, unknown>;
      const result = await recordVacation({
        agreementId: routeParam(req, "id"),
        agreementLineId: routeParam(req, "lineId"),
        caseType: String(body.caseType ?? ""),
        intimationDate: body.intimationDate ? String(body.intimationDate).slice(0, 10) : undefined,
        proposedVacationDate: body.proposedVacationDate
          ? String(body.proposedVacationDate).slice(0, 10)
          : undefined,
        actualVacationDate: body.actualVacationDate
          ? String(body.actualVacationDate).slice(0, 10)
          : undefined,
        orderType: body.orderType ? String(body.orderType) : undefined,
        orderRefNo: body.orderRefNo ? String(body.orderRefNo) : undefined,
        orderDate: body.orderDate ? String(body.orderDate).slice(0, 10) : undefined,
        remarks: body.remarks ? String(body.remarks) : undefined,
        createdBy: req.user?.id,
      });
      res.status(201).json(result);
    } catch (e) {
      sendApiError(res, 400, "VACATION_FAILED", e instanceof Error ? e.message : "Failed");
    }
  });

  app.put("/api/ioms/full-final-settlements/:id/approve", async (req, res) => {
    try {
      const body = req.body as Record<string, unknown>;
      const row = await approveSettlement({
        settlementId: routeParam(req, "id"),
        userId: req.user?.id,
        approvedAdjustments: Array.isArray(body.approvedAdjustments) ? body.approvedAdjustments : undefined,
        finalApprovedNet: body.finalApprovedNet != null ? Number(body.finalApprovedNet) : undefined,
      });
      res.json(row);
    } catch (e) {
      sendApiError(res, 400, "SETTLEMENT_APPROVE_FAILED", e instanceof Error ? e.message : "Failed");
    }
  });

  app.post("/api/ioms/full-final-settlements/:id/demand-notice", async (req, res) => {
    try {
      const body = req.body as Record<string, unknown>;
      const notice = await createFinalDemandNotice({
        settlementId: routeParam(req, "id"),
        paymentDueDate: body.paymentDueDate ? String(body.paymentDueDate).slice(0, 10) : undefined,
        generatedBy: req.user?.id,
      });
      res.status(201).json(notice);
    } catch (e) {
      sendApiError(res, 400, "DEMAND_NOTICE_FAILED", e instanceof Error ? e.message : "Failed");
    }
  });

  app.get("/api/ioms/final-demand-notices/:id/pdf", async (req, res) => {
    try {
      const { finalDemandNotices, fullFinalSettlements } = await import("@shared/db-schema");
      const id = routeParam(req, "id");
      const [notice] = await db.select().from(finalDemandNotices).where(eq(finalDemandNotices.id, id)).limit(1);
      if (!notice) return sendApiError(res, 404, "NOT_FOUND", "Not found");
      const [setl] = await db
        .select()
        .from(fullFinalSettlements)
        .where(eq(fullFinalSettlements.id, notice.settlementId))
        .limit(1);
      const agr = await getAgreementDetail(notice.agreementId);
      const pdf = await buildFinalDemandNoticePdf({ notice, settlement: setl, agreement: agr });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${notice.noticeNo}.pdf"`);
      res.send(pdf);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "PDF failed");
    }
  });

}
