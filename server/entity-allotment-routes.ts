/**
 * US-M02-003: Track B premises allocation workflow (DO→DV→DA), agreement PDF, refs, validations.
 */
import type { Express, NextFunction, Request, Response } from "express";
import multer from "multer";
import { and, desc, eq, ne } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import { nanoid } from "nanoid";
import { assetAllotments, assets, entities, entityAllotments, iomsReceipts, yards } from "@shared/db-schema";
import { unifiedEntityIdFromTrackB } from "@shared/unified-entity-id";
import { db, pool } from "./db";
import { describeStorageFailure, sendApiError } from "./api-errors";
import { writeAuditLog } from "./audit";
import { createIomsReceipt } from "./routes-receipts-ioms";
import { routeParamString } from "./route-params";
import { syncPremisesStatusFromTenancy } from "./premises-status-sync";
import {
  assertPremisesNotAlreadyAllocatedActive,
  fetchAssetForAllocationGuard,
  isPremisesAllocatable,
} from "./premises-allocation-guard";
import {
  assertSegregationDoDvDa,
  assertRecordDoDvDaSeparation,
  canCreateEntityAllotmentDraft,
  canEditDraftEntityAllotment,
  canTransitionEntityAllotmentApproval,
} from "./workflow";
import {
  assertVacatedToDateNotFuture,
  defaultGstApplicableTrackBEntity,
  hasAgreementCalendarGap,
  inferAgreementTypeFromDates,
  normalizeAgreementType,
  normalizeRentRevisionMode,
  roundedMoney2,
  todayYmdUtc,
} from "@shared/premises-allocation";
import {
  issueSecurityDepositReceiptOnAllotmentDraft,
  SecurityDepositReceiptError,
} from "./allotment-security-deposit-receipt";
import {
  contentTypeForEntityAllotmentAgreement,
  extFromEntityAllotmentAgreementMime,
  isAllowedEntityAllotmentAgreementFileName,
  readEntityAllotmentAgreementBuffer,
  writeEntityAllotmentAgreementBuffer,
} from "./entity-allotment-agreement-storage";

type EntityAllotmentAgreementUploadFile = { buffer: Buffer; mimetype: string; originalname?: string };

type EntityAllotmentRow = InferSelectModel<typeof entityAllotments>;

function yardInScope(req: Request, yardId: string): boolean {
  const scopedIds = (req as Request & { scopedLocationIds?: string[] }).scopedLocationIds;
  return !scopedIds || scopedIds.length === 0 || scopedIds.includes(yardId);
}

function ymdFieldError(label: string, v: string | null | undefined, required: boolean): string | null {
  if (v == null || String(v).trim() === "") return required ? `${label} is required.` : null;
  const s = String(v).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${label} must be YYYY-MM-DD.`;
  const t = new Date(`${s}T12:00:00.000Z`).getTime();
  if (Number.isNaN(t)) return `${label} is invalid.`;
  return null;
}

async function nextPremisesRefCounter(premisesKey: string): Promise<number> {
  const q = `
    INSERT INTO gapmc.premises_ref_counters (premises_key, last_nn)
    VALUES ($1, 1)
    ON CONFLICT (premises_key) DO UPDATE
    SET last_nn = gapmc.premises_ref_counters.last_nn + 1
    RETURNING last_nn
  `;
  const res = await pool.query<{ last_nn: number }>(q, [premisesKey]);
  const r = res.rows[0]?.last_nn;
  if (!Number.isFinite(Number(r))) throw new Error("premises_ref_counter_failed");
  return Number(r);
}

async function allocatePremisesRefNo(assetPremisesId: string, yardCode: string): Promise<string> {
  const premisesKey = `${assetPremisesId}|${yardCode}`;
  const nn = await nextPremisesRefCounter(premisesKey);
  return `${assetPremisesId}-${yardCode}-${String(nn).padStart(2, "0")}`;
}

export async function premisesRefNoTaken(refNo: string, excludeEntityAllotId?: string, excludeAssetAllotId?: string): Promise<boolean> {
  const ref = String(refNo ?? "").trim();
  if (!ref) return false;
  const entityCond = excludeEntityAllotId
    ? and(eq(entityAllotments.premisesRefNo, ref), ne(entityAllotments.id, excludeEntityAllotId))
    : eq(entityAllotments.premisesRefNo, ref);
  const [entityHit] = await db.select({ id: entityAllotments.id }).from(entityAllotments).where(entityCond).limit(1);
  if (entityHit) return true;
  const traderCond = excludeAssetAllotId
    ? and(eq(assetAllotments.premisesRefNo, ref), ne(assetAllotments.id, excludeAssetAllotId))
    : eq(assetAllotments.premisesRefNo, ref);
  const [traderHit] = await db.select({ id: assetAllotments.id }).from(assetAllotments).where(traderCond).limit(1);
  return Boolean(traderHit);
}

async function tenantChainGapViolates(existing: EntityAllotmentRow): Promise<boolean> {
  const list = await db
    .select()
    .from(entityAllotments)
    .where(
      and(
        eq(entityAllotments.assetId, existing.assetId),
        eq(entityAllotments.entityId, existing.entityId),
        eq(entityAllotments.status, "Vacated"),
      ),
    )
    .orderBy(desc(entityAllotments.toDate))
    .limit(1);

  const prior = list[0];
  if (!prior?.toDate) return false;
  const fromDate = String(existing.fromDate ?? "").trim();
  return hasAgreementCalendarGap(String(prior.toDate).trim(), fromDate);
}

export function registerEntityAllotmentRoutes(app: Express) {
  const nowIso = () => new Date().toISOString();

  const agreementPdfUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 },
  });

  function multerAgreementSingle(req: Request, res: Response, next: NextFunction): void {
    agreementPdfUpload.single("file")(req, res, (err: unknown) => {
      const e = err as { code?: string; message?: string } | undefined;
      if (e?.code === "LIMIT_FILE_SIZE") {
        return sendApiError(res, 400, "E-AST-011", "Agreement PDF must be 20 MB or smaller.");
      }
      if (err) {
        return sendApiError(res, 400, "AGREEMENT_UPLOAD_FAILED", e?.message || "Upload failed.");
      }
      next();
    });
  }

  app.get("/api/ioms/entity-allotments", async (req, res) => {
    try {
      const entityId = req.query.entityId as string | undefined;
      const assetId = req.query.assetId as string | undefined;
      let list = await db.select().from(entityAllotments).orderBy(desc(entityAllotments.fromDate));
      if (entityId) list = list.filter((r) => r.entityId === entityId);
      if (assetId) list = list.filter((r) => r.assetId === assetId);
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch entity allotments");
    }
  });

  app.post("/api/ioms/entity-allotments", async (req, res) => {
    try {
      if (!canCreateEntityAllotmentDraft(req.user)) {
        return sendApiError(res, 403, "ENTITY_ALLOT_CREATE_DENIED", "Only Data Originator or Admin can create premises allocation drafts.");
      }
      const body = req.body as Record<string, unknown>;
      const entityId = String(body.entityId ?? "");
      const assetId = String(body.assetId ?? "");

      const [ent] = await db.select().from(entities).where(eq(entities.id, entityId)).limit(1);
      if (!ent) return sendApiError(res, 404, "ENTITY_NOT_FOUND", "Entity not found");
      if (String(ent.track ?? "").trim() !== "TrackB") {
        return sendApiError(res, 400, "ENTITY_TRACK_NOT_TRACKB", "Premises Allocation workflow applies to Track B entities.");
      }
      if (String(ent.status ?? "").trim() !== "Active") {
        return sendApiError(res, 400, "ENTITY_INACTIVE", "Entity must be Active to allocate premises.");
      }
      if (!yardInScope(req, ent.yardId)) return sendApiError(res, 403, "M02_YARD_ACCESS_DENIED", "You do not have access to this entity yard");

      const assetRow = await fetchAssetForAllocationGuard(assetId);
      if (!assetRow) return sendApiError(res, 404, "ASSET_NOT_FOUND", "Premises / asset not found");
      if (!yardInScope(req, assetRow.yardId))
        return sendApiError(res, 403, "ASSET_YARD_ACCESS_DENIED", "You do not have access to this asset's yard");

      const allocPrem = isPremisesAllocatable({
        isActive: assetRow.isActive,
        premisesStatus: (assetRow as { premisesStatus?: string | null }).premisesStatus ?? "Vacant",
      });
      if (!allocPrem.ok) return sendApiError(res, 400, allocPrem.code, allocPrem.message);

      const dup = await assertPremisesNotAlreadyAllocatedActive({ assetId });
      if (!dup.ok) {
        return sendApiError(res, 400, "E-PRE-005", "Premises already has an Active allocation.", {
          assetId,
          entityAllotments: dup.entityConflicts,
          traderAllotments: dup.traderConflicts,
        });
      }

      const allotmentDate = String(body.allotmentDate ?? "").trim();
      const adErr = ymdFieldError("Allotment date", allotmentDate, true);
      if (adErr) return sendApiError(res, 400, "ALLOTMENT_DATE", adErr);

      const premisesRefNo = body.premisesRefNo != null ? String(body.premisesRefNo).trim() : "";
      if (premisesRefNo && (await premisesRefNoTaken(premisesRefNo))) {
        return sendApiError(res, 400, "PREMISES_REF_DUPLICATE", "Allotment reference number is already in use.");
      }

      const fromDate = String(body.fromDate ?? "").trim();
      const toDate = String(body.toDate ?? "").trim();
      const ferr = ymdFieldError("Agreement from", fromDate, true);
      if (ferr) return sendApiError(res, 400, "AGREEMENT_FROM", ferr);
      const terr = ymdFieldError("Agreement to", toDate, true);
      if (terr) return sendApiError(res, 400, "AGREEMENT_TO", terr);
      if (fromDate > toDate) return sendApiError(res, 400, "AGREEMENT_RANGE", "Agreement To must be on or after Agreement From.");

      const monthlyRent = Number(body.monthlyRent);
      if (!Number.isFinite(monthlyRent) || monthlyRent <= 0) {
        return sendApiError(res, 400, "MONTHLY_RENT", "Monthly rent must be greater than 0.");
      }

      const rr = normalizeRentRevisionMode(body.rentRevisionMode);
      if (!rr) {
        return sendApiError(res, 400, "RENT_REVISION_MODE", "Rent Revision Mode is required (StandardConsecutiveRenewal or PwdCertificate).");
      }

      let agreementType = inferAgreementTypeFromDates(fromDate, toDate);
      const overridden = normalizeAgreementType(body.agreementType);
      if (overridden) agreementType = overridden;

      let gstApplicable = defaultGstApplicableTrackBEntity(ent.subType);
      if (body.gstApplicable !== undefined && body.gstApplicable !== null && String(ent.subType ?? "").trim() === "AdHocOccupant") {
        gstApplicable = Boolean(body.gstApplicable);
      }

      const [priorVacated] = await db
        .select()
        .from(entityAllotments)
        .where(and(eq(entityAllotments.assetId, assetId), eq(entityAllotments.entityId, entityId), eq(entityAllotments.status, "Vacated")))
        .orderBy(desc(entityAllotments.toDate))
        .limit(1);
      if (priorVacated?.toDate && hasAgreementCalendarGap(String(priorVacated.toDate).trim(), fromDate)) {
        return sendApiError(
          res,
          400,
          "E-AST-004",
          "Agreement start leaves a calendar gap after the prior vacated record for this entity and premises. DA can override only on approval.",
        );
      }

      const allotteeName = String(ent.name ?? "").trim();
      if (!allotteeName) return sendApiError(res, 400, "ALLOTTEE_REQUIRED", "Entity name is required as allottee.");
      const sec = body.securityDeposit != null ? Number(body.securityDeposit) : null;

      const id = nanoid();
      await db.insert(entityAllotments).values({
        id,
        assetId,
        entityId,
        allotteeName,
        fromDate,
        toDate,
        status: "Pending",
        securityDeposit: sec != null && Number.isFinite(sec) ? roundedMoney2(sec) : null,
        doUser: req.user?.id ?? null,
        dvUser: null,
        daUser: null,
        approvalStatus: "Draft",
        allotmentDate,
        premisesRefNo: premisesRefNo || null,
        monthlyRent: roundedMoney2(monthlyRent),
        gstApplicable,
        gstLocked: false,
        agreementType,
        agreementDocFile: null,
        agreementDocUploadedAt: null,
        rentRevisionMode: rr,
        consecutiveRenewalCount: Number.isFinite(Number(body.consecutiveRenewalCount)) ? Number(body.consecutiveRenewalCount) : 0,
        verifiedAt: null,
        approvedAt: null,
        workflowRevisionCount: 0,
        dvReturnRemarks: null,
        rejectionRemarks: null,
        agreementGapDaOverride: false,
        daGstOverride: false,
      });
      const [row] = await db.select().from(entityAllotments).where(eq(entityAllotments.id, id));
      if (row)
        writeAuditLog(req, { module: "Traders", action: "Create", recordId: id, afterValue: row }).catch((e) => console.error(e));

      let securityDepositReceipt: { receiptId: string; receiptNo: string } | null = null;
      if (sec != null && Number.isFinite(sec) && sec > 0) {
        try {
          securityDepositReceipt = await issueSecurityDepositReceiptOnAllotmentDraft({
            req,
            allotmentId: id,
            yardId: assetRow.yardId,
            securityDepositAmount: sec,
            payerName: allotteeName,
            payerType: "Entity",
            payerRefId: entityId,
            unifiedEntityId: unifiedEntityIdFromTrackB(entityId),
            premisesAssetId: assetRow.assetId,
            paymentBody: body,
          });
        } catch (err) {
          if (err instanceof SecurityDepositReceiptError) {
            return sendApiError(res, 400, err.code, err.message);
          }
          throw err;
        }
      }

      res.status(201).json({ ...row, securityDepositReceipt });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create entity allotment");
    }
  });

  app.post("/api/ioms/entity-allotments/:id/agreement", multerAgreementSingle, async (req, res) => {
    try {
      const id = routeParamString(req.params.id);
      const [row] = await db.select().from(entityAllotments).where(eq(entityAllotments.id, id)).limit(1);
      if (!row) return sendApiError(res, 404, "ENTITY_ALLOT_NOT_FOUND", "Allocation not found");
      const appr = String(row.approvalStatus ?? "Draft");
      if (!["Draft", "Rejected"].includes(appr)) {
        return sendApiError(res, 400, "AGREEMENT_UPLOAD_STATE", "Agreement uploads are allowed only in Draft or Rejected status.");
      }
      if (!canEditDraftEntityAllotment(req.user, row)) {
        return sendApiError(res, 403, "AGREEMENT_UPLOAD_DENIED", "You cannot attach agreement documents on this allocation.");
      }
      const [assetRow] = await db.select().from(assets).where(eq(assets.id, row.assetId)).limit(1);
      if (!assetRow || !yardInScope(req, assetRow.yardId)) return sendApiError(res, 404, "ENTITY_ALLOT_NOT_FOUND", "Allocation not found");

      const file = (req as Request & { file?: EntityAllotmentAgreementUploadFile }).file;
      if (!file) return sendApiError(res, 400, "AGREEMENT_FILE_REQUIRED", "Upload file required (field name: file)");
      const ext = extFromEntityAllotmentAgreementMime(file.mimetype, file.originalname);
      if (!ext) return sendApiError(res, 400, "AGREEMENT_FILE_TYPE", "Only PDF uploads are accepted for scanned agreements.");

      const storedName = `agreement-${Date.now()}-${nanoid(10)}${ext}`;
      if (!isAllowedEntityAllotmentAgreementFileName(storedName))
        return sendApiError(res, 400, "AGREEMENT_FILE_NAME", "Internal file naming error.");

      await writeEntityAllotmentAgreementBuffer(row.id, storedName, file.buffer);

      await db
        .update(entityAllotments)
        .set({ agreementDocFile: storedName, agreementDocUploadedAt: nowIso() })
        .where(eq(entityAllotments.id, id));

      const [fresh] = await db.select().from(entityAllotments).where(eq(entityAllotments.id, id));
      writeAuditLog(req, { module: "Traders", action: "Update", recordId: id, afterValue: fresh }).catch((e) => console.error(e));
      res.json(fresh);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", describeStorageFailure(e, "Failed to upload agreement"));
    }
  });

  app.get("/api/ioms/entity-allotments/:id/agreement", async (req, res) => {
    try {
      const id = routeParamString(req.params.id);
      const [row] = await db.select().from(entityAllotments).where(eq(entityAllotments.id, id)).limit(1);
      if (!row?.agreementDocFile) return sendApiError(res, 404, "AGREEMENT_NOT_FOUND", "No agreement PDF recorded.");
      const [assetRow] = await db.select().from(assets).where(eq(assets.id, row.assetId)).limit(1);
      if (!assetRow || !yardInScope(req, assetRow.yardId)) return sendApiError(res, 404, "AGREEMENT_NOT_FOUND", "No agreement PDF.");
      const buf = await readEntityAllotmentAgreementBuffer(row.id, row.agreementDocFile);
      if (!buf) return sendApiError(res, 404, "AGREEMENT_BLOB_MISSING", "Stored PDF not found.");
      const fn = encodeURIComponent(`${row.premisesRefNo || row.id}-agreement.pdf`);
      res.setHeader("Content-Type", contentTypeForEntityAllotmentAgreement(row.agreementDocFile));
      res.setHeader("Content-Disposition", `inline; filename="${fn}"`);
      res.send(buf);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", describeStorageFailure(e, "Failed to read agreement PDF"));
    }
  });

  app.put("/api/ioms/entity-allotments/:id", async (req, res) => {
    try {
      const id = routeParamString(req.params.id);
      const body = req.body as Record<string, unknown>;
      const [existing] = await db.select().from(entityAllotments).where(eq(entityAllotments.id, id)).limit(1);
      if (!existing) return sendApiError(res, 404, "ENTITY_ALLOT_NOT_FOUND", "Not found");

      const [assetRow] = await db.select().from(assets).where(eq(assets.id, existing.assetId)).limit(1);
      if (!assetRow || !yardInScope(req, assetRow.yardId)) return sendApiError(res, 404, "ENTITY_ALLOT_NOT_FOUND", "Not found");

      const [entRow] = await db.select().from(entities).where(eq(entities.id, existing.entityId)).limit(1);
      if (!entRow) return sendApiError(res, 404, "ENTITY_NOT_FOUND", "Entity not found");

      const currentApproval = String(existing.approvalStatus ?? "Draft");
      const newApproval = body.approvalStatus !== undefined ? String(body.approvalStatus).trim() : null;

      if (newApproval && newApproval !== currentApproval) {
        const transition = canTransitionEntityAllotmentApproval(req.user, currentApproval, newApproval);
        if (!transition.allowed)
          return sendApiError(res, 403, "ENTITY_ALLOT_STATUS_DENIED", `Cannot transition from ${currentApproval} to ${newApproval}.`);

        const mergedDo = existing.doUser;
        const mergedDvExisting = existing.dvUser ?? null;
        const nextDvForSeg =
          transition.setDvUser && newApproval === "Verified" ? req.user?.id ?? null : mergedDvExisting;
        const nextDaForSeg =
          transition.setDaUser && (newApproval === "Approved" || newApproval === "Rejected")
            ? req.user?.id ?? null
            : (existing.daUser ?? null);

        const pendingRecord = {
          doUser: mergedDo ?? null,
          dvUser: nextDvForSeg,
          daUser: nextDaForSeg,
        };

        const seg = assertSegregationDoDvDa(
          req.user,
          {
            doUser: mergedDo ?? null,
            dvUser: nextDvForSeg,
            daUser: nextDaForSeg,
          },
          transition,
        );
        if (!seg.ok) return sendApiError(res, 403, "ENTITY_ALLOT_DO_DV_DA_SEGREGATION", seg.error);

        const segRec = assertRecordDoDvDaSeparation(req.user, pendingRecord as { doUser?: string | null; dvUser?: string | null; daUser?: string | null });
        if (!segRec.ok) return sendApiError(res, 403, "ENTITY_ALLOT_DO_DV_DA_SEPARATION", segRec.error);

        if (currentApproval === "Draft" && newApproval === "Verified") {
          if (!existing.agreementDocFile)
            return sendApiError(res, 400, "E-AST-011", "Agreement copy (PDF) must be uploaded before DV verification.");
        }

        if (currentApproval === "Verified" && newApproval === "Draft") {
          const remarks = body.dvReturnRemarks ? String(body.dvReturnRemarks).trim() : "";
          if (remarks.length < 5) {
            return sendApiError(res, 400, "DV_RETURN_REMARKS", "Return remarks (minimum 5 characters) required when verifier returns allocation to Draft.");
          }
        }

        if (newApproval === "Approved") {
          if (!existing.agreementDocFile)
            return sendApiError(res, 400, "E-AST-011", "Agreement copy (PDF) is mandatory before DA approval.");

          const gapOv = Boolean(body.agreementGapDaOverride ?? false);
          const violates = await tenantChainGapViolates(existing);
          if (violates && !gapOv) {
            return sendApiError(res, 400, "E-AST-004", "Agreement gap with prior period exists; DA must acknowledge override.");
          }

          let premRef = existing.premisesRefNo ?? null;
          if (!premRef) {
            const [yRow] = await db.select({ code: yards.code }).from(yards).where(eq(yards.id, entRow.yardId)).limit(1);
            const yc = String(yRow?.code ?? "YRD").trim().replace(/\s+/g, "") || "YRD";
            premRef = await allocatePremisesRefNo(assetRow.assetId, yc);
          }

          let gstApplicable = Boolean(existing.gstApplicable);
          let gstLocked = true;
          let daGstOv = Boolean(existing.daGstOverride ?? false);

          if (body.gstApplicableDaOverride !== undefined) {
            gstApplicable = Boolean(body.gstApplicableDaOverride);
            daGstOv = true;
          }

          await db
            .update(entityAllotments)
            .set({
              approvalStatus: "Approved",
              allotteeName: String(entRow.name ?? existing.allotteeName ?? "").trim() || existing.allotteeName,
              dvUser: existing.dvUser,
              verifiedAt: existing.verifiedAt,
              daUser: transition.setDaUser ? req.user?.id ?? null : existing.daUser,
              approvedAt: nowIso(),
              premisesRefNo: premRef,
              gstApplicable,
              gstLocked,
              daGstOverride: daGstOv,
              agreementGapDaOverride: gapOv,
              status: "Active",
            })
            .where(eq(entityAllotments.id, id));

          const secDep = Number(existing.securityDeposit ?? 0);
          if (Number.isFinite(secDep) && secDep > 0) {
            const [existingReceipt] = await db
              .select()
              .from(iomsReceipts)
              .where(
                and(
                  eq(iomsReceipts.sourceModule, "M-02"),
                  eq(iomsReceipts.sourceRecordId, id),
                  eq(iomsReceipts.revenueHead, "SecurityDeposit"),
                ),
              )
              .limit(1);
            if (!existingReceipt) {
              const createdBy = req.user?.id ?? "system";
              const created = await createIomsReceipt({
                yardId: assetRow.yardId,
                revenueHead: "SecurityDeposit",
                payerName: String(entRow.name ?? existing.allotteeName ?? "").trim() || existing.allotteeName,
                payerType: "Entity",
                payerRefId: entRow.id,
                amount: roundedMoney2(secDep),
                paymentMode: "Cash",
                sourceModule: "M-02",
                sourceRecordId: id,
                unifiedEntityId: unifiedEntityIdFromTrackB(entRow.id),
                createdBy,
              });
              const [createdRow] = await db.select().from(iomsReceipts).where(eq(iomsReceipts.id, created.id)).limit(1);
              if (createdRow) {
                writeAuditLog(req, {
                  module: "Receipts",
                  action: "Create",
                  recordId: createdRow.id,
                  afterValue: createdRow,
                }).catch((e) => console.error(e));
              }
            }
          }

          await syncPremisesStatusFromTenancy(existing.assetId);
          const [after] = await db.select().from(entityAllotments).where(eq(entityAllotments.id, id));
          writeAuditLog(req, { module: "Traders", action: "Update", recordId: id, beforeValue: existing, afterValue: after }).catch((e) =>
            console.error(e),
          );
          return res.json(after);
        }

        const patchWorkflow: Partial<EntityAllotmentRow> = {
          approvalStatus: newApproval as EntityAllotmentRow["approvalStatus"],
        };

        if (newApproval === "Verified") {
          patchWorkflow.dvUser = transition.setDvUser ? req.user?.id ?? null : existing.dvUser;
          patchWorkflow.verifiedAt = nowIso();
        }

        if (newApproval === "Rejected") {
          patchWorkflow.daUser = transition.setDaUser ? req.user?.id ?? null : existing.daUser;
          patchWorkflow.rejectionRemarks = body.rejectionRemarks ? String(body.rejectionRemarks).trim() : null;
        }

        if (newApproval === "Draft" && currentApproval === "Rejected") {
          patchWorkflow.workflowRevisionCount = Number(existing.workflowRevisionCount ?? 0) + 1;
        }

        if (currentApproval === "Verified" && newApproval === "Draft") {
          patchWorkflow.dvReturnRemarks = body.dvReturnRemarks ? String(body.dvReturnRemarks).trim() : null;
          patchWorkflow.workflowRevisionCount = Number(existing.workflowRevisionCount ?? 0) + 1;
          patchWorkflow.dvUser = null;
          patchWorkflow.verifiedAt = null;
        }

        await db.update(entityAllotments).set(patchWorkflow).where(eq(entityAllotments.id, id));
        const [row] = await db.select().from(entityAllotments).where(eq(entityAllotments.id, id));
        writeAuditLog(req, { module: "Traders", action: "Update", recordId: id, beforeValue: existing, afterValue: row }).catch((e) =>
          console.error(e),
        );
        return res.json(row);
      }

      if (currentApproval === "Verified") {
        return sendApiError(
          res,
          403,
          "ENTITY_ALLOT_VERIFIED",
          "Awaiting DV return or DA decision — workflow actions only on this allocation.",
        );
      }

      if (existing.approvalStatus === "Approved") {
        const tenancy = body.status !== undefined ? String(body.status).trim() : null;
        if (tenancy && tenancy !== existing.status && ["Vacating", "Vacated"].includes(tenancy)) {
          if (tenancy === "Vacated") {
            const existingTo = String(existing.toDate ?? "").trim();
            const bodyToRaw = body.toDate;
            const hasExplicitTo =
              bodyToRaw !== undefined && bodyToRaw !== null && String(bodyToRaw).trim() !== "";
            const nextTo = hasExplicitTo ? String(bodyToRaw).trim() : existingTo;
            const vOnErr = ymdFieldError("Vacated on", nextTo, true);
            if (vOnErr) return sendApiError(res, 400, "VACATED_ON", vOnErr);
            const vFut = assertVacatedToDateNotFuture(nextTo);
            if (vFut) return sendApiError(res, 400, "VACATED_DATE_FUTURE", vFut);
            if (!hasExplicitTo && existingTo > todayYmdUtc()) {
              return sendApiError(
                res,
                400,
                "VACATED_TO_REQUIRED",
                "Agreement end is still in the future: set toDate to the actual vacation date (today or earlier).",
              );
            }
            const nextFrom = String(existing.fromDate ?? "").trim();
            if (nextFrom > nextTo) {
              return sendApiError(
                res,
                400,
                "AGREEMENT_RANGE",
                "Vacated on (agreement to) must be on or after agreement from.",
              );
            }
            const setPayload: Partial<EntityAllotmentRow> = { status: tenancy };
            if (hasExplicitTo) setPayload.toDate = nextTo;
            await db.update(entityAllotments).set(setPayload).where(eq(entityAllotments.id, id));
          } else {
            await db.update(entityAllotments).set({ status: tenancy }).where(eq(entityAllotments.id, id));
          }
          await syncPremisesStatusFromTenancy(existing.assetId);
          const [row] = await db.select().from(entityAllotments).where(eq(entityAllotments.id, id));
          writeAuditLog(req, { module: "Traders", action: "Update", recordId: id, beforeValue: existing, afterValue: row }).catch((e) =>
            console.error(e),
          );
          return res.json(row);
        }
        return sendApiError(res, 400, "ENTITY_ALLOT_LOCKED", "Approved allocations are immutable except tenancy status Vacating/Vacated.");
      }

      if (!canEditDraftEntityAllotment(req.user, existing)) {
        return sendApiError(res, 403, "ENTITY_ALLOT_EDIT_DENIED", "Only the originating DO (or Admin) can edit drafts.");
      }

      const financeEditable = ["Draft", "Rejected"].includes(String(existing.approvalStatus ?? ""));
      const updates: Partial<EntityAllotmentRow> = {};
      if (financeEditable) {
        const syncedAllottee = String(entRow.name ?? "").trim();
        if (syncedAllottee) updates.allotteeName = syncedAllottee;
      } else if (body.allotteeName !== undefined) {
        updates.allotteeName = String(body.allotteeName ?? "").trim();
      }
      if (financeEditable && body.allotmentDate !== undefined) {
        const ad = String(body.allotmentDate ?? "").trim();
        const adErr = ymdFieldError("Allotment date", ad, true);
        if (adErr) return sendApiError(res, 400, "ALLOTMENT_DATE", adErr);
        updates.allotmentDate = ad;
      }
      if (financeEditable && body.premisesRefNo !== undefined) {
        const ref = String(body.premisesRefNo ?? "").trim();
        if (ref && (await premisesRefNoTaken(ref, id))) {
          return sendApiError(res, 400, "PREMISES_REF_DUPLICATE", "Allotment reference number is already in use.");
        }
        updates.premisesRefNo = ref || null;
      }
      if (body.fromDate !== undefined) updates.fromDate = String(body.fromDate ?? "").trim();
      if (body.toDate !== undefined) updates.toDate = String(body.toDate ?? "").trim();

      if (updates.fromDate || updates.toDate) {
        const f = String((updates.fromDate ?? existing.fromDate) ?? "").trim();
        const t = String((updates.toDate ?? existing.toDate) ?? "").trim();
        if (ymdFieldError("From", f, true)) return sendApiError(res, 400, "AGREEMENT_FROM", ymdFieldError("From", f, true)!);
        if (ymdFieldError("To", t, true)) return sendApiError(res, 400, "AGREEMENT_TO", ymdFieldError("To", t, true)!);
        if (f > t) return sendApiError(res, 400, "AGREEMENT_RANGE", "Agreement To must be on or after Agreement From.");
      }

      if (financeEditable && body.monthlyRent !== undefined) {
        const mr = Number(body.monthlyRent);
        if (!Number.isFinite(mr) || mr <= 0) return sendApiError(res, 400, "MONTHLY_RENT", "Monthly rent must be greater than 0.");
        updates.monthlyRent = roundedMoney2(mr);
      }

      const entSub = String(entRow.subType ?? "").trim();
      if (financeEditable && body.gstApplicable !== undefined && entSub === "AdHocOccupant") {
        updates.gstApplicable = Boolean(body.gstApplicable);
      }

      if (financeEditable && body.agreementType !== undefined) {
        const at = normalizeAgreementType(body.agreementType);
        if (at) updates.agreementType = at;
      }

      if (financeEditable && body.rentRevisionMode !== undefined) {
        const rr = normalizeRentRevisionMode(body.rentRevisionMode);
        if (!rr)
          return sendApiError(res, 400, "RENT_REVISION_MODE", "Rent Revision Mode must be StandardConsecutiveRenewal or PwdCertificate.");
        updates.rentRevisionMode = rr;
      }

      if (financeEditable && (updates.fromDate || updates.toDate) && body.agreementType === undefined) {
        const f = String((updates.fromDate ?? existing.fromDate) ?? "").trim();
        const td = String((updates.toDate ?? existing.toDate) ?? "").trim();
        if (!body.agreementType) updates.agreementType = inferAgreementTypeFromDates(f, td);
      }

      Object.keys(updates).forEach((k) => {
        if (updates[k as keyof EntityAllotmentRow] === undefined) delete updates[k as keyof EntityAllotmentRow];
      });
      if (Object.keys(updates).length === 0) return res.json(existing);

      await db.update(entityAllotments).set(updates).where(eq(entityAllotments.id, id));
      const [fresh] = await db.select().from(entityAllotments).where(eq(entityAllotments.id, id));
      writeAuditLog(req, { module: "Traders", action: "Update", recordId: id, beforeValue: existing, afterValue: fresh }).catch((e) =>
        console.error(e),
      );
      res.json(fresh);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to update entity allotment");
    }
  });

}
