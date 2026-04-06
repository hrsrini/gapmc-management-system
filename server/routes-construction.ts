/**
 * IOMS M-08: Construction & Maintenance API routes.
 * Tables: works, works_bills, amc_contracts, amc_bills, land_records, fixed_assets.
 * Yard-scoped: list/get/create/update for works, amc, land_records, fixed_assets.
 */
import type { Express } from "express";
import { eq, desc, and, inArray } from "drizzle-orm";
import { db } from "./db";
import { works, worksBills, amcContracts, amcBills, landRecords, fixedAssets } from "@shared/db-schema";
import { nanoid } from "nanoid";
import { writeAuditLog } from "./audit";
import { sendApiError } from "./api-errors";
import { assertRecordDoDvDaSeparation, hasRole } from "./workflow";
import type { AuthUser } from "./auth";
import { computeAmcRenewalAlerts } from "./operational-alerts";

function yardInScope(req: Express.Request, yardId: string): boolean {
  const scopedIds = (req as Express.Request & { scopedLocationIds?: string[] }).scopedLocationIds;
  return !scopedIds || scopedIds.length === 0 || scopedIds.includes(yardId);
}

export function registerConstructionRoutes(app: Express) {
  app.get("/api/ioms/works", async (req, res) => {
    try {
      const yardId = req.query.yardId as string | undefined;
      const scopedIds = (req as Express.Request & { scopedLocationIds?: string[] }).scopedLocationIds;
      const conditions = [];
      if (scopedIds && scopedIds.length > 0) conditions.push(inArray(works.yardId, scopedIds));
      if (yardId) conditions.push(eq(works.yardId, yardId));
      const base = db.select().from(works).orderBy(desc(works.startDate));
      const list = conditions.length > 0 ? await base.where(and(...conditions)) : await base;
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch works");
    }
  });

  app.get("/api/ioms/works/:id", async (req, res) => {
    try {
      const [row] = await db.select().from(works).where(eq(works.id, req.params.id)).limit(1);
      if (!row) return sendApiError(res, 404, "WORK_NOT_FOUND", "Work not found");
      if (!yardInScope(req, row.yardId)) return sendApiError(res, 404, "WORK_NOT_FOUND", "Work not found");
      res.json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch work");
    }
  });

  app.post("/api/ioms/works", async (req, res) => {
    try {
      const body = req.body;
      const yardId = String(body.yardId ?? "");
      if (!yardInScope(req, yardId))
        return sendApiError(res, 403, "WORK_YARD_ACCESS_DENIED", "You do not have access to this yard");
      const id = nanoid();
      await db.insert(works).values({
        id,
        yardId,
        workType: String(body.workType ?? ""),
        status: String(body.status ?? "Planned"),
        description: body.description ? String(body.description) : null,
        location: body.location ? String(body.location) : null,
        contractorName: body.contractorName ? String(body.contractorName) : null,
        contractorContact: body.contractorContact ? String(body.contractorContact) : null,
        estimateAmount: body.estimateAmount != null ? Number(body.estimateAmount) : null,
        tenderValue: body.tenderValue != null ? Number(body.tenderValue) : null,
        workOrderNo: body.workOrderNo ? String(body.workOrderNo) : null,
        workOrderDate: body.workOrderDate ? String(body.workOrderDate) : null,
        startDate: body.startDate ? String(body.startDate) : null,
        endDate: body.endDate ? String(body.endDate) : null,
        completionDate: body.completionDate ? String(body.completionDate) : null,
        doUser: body.doUser ? String(body.doUser) : null,
        dvUser: body.dvUser ? String(body.dvUser) : null,
        daUser: body.daUser ? String(body.daUser) : null,
        workNo: body.workNo ? String(body.workNo) : null,
      });
      const [row] = await db.select().from(works).where(eq(works.id, id));
      if (row) writeAuditLog(req, { module: "Construction", action: "Create", recordId: id, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create work");
    }
  });

  app.put("/api/ioms/works/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const [existing] = await db.select().from(works).where(eq(works.id, id));
      if (!existing) return sendApiError(res, 404, "WORK_NOT_FOUND", "Work not found");
      if (!yardInScope(req, existing.yardId)) return sendApiError(res, 404, "WORK_NOT_FOUND", "Work not found");
      const body = req.body;
      const newYardId = body.yardId !== undefined ? String(body.yardId) : existing.yardId;
      if (body.yardId !== undefined && !yardInScope(req, newYardId))
        return sendApiError(res, 403, "WORK_YARD_ACCESS_DENIED", "You do not have access to this yard");
      const updates: Record<string, unknown> = {};
      ["workNo", "yardId", "workType", "description", "location", "contractorName", "contractorContact", "estimateAmount", "tenderValue", "workOrderNo", "workOrderDate", "startDate", "endDate", "completionDate", "status", "doUser", "dvUser", "daUser"].forEach((k) => {
        if (body[k] === undefined) return;
        if (["estimateAmount", "tenderValue"].includes(k)) updates[k] = body[k] == null ? null : Number(body[k]);
        else updates[k] = body[k] == null ? null : String(body[k]);
      });
      const mergedRoles = {
        doUser: updates.doUser !== undefined ? (updates.doUser as string | null) : existing.doUser,
        dvUser: updates.dvUser !== undefined ? (updates.dvUser as string | null) : existing.dvUser,
        daUser: updates.daUser !== undefined ? (updates.daUser as string | null) : existing.daUser,
      };
      const seg = assertRecordDoDvDaSeparation(req.user, mergedRoles);
      if (!seg.ok) return sendApiError(res, 403, "WORK_DO_DV_DA_SEGREGATION", seg.error);
      await db.update(works).set(updates as Record<string, string | number | null>).where(eq(works.id, id));
      const [row] = await db.select().from(works).where(eq(works.id, id));
      if (!row) return sendApiError(res, 404, "WORK_NOT_FOUND", "Not found");
      writeAuditLog(req, { module: "Construction", action: "Update", recordId: id, beforeValue: existing, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to update work");
    }
  });

  app.get("/api/ioms/works/:workId/bills", async (req, res) => {
    try {
      const [work] = await db.select().from(works).where(eq(works.id, req.params.workId)).limit(1);
      if (!work) return sendApiError(res, 404, "WORK_NOT_FOUND", "Work not found");
      if (!yardInScope(req, work.yardId)) return sendApiError(res, 404, "WORK_NOT_FOUND", "Work not found");
      const list = await db.select().from(worksBills).where(eq(worksBills.workId, req.params.workId)).orderBy(desc(worksBills.billDate));
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch bills");
    }
  });

  app.post("/api/ioms/works/bills", async (req, res) => {
    try {
      const body = req.body;
      const workId = String(body.workId ?? "");
      const [work] = await db.select().from(works).where(eq(works.id, workId)).limit(1);
      if (!work) return sendApiError(res, 404, "WORK_NOT_FOUND", "Work not found");
      if (!yardInScope(req, work.yardId))
        return sendApiError(res, 403, "WORK_RECORD_YARD_ACCESS_DENIED", "You do not have access to this work's yard");
      const id = nanoid();
      await db.insert(worksBills).values({
        id,
        workId,
        billDate: String(body.billDate ?? ""),
        amount: Number(body.amount ?? 0),
        cumulativePaid: body.cumulativePaid != null ? Number(body.cumulativePaid) : 0,
        voucherId: body.voucherId ? String(body.voucherId) : null,
        status: String(body.status ?? "Pending"),
        approvedBy: body.approvedBy ? String(body.approvedBy) : null,
        billNo: body.billNo ? String(body.billNo) : null,
      });
      const [row] = await db.select().from(worksBills).where(eq(worksBills.id, id));
      if (row) writeAuditLog(req, { module: "Construction", action: "Create", recordId: id, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create bill");
    }
  });

  app.get("/api/ioms/amc/renewal-alerts", async (req, res) => {
    try {
      const yardId = req.query.yardId as string | undefined;
      const scopedIds = (req as Express.Request & { scopedLocationIds?: string[] }).scopedLocationIds;
      const conditions = [];
      if (scopedIds && scopedIds.length > 0) conditions.push(inArray(amcContracts.yardId, scopedIds));
      if (yardId) conditions.push(eq(amcContracts.yardId, yardId));
      const base = db.select().from(amcContracts);
      const list = conditions.length > 0 ? await base.where(and(...conditions)) : await base;
      res.json({ alerts: computeAmcRenewalAlerts(list) });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch AMC renewal alerts");
    }
  });

  app.get("/api/ioms/amc", async (req, res) => {
    try {
      const yardId = req.query.yardId as string | undefined;
      const scopedIds = (req as Express.Request & { scopedLocationIds?: string[] }).scopedLocationIds;
      const conditions = [];
      if (scopedIds && scopedIds.length > 0) conditions.push(inArray(amcContracts.yardId, scopedIds));
      if (yardId) conditions.push(eq(amcContracts.yardId, yardId));
      const base = db.select().from(amcContracts).orderBy(desc(amcContracts.contractEnd));
      const list = conditions.length > 0 ? await base.where(and(...conditions)) : await base;
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch AMC contracts");
    }
  });

  app.post("/api/ioms/amc", async (req, res) => {
    try {
      const body = req.body;
      const yardId = String(body.yardId ?? "");
      if (!yardInScope(req, yardId))
        return sendApiError(res, 403, "WORK_YARD_ACCESS_DENIED", "You do not have access to this yard");
      const id = nanoid();
      await db.insert(amcContracts).values({
        id,
        yardId,
        contractorName: String(body.contractorName ?? ""),
        amountPerPeriod: Number(body.amountPerPeriod ?? 0),
        contractStart: String(body.contractStart ?? ""),
        contractEnd: String(body.contractEnd ?? ""),
        status: String(body.status ?? "Active"),
        description: body.description ? String(body.description) : null,
        periodType: body.periodType ? String(body.periodType) : null,
        daUser: body.daUser ? String(body.daUser) : null,
      });
      const [row] = await db.select().from(amcContracts).where(eq(amcContracts.id, id));
      if (row) writeAuditLog(req, { module: "Construction", action: "Create", recordId: id, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create AMC");
    }
  });

  app.get("/api/ioms/land-records", async (req, res) => {
    try {
      const yardId = req.query.yardId as string | undefined;
      const scopedIds = (req as Express.Request & { scopedLocationIds?: string[] }).scopedLocationIds;
      const conditions = [];
      if (scopedIds && scopedIds.length > 0) conditions.push(inArray(landRecords.yardId, scopedIds));
      if (yardId) conditions.push(eq(landRecords.yardId, yardId));
      const base = db.select().from(landRecords).orderBy(landRecords.surveyNo);
      const list = conditions.length > 0 ? await base.where(and(...conditions)) : await base;
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch land records");
    }
  });

  app.post("/api/ioms/land-records", async (req, res) => {
    try {
      const body = req.body;
      const yardId = String(body.yardId ?? "");
      if (!yardInScope(req, yardId))
        return sendApiError(res, 403, "WORK_YARD_ACCESS_DENIED", "You do not have access to this yard");
      const id = nanoid();
      const now = new Date().toISOString();
      await db.insert(landRecords).values({
        id,
        yardId,
        surveyNo: String(body.surveyNo ?? ""),
        createdBy: String(body.createdBy ?? ""),
        createdAt: now,
        village: body.village ? String(body.village) : null,
        taluk: body.taluk ? String(body.taluk) : null,
        district: body.district ? String(body.district) : null,
        areaSqm: body.areaSqm != null ? Number(body.areaSqm) : null,
        saleDeedNo: body.saleDeedNo ? String(body.saleDeedNo) : null,
        saleDeedDate: body.saleDeedDate ? String(body.saleDeedDate) : null,
        encumbrance: body.encumbrance ? String(body.encumbrance) : null,
        remarks: body.remarks ? String(body.remarks) : null,
      });
      const [row] = await db.select().from(landRecords).where(eq(landRecords.id, id));
      if (row) writeAuditLog(req, { module: "Construction", action: "Create", recordId: id, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create land record");
    }
  });

  app.get("/api/ioms/fixed-assets", async (req, res) => {
    try {
      const yardId = req.query.yardId as string | undefined;
      const scopedIds = (req as Express.Request & { scopedLocationIds?: string[] }).scopedLocationIds;
      const conditions = [];
      if (scopedIds && scopedIds.length > 0) conditions.push(inArray(fixedAssets.yardId, scopedIds));
      if (yardId) conditions.push(eq(fixedAssets.yardId, yardId));
      const base = db.select().from(fixedAssets).orderBy(fixedAssets.assetType);
      const list = conditions.length > 0 ? await base.where(and(...conditions)) : await base;
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch fixed assets");
    }
  });

  app.post("/api/ioms/fixed-assets", async (req, res) => {
    try {
      const body = req.body;
      const yardId = String(body.yardId ?? "");
      if (!yardInScope(req, yardId))
        return sendApiError(res, 403, "WORK_YARD_ACCESS_DENIED", "You do not have access to this yard");
      const id = nanoid();
      await db.insert(fixedAssets).values({
        id,
        yardId,
        assetType: String(body.assetType ?? ""),
        acquisitionDate: String(body.acquisitionDate ?? ""),
        acquisitionValue: Number(body.acquisitionValue ?? 0),
        status: String(body.status ?? "Active"),
        description: body.description ? String(body.description) : null,
        usefulLifeYears: body.usefulLifeYears != null ? Number(body.usefulLifeYears) : null,
        depreciationMethod: body.depreciationMethod ? String(body.depreciationMethod) : null,
        currentBookValue: body.currentBookValue != null ? Number(body.currentBookValue) : null,
        disposalDate: body.disposalDate ? String(body.disposalDate) : null,
        disposalValue: body.disposalValue != null ? Number(body.disposalValue) : null,
        disposalApprovedBy: body.disposalApprovedBy ? String(body.disposalApprovedBy) : null,
        worksId: body.worksId ? String(body.worksId) : null,
      });
      const [row] = await db.select().from(fixedAssets).where(eq(fixedAssets.id, id));
      if (row) writeAuditLog(req, { module: "Construction", action: "Create", recordId: id, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create fixed asset");
    }
  });

  app.put("/api/ioms/fixed-assets/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const [existing] = await db.select().from(fixedAssets).where(eq(fixedAssets.id, id)).limit(1);
      if (!existing) return sendApiError(res, 404, "FIXED_ASSET_NOT_FOUND", "Not found");
      if (!yardInScope(req, existing.yardId)) return sendApiError(res, 404, "FIXED_ASSET_NOT_FOUND", "Not found");
      const user = (req as Express.Request & { user?: AuthUser }).user;
      const body = req.body;
      const touchesDisposal =
        body.disposalDate !== undefined ||
        body.disposalValue !== undefined ||
        body.disposalApprovedBy !== undefined;
      if (touchesDisposal && !hasRole(user, "DA") && !hasRole(user, "ADMIN")) {
        return sendApiError(
          res,
          403,
          "FIXED_ASSET_DISPOSAL_DA_ONLY",
          "Recording disposal requires Data Approver or Admin",
        );
      }
      const updates: Record<string, unknown> = {};
      [
        "yardId",
        "assetType",
        "acquisitionDate",
        "acquisitionValue",
        "status",
        "description",
        "usefulLifeYears",
        "depreciationMethod",
        "currentBookValue",
        "worksId",
      ].forEach((k) => {
        if (body[k] === undefined) return;
        if (["acquisitionValue", "usefulLifeYears", "currentBookValue", "disposalValue"].includes(k)) {
          updates[k] = body[k] == null ? null : Number(body[k]);
        } else updates[k] = body[k] == null ? null : String(body[k]);
      });
      if (body.disposalDate !== undefined) updates.disposalDate = body.disposalDate == null ? null : String(body.disposalDate);
      if (body.disposalValue !== undefined) updates.disposalValue = body.disposalValue == null ? null : Number(body.disposalValue);
      if (body.disposalApprovedBy !== undefined) {
        updates.disposalApprovedBy = body.disposalApprovedBy == null ? null : String(body.disposalApprovedBy);
      }
      if (updates.yardId && !yardInScope(req, String(updates.yardId))) {
        return sendApiError(res, 403, "WORK_YARD_ACCESS_DENIED", "You do not have access to this yard");
      }
      if (Object.keys(updates).length === 0) {
        const [row] = await db.select().from(fixedAssets).where(eq(fixedAssets.id, id)).limit(1);
        return res.json(row!);
      }
      await db.update(fixedAssets).set(updates as Record<string, string | number | null>).where(eq(fixedAssets.id, id));
      const [row] = await db.select().from(fixedAssets).where(eq(fixedAssets.id, id)).limit(1);
      if (!row) return sendApiError(res, 404, "FIXED_ASSET_NOT_FOUND", "Not found");
      writeAuditLog(req, { module: "Construction", action: "Update", recordId: id, beforeValue: existing, afterValue: row }).catch((e) =>
        console.error("Audit log failed:", e),
      );
      res.json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to update fixed asset");
    }
  });
}
