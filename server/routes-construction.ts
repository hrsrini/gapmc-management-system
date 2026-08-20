/**
 * IOMS M-08: Construction & Maintenance API routes.
 * Tables: works, works_bills, amc_contracts, amc_bills, land_records, fixed_assets.
 * Yard-scoped: list/get/create/update for works, amc, land_records, fixed_assets.
 */
import type { Express } from "express";
import { eq, desc, and, inArray, sql } from "drizzle-orm";
import { db } from "./db";
import { works, worksMilestones, worksFinalAccounts, amcContracts, amcBills, landRecords, fixedAssets } from "@shared/db-schema";
import { nanoid } from "nanoid";
import { writeAuditLog } from "./audit";
import { sendApiError } from "./api-errors";
import { hasRole } from "./workflow";
import type { AuthUser } from "./auth";
import { computeAmcRenewalAlerts } from "./operational-alerts";

function yardInScope(req: Express.Request, yardId: string): boolean {
  const scopedIds = (req as Express.Request & { scopedLocationIds?: string[] }).scopedLocationIds;
  return !scopedIds || scopedIds.length === 0 || scopedIds.includes(yardId);
}

/** Reject missing yard before scope check (empty string is "in scope" for unscoped admins). */
function requireYardId(req: Express.Request, yardId: string): string | null {
  const id = yardId.trim();
  if (!id) return "Yard is required";
  if (!yardInScope(req, id)) return "You do not have access to this yard";
  return null;
}

function isYmd(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

export function registerConstructionRoutes(app: Express) {
  const now = () => new Date().toISOString();

  // Works CRUD / bills / advances / SD-PBG / vendors: see registerWorksWoRoutes (routes-works-wo.ts)

  // --- US-M08-002: milestones / progress entries ---
  app.get("/api/ioms/works/:workId/milestones", async (req, res) => {
    try {
      const [work] = await db.select().from(works).where(eq(works.id, req.params.workId)).limit(1);
      if (!work) return sendApiError(res, 404, "WORK_NOT_FOUND", "Work not found");
      if (!yardInScope(req, work.yardId)) return sendApiError(res, 404, "WORK_NOT_FOUND", "Work not found");
      const list = await db
        .select()
        .from(worksMilestones)
        .where(eq(worksMilestones.workId, req.params.workId))
        .orderBy(desc(worksMilestones.percentComplete));
      return res.json(list);
    } catch (e) {
      console.error(e);
      return sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch milestones");
    }
  });

  app.post("/api/ioms/works/milestones", async (req, res) => {
    try {
      const body = req.body;
      const workId = String(body.workId ?? "");
      const [work] = await db.select().from(works).where(eq(works.id, workId)).limit(1);
      if (!work) return sendApiError(res, 404, "WORK_NOT_FOUND", "Work not found");
      if (!yardInScope(req, work.yardId))
        return sendApiError(res, 403, "WORK_RECORD_YARD_ACCESS_DENIED", "You do not have access to this work's yard");

      const pct = Number(body.percentComplete ?? 0);
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
        return sendApiError(res, 400, "E-AST-CON-002", "% completion must be between 0 and 100");
      }
      const prevMaxRow = await db
        .select({ m: sql<number>`COALESCE(MAX(${worksMilestones.percentComplete}), 0)` })
        .from(worksMilestones)
        .where(eq(worksMilestones.workId, workId));
      const prevMax = Number(prevMaxRow?.[0]?.m ?? 0);
      if (pct < prevMax) {
        return sendApiError(res, 400, "E-AST-CON-002", "Completion % cannot be less than previously approved/recorded progress");
      }
      const actualDate = body.actualDate ? String(body.actualDate).slice(0, 10) : null;
      if (actualDate && actualDate > new Date().toISOString().slice(0, 10)) {
        return sendApiError(res, 400, "MILESTONE_DATE_FUTURE", "Actual date cannot be in the future");
      }

      const id = nanoid();
      await db.insert(worksMilestones).values({
        id,
        workId,
        milestoneName: String(body.milestoneName ?? ""),
        expectedDate: body.expectedDate ? String(body.expectedDate).slice(0, 10) : null,
        actualDate,
        percentComplete: Math.trunc(pct),
        valueOfWorkInr: body.valueOfWorkInr != null ? Number(body.valueOfWorkInr) : 0,
        attachments: null,
        status: String(body.status ?? "Draft"),
        doUser: body.doUser ? String(body.doUser) : null,
        dvUser: body.dvUser ? String(body.dvUser) : null,
        daUser: body.daUser ? String(body.daUser) : null,
        createdAt: now(),
      });
      const [row] = await db.select().from(worksMilestones).where(eq(worksMilestones.id, id));
      if (row) writeAuditLog(req, { module: "Construction", action: "Create", recordId: id, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      return res.status(201).json(row);
    } catch (e) {
      console.error(e);
      return sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create milestone");
    }
  });

  // --- US-M08-002/004: final account ---
  app.get("/api/ioms/works/:workId/final-account", async (req, res) => {
    try {
      const [work] = await db.select().from(works).where(eq(works.id, req.params.workId)).limit(1);
      if (!work) return sendApiError(res, 404, "WORK_NOT_FOUND", "Work not found");
      if (!yardInScope(req, work.yardId)) return sendApiError(res, 404, "WORK_NOT_FOUND", "Work not found");
      const [fa] = await db.select().from(worksFinalAccounts).where(eq(worksFinalAccounts.workId, req.params.workId)).limit(1);
      return res.json(fa ?? null);
    } catch (e) {
      console.error(e);
      return sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch final account");
    }
  });

  app.post("/api/ioms/works/:workId/final-account", async (req, res) => {
    try {
      const workId = String(req.params.workId ?? "");
      const body = req.body;
      const [work] = await db.select().from(works).where(eq(works.id, workId)).limit(1);
      if (!work) return sendApiError(res, 404, "WORK_NOT_FOUND", "Work not found");
      if (!yardInScope(req, work.yardId))
        return sendApiError(res, 403, "WORK_RECORD_YARD_ACCESS_DENIED", "You do not have access to this work's yard");

      const pctRow = await db
        .select({ m: sql<number>`COALESCE(MAX(${worksMilestones.percentComplete}), 0)` })
        .from(worksMilestones)
        .where(eq(worksMilestones.workId, workId));
      const pct = Number(pctRow?.[0]?.m ?? 0);
      if (pct < 100) {
        return sendApiError(res, 400, "E-AST-CON-004", "Final Account can be submitted only after 100% completion");
      }

      const sanctioned = work.estimateAmount != null ? Number(work.estimateAmount) : null;
      const actual = Number(body.actualCostInr ?? 0);
      if (!Number.isFinite(actual) || actual <= 0) {
        return sendApiError(res, 400, "FINAL_ACCOUNT_COST_INVALID", "Actual cost must be a positive number");
      }
      if (sanctioned != null) {
        const limit = sanctioned * 1.1;
        const revisedBy = body.revisedEstimateApprovedBy ? String(body.revisedEstimateApprovedBy) : "";
        if (actual > limit && !revisedBy) {
          return sendApiError(
            res,
            400,
            "E-AST-CON-001",
            "Actual cost exceeds sanctioned amount by >10%. Provide revised estimate approval before submitting Final Account.",
          );
        }
      }

      const [existing] = await db.select().from(worksFinalAccounts).where(eq(worksFinalAccounts.workId, workId)).limit(1);
      if (existing) {
        return sendApiError(res, 409, "FINAL_ACCOUNT_EXISTS", "Final Account already exists for this work");
      }

      const id = nanoid();
      await db.insert(worksFinalAccounts).values({
        id,
        workId,
        actualCostInr: actual,
        sanctionedAmountInr: sanctioned,
        revisedEstimateApprovedBy: body.revisedEstimateApprovedBy ? String(body.revisedEstimateApprovedBy) : null,
        revisedEstimateRemarks: body.revisedEstimateRemarks ? String(body.revisedEstimateRemarks) : null,
        supportingDocs: null,
        status: String(body.status ?? "Submitted"),
        doUser: body.doUser ? String(body.doUser) : null,
        dvUser: body.dvUser ? String(body.dvUser) : null,
        daUser: body.daUser ? String(body.daUser) : null,
        createdAt: now(),
        approvedAt: null,
      });
      const [row] = await db.select().from(worksFinalAccounts).where(eq(worksFinalAccounts.id, id)).limit(1);
      if (row) writeAuditLog(req, { module: "Construction", action: "Create", recordId: id, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      return res.status(201).json(row);
    } catch (e) {
      console.error(e);
      return sendApiError(res, 500, "INTERNAL_ERROR", "Failed to submit final account");
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
      const yardId = String(body.yardId ?? "").trim();
      const yardErr = requireYardId(req, yardId);
      if (yardErr) {
        return sendApiError(
          res,
          yardErr.includes("access") ? 403 : 400,
          yardErr.includes("access") ? "WORK_YARD_ACCESS_DENIED" : "AMC_YARD_REQUIRED",
          yardErr,
        );
      }
      const contractorName = String(body.contractorName ?? "").trim();
      if (!contractorName) return sendApiError(res, 400, "AMC_CONTRACTOR_REQUIRED", "Contractor name is required");
      const amountPerPeriod = Number(body.amountPerPeriod);
      if (!Number.isFinite(amountPerPeriod) || amountPerPeriod <= 0) {
        return sendApiError(res, 400, "AMC_AMOUNT_INVALID", "Amount per period must be greater than zero");
      }
      const contractStart = String(body.contractStart ?? "").trim();
      const contractEnd = String(body.contractEnd ?? "").trim();
      if (!isYmd(contractStart) || !isYmd(contractEnd)) {
        return sendApiError(res, 400, "AMC_DATES_REQUIRED", "Contract start and end dates are required (YYYY-MM-DD)");
      }
      if (contractEnd < contractStart) {
        return sendApiError(res, 400, "AMC_DATE_RANGE", "Contract end must be on or after start date");
      }
      const id = nanoid();
      await db.insert(amcContracts).values({
        id,
        yardId,
        contractorName,
        amountPerPeriod,
        contractStart,
        contractEnd,
        status: String(body.status ?? "Active").trim() || "Active",
        description: body.description ? String(body.description).trim() || null : null,
        periodType: body.periodType ? String(body.periodType).trim() || null : null,
        daUser: body.daUser ? String(body.daUser).trim() || null : null,
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
      const yardId = String(body.yardId ?? "").trim();
      const yardErr = requireYardId(req, yardId);
      if (yardErr) {
        return sendApiError(
          res,
          yardErr.includes("access") ? 403 : 400,
          yardErr.includes("access") ? "WORK_YARD_ACCESS_DENIED" : "LAND_YARD_REQUIRED",
          yardErr,
        );
      }
      const surveyNo = String(body.surveyNo ?? "").trim();
      if (!surveyNo) return sendApiError(res, 400, "LAND_SURVEY_REQUIRED", "Survey number is required");
      const user = (req as Express.Request & { user?: AuthUser }).user;
      const createdBy = user?.id?.trim() || user?.name?.trim() || "";
      if (!createdBy) return sendApiError(res, 401, "AUTH_REQUIRED", "Sign in required to create land records");
      let areaSqm: number | null = null;
      if (body.areaSqm != null && body.areaSqm !== "") {
        areaSqm = Number(body.areaSqm);
        if (!Number.isFinite(areaSqm) || areaSqm < 0) {
          return sendApiError(res, 400, "LAND_AREA_INVALID", "Area must be a non-negative number");
        }
      }
      const saleDeedDate = body.saleDeedDate ? String(body.saleDeedDate).trim() : "";
      if (saleDeedDate && !isYmd(saleDeedDate)) {
        return sendApiError(res, 400, "LAND_DEED_DATE_INVALID", "Sale deed date must be YYYY-MM-DD");
      }
      const id = nanoid();
      const createdAt = new Date().toISOString();
      await db.insert(landRecords).values({
        id,
        yardId,
        surveyNo,
        createdBy,
        createdAt,
        village: body.village ? String(body.village).trim() || null : null,
        taluk: body.taluk ? String(body.taluk).trim() || null : null,
        district: body.district ? String(body.district).trim() || null : null,
        areaSqm,
        saleDeedNo: body.saleDeedNo ? String(body.saleDeedNo).trim() || null : null,
        saleDeedDate: saleDeedDate || null,
        encumbrance: body.encumbrance ? String(body.encumbrance).trim() || null : null,
        remarks: body.remarks ? String(body.remarks).trim() || null : null,
      });
      const [row] = await db.select().from(landRecords).where(eq(landRecords.id, id));
      if (row) writeAuditLog(req, { module: "Construction", action: "Create", recordId: id, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create land record");
    }
  });

  /**
   * Land register is append-only at the database (migration 002 triggers).
   * Updates are refused with a clear API error rather than a 500 from the trigger.
   */
  app.put("/api/ioms/land-records/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const user = (req as Express.Request & { user?: AuthUser }).user;
      if (!hasRole(user, "DA") && !hasRole(user, "ADMIN")) {
        return sendApiError(
          res,
          403,
          "LAND_RECORD_UPDATE_DA_ONLY",
          "Updating land records requires Data Approver or Admin",
        );
      }
      const [existing] = await db.select().from(landRecords).where(eq(landRecords.id, id)).limit(1);
      if (!existing) return sendApiError(res, 404, "LAND_RECORD_NOT_FOUND", "Not found");
      if (!yardInScope(req, existing.yardId)) return sendApiError(res, 404, "LAND_RECORD_NOT_FOUND", "Not found");
      return sendApiError(
        res,
        403,
        "LAND_RECORD_IMMUTABLE",
        "Land records are append-only and cannot be updated. Add a new record with corrections.",
      );
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to update land record");
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
      const yardId = String(body.yardId ?? "").trim();
      const yardErr = requireYardId(req, yardId);
      if (yardErr) {
        return sendApiError(
          res,
          yardErr.includes("access") ? 403 : 400,
          yardErr.includes("access") ? "WORK_YARD_ACCESS_DENIED" : "ASSET_YARD_REQUIRED",
          yardErr,
        );
      }
      const assetType = String(body.assetType ?? "").trim();
      if (!assetType) return sendApiError(res, 400, "ASSET_TYPE_REQUIRED", "Asset type is required");
      const acquisitionDate = String(body.acquisitionDate ?? "").trim();
      if (!isYmd(acquisitionDate)) {
        return sendApiError(res, 400, "ASSET_ACQ_DATE_REQUIRED", "Acquisition date is required (YYYY-MM-DD)");
      }
      const acquisitionValue = Number(body.acquisitionValue);
      if (!Number.isFinite(acquisitionValue) || acquisitionValue < 0) {
        return sendApiError(res, 400, "ASSET_ACQ_VALUE_INVALID", "Acquisition value must be a non-negative number");
      }
      let usefulLifeYears: number | null = null;
      if (body.usefulLifeYears != null && body.usefulLifeYears !== "") {
        usefulLifeYears = Number(body.usefulLifeYears);
        if (!Number.isFinite(usefulLifeYears) || usefulLifeYears <= 0) {
          return sendApiError(res, 400, "ASSET_LIFE_INVALID", "Useful life must be a positive number of years");
        }
      }
      let currentBookValue: number | null =
        body.currentBookValue != null && body.currentBookValue !== ""
          ? Number(body.currentBookValue)
          : acquisitionValue;
      if (currentBookValue != null && (!Number.isFinite(currentBookValue) || currentBookValue < 0)) {
        return sendApiError(res, 400, "ASSET_BOOK_VALUE_INVALID", "Book value must be a non-negative number");
      }
      const id = nanoid();
      await db.insert(fixedAssets).values({
        id,
        yardId,
        assetType,
        acquisitionDate,
        acquisitionValue,
        status: String(body.status ?? "Active").trim() || "Active",
        description: body.description ? String(body.description).trim() || null : null,
        usefulLifeYears,
        depreciationMethod: body.depreciationMethod ? String(body.depreciationMethod).trim() || null : null,
        currentBookValue,
        disposalDate: body.disposalDate ? String(body.disposalDate).trim() || null : null,
        disposalValue: body.disposalValue != null && body.disposalValue !== "" ? Number(body.disposalValue) : null,
        disposalApprovedBy: body.disposalApprovedBy ? String(body.disposalApprovedBy).trim() || null : null,
        worksId: body.worksId ? String(body.worksId).trim() || null : null,
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
