/**
 * M-08 Works Work-Order redevelopment routes:
 * vendors, WO workflow, GST bills, advance, SD/PBG, payment allocations.
 */
import type { Express } from "express";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./db";
import {
  vendors,
  works,
  worksBills,
  worksAdvances,
  worksAdvanceAdjustments,
  worksSdPbg,
  worksPaymentAllocations,
  paymentVouchers,
} from "@shared/db-schema";
import { writeAuditLog } from "./audit";
import { sendApiError } from "./api-errors";
import {
  assertRecordDoDvDaSeparation,
  canCreateWorksDocument,
  canEditDraftWorksDocument,
  canMarkWorkCompleted,
  canTransitionWorksDocument,
  hasRole,
} from "./workflow";
import {
  computeBillGst,
  isBillLocked,
  isWorkAmendable,
  isWorkApprovedForChildDocs,
  maxMobilizationAdvance,
  woAmountBaseExclGst,
} from "./works-wo-rules";

function yardInScope(req: Express.Request, yardId: string): boolean {
  const scopedIds = (req as Express.Request & { scopedLocationIds?: string[] }).scopedLocationIds;
  return !scopedIds || scopedIds.length === 0 || scopedIds.includes(yardId);
}

function isYmd(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

async function loadWorkScoped(req: Express.Request, workId: string) {
  const [work] = await db.select().from(works).where(eq(works.id, workId)).limit(1);
  if (!work) return { error: "not_found" as const };
  if (!yardInScope(req, work.yardId)) return { error: "not_found" as const };
  return { work };
}

export function registerWorksWoRoutes(app: Express) {
  const now = () => new Date().toISOString();

  // ----- Vendors -----
  app.get("/api/ioms/vendors", async (_req, res) => {
    try {
      const list = await db.select().from(vendors).orderBy(vendors.name);
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch vendors");
    }
  });

  app.post("/api/ioms/vendors", async (req, res) => {
    try {
      if (!canCreateWorksDocument(req.user)) {
        return sendApiError(res, 403, "VENDOR_CREATE_DENIED", "Only DO/Admin can create vendors");
      }
      const body = req.body ?? {};
      const name = String(body.name ?? "").trim();
      if (!name) return sendApiError(res, 400, "VENDOR_NAME_REQUIRED", "Vendor name is required");
      const id = nanoid();
      const ts = now();
      await db.insert(vendors).values({
        id,
        name,
        code: body.code ? String(body.code).trim() : null,
        gstin: body.gstin ? String(body.gstin).trim() : null,
        pan: body.pan ? String(body.pan).trim() : null,
        contactName: body.contactName ? String(body.contactName).trim() : null,
        phone: body.phone ? String(body.phone).trim() : null,
        email: body.email ? String(body.email).trim() : null,
        address: body.address ? String(body.address).trim() : null,
        status: String(body.status ?? "Active"),
        createdAt: ts,
        updatedAt: ts,
      });
      const [row] = await db.select().from(vendors).where(eq(vendors.id, id));
      if (row) writeAuditLog(req, { module: "Construction", action: "VendorCreate", recordId: id, afterValue: row }).catch(console.error);
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create vendor");
    }
  });

  app.put("/api/ioms/vendors/:id", async (req, res) => {
    try {
      if (!canEditDraftWorksDocument(req.user)) {
        return sendApiError(res, 403, "VENDOR_UPDATE_DENIED", "Only DO/Admin can update vendors");
      }
      const id = req.params.id;
      const [existing] = await db.select().from(vendors).where(eq(vendors.id, id)).limit(1);
      if (!existing) return sendApiError(res, 404, "VENDOR_NOT_FOUND", "Vendor not found");
      const body = req.body ?? {};
      const updates: Record<string, unknown> = { updatedAt: now() };
      for (const k of ["name", "code", "gstin", "pan", "contactName", "phone", "email", "address", "status"] as const) {
        if (body[k] !== undefined) updates[k] = body[k] == null || body[k] === "" ? null : String(body[k]).trim();
      }
      if (updates.name != null && !String(updates.name).trim()) {
        return sendApiError(res, 400, "VENDOR_NAME_REQUIRED", "Vendor name is required");
      }
      await db.update(vendors).set(updates as typeof vendors.$inferInsert).where(eq(vendors.id, id));
      const [row] = await db.select().from(vendors).where(eq(vendors.id, id));
      writeAuditLog(req, { module: "Construction", action: "VendorUpdate", recordId: id, beforeValue: existing, afterValue: row }).catch(console.error);
      res.json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to update vendor");
    }
  });

  /** Works TDS report — must be registered before /api/ioms/works/:id */
  app.get("/api/ioms/works/reports/tds", async (req, res) => {
    try {
      const from = typeof req.query.from === "string" ? req.query.from : "";
      const to = typeof req.query.to === "string" ? req.query.to : "";
      const workId = typeof req.query.workId === "string" ? req.query.workId.trim() : "";
      const scopedIds = (req as Express.Request & { scopedLocationIds?: string[] }).scopedLocationIds;

      const conditions = [
        eq(paymentVouchers.sourceModule, "M-08"),
        eq(paymentVouchers.tdsApplicable, true),
      ];
      if (scopedIds && scopedIds.length > 0) conditions.push(inArray(paymentVouchers.yardId, scopedIds));
      if (workId) conditions.push(eq(paymentVouchers.sourceRecordId, workId));
      if (from && isYmd(from)) {
        conditions.push(sql`coalesce(${paymentVouchers.paidAt}, ${paymentVouchers.createdAt}) >= ${from}`);
      }
      if (to && isYmd(to)) {
        conditions.push(sql`coalesce(${paymentVouchers.paidAt}, ${paymentVouchers.createdAt}) <= ${to + "T23:59:59.999Z"}`);
      }

      const rows = await db
        .select()
        .from(paymentVouchers)
        .where(and(...conditions))
        .orderBy(desc(paymentVouchers.createdAt));

      const workIds = Array.from(new Set(rows.map((r) => r.sourceRecordId).filter(Boolean) as string[]));
      const workRows = workIds.length
        ? await db.select().from(works).where(inArray(works.id, workIds))
        : [];
      const workById = Object.fromEntries(workRows.map((w) => [w.id, w]));

      res.json(
        rows.map((r) => {
          const w = r.sourceRecordId ? workById[r.sourceRecordId] : null;
          return {
            voucherId: r.id,
            voucherNo: r.voucherNo,
            status: r.status,
            payeeName: r.payeeName,
            grossAmount: r.amount,
            tdsSection: r.tdsSection,
            tdsRatePercent: r.tdsRatePercent,
            tdsApplicableAmount: r.tdsApplicableAmount,
            tdsAmount: r.tdsAmount ?? 0,
            netPayable: r.netPayable ?? Number(r.amount) - Number(r.tdsAmount ?? 0),
            paymentMode: r.paymentMode,
            paidAt: r.paidAt,
            createdAt: r.createdAt,
            workId: r.sourceRecordId,
            workOrderNo: w?.workOrderNo ?? w?.workNo ?? null,
            yardId: r.yardId,
          };
        }),
      );
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch Works TDS report");
    }
  });

  // ----- Works list / get (with optional WO date filter) -----
  app.get("/api/ioms/works", async (req, res) => {
    try {
      const yardId = req.query.yardId as string | undefined;
      const woFrom = req.query.woDateFrom as string | undefined;
      const woTo = req.query.woDateTo as string | undefined;
      const scopedIds = (req as Express.Request & { scopedLocationIds?: string[] }).scopedLocationIds;
      const conditions = [];
      if (scopedIds && scopedIds.length > 0) conditions.push(inArray(works.yardId, scopedIds));
      if (yardId) conditions.push(eq(works.yardId, yardId));
      if (woFrom && isYmd(woFrom)) conditions.push(sql`${works.workOrderDate} >= ${woFrom}`);
      if (woTo && isYmd(woTo)) conditions.push(sql`${works.workOrderDate} <= ${woTo}`);
      const base = db.select().from(works).orderBy(desc(works.workOrderDate), desc(works.startDate));
      const list = conditions.length > 0 ? await base.where(and(...conditions)) : await base;
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch works");
    }
  });

  app.get("/api/ioms/works/:id", async (req, res) => {
    try {
      const loaded = await loadWorkScoped(req, req.params.id);
      if ("error" in loaded) return sendApiError(res, 404, "WORK_NOT_FOUND", "Work not found");
      res.json(loaded.work);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch work");
    }
  });

  app.post("/api/ioms/works", async (req, res) => {
    try {
      if (!canCreateWorksDocument(req.user)) {
        return sendApiError(res, 403, "WORK_CREATE_DENIED", "Only DO/Admin can create work orders");
      }
      const body = req.body ?? {};
      const yardId = String(body.yardId ?? "").trim();
      if (!yardId) return sendApiError(res, 400, "WORK_YARD_REQUIRED", "Yard is required");
      if (!yardInScope(req, yardId)) {
        return sendApiError(res, 403, "WORK_YARD_ACCESS_DENIED", "You do not have access to this yard");
      }
      const workOrderNo = String(body.workOrderNo ?? "").trim();
      if (!workOrderNo) return sendApiError(res, 400, "WORK_ORDER_NO_REQUIRED", "Work Order No. is required (user-entered)");
      const workOrderDate = String(body.workOrderDate ?? "").trim();
      if (!workOrderDate || !isYmd(workOrderDate)) {
        return sendApiError(res, 400, "WORK_ORDER_DATE_REQUIRED", "Work Order date is required (YYYY-MM-DD)");
      }
      const vendorId = String(body.vendorId ?? "").trim();
      if (!vendorId) return sendApiError(res, 400, "WORK_VENDOR_REQUIRED", "Vendor selection is mandatory");
      const [vendor] = await db.select().from(vendors).where(eq(vendors.id, vendorId)).limit(1);
      if (!vendor || vendor.status !== "Active") {
        return sendApiError(res, 400, "WORK_VENDOR_INVALID", "Active vendor is required");
      }
      const workType = String(body.workType ?? "").trim();
      if (!workType) return sendApiError(res, 400, "WORK_TYPE_REQUIRED", "Work type is required");

      const id = nanoid();
      const ts = now();
      await db.insert(works).values({
        id,
        yardId,
        workType,
        status: "Draft",
        workOrderNo,
        workOrderDate,
        vendorId,
        contractorName: vendor.name,
        contractorContact: vendor.phone ?? vendor.contactName ?? null,
        description: body.description ? String(body.description) : null,
        location: body.location ? String(body.location) : null,
        estimateAmount: body.estimateAmount != null ? Number(body.estimateAmount) : null,
        tenderValue: body.tenderValue != null ? Number(body.tenderValue) : null,
        woAmountExclGst: body.woAmountExclGst != null ? Number(body.woAmountExclGst) : null,
        startDate: body.startDate ? String(body.startDate) : null,
        endDate: body.endDate ? String(body.endDate) : null,
        scopeText: body.scopeText ? String(body.scopeText) : null,
        termsConditions: body.termsConditions ? String(body.termsConditions) : null,
        dlpMonths: body.dlpMonths != null && body.dlpMonths !== "" ? Number(body.dlpMonths) : null,
        penaltyText: body.penaltyText ? String(body.penaltyText) : null,
        retentionPercent: body.retentionPercent != null && body.retentionPercent !== "" ? Number(body.retentionPercent) : null,
        remarks: body.remarks ? String(body.remarks) : null,
        workNo: body.workNo ? String(body.workNo) : workOrderNo,
        doUser: req.user?.id ?? null,
        updatedAt: ts,
      });
      const [row] = await db.select().from(works).where(eq(works.id, id));
      if (row) writeAuditLog(req, { module: "Construction", action: "Create", recordId: id, afterValue: row }).catch(console.error);
      res.status(201).json(row);
    } catch (e: unknown) {
      console.error(e);
      const msg = e instanceof Error ? e.message : "";
      if (msg.includes("works_work_order_no_uidx") || msg.includes("unique")) {
        return sendApiError(res, 400, "WORK_ORDER_NO_DUPLICATE", "Work Order No. already exists");
      }
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create work");
    }
  });

  app.put("/api/ioms/works/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const loaded = await loadWorkScoped(req, id);
      if ("error" in loaded) return sendApiError(res, 404, "WORK_NOT_FOUND", "Work not found");
      const existing = loaded.work;
      const body = req.body ?? {};

      // Status transition (DO→DV→DA or Mark completed)
      if (body.status != null && String(body.status) !== existing.status) {
        const newStatus = String(body.status);
        if (newStatus === "Completed") {
          if (!canMarkWorkCompleted(req.user)) {
            return sendApiError(res, 403, "WORK_COMPLETE_DENIED", "Only DA/Admin can mark work completed");
          }
          if (existing.status !== "Approved") {
            return sendApiError(res, 400, "WORK_NOT_APPROVED", "Only Approved work orders can be marked completed");
          }
          await db
            .update(works)
            .set({
              status: "Completed",
              completionDate: body.completionDate ? String(body.completionDate) : now().slice(0, 10),
              daUser: req.user?.id ?? existing.daUser,
              updatedAt: now(),
            })
            .where(eq(works.id, id));
          const [row] = await db.select().from(works).where(eq(works.id, id));
          writeAuditLog(req, { module: "Construction", action: "MarkCompleted", recordId: id, beforeValue: existing, afterValue: row }).catch(console.error);
          return res.json(row);
        }

        const tr = canTransitionWorksDocument(req.user, existing.status, newStatus);
        if (!tr.allowed) {
          return sendApiError(res, 403, "WORK_STATUS_DENIED", `Cannot transition ${existing.status} → ${newStatus}`);
        }
        const updates: Record<string, unknown> = { status: newStatus, updatedAt: now() };
        if (tr.setDvUser) updates.dvUser = req.user?.id ?? null;
        if (tr.setDaUser) updates.daUser = req.user?.id ?? null;
        const mergedRoles = {
          doUser: existing.doUser,
          dvUser: (updates.dvUser as string | null | undefined) ?? existing.dvUser,
          daUser: (updates.daUser as string | null | undefined) ?? existing.daUser,
        };
        const seg = assertRecordDoDvDaSeparation(req.user, mergedRoles);
        if (!seg.ok) return sendApiError(res, 403, "WORK_DO_DV_DA_SEGREGATION", seg.error);
        await db.update(works).set(updates as Record<string, string | null>).where(eq(works.id, id));
        const [row] = await db.select().from(works).where(eq(works.id, id));
        writeAuditLog(req, { module: "Construction", action: "Status", recordId: id, beforeValue: existing, afterValue: row }).catch(console.error);
        return res.json(row);
      }

      if (!isWorkAmendable(existing.status)) {
        return sendApiError(res, 400, "WORK_LOCKED", "Work Order cannot be amended after Approved (v1)");
      }
      if (!canEditDraftWorksDocument(req.user) && existing.status === "Draft") {
        return sendApiError(res, 403, "WORK_EDIT_DENIED", "Only DO/Admin can edit draft work orders");
      }

      const updates: Record<string, unknown> = { updatedAt: now() };
      const strKeys = [
        "workNo",
        "yardId",
        "workType",
        "description",
        "location",
        "workOrderNo",
        "workOrderDate",
        "startDate",
        "endDate",
        "scopeText",
        "termsConditions",
        "penaltyText",
        "remarks",
        "vendorId",
      ] as const;
      for (const k of strKeys) {
        if (body[k] !== undefined) updates[k] = body[k] == null || body[k] === "" ? null : String(body[k]);
      }
      for (const k of ["estimateAmount", "tenderValue", "woAmountExclGst", "retentionPercent"] as const) {
        if (body[k] !== undefined) updates[k] = body[k] == null || body[k] === "" ? null : Number(body[k]);
      }
      if (body.dlpMonths !== undefined) {
        updates.dlpMonths = body.dlpMonths == null || body.dlpMonths === "" ? null : Number(body.dlpMonths);
      }
      if (updates.vendorId) {
        const [vendor] = await db.select().from(vendors).where(eq(vendors.id, String(updates.vendorId))).limit(1);
        if (!vendor || vendor.status !== "Active") {
          return sendApiError(res, 400, "WORK_VENDOR_INVALID", "Active vendor is required");
        }
        updates.contractorName = vendor.name;
        updates.contractorContact = vendor.phone ?? vendor.contactName ?? null;
      }
      if (updates.yardId && !yardInScope(req, String(updates.yardId))) {
        return sendApiError(res, 403, "WORK_YARD_ACCESS_DENIED", "You do not have access to this yard");
      }
      if (updates.workOrderNo != null && !String(updates.workOrderNo).trim()) {
        return sendApiError(res, 400, "WORK_ORDER_NO_REQUIRED", "Work Order No. is required");
      }

      await db.update(works).set(updates as Record<string, string | number | null>).where(eq(works.id, id));
      const [row] = await db.select().from(works).where(eq(works.id, id));
      writeAuditLog(req, { module: "Construction", action: "Update", recordId: id, beforeValue: existing, afterValue: row }).catch(console.error);
      res.json(row);
    } catch (e: unknown) {
      console.error(e);
      const msg = e instanceof Error ? e.message : "";
      if (msg.includes("unique")) {
        return sendApiError(res, 400, "WORK_ORDER_NO_DUPLICATE", "Work Order No. already exists");
      }
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to update work");
    }
  });

  // ----- Bills -----
  app.get("/api/ioms/works/:workId/bills", async (req, res) => {
    try {
      const loaded = await loadWorkScoped(req, req.params.workId);
      if ("error" in loaded) return sendApiError(res, 404, "WORK_NOT_FOUND", "Work not found");
      const list = await db
        .select()
        .from(worksBills)
        .where(eq(worksBills.workId, req.params.workId))
        .orderBy(desc(worksBills.billDate));
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch bills");
    }
  });

  app.post("/api/ioms/works/bills", async (req, res) => {
    try {
      if (!canCreateWorksDocument(req.user)) {
        return sendApiError(res, 403, "BILL_CREATE_DENIED", "Only DO/Admin can create bills");
      }
      const body = req.body ?? {};
      const workId = String(body.workId ?? "");
      const loaded = await loadWorkScoped(req, workId);
      if ("error" in loaded) return sendApiError(res, 404, "WORK_NOT_FOUND", "Work not found");
      const work = loaded.work;
      if (!isWorkApprovedForChildDocs(work.status)) {
        return sendApiError(res, 400, "WORK_NOT_APPROVED", "Bills can only be created after Work Order is Approved");
      }
      const billDate = String(body.billDate ?? "");
      if (!isYmd(billDate)) return sendApiError(res, 400, "BILL_DATE_REQUIRED", "Bill date is required (YYYY-MM-DD)");
      const taxableAmount = Number(body.taxableAmount ?? body.amount ?? 0);
      const gstPercent = Number(body.gstPercent ?? 0);
      if (!(taxableAmount > 0)) return sendApiError(res, 400, "BILL_AMOUNT_INVALID", "Taxable amount must be greater than zero");
      const { gstAmount, total } = computeBillGst({ taxableAmount, gstPercent });

      // Over-billing check: approved bills + this bill + approved advance vs WO value
      const [adv] = await db.select().from(worksAdvances).where(eq(worksAdvances.workId, workId)).limit(1);
      const approvedBills = await db.select().from(worksBills).where(eq(worksBills.workId, workId));
      const billed = approvedBills
        .filter((b) => ["Approved", "Locked"].includes(b.status))
        .reduce((s, b) => s + Number(b.amount ?? 0), 0);
      const advanceAmt = adv && adv.status === "Approved" ? Number(adv.amount) : 0;
      const woBase = woAmountBaseExclGst(work);
      const projected = billed + total + advanceAmt;
      const over = woBase > 0 && projected > woBase + 1e-6;
      if (over && !(body.overbillingOverrideRemark && String(body.overbillingOverrideRemark).trim()) && !hasRole(req.user, "ADMIN") && !hasRole(req.user, "DA")) {
        return sendApiError(
          res,
          400,
          "BILL_OVER_WO_VALUE",
          "Bills + advance exceed WO value. DA override remark required.",
          { projected, woBase },
        );
      }
      if (over && !String(body.overbillingOverrideRemark ?? "").trim()) {
        // DA/Admin creating without remark still require remark per A5
        return sendApiError(res, 400, "BILL_OVER_REMARK_REQUIRED", "Over-billing requires DA override remark");
      }

      const id = nanoid();
      const ts = now();
      await db.insert(worksBills).values({
        id,
        workId,
        billNo: body.billNo ? String(body.billNo) : null,
        billDate,
        taxableAmount,
        gstPercent,
        gstAmount,
        amount: total,
        cumulativePaid: 0,
        status: "Draft",
        doUser: req.user?.id ?? null,
        overbillingOverrideRemark: over ? String(body.overbillingOverrideRemark).trim() : null,
        remarks: body.remarks ? String(body.remarks) : null,
        createdAt: ts,
        updatedAt: ts,
      });
      const [row] = await db.select().from(worksBills).where(eq(worksBills.id, id));
      if (row) writeAuditLog(req, { module: "Construction", action: "BillCreate", recordId: id, afterValue: row }).catch(console.error);
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create bill");
    }
  });

  app.put("/api/ioms/works/bills/:id/status", async (req, res) => {
    try {
      const id = req.params.id;
      const [existing] = await db.select().from(worksBills).where(eq(worksBills.id, id)).limit(1);
      if (!existing) return sendApiError(res, 404, "BILL_NOT_FOUND", "Bill not found");
      const loaded = await loadWorkScoped(req, existing.workId);
      if ("error" in loaded) return sendApiError(res, 404, "WORK_NOT_FOUND", "Work not found");
      if (isBillLocked(existing.status, existing.lockedAt)) {
        return sendApiError(res, 400, "BILL_LOCKED", "Bill is locked after Approved M-06 payment");
      }
      const newStatus = String(req.body?.status ?? "");
      const tr = canTransitionWorksDocument(req.user, existing.status, newStatus);
      if (!tr.allowed) {
        return sendApiError(res, 403, "BILL_STATUS_DENIED", `Cannot transition ${existing.status} → ${newStatus}`);
      }
      const updates: Record<string, unknown> = { status: newStatus, updatedAt: now() };
      if (tr.setDvUser) updates.dvUser = req.user?.id ?? null;
      if (tr.setDaUser) {
        updates.daUser = req.user?.id ?? null;
        updates.approvedBy = req.user?.id ?? null;
      }
      const seg = assertRecordDoDvDaSeparation(req.user, {
        doUser: existing.doUser,
        dvUser: (updates.dvUser as string | null | undefined) ?? existing.dvUser,
        daUser: (updates.daUser as string | null | undefined) ?? existing.daUser,
      });
      if (!seg.ok) return sendApiError(res, 403, "BILL_DO_DV_DA_SEGREGATION", seg.error);
      await db.update(worksBills).set(updates as Record<string, string | null>).where(eq(worksBills.id, id));
      const [row] = await db.select().from(worksBills).where(eq(worksBills.id, id));
      writeAuditLog(req, { module: "Construction", action: "BillStatus", recordId: id, beforeValue: existing, afterValue: row }).catch(console.error);
      res.json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to update bill status");
    }
  });

  // ----- Mobilization advance -----
  app.get("/api/ioms/works/:workId/advance", async (req, res) => {
    try {
      const loaded = await loadWorkScoped(req, req.params.workId);
      if ("error" in loaded) return sendApiError(res, 404, "WORK_NOT_FOUND", "Work not found");
      const [row] = await db.select().from(worksAdvances).where(eq(worksAdvances.workId, req.params.workId)).limit(1);
      const adjustments = row
        ? await db.select().from(worksAdvanceAdjustments).where(eq(worksAdvanceAdjustments.advanceId, row.id))
        : [];
      const adjusted = adjustments.reduce((s, a) => s + Number(a.amount ?? 0), 0);
      res.json({
        advance: row ?? null,
        adjustedTotal: adjusted,
        remaining: row && row.status === "Approved" ? Math.max(0, Number(row.amount) - adjusted) : 0,
        maxAllowed: maxMobilizationAdvance(loaded.work),
      });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch advance");
    }
  });

  app.post("/api/ioms/works/:workId/advance", async (req, res) => {
    try {
      if (!canCreateWorksDocument(req.user)) {
        return sendApiError(res, 403, "ADVANCE_CREATE_DENIED", "Only DO/Admin can create advances");
      }
      const loaded = await loadWorkScoped(req, req.params.workId);
      if ("error" in loaded) return sendApiError(res, 404, "WORK_NOT_FOUND", "Work not found");
      const work = loaded.work;
      if (!isWorkApprovedForChildDocs(work.status)) {
        return sendApiError(res, 400, "WORK_NOT_APPROVED", "Advance requires Approved Work Order");
      }
      const [existing] = await db.select().from(worksAdvances).where(eq(worksAdvances.workId, work.id)).limit(1);
      if (existing) return sendApiError(res, 400, "ADVANCE_EXISTS", "Only one advance record per Work Order");
      const amount = Number(req.body?.amount ?? 0);
      const cap = maxMobilizationAdvance(work);
      if (!(amount > 0)) return sendApiError(res, 400, "ADVANCE_AMOUNT_INVALID", "Advance amount must be greater than zero");
      if (cap > 0 && amount > cap + 1e-6) {
        return sendApiError(res, 400, "ADVANCE_CAP_EXCEEDED", `Advance cannot exceed 10% of WO amount excl. GST (max ${cap})`, { cap });
      }
      const id = nanoid();
      const ts = now();
      await db.insert(worksAdvances).values({
        id,
        workId: work.id,
        amount,
        status: "Draft",
        remarks: req.body?.remarks ? String(req.body.remarks) : null,
        doUser: req.user?.id ?? null,
        createdAt: ts,
        updatedAt: ts,
      });
      const [row] = await db.select().from(worksAdvances).where(eq(worksAdvances.id, id));
      writeAuditLog(req, { module: "Construction", action: "AdvanceCreate", recordId: id, afterValue: row }).catch(console.error);
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create advance");
    }
  });

  app.put("/api/ioms/works/advances/:id/status", async (req, res) => {
    try {
      const id = req.params.id;
      const [existing] = await db.select().from(worksAdvances).where(eq(worksAdvances.id, id)).limit(1);
      if (!existing) return sendApiError(res, 404, "ADVANCE_NOT_FOUND", "Advance not found");
      const loaded = await loadWorkScoped(req, existing.workId);
      if ("error" in loaded) return sendApiError(res, 404, "WORK_NOT_FOUND", "Work not found");
      const newStatus = String(req.body?.status ?? "");
      const tr = canTransitionWorksDocument(req.user, existing.status, newStatus);
      if (!tr.allowed) {
        return sendApiError(res, 403, "ADVANCE_STATUS_DENIED", `Cannot transition ${existing.status} → ${newStatus}`);
      }
      const updates: Record<string, unknown> = { status: newStatus, updatedAt: now() };
      if (tr.setDvUser) updates.dvUser = req.user?.id ?? null;
      if (tr.setDaUser) updates.daUser = req.user?.id ?? null;
      const seg = assertRecordDoDvDaSeparation(req.user, {
        doUser: existing.doUser,
        dvUser: (updates.dvUser as string | null | undefined) ?? existing.dvUser,
        daUser: (updates.daUser as string | null | undefined) ?? existing.daUser,
      });
      if (!seg.ok) return sendApiError(res, 403, "ADVANCE_DO_DV_DA_SEGREGATION", seg.error);
      await db.update(worksAdvances).set(updates as Record<string, string | null>).where(eq(worksAdvances.id, id));
      const [row] = await db.select().from(worksAdvances).where(eq(worksAdvances.id, id));
      writeAuditLog(req, { module: "Construction", action: "AdvanceStatus", recordId: id, beforeValue: existing, afterValue: row }).catch(console.error);
      res.json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to update advance status");
    }
  });

  // ----- SD / PBG -----
  app.get("/api/ioms/works/:workId/sd-pbg", async (req, res) => {
    try {
      const loaded = await loadWorkScoped(req, req.params.workId);
      if ("error" in loaded) return sendApiError(res, 404, "WORK_NOT_FOUND", "Work not found");
      const list = await db.select().from(worksSdPbg).where(eq(worksSdPbg.workId, req.params.workId)).orderBy(desc(worksSdPbg.createdAt));
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch SD/PBG");
    }
  });

  app.post("/api/ioms/works/:workId/sd-pbg", async (req, res) => {
    try {
      if (!canCreateWorksDocument(req.user)) {
        return sendApiError(res, 403, "SD_CREATE_DENIED", "Only DO/Admin can create SD/PBG records");
      }
      const loaded = await loadWorkScoped(req, req.params.workId);
      if ("error" in loaded) return sendApiError(res, 404, "WORK_NOT_FOUND", "Work not found");
      if (!isWorkApprovedForChildDocs(loaded.work.status)) {
        return sendApiError(res, 400, "WORK_NOT_APPROVED", "SD/PBG requires Approved Work Order");
      }
      const body = req.body ?? {};
      const instrumentType = String(body.instrumentType ?? "").toUpperCase();
      if (!["SD", "PBG"].includes(instrumentType)) {
        return sendApiError(res, 400, "SD_TYPE_INVALID", "instrumentType must be SD or PBG");
      }
      const mode = String(body.mode ?? "");
      if (!["Cash", "DD", "BG", "Other"].includes(mode)) {
        return sendApiError(res, 400, "SD_MODE_INVALID", "mode must be Cash, DD, BG, or Other");
      }
      const amount = Number(body.amount ?? 0);
      if (!(amount > 0)) return sendApiError(res, 400, "SD_AMOUNT_INVALID", "Amount must be greater than zero");
      const id = nanoid();
      const ts = now();
      await db.insert(worksSdPbg).values({
        id,
        workId: loaded.work.id,
        instrumentType,
        amount,
        mode,
        instrumentNo: body.instrumentNo ? String(body.instrumentNo) : null,
        bankName: body.bankName ? String(body.bankName) : null,
        validFrom: body.validFrom ? String(body.validFrom) : null,
        validTo: body.validTo ? String(body.validTo) : null,
        otherDetails: body.otherDetails ? String(body.otherDetails) : null,
        status: "Active",
        doUser: req.user?.id ?? null,
        voucherId: body.voucherId ? String(body.voucherId).trim() : null,
        createdAt: ts,
        updatedAt: ts,
      });
      const [row] = await db.select().from(worksSdPbg).where(eq(worksSdPbg.id, id));
      writeAuditLog(req, { module: "Construction", action: "SdPbgCreate", recordId: id, afterValue: row }).catch(console.error);
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create SD/PBG");
    }
  });

  app.post("/api/ioms/works/sd-pbg/:id/request-release", async (req, res) => {
    try {
      if (!canCreateWorksDocument(req.user)) {
        return sendApiError(res, 403, "SD_RELEASE_DENIED", "Only DO/Admin can request SD/PBG release");
      }
      const id = req.params.id;
      const [existing] = await db.select().from(worksSdPbg).where(eq(worksSdPbg.id, id)).limit(1);
      if (!existing) return sendApiError(res, 404, "SD_NOT_FOUND", "SD/PBG not found");
      const loaded = await loadWorkScoped(req, existing.workId);
      if ("error" in loaded) return sendApiError(res, 404, "WORK_NOT_FOUND", "Work not found");
      if (existing.status !== "Active") {
        return sendApiError(res, 400, "SD_NOT_ACTIVE", "Only Active SD/PBG can request release");
      }
      await db
        .update(worksSdPbg)
        .set({
          status: "ReleaseRequested",
          releaseStatus: "Draft",
          releaseRemarks: req.body?.remarks ? String(req.body.remarks) : null,
          doUser: req.user?.id ?? existing.doUser,
          updatedAt: now(),
        })
        .where(eq(worksSdPbg.id, id));
      const [row] = await db.select().from(worksSdPbg).where(eq(worksSdPbg.id, id));
      writeAuditLog(req, { module: "Construction", action: "SdPbgReleaseRequest", recordId: id, beforeValue: existing, afterValue: row }).catch(console.error);
      res.json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to request release");
    }
  });

  app.put("/api/ioms/works/sd-pbg/:id/release-status", async (req, res) => {
    try {
      const id = req.params.id;
      const [existing] = await db.select().from(worksSdPbg).where(eq(worksSdPbg.id, id)).limit(1);
      if (!existing) return sendApiError(res, 404, "SD_NOT_FOUND", "SD/PBG not found");
      const loaded = await loadWorkScoped(req, existing.workId);
      if ("error" in loaded) return sendApiError(res, 404, "WORK_NOT_FOUND", "Work not found");
      if (existing.status !== "ReleaseRequested" || !existing.releaseStatus) {
        return sendApiError(res, 400, "SD_RELEASE_NOT_PENDING", "No release request pending");
      }
      const newStatus = String(req.body?.status ?? "");
      const tr = canTransitionWorksDocument(req.user, existing.releaseStatus, newStatus);
      if (!tr.allowed) {
        return sendApiError(res, 403, "SD_RELEASE_STATUS_DENIED", `Cannot transition release ${existing.releaseStatus} → ${newStatus}`);
      }
      const updates: Record<string, unknown> = {
        releaseStatus: newStatus,
        updatedAt: now(),
      };
      if (tr.setDvUser) updates.dvUser = req.user?.id ?? null;
      if (tr.setDaUser) {
        updates.daUser = req.user?.id ?? null;
        updates.status = "Released";
      }
      await db.update(worksSdPbg).set(updates as Record<string, string | null>).where(eq(worksSdPbg.id, id));
      const [row] = await db.select().from(worksSdPbg).where(eq(worksSdPbg.id, id));
      writeAuditLog(req, { module: "Construction", action: "SdPbgReleaseStatus", recordId: id, beforeValue: existing, afterValue: row }).catch(console.error);
      res.json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to update release status");
    }
  });

  // ----- Multi-bill payment allocation (M-06 link) + lock -----
  app.get("/api/ioms/works/:workId/payment-allocations", async (req, res) => {
    try {
      const loaded = await loadWorkScoped(req, req.params.workId);
      if ("error" in loaded) return sendApiError(res, 404, "WORK_NOT_FOUND", "Work not found");
      const list = await db
        .select()
        .from(worksPaymentAllocations)
        .where(eq(worksPaymentAllocations.workId, req.params.workId))
        .orderBy(desc(worksPaymentAllocations.createdAt));
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch payment allocations");
    }
  });

  /** Create ContractorBill voucher (optional) + allocate to approved bills in one step. */
  app.post("/api/ioms/works/:workId/pay-bills", async (req, res) => {
    try {
      if (!canCreateWorksDocument(req.user)) {
        return sendApiError(res, 403, "PAY_DENIED", "Only DO/Admin can record Works payments");
      }
      const loaded = await loadWorkScoped(req, req.params.workId);
      if ("error" in loaded) return sendApiError(res, 404, "WORK_NOT_FOUND", "Work not found");
      const body = req.body ?? {};
      const lines = Array.isArray(body.lines) ? body.lines : [];
      if (!lines.length) return sendApiError(res, 400, "PAY_LINES_REQUIRED", "Select at least one bill line");

      let voucherId = String(body.voucherId ?? "").trim();
      if (!voucherId) {
        const expenditureHeadId = String(body.expenditureHeadId ?? "").trim();
        const payeeName = String(body.payeeName ?? loaded.work.contractorName ?? "").trim();
        if (!expenditureHeadId) {
          return sendApiError(res, 400, "EXPENDITURE_HEAD_REQUIRED", "Expenditure head is required to create voucher");
        }
        if (!payeeName) return sendApiError(res, 400, "PAYEE_REQUIRED", "Payee name is required");
        const gross = lines.reduce((s: number, l: { amount?: number }) => s + Number(l.amount ?? 0), 0);
        if (!(gross > 0)) return sendApiError(res, 400, "PAY_AMOUNT_INVALID", "Payment total must be greater than zero");

        const tdsApplicable = body.tdsApplicable === true || body.tdsApplicable === "true";
        const tdsRate = body.tdsRatePercent != null && body.tdsRatePercent !== "" ? Number(body.tdsRatePercent) : 0;
        const tdsBase =
          body.tdsApplicableAmount != null && body.tdsApplicableAmount !== ""
            ? Number(body.tdsApplicableAmount)
            : gross;
        const tdsAmount = tdsApplicable
          ? body.tdsAmount != null && body.tdsAmount !== ""
            ? Number(body.tdsAmount)
            : Math.round(tdsBase * tdsRate) / 100
          : 0;
        const netPayable = Math.round((gross - tdsAmount) * 100) / 100;

        voucherId = nanoid();
        const ts = now();
        await db.insert(paymentVouchers).values({
          id: voucherId,
          voucherType: "ContractorBill",
          yardId: loaded.work.yardId,
          expenditureHeadId,
          payeeName,
          amount: gross,
          description:
            body.description
              ? String(body.description)
              : `Works payment ${loaded.work.workOrderNo ?? loaded.work.id}`,
          sourceModule: "M-08",
          sourceRecordId: loaded.work.id,
          status: "Draft",
          tdsApplicable,
          tdsSection: body.tdsSection ? String(body.tdsSection) : null,
          tdsRatePercent: tdsApplicable ? tdsRate : null,
          tdsApplicableAmount: tdsApplicable ? tdsBase : null,
          tdsAmount,
          netPayable,
          doUser: req.user?.id ?? null,
          createdAt: ts,
        });
      }

      // Reuse allocation logic via internal redirect-style call: set body and fall through pattern
      req.body = { voucherId, lines };
      // Inline allocate (same as payment-allocations)
      const [voucher] = await db.select().from(paymentVouchers).where(eq(paymentVouchers.id, voucherId)).limit(1);
      if (!voucher) return sendApiError(res, 404, "VOUCHER_NOT_FOUND", "Payment voucher not found");

      const [adv] = await db.select().from(worksAdvances).where(eq(worksAdvances.workId, loaded.work.id)).limit(1);
      let remainingAdvance = 0;
      if (adv && adv.status === "Approved") {
        const adj = await db.select().from(worksAdvanceAdjustments).where(eq(worksAdvanceAdjustments.advanceId, adv.id));
        remainingAdvance = Math.max(0, Number(adv.amount) - adj.reduce((s, a) => s + Number(a.amount), 0));
      }

      let advanceUsedThisPayment = 0;
      const resolved: { bill: typeof worksBills.$inferSelect; amount: number; advanceAdjusted: number }[] = [];
      for (const line of lines) {
        const billId = String(line.billId ?? "");
        const amount = Number(line.amount ?? 0);
        const advanceAdjusted = Number(line.advanceAdjusted ?? 0);
        if (!billId || !(amount > 0)) {
          return sendApiError(res, 400, "PAY_LINE_INVALID", "Each line needs billId and amount > 0");
        }
        if (advanceAdjusted < 0) {
          return sendApiError(res, 400, "ADVANCE_ADJUST_INVALID", "Advance adjusted cannot be negative");
        }
        const [bill] = await db.select().from(worksBills).where(eq(worksBills.id, billId)).limit(1);
        if (!bill || bill.workId !== loaded.work.id) {
          return sendApiError(res, 400, "PAY_BILL_INVALID", "Bill not found on this work");
        }
        if (bill.status !== "Approved") {
          return sendApiError(res, 400, "PAY_BILL_NOT_APPROVED", "Only Approved (unlocked) bills can be paid");
        }
        advanceUsedThisPayment += advanceAdjusted;
        resolved.push({ bill, amount, advanceAdjusted });
      }
      if (advanceUsedThisPayment > remainingAdvance + 1e-6) {
        return sendApiError(res, 400, "ADVANCE_ADJUST_EXCEEDED", "Total advance adjustments exceed remaining advance", {
          remainingAdvance,
          advanceUsedThisPayment,
        });
      }

      const created: string[] = [];
      const ts = now();
      for (const { bill, amount, advanceAdjusted } of resolved) {
        const allocId = nanoid();
        await db.insert(worksPaymentAllocations).values({
          id: allocId,
          workId: loaded.work.id,
          voucherId,
          billId: bill.id,
          amount,
          advanceAdjusted,
          createdBy: req.user?.id ?? null,
          createdAt: ts,
        });
        if (advanceAdjusted > 0 && adv) {
          await db.insert(worksAdvanceAdjustments).values({
            id: nanoid(),
            advanceId: adv.id,
            billId: bill.id,
            voucherId,
            amount: advanceAdjusted,
            remarks: "Payment allocation",
            createdBy: req.user?.id ?? null,
            createdAt: ts,
          });
        }
        const newPaid = Number(bill.cumulativePaid ?? 0) + amount;
        const lockBill = voucher.status === "Approved";
        await db
          .update(worksBills)
          .set({
            cumulativePaid: newPaid,
            voucherId,
            status: lockBill ? "Locked" : bill.status,
            lockedAt: lockBill ? ts : bill.lockedAt,
            updatedAt: ts,
          })
          .where(eq(worksBills.id, bill.id));
        created.push(allocId);
      }

      writeAuditLog(req, {
        module: "Construction",
        action: "PayBills",
        recordId: loaded.work.id,
        afterValue: { voucherId, allocationIds: created },
      }).catch(console.error);
      res.status(201).json({ ok: true, voucherId, allocationIds: created, voucherStatus: voucher.status });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to pay bills");
    }
  });

  app.post("/api/ioms/works/:workId/payment-allocations", async (req, res) => {
    try {
      if (!canCreateWorksDocument(req.user) && !hasRole(req.user, "DA") && !hasRole(req.user, "DV")) {
        return sendApiError(res, 403, "PAY_ALLOC_DENIED", "Insufficient permissions");
      }
      const loaded = await loadWorkScoped(req, req.params.workId);
      if ("error" in loaded) return sendApiError(res, 404, "WORK_NOT_FOUND", "Work not found");
      const voucherId = String(req.body?.voucherId ?? "").trim();
      if (!voucherId) return sendApiError(res, 400, "VOUCHER_REQUIRED", "M-06 Payment Voucher id is required");
      const [voucher] = await db.select().from(paymentVouchers).where(eq(paymentVouchers.id, voucherId)).limit(1);
      if (!voucher) return sendApiError(res, 404, "VOUCHER_NOT_FOUND", "Payment voucher not found");

      const lines = Array.isArray(req.body?.lines) ? req.body.lines : [];
      if (!lines.length) return sendApiError(res, 400, "PAY_LINES_REQUIRED", "At least one bill allocation line is required");

      const [adv] = await db.select().from(worksAdvances).where(eq(worksAdvances.workId, loaded.work.id)).limit(1);
      let remainingAdvance = 0;
      if (adv && adv.status === "Approved") {
        const adj = await db.select().from(worksAdvanceAdjustments).where(eq(worksAdvanceAdjustments.advanceId, adv.id));
        remainingAdvance = Math.max(0, Number(adv.amount) - adj.reduce((s, a) => s + Number(a.amount), 0));
      }

      // Validate all lines before writing
      let advanceUsedThisPayment = 0;
      const resolved: { bill: typeof worksBills.$inferSelect; amount: number; advanceAdjusted: number }[] = [];
      for (const line of lines) {
        const billId = String(line.billId ?? "");
        const amount = Number(line.amount ?? 0);
        const advanceAdjusted = Number(line.advanceAdjusted ?? 0);
        if (!billId || !(amount > 0)) {
          return sendApiError(res, 400, "PAY_LINE_INVALID", "Each line needs billId and amount > 0");
        }
        if (advanceAdjusted < 0) {
          return sendApiError(res, 400, "ADVANCE_ADJUST_INVALID", "Advance adjusted cannot be negative");
        }
        const [bill] = await db.select().from(worksBills).where(eq(worksBills.id, billId)).limit(1);
        if (!bill || bill.workId !== loaded.work.id) {
          return sendApiError(res, 400, "PAY_BILL_INVALID", "Bill not found on this work");
        }
        if (bill.status !== "Approved") {
          return sendApiError(res, 400, "PAY_BILL_NOT_APPROVED", "Only Approved (unlocked) bills can be paid");
        }
        advanceUsedThisPayment += advanceAdjusted;
        resolved.push({ bill, amount, advanceAdjusted });
      }
      if (advanceUsedThisPayment > remainingAdvance + 1e-6) {
        return sendApiError(res, 400, "ADVANCE_ADJUST_EXCEEDED", "Total advance adjustments exceed remaining advance", {
          remainingAdvance,
          advanceUsedThisPayment,
        });
      }

      const created: string[] = [];
      const ts = now();
      for (const { bill, amount, advanceAdjusted } of resolved) {
        const allocId = nanoid();
        await db.insert(worksPaymentAllocations).values({
          id: allocId,
          workId: loaded.work.id,
          voucherId,
          billId: bill.id,
          amount,
          advanceAdjusted,
          createdBy: req.user?.id ?? null,
          createdAt: ts,
        });
        if (advanceAdjusted > 0 && adv) {
          await db.insert(worksAdvanceAdjustments).values({
            id: nanoid(),
            advanceId: adv.id,
            billId: bill.id,
            voucherId,
            amount: advanceAdjusted,
            remarks: "Payment allocation",
            createdBy: req.user?.id ?? null,
            createdAt: ts,
          });
        }
        const newPaid = Number(bill.cumulativePaid ?? 0) + amount;
        const lockBill = voucher.status === "Approved";
        await db
          .update(worksBills)
          .set({
            cumulativePaid: newPaid,
            voucherId,
            status: lockBill ? "Locked" : bill.status,
            lockedAt: lockBill ? ts : bill.lockedAt,
            updatedAt: ts,
          })
          .where(eq(worksBills.id, bill.id));
        created.push(allocId);
      }

      writeAuditLog(req, {
        module: "Construction",
        action: "PaymentAllocate",
        recordId: loaded.work.id,
        afterValue: { voucherId, allocationIds: created },
      }).catch(console.error);
      res.status(201).json({ ok: true, allocationIds: created, voucherStatus: voucher.status });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to allocate payment");
    }
  });
}
