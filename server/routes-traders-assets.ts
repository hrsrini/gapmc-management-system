/**
 * IOMS M-02: Trader & Asset ID Management API routes.
 * Tables: trader_licences, assistant_traders, assets, asset_allotments, trader_blocking_log, msp_settings.
 * CC-05: list/get/mutate filtered by req.scopedLocationIds when non-empty.
 */
import type { Express, Request, Response } from "express";
import { eq, desc, and, inArray, sql, or, ilike } from "drizzle-orm";
import { db } from "./db";
import {
  traderLicences,
  assistantTraders,
  assets,
  assetAllotments,
  traderBlockingLog,
  traderStockOpenings,
  commodities,
  mspSettings,
  rentInvoices,
  iomsReceipts,
} from "@shared/db-schema";
import { nanoid } from "nanoid";
import { getMergedSystemConfig, parseSystemConfigNumber } from "./system-config";
import { writeAuditLog } from "./audit";
import { createIomsReceipt } from "./routes-receipts-ioms";
import { tenantLicenceIsGstExempt } from "./gst-exempt";
import { assertRecordDoDvDaSeparation } from "./workflow";
import { sendApiError } from "./api-errors";
import { parseReportPaging, parseReportSort, reportSearchPattern } from "./report-paging";
import { orderLicenceReport, LICENCE_REPORT_SORT_ALLOW } from "./report-order";
import {
  HrEmployeeRuleError,
  normalizeMobile10,
  assertPersonalEmailFormat,
  normalizeAadhaarMasked,
} from "./hr-employee-rules";

function sendHrRule(res: Response, e: unknown): boolean {
  if (e instanceof HrEmployeeRuleError) {
    sendApiError(res, 400, e.code, e.message);
    return true;
  }
  return false;
}

function yardInScope(req: Request, yardId: string): boolean {
  const scopedIds = (req as Request & { scopedLocationIds?: string[] }).scopedLocationIds;
  return !scopedIds || scopedIds.length === 0 || scopedIds.includes(yardId);
}

export function registerTradersAssetsRoutes(app: Express) {
  const now = () => new Date().toISOString();

  // ----- Trader licences -----
  app.get("/api/ioms/traders/licences", async (req, res) => {
    try {
      const yardId = req.query.yardId as string | undefined;
      const status = req.query.status as string | undefined;
      const paged = req.query.paged === "1";
      const scopedIds = (req as Request & { scopedLocationIds?: string[] }).scopedLocationIds;
      const conditions = [];
      if (scopedIds && scopedIds.length > 0) conditions.push(inArray(traderLicences.yardId, scopedIds));
      if (yardId) conditions.push(eq(traderLicences.yardId, yardId));
      if (status) conditions.push(eq(traderLicences.status, status));

      if (paged) {
        const { page, pageSize, q } = parseReportPaging(req);
        const { sortKey, sortDir } = parseReportSort(req, LICENCE_REPORT_SORT_ALLOW, "createdAt");
        const pattern = reportSearchPattern(q);
        const all = [...conditions];
        if (pattern) {
          all.push(
            or(
              ilike(traderLicences.licenceNo, pattern),
              ilike(traderLicences.firmName, pattern),
              ilike(traderLicences.mobile, pattern),
              ilike(traderLicences.id, pattern),
              ilike(traderLicences.email, pattern),
              ilike(traderLicences.licenceType, pattern),
              ilike(traderLicences.contactName, pattern),
              sql`cast(${traderLicences.feeAmount} as text) ilike ${pattern}`,
            )!,
          );
        }
        const wc = all.length ? and(...all) : undefined;
        const countQ = db.select({ c: sql<number>`count(*)::int` }).from(traderLicences);
        const [{ c: total }] = wc ? await countQ.where(wc) : await countQ;
        const licenceBase = db.select().from(traderLicences);
        const licenceFiltered = wc ? licenceBase.where(wc) : licenceBase;
        const dataQ = licenceFiltered.orderBy(...orderLicenceReport(sortKey, sortDir));
        const rows =
          pageSize === "all"
            ? await dataQ
            : await dataQ.limit(pageSize).offset((page - 1) * pageSize);
        return res.json({ total, page, pageSize, rows });
      }

      const base = db.select().from(traderLicences).orderBy(desc(traderLicences.createdAt));
      const list = conditions.length > 0 ? await base.where(and(...conditions)) : await base;
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch licences");
    }
  });

  app.get("/api/ioms/traders/licences/:id", async (req, res) => {
    try {
      const [row] = await db.select().from(traderLicences).where(eq(traderLicences.id, req.params.id)).limit(1);
      if (!row) return sendApiError(res, 404, "LICENCE_NOT_FOUND", "Licence not found");
      if (!yardInScope(req, row.yardId)) return sendApiError(res, 404, "LICENCE_NOT_FOUND", "Licence not found");
      res.json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch licence");
    }
  });

  // ----- Trader stock openings (M-02 legacy opening balance) -----
  app.get("/api/ioms/traders/licences/:licenceId/stock-openings", async (req, res) => {
    try {
      const licenceId = req.params.licenceId;
      const [lic] = await db.select().from(traderLicences).where(eq(traderLicences.id, licenceId)).limit(1);
      if (!lic || !yardInScope(req, lic.yardId)) return sendApiError(res, 404, "LICENCE_NOT_FOUND", "Licence not found");
      const list = await db
        .select()
        .from(traderStockOpenings)
        .where(eq(traderStockOpenings.traderLicenceId, licenceId))
        .orderBy(desc(traderStockOpenings.effectiveDate));
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch stock openings");
    }
  });

  app.post("/api/ioms/traders/licences/:licenceId/stock-openings", async (req, res) => {
    try {
      const licenceId = req.params.licenceId;
      const [lic] = await db.select().from(traderLicences).where(eq(traderLicences.id, licenceId)).limit(1);
      if (!lic || !yardInScope(req, lic.yardId)) return sendApiError(res, 404, "LICENCE_NOT_FOUND", "Licence not found");
      const body = req.body as Record<string, unknown>;
      const commodityId = String(body.commodityId ?? "");
      const unit = String(body.unit ?? "");
      const effectiveDate = String(body.effectiveDate ?? "");
      const quantity = Number(body.quantity);
      if (!commodityId || !unit || !effectiveDate || !Number.isFinite(quantity)) {
        return sendApiError(res, 400, "STOCK_OPENING_FIELDS", "commodityId, unit, effectiveDate, quantity (number) required");
      }
      const [com] = await db.select().from(commodities).where(eq(commodities.id, commodityId)).limit(1);
      if (!com) return sendApiError(res, 400, "STOCK_OPENING_COMMODITY_INVALID", "Commodity not found");
      const id = nanoid();
      const ts = now();
      await db.insert(traderStockOpenings).values({
        id,
        traderLicenceId: licenceId,
        yardId: lic.yardId,
        commodityId,
        quantity,
        unit,
        effectiveDate,
        remarks: body.remarks ? String(body.remarks) : null,
        createdAt: ts,
        createdBy: req.user?.id ?? null,
      });
      const [row] = await db.select().from(traderStockOpenings).where(eq(traderStockOpenings.id, id));
      if (row) writeAuditLog(req, { module: "Traders", action: "Create", recordId: id, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create stock opening");
    }
  });

  app.put("/api/ioms/traders/stock-openings/:openingId", async (req, res) => {
    try {
      const openingId = req.params.openingId;
      const [existing] = await db.select().from(traderStockOpenings).where(eq(traderStockOpenings.id, openingId)).limit(1);
      if (!existing) return sendApiError(res, 404, "STOCK_OPENING_NOT_FOUND", "Not found");
      const [lic] = await db.select().from(traderLicences).where(eq(traderLicences.id, existing.traderLicenceId)).limit(1);
      if (!lic || !yardInScope(req, lic.yardId)) return sendApiError(res, 404, "STOCK_OPENING_NOT_FOUND", "Not found");
      const body = req.body as Record<string, unknown>;
      const updates: Record<string, unknown> = {};
      if (body.commodityId !== undefined) {
        const cid = String(body.commodityId);
        const [com] = await db.select().from(commodities).where(eq(commodities.id, cid)).limit(1);
        if (!com) return sendApiError(res, 400, "STOCK_OPENING_COMMODITY_INVALID", "Commodity not found");
        updates.commodityId = cid;
      }
      if (body.quantity !== undefined) updates.quantity = Number(body.quantity);
      if (body.unit !== undefined) updates.unit = String(body.unit);
      if (body.effectiveDate !== undefined) updates.effectiveDate = String(body.effectiveDate);
      if (body.remarks !== undefined) updates.remarks = body.remarks == null ? null : String(body.remarks);
      if (Object.keys(updates).length === 0) {
        const [row] = await db.select().from(traderStockOpenings).where(eq(traderStockOpenings.id, openingId));
        return res.json(row!);
      }
      await db.update(traderStockOpenings).set(updates as Record<string, string | number | null>).where(eq(traderStockOpenings.id, openingId));
      const [row] = await db.select().from(traderStockOpenings).where(eq(traderStockOpenings.id, openingId));
      if (row) writeAuditLog(req, { module: "Traders", action: "Update", recordId: openingId, beforeValue: existing, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.json(row!);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to update stock opening");
    }
  });

  app.delete("/api/ioms/traders/stock-openings/:openingId", async (req, res) => {
    try {
      const openingId = req.params.openingId;
      const [existing] = await db.select().from(traderStockOpenings).where(eq(traderStockOpenings.id, openingId)).limit(1);
      if (!existing) return sendApiError(res, 404, "STOCK_OPENING_NOT_FOUND", "Not found");
      const [lic] = await db.select().from(traderLicences).where(eq(traderLicences.id, existing.traderLicenceId)).limit(1);
      if (!lic || !yardInScope(req, lic.yardId)) return sendApiError(res, 404, "STOCK_OPENING_NOT_FOUND", "Not found");
      await db.delete(traderStockOpenings).where(eq(traderStockOpenings.id, openingId));
      writeAuditLog(req, { module: "Traders", action: "Delete", recordId: openingId, beforeValue: existing }).catch((e) => console.error("Audit log failed:", e));
      res.status(204).send();
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to delete stock opening");
    }
  });

  app.post("/api/ioms/traders/licences", async (req, res) => {
    try {
      const body = req.body;
      const yid = String(body.yardId ?? "");
      if (!yardInScope(req, yid)) return sendApiError(res, 403, "M02_YARD_ACCESS_DENIED", "You do not have access to this yard");
      if (!body.mobile || String(body.mobile).trim() === "") {
        return sendApiError(res, 400, "LICENCE_MOBILE_REQUIRED", "Mobile is required");
      }
      let mobileNorm: string;
      let emailNorm: string | null;
      let aadhaarNorm: string | null;
      try {
        const m = normalizeMobile10(String(body.mobile));
        if (m == null) {
          return sendApiError(res, 400, "LICENCE_MOBILE_REQUIRED", "Mobile is required");
        }
        mobileNorm = m;
        emailNorm =
          body.email != null && String(body.email).trim() !== "" ? String(body.email).trim().toLowerCase() : null;
        assertPersonalEmailFormat(emailNorm);
        aadhaarNorm = normalizeAadhaarMasked(body.aadhaarToken ?? null);
      } catch (e) {
        if (sendHrRule(res, e)) return;
        throw e;
      }
      const id = nanoid();
      const sys = await getMergedSystemConfig();
      const feeFromBody =
        body.feeAmount != null && String(body.feeAmount).trim() !== "" ? Number(body.feeAmount) : null;
      const feeAmount = feeFromBody != null && !Number.isNaN(feeFromBody) ? feeFromBody : parseSystemConfigNumber(sys, "licence_fee");
      await db.insert(traderLicences).values({
        id,
        firmName: String(body.firmName ?? ""),
        yardId: String(body.yardId ?? ""),
        mobile: mobileNorm,
        licenceType: String(body.licenceType ?? "Associated"),
        status: String(body.status ?? "Draft"),
        firmType: body.firmType ? String(body.firmType) : null,
        contactName: body.contactName ? String(body.contactName) : null,
        email: emailNorm,
        address: body.address ? String(body.address) : null,
        aadhaarToken: aadhaarNorm,
        pan: body.pan ? String(body.pan) : null,
        gstin: body.gstin ? String(body.gstin) : null,
        feeAmount,
        receiptId: body.receiptId ? String(body.receiptId) : null,
        validFrom: body.validFrom ? String(body.validFrom) : null,
        validTo: body.validTo ? String(body.validTo) : null,
        isBlocked: Boolean(body.isBlocked ?? false),
        blockReason: body.blockReason ? String(body.blockReason) : null,
        dvReturnRemarks: null,
        workflowRevisionCount: 0,
        govtGstExemptCategoryId: body.govtGstExemptCategoryId ? String(body.govtGstExemptCategoryId) : null,
        isNonGstEntity: Boolean(body.isNonGstEntity ?? false),
        doUser: body.doUser ? String(body.doUser) : null,
        dvUser: body.dvUser ? String(body.dvUser) : null,
        daUser: body.daUser ? String(body.daUser) : null,
        createdAt: now(),
        updatedAt: now(),
      });
      const [row] = await db.select().from(traderLicences).where(eq(traderLicences.id, id));
      if (row) writeAuditLog(req, { module: "Traders", action: "Create", recordId: id, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create licence");
    }
  });

  app.put("/api/ioms/traders/licences/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const body = req.body as Record<string, unknown>;

      const [existing] = await db.select().from(traderLicences).where(eq(traderLicences.id, id)).limit(1);
      if (!existing) return sendApiError(res, 404, "LICENCE_NOT_FOUND", "Licence not found");
      if (!yardInScope(req, existing.yardId)) return sendApiError(res, 404, "LICENCE_NOT_FOUND", "Licence not found");

      const issuedNo = existing.licenceNo != null && String(existing.licenceNo).trim() !== "";
      /** After licence number is issued, application data is frozen; these keys remain patchable (tax / operational). */
      const ISSUED_ALLOWED_BODY_KEYS = new Set([
        "govtGstExemptCategoryId",
        "isNonGstEntity",
        "isBlocked",
        "blockReason",
      ]);
      if (issuedNo) {
        for (const key of Object.keys(body)) {
          if (body[key] === undefined) continue;
          if (!ISSUED_ALLOWED_BODY_KEYS.has(key)) {
            return sendApiError(
              res,
              403,
              "LICENCE_FINAL_LOCKED",
              "This licence number has been issued. Only GST exemption category, non-GST flag, and block fields can be updated.",
            );
          }
        }
      }

      const newYardId = body.yardId !== undefined ? String(body.yardId) : existing.yardId;
      if (body.yardId !== undefined && !yardInScope(req, newYardId)) {
        return sendApiError(res, 403, "M02_YARD_ACCESS_DENIED", "You do not have access to this yard");
      }

      const allowedAll = [
        "firmName",
        "firmType",
        "yardId",
        "contactName",
        "mobile",
        "email",
        "address",
        "aadhaarToken",
        "pan",
        "gstin",
        "licenceType",
        "feeAmount",
        "receiptId",
        "validFrom",
        "validTo",
        "status",
        "isBlocked",
        "blockReason",
        "licenceNo",
        "doUser",
        "dvUser",
        "daUser",
        "govtGstExemptCategoryId",
      ];
      const allowed = issuedNo
        ? allowedAll.filter((k) => ISSUED_ALLOWED_BODY_KEYS.has(k))
        : allowedAll;
      const updates: Record<string, unknown> = { updatedAt: now() };
      for (const k of allowed) {
        if (body[k] === undefined) continue;
        if (k === "feeAmount") updates.feeAmount = body[k] == null ? null : Number(body[k]);
        else updates[k] = body[k] == null ? null : String(body[k]);
      }
      if (body.isBlocked !== undefined) updates.isBlocked = Boolean(body.isBlocked);
      if (body.isNonGstEntity !== undefined) updates.isNonGstEntity = Boolean(body.isNonGstEntity);

      if (body.dvReturnRemarks !== undefined) {
        const raw = body.dvReturnRemarks;
        updates.dvReturnRemarks =
          raw == null || String(raw).trim() === "" ? null : String(raw).trim().slice(0, 4000);
      }

      const mergedStatus =
        updates.status !== undefined ? String(updates.status) : String(existing.status);
      if (mergedStatus === "Query" && existing.status !== "Query") {
        const remark =
          updates.dvReturnRemarks !== undefined ? (updates.dvReturnRemarks as string | null) : null;
        if (remark == null || String(remark).trim() === "") {
          return sendApiError(
            res,
            400,
            "QUERY_REMARKS_REQUIRED",
            "Reviewer remarks are required when returning an application for correction.",
          );
        }
      }
      if (existing.status === "Query" && mergedStatus === "Pending") {
        updates.workflowRevisionCount = (existing.workflowRevisionCount ?? 0) + 1;
        updates.dvReturnRemarks = null;
      }

      const mergedMobile = updates.mobile !== undefined ? updates.mobile : existing.mobile;
      const mergedEmail = updates.email !== undefined ? updates.email : existing.email;
      const mergedAadhaar = updates.aadhaarToken !== undefined ? updates.aadhaarToken : existing.aadhaarToken;
      try {
        if (mergedMobile == null || String(mergedMobile).trim() === "") {
          return sendApiError(res, 400, "LICENCE_MOBILE_REQUIRED", "Mobile is required");
        }
        const mn = normalizeMobile10(String(mergedMobile));
        if (!mn) {
          return sendApiError(res, 400, "LICENCE_MOBILE_REQUIRED", "Mobile is required");
        }
        updates.mobile = mn;
        const en =
          mergedEmail == null || String(mergedEmail).trim() === "" ? null : String(mergedEmail).trim().toLowerCase();
        assertPersonalEmailFormat(en);
        updates.email = en;
        updates.aadhaarToken = normalizeAadhaarMasked(mergedAadhaar as string | null);
      } catch (e) {
        if (sendHrRule(res, e)) return;
        throw e;
      }

      const mergedRoles = {
        doUser: updates.doUser !== undefined ? (updates.doUser as string | null) : existing.doUser,
        dvUser: updates.dvUser !== undefined ? (updates.dvUser as string | null) : existing.dvUser,
        daUser: updates.daUser !== undefined ? (updates.daUser as string | null) : existing.daUser,
      };
      const seg = assertRecordDoDvDaSeparation(req.user, mergedRoles);
      if (!seg.ok) return sendApiError(res, 403, "LICENCE_DO_DV_DA_SEGREGATION", seg.error);
      await db.update(traderLicences).set(updates as Record<string, string | number | boolean | null>).where(eq(traderLicences.id, id));

      const [row] = await db.select().from(traderLicences).where(eq(traderLicences.id, id)).limit(1);
      if (!row) return sendApiError(res, 404, "LICENCE_NOT_FOUND", "Licence not found");

      // Phase-1 linkage: when a licence becomes Active and fee is present, auto-create (or reuse) a LicenceFee receipt.
      const shouldCreateReceipt =
        row.status === "Active" &&
        row.receiptId == null &&
        row.feeAmount != null &&
        Number(row.feeAmount) > 0;

      if (shouldCreateReceipt) {
        const [existingReceipt] = await db
          .select()
          .from(iomsReceipts)
          .where(and(eq(iomsReceipts.sourceModule, "M-02"), eq(iomsReceipts.sourceRecordId, row.id)))
          .limit(1);

        const receiptToLink = existingReceipt
          ? existingReceipt
          : await (async () => {
              const createdBy = req.user?.id ?? "system";
              const exempt = await tenantLicenceIsGstExempt(row.id);
              const created = await createIomsReceipt({
                yardId: String(row.yardId),
                revenueHead: "LicenceFee",
                payerName: row.firmName,
                payerType: "TraderLicence",
                payerRefId: row.id,
                amount: Number(row.feeAmount ?? 0),
                cgst: exempt ? 0 : undefined,
                sgst: exempt ? 0 : undefined,
                paymentMode: "Cash",
                sourceModule: "M-02",
                sourceRecordId: row.id,
                createdBy,
              });
              const [createdRow] = await db.select().from(iomsReceipts).where(eq(iomsReceipts.id, created.id)).limit(1);
              if (createdRow) {
                await writeAuditLog(req, {
                  module: "Receipts",
                  action: "Create",
                  recordId: createdRow.id,
                  afterValue: createdRow,
                }).catch((e) => console.error("Audit log failed:", e));
              }
              return createdRow ?? null;
            })();

        if (receiptToLink?.id) {
          await db.update(traderLicences).set({ receiptId: receiptToLink.id }).where(eq(traderLicences.id, id));
          const [updatedLicence] = await db.select().from(traderLicences).where(eq(traderLicences.id, id)).limit(1);
          if (updatedLicence) {
            writeAuditLog(req, { module: "Traders", action: "Update", recordId: id, beforeValue: existing, afterValue: updatedLicence }).catch((e) =>
              console.error("Audit log failed:", e)
            );
          }
          return res.json(updatedLicence ?? row);
        }
      }

      writeAuditLog(req, { module: "Traders", action: "Update", recordId: id, beforeValue: existing, afterValue: row }).catch((e) =>
        console.error("Audit log failed:", e)
      );
      res.json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to update licence");
    }
  });

  // ----- Assistant traders -----
  app.get("/api/ioms/traders/assistants", async (req, res) => {
    try {
      const primaryLicenceId = req.query.primaryLicenceId as string | undefined;
      const scopedIds = (req as Request & { scopedLocationIds?: string[] }).scopedLocationIds;
      if (primaryLicenceId) {
        const [lic] = await db.select().from(traderLicences).where(eq(traderLicences.id, primaryLicenceId)).limit(1);
        if (!lic || !yardInScope(req, lic.yardId)) return res.json([]);
      }
      let list =
        primaryLicenceId != null && primaryLicenceId !== ""
          ? await db.select().from(assistantTraders).where(eq(assistantTraders.primaryLicenceId, primaryLicenceId))
          : await db.select().from(assistantTraders).orderBy(desc(assistantTraders.personName));
      if (scopedIds && scopedIds.length > 0) {
        list = list.filter((a) => scopedIds.includes(a.yardId));
      }
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch assistant traders");
    }
  });

  app.post("/api/ioms/traders/assistants", async (req, res) => {
    try {
      const body = req.body;
      const ay = String(body.yardId ?? "");
      if (!yardInScope(req, ay)) return sendApiError(res, 403, "M02_YARD_ACCESS_DENIED", "You do not have access to this yard");
      const primaryLicenceId = String(body.primaryLicenceId ?? "");
      const [primary] = await db.select().from(traderLicences).where(eq(traderLicences.id, primaryLicenceId)).limit(1);
      if (!primary) {
        return sendApiError(res, 400, "ASSISTANT_PRIMARY_NOT_FOUND", "Primary trader licence not found");
      }
      if (!yardInScope(req, primary.yardId)) {
        return sendApiError(res, 403, "M02_YARD_ACCESS_DENIED", "You do not have access to the primary licence yard");
      }
      if (primary.status !== "Active") {
        return sendApiError(
          res,
          400,
          "ASSISTANT_PRIMARY_NOT_ACTIVE",
          "Assistant can only be linked to an Active primary trader licence.",
        );
      }
      if (ay !== primary.yardId) {
        return sendApiError(
          res,
          400,
          "ASSISTANT_YARD_MISMATCH",
          "Assistant yard must match the primary trader licence yard.",
        );
      }
      const id = nanoid();
      await db.insert(assistantTraders).values({
        id,
        primaryLicenceId,
        personName: String(body.personName ?? ""),
        yardId: String(body.yardId ?? ""),
        status: String(body.status ?? "Active"),
        characterCertIssuer: body.characterCertIssuer ? String(body.characterCertIssuer) : null,
        certDate: body.certDate ? String(body.certDate) : null,
        manualLicenceNo: body.manualLicenceNo ? String(body.manualLicenceNo) : null,
      });
      const [row] = await db.select().from(assistantTraders).where(eq(assistantTraders.id, id));
      if (row) writeAuditLog(req, { module: "Traders", action: "Create", recordId: id, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create assistant trader");
    }
  });

  // ----- Assets -----
  app.get("/api/ioms/assets", async (req, res) => {
    try {
      const yardId = req.query.yardId as string | undefined;
      const scopedIds = (req as Request & { scopedLocationIds?: string[] }).scopedLocationIds;
      const conditions = [];
      if (scopedIds && scopedIds.length > 0) conditions.push(inArray(assets.yardId, scopedIds));
      if (yardId) conditions.push(eq(assets.yardId, yardId));
      const base = db.select().from(assets).orderBy(assets.assetId);
      const list = conditions.length > 0 ? await base.where(and(...conditions)) : await base;
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch assets");
    }
  });

  // Vacated / vacant shops: no active allotment; show previous allottee, officer, rent
  app.get("/api/ioms/assets/vacant", async (req, res) => {
    try {
      const yardId = req.query.yardId as string | undefined;
      const scopedIds = (req as Request & { scopedLocationIds?: string[] }).scopedLocationIds;
      const conditions = [];
      if (scopedIds && scopedIds.length > 0) conditions.push(inArray(assets.yardId, scopedIds));
      if (yardId) conditions.push(eq(assets.yardId, yardId));
      const base = db.select().from(assets).orderBy(assets.assetId);
      const allAssets = conditions.length > 0 ? await base.where(and(...conditions)) : await base;
      const allAllotments = await db.select().from(assetAllotments).orderBy(desc(assetAllotments.toDate));
      const allInvoices = await db.select().from(rentInvoices).orderBy(desc(rentInvoices.periodMonth));
      const latestRentByAllotment: Record<string, number> = {};
      for (const inv of allInvoices) {
        if (inv.allotmentId && latestRentByAllotment[inv.allotmentId] == null)
          latestRentByAllotment[inv.allotmentId] = inv.rentAmount ?? inv.totalAmount ?? 0;
      }
      const allotmentsByAsset = new Map<string, typeof allAllotments>();
      for (const a of allAllotments) {
        const list = allotmentsByAsset.get(a.assetId) ?? [];
        list.push(a);
        allotmentsByAsset.set(a.assetId, list);
      }
      const vacant: Array<{
        asset: (typeof allAssets)[0];
        lastAllotment: { allotteeName: string; toDate: string; daUser: string | null; id: string } | null;
        lastRentAmount: number | null;
      }> = [];
      for (const asset of allAssets) {
        const list = allotmentsByAsset.get(asset.id) ?? allotmentsByAsset.get(asset.assetId) ?? [];
        const latest = list[0];
        if (latest && latest.status === "Active") continue;
        const lastAllotment = latest
          ? { allotteeName: latest.allotteeName, toDate: latest.toDate, daUser: latest.daUser, id: latest.id }
          : null;
        const lastRentAmount = lastAllotment ? (latestRentByAllotment[lastAllotment.id] ?? null) : null;
        vacant.push({ asset, lastAllotment, lastRentAmount });
      }
      res.json(vacant);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch vacant assets");
    }
  });

  // ----- Asset allotments (use /asset-allotments to avoid conflict with /assets/:id) -----
  app.get("/api/ioms/asset-allotments", async (req, res) => {
    try {
      const assetId = req.query.assetId as string | undefined;
      const licenceId = req.query.traderLicenceId as string | undefined;
      const scopedIds = (req as Request & { scopedLocationIds?: string[] }).scopedLocationIds;
      let list = await db.select().from(assetAllotments).orderBy(desc(assetAllotments.fromDate));
      if (assetId) list = list.filter((r) => r.assetId === assetId);
      if (licenceId) list = list.filter((r) => r.traderLicenceId === licenceId);
      if (scopedIds && scopedIds.length > 0) {
        const inScope = await db.select({ id: assets.id }).from(assets).where(inArray(assets.yardId, scopedIds));
        const ok = new Set(inScope.map((a) => a.id));
        list = list.filter((r) => ok.has(r.assetId));
      }
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch allotments");
    }
  });

  app.post("/api/ioms/asset-allotments", async (req, res) => {
    try {
      const body = req.body;
      const aid = String(body.assetId ?? "");
      const [assetRow] = await db.select().from(assets).where(eq(assets.id, aid)).limit(1);
      if (!assetRow) return sendApiError(res, 404, "ASSET_NOT_FOUND", "Asset not found");
      if (!yardInScope(req, assetRow.yardId))
        return sendApiError(res, 403, "ASSET_YARD_ACCESS_DENIED", "You do not have access to this asset's yard");
      const id = nanoid();
      await db.insert(assetAllotments).values({
        id,
        assetId: String(body.assetId ?? ""),
        traderLicenceId: String(body.traderLicenceId ?? ""),
        allotteeName: String(body.allotteeName ?? ""),
        fromDate: String(body.fromDate ?? ""),
        toDate: String(body.toDate ?? ""),
        status: String(body.status ?? "Active"),
        securityDeposit: body.securityDeposit != null ? Number(body.securityDeposit) : null,
        doUser: body.doUser ? String(body.doUser) : null,
        daUser: body.daUser ? String(body.daUser) : null,
      });
      const [row] = await db.select().from(assetAllotments).where(eq(assetAllotments.id, id));
      if (row) writeAuditLog(req, { module: "Traders", action: "Create", recordId: id, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create allotment");
    }
  });

  app.put("/api/ioms/asset-allotments/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const [existingAllot] = await db.select().from(assetAllotments).where(eq(assetAllotments.id, id)).limit(1);
      if (!existingAllot) return sendApiError(res, 404, "ALLOTMENT_NOT_FOUND", "Not found");
      const [assetRow] = await db.select().from(assets).where(eq(assets.id, existingAllot.assetId)).limit(1);
      if (!assetRow || !yardInScope(req, assetRow.yardId)) return sendApiError(res, 404, "ALLOTMENT_NOT_FOUND", "Not found");
      const body = req.body;
      const updates: Record<string, unknown> = {};
      ["allotteeName", "fromDate", "toDate", "status", "securityDeposit", "doUser", "daUser"].forEach((k) => {
        if (body[k] === undefined) return;
        if (k === "securityDeposit") updates.securityDeposit = body[k] == null ? null : Number(body[k]);
        else updates[k] = body[k] == null ? null : String(body[k]);
      });
      const seg = assertRecordDoDvDaSeparation(req.user, {
        doUser: updates.doUser !== undefined ? (updates.doUser as string | null) : existingAllot.doUser,
        daUser: updates.daUser !== undefined ? (updates.daUser as string | null) : existingAllot.daUser,
      });
      if (!seg.ok) return sendApiError(res, 403, "ALLOTMENT_DO_DV_DA_SEGREGATION", seg.error);
      await db.update(assetAllotments).set(updates as Record<string, string | number | null>).where(eq(assetAllotments.id, id));
      const [row] = await db.select().from(assetAllotments).where(eq(assetAllotments.id, id));
      if (!row) return sendApiError(res, 404, "ALLOTMENT_NOT_FOUND", "Not found");
      writeAuditLog(req, { module: "Traders", action: "Update", recordId: id, beforeValue: existingAllot, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to update allotment");
    }
  });

  app.get("/api/ioms/assets/:id", async (req, res) => {
    try {
      const [row] = await db.select().from(assets).where(eq(assets.id, req.params.id)).limit(1);
      if (!row) return sendApiError(res, 404, "ASSET_NOT_FOUND", "Asset not found");
      if (!yardInScope(req, row.yardId)) return sendApiError(res, 404, "ASSET_NOT_FOUND", "Asset not found");
      res.json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch asset");
    }
  });

  app.post("/api/ioms/assets", async (req, res) => {
    try {
      const body = req.body;
      const yid = String(body.yardId ?? "");
      if (!yardInScope(req, yid)) return sendApiError(res, 403, "M02_YARD_ACCESS_DENIED", "You do not have access to this yard");
      const id = nanoid();
      await db.insert(assets).values({
        id,
        assetId: String(body.assetId ?? ""),
        yardId: yid,
        assetType: String(body.assetType ?? "Shop"),
        complexName: body.complexName ? String(body.complexName) : null,
        area: body.area ? String(body.area) : null,
        plinthAreaSqft: body.plinthAreaSqft != null ? Number(body.plinthAreaSqft) : null,
        value: body.value != null ? Number(body.value) : null,
        fileNumber: body.fileNumber ? String(body.fileNumber) : null,
        orderNumber: body.orderNumber ? String(body.orderNumber) : null,
        isActive: body.isActive !== undefined ? Boolean(body.isActive) : true,
      });
      const [row] = await db.select().from(assets).where(eq(assets.id, id));
      if (row) writeAuditLog(req, { module: "Traders", action: "Create", recordId: id, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create asset");
    }
  });

  app.put("/api/ioms/assets/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const [existing] = await db.select().from(assets).where(eq(assets.id, id)).limit(1);
      if (!existing) return sendApiError(res, 404, "ASSET_NOT_FOUND", "Asset not found");
      if (!yardInScope(req, existing.yardId)) return sendApiError(res, 404, "ASSET_NOT_FOUND", "Asset not found");
      const body = req.body;
      const newYard = body.yardId !== undefined ? String(body.yardId) : existing.yardId;
      if (body.yardId !== undefined && !yardInScope(req, newYard)) {
        return sendApiError(res, 403, "M02_YARD_ACCESS_DENIED", "You do not have access to this yard");
      }
      const allowed = ["assetId", "yardId", "assetType", "complexName", "area", "plinthAreaSqft", "value", "fileNumber", "orderNumber", "isActive"];
      const updates: Record<string, unknown> = {};
      for (const k of allowed) {
        if (body[k] === undefined) continue;
        if (k === "plinthAreaSqft" || k === "value") updates[k] = body[k] == null ? null : Number(body[k]);
        else if (k === "isActive") updates.isActive = Boolean(body.isActive);
        else updates[k] = body[k] == null ? null : String(body[k]);
      }
      await db.update(assets).set(updates as Record<string, string | number | boolean | null>).where(eq(assets.id, id));
      const [row] = await db.select().from(assets).where(eq(assets.id, id));
      if (!row) return sendApiError(res, 404, "ASSET_NOT_FOUND", "Asset not found");
      writeAuditLog(req, { module: "Traders", action: "Update", recordId: id, beforeValue: existing, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to update asset");
    }
  });

  // ----- Trader blocking log -----
  app.get("/api/ioms/traders/blocking-log", async (req, res) => {
    try {
      const traderLicenceId = req.query.traderLicenceId as string | undefined;
      const scopedIds = (req as Request & { scopedLocationIds?: string[] }).scopedLocationIds;
      if (traderLicenceId) {
        const [lic] = await db.select().from(traderLicences).where(eq(traderLicences.id, traderLicenceId)).limit(1);
        if (!lic || !yardInScope(req, lic.yardId)) return res.json([]);
      }
      let list = traderLicenceId
        ? await db.select().from(traderBlockingLog).where(eq(traderBlockingLog.traderLicenceId, traderLicenceId)).orderBy(desc(traderBlockingLog.actionedAt))
        : await db.select().from(traderBlockingLog).orderBy(desc(traderBlockingLog.actionedAt));
      if (!traderLicenceId && scopedIds && scopedIds.length > 0) {
        const licences = await db.select().from(traderLicences).where(inArray(traderLicences.yardId, scopedIds));
        const ok = new Set(licences.map((l) => l.id));
        list = list.filter((e) => ok.has(e.traderLicenceId));
      }
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch blocking log");
    }
  });

  app.post("/api/ioms/traders/blocking-log", async (req, res) => {
    try {
      const body = req.body;
      const lid = String(body.traderLicenceId ?? "");
      const [lic] = await db.select().from(traderLicences).where(eq(traderLicences.id, lid)).limit(1);
      if (!lic) return sendApiError(res, 404, "LICENCE_NOT_FOUND", "Licence not found");
      if (!yardInScope(req, lic.yardId))
        return sendApiError(res, 403, "LICENCE_YARD_ACCESS_DENIED", "You do not have access to this licence's yard");
      const id = nanoid();
      await db.insert(traderBlockingLog).values({
        id,
        traderLicenceId: String(body.traderLicenceId ?? ""),
        action: String(body.action ?? "Blocked"),
        reason: String(body.reason ?? ""),
        actionedBy: String(body.actionedBy ?? ""),
        actionedAt: body.actionedAt ? String(body.actionedAt) : now(),
      });
      const [row] = await db.select().from(traderBlockingLog).where(eq(traderBlockingLog.id, id));
      if (row) writeAuditLog(req, { module: "Traders", action: "Create", recordId: id, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create blocking log entry");
    }
  });

  // ----- MSP settings -----
  app.get("/api/ioms/msp-settings", async (_req, res) => {
    try {
      const list = await db.select().from(mspSettings).orderBy(mspSettings.commodity);
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch MSP settings");
    }
  });

  app.post("/api/ioms/msp-settings", async (req, res) => {
    try {
      const body = req.body;
      const sys = await getMergedSystemConfig();
      const defaultMsp = parseSystemConfigNumber(sys, "msp_rate");
      const id = nanoid();
      await db.insert(mspSettings).values({
        id,
        commodity: String(body.commodity ?? ""),
        mspRate:
          body.mspRate != null && String(body.mspRate).trim() !== "" ? Number(body.mspRate) : defaultMsp,
        validFrom: String(body.validFrom ?? ""),
        validTo: String(body.validTo ?? ""),
        updatedBy: body.updatedBy ? String(body.updatedBy) : null,
      });
      const [row] = await db.select().from(mspSettings).where(eq(mspSettings.id, id));
      if (row) writeAuditLog(req, { module: "Traders", action: "Create", recordId: id, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create MSP setting");
    }
  });

  app.put("/api/ioms/msp-settings/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const [existingMsp] = await db.select().from(mspSettings).where(eq(mspSettings.id, id)).limit(1);
      if (!existingMsp) return sendApiError(res, 404, "MSP_SETTING_NOT_FOUND", "Not found");
      const body = req.body;
      const updates: Record<string, unknown> = {};
      ["commodity", "mspRate", "validFrom", "validTo", "updatedBy"].forEach((k) => {
        if (body[k] === undefined) return;
        if (k === "mspRate") updates.mspRate = Number(body.mspRate);
        else updates[k] = body[k] == null ? null : String(body[k]);
      });
      await db.update(mspSettings).set(updates as Record<string, string | number | null>).where(eq(mspSettings.id, id));
      const [row] = await db.select().from(mspSettings).where(eq(mspSettings.id, id));
      if (!row) return sendApiError(res, 404, "MSP_SETTING_NOT_FOUND", "Not found");
      writeAuditLog(req, { module: "Traders", action: "Update", recordId: id, beforeValue: existingMsp, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to update MSP setting");
    }
  });
}
