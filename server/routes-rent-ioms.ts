/**
 * IOMS M-03: Rent / GST Tax Invoice API routes.
 * Tables: rent_invoices, rent_deposit_ledger, credit_notes.
 * Workflow: DO creates Draft; DV verifies (Draft→Verified); DA approves (Verified→Approved).
 */
import type { Express, Request } from "express";
import { eq, desc, and, inArray, gte, lte, or, isNull } from "drizzle-orm";
import { db } from "./db";
import { rentInvoices, rentDepositLedger, creditNotes, iomsReceipts, traderLicences, rentRevisionOverrides, assetAllotments, assets } from "@shared/db-schema";
import { nanoid } from "nanoid";
import {
  canCreateRentInvoice,
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
import { recordRentCollectionForM03Receipt } from "./rent-deposit-ledger-from-receipt";
import { parseUnifiedEntityId, unifiedEntityIdFromTrackA } from "@shared/unified-entity-id";
import { normalizeRentRevisionBasis, yearMonthMinusOne } from "@shared/rent-revision-basis";
import { resolveRentForAllotmentPeriodMonth } from "./rent-allotment-rent-resolve";

function currentYearMonthUtc(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
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

export function registerRentIomsRoutes(app: Express) {
  const nowIso = () => new Date().toISOString();
  // ----- Rent invoices (IOMS M-03; distinct from gapmc.invoices; scoped by user yards) -----
  app.get("/api/ioms/rent/invoices", async (req, res) => {
    try {
      const yardId = req.query.yardId as string | undefined;
      const status = req.query.status as string | undefined;
      const conditions = [];
      const scopedIds = req.scopedLocationIds;
      if (scopedIds && scopedIds.length > 0) conditions.push(inArray(rentInvoices.yardId, scopedIds));
      if (yardId) conditions.push(eq(rentInvoices.yardId, yardId));
      if (status) conditions.push(eq(rentInvoices.status, status));
      const base = db.select().from(rentInvoices).orderBy(desc(rentInvoices.periodMonth));
      const list = conditions.length > 0 ? await base.where(and(...conditions)) : await base;
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch rent invoices");
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
      const now = new Date().toISOString();
      const tenantLicenceId = String(body.tenantLicenceId ?? "");
      let rentAmount = Number(body.rentAmount ?? 0);
      const nonGst = parseNonGstCharges((body as Record<string, unknown>).nonGstCharges);
      if (!nonGst.ok) return sendApiError(res, 400, "RENT_INVOICE_NON_GST_CHARGES", nonGst.error);
      let cgst = Number(body.cgst ?? 0);
      let sgst = Number(body.sgst ?? 0);
      let totalAmount = Number(body.totalAmount ?? 0);
      let isGovtEntity = Boolean(body.isGovtEntity ?? false);
      const gstExempt = Boolean(tenantLicenceId && (await tenantLicenceIsGstExempt(tenantLicenceId)));
      if (gstExempt) {
        cgst = 0;
        sgst = 0;
        totalAmount = rentAmount + nonGst.sum;
        isGovtEntity = true;
      }
      const periodMonth = String(body.periodMonth ?? "").trim();
      if (!isValidYearMonthYm(periodMonth)) {
        return sendApiError(res, 400, "RENT_INVOICE_PERIOD_MONTH", "periodMonth must be YYYY-MM (required for GST / TDS FY logic).");
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

      // Apply latest rent revision override for the referenced allotment (if any).
      const allotmentId = String(body.allotmentId ?? "");
      if (allotmentId) {
        const [rev] = await db
          .select()
          .from(rentRevisionOverrides)
          .where(
            and(
              eq(rentRevisionOverrides.allotmentId, allotmentId),
              lte(rentRevisionOverrides.effectiveMonth, periodMonth),
              or(eq(rentRevisionOverrides.status, "Approved"), isNull(rentRevisionOverrides.status)),
            ),
          )
          .orderBy(desc(rentRevisionOverrides.effectiveMonth))
          .limit(1);
        if (rev?.rentAmount != null && Number.isFinite(Number(rev.rentAmount))) {
          rentAmount = Number(rev.rentAmount);
          if (gstExempt) {
            cgst = 0;
            sgst = 0;
          }
          totalAmount = rentAmount + nonGst.sum + cgst + sgst;
        }
      }
      await db.insert(rentInvoices).values({
        id,
        allotmentId,
        tenantLicenceId,
        assetId: String(body.assetId ?? ""),
        yardId,
        periodMonth,
        rentAmount,
        nonGstChargesJson: nonGst.json,
        cgst,
        sgst,
        totalAmount: gstExempt ? rentAmount + nonGst.sum : (Number.isFinite(totalAmount) && totalAmount > 0 ? totalAmount : rentAmount + nonGst.sum + cgst + sgst),
        tdsApplicable: tdsRes.tdsApplicable,
        tdsAmount: tdsRes.tdsAmount,
        status: "Draft",
        isGovtEntity,
        invoiceNo: body.invoiceNo ? String(body.invoiceNo) : null,
        doUser: req.user?.id ?? null,
        dvUser: null,
        daUser: null,
        generatedAt: null,
        approvedAt: null,
      });
      const [row] = await db.select().from(rentInvoices).where(eq(rentInvoices.id, id));
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
      const emRaw = req.query.effectiveMonth as string | undefined;
      const [all] = await db.select().from(assetAllotments).where(eq(assetAllotments.id, allotmentId)).limit(1);
      if (!all) return sendApiError(res, 404, "ALLOTMENT_NOT_FOUND", "Allotment not found");
      const [assetRow] = await db.select({ yardId: assets.yardId }).from(assets).where(eq(assets.id, all.assetId)).limit(1);
      if (!assetRow) return sendApiError(res, 404, "ASSET_NOT_FOUND", "Asset not found");
      const scopedIds = req.scopedLocationIds;
      if (scopedIds && scopedIds.length > 0 && !scopedIds.includes(assetRow.yardId)) {
        return sendApiError(res, 403, "RENT_CONTEXT_YARD_ACCESS_DENIED", "You do not have access to this yard");
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
      if (!isValidYearMonthYm(effectiveMonth)) {
        return sendApiError(res, 400, "RENT_REV_MONTH", "effectiveMonth must be YYYY-MM");
      }
      const [all] = await db.select().from(assetAllotments).where(eq(assetAllotments.id, allotmentId)).limit(1);
      if (!all) return sendApiError(res, 404, "ALLOTMENT_NOT_FOUND", "Allotment not found");
      const [assetRow] = await db.select({ yardId: assets.yardId }).from(assets).where(eq(assets.id, all.assetId)).limit(1);
      if (!assetRow) return sendApiError(res, 404, "ASSET_NOT_FOUND", "Asset not found");
      const scopedIds = req.scopedLocationIds;
      if (scopedIds && scopedIds.length > 0 && !scopedIds.includes(assetRow.yardId)) {
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
      const [all] = await db.select().from(assetAllotments).where(eq(assetAllotments.id, existing.allotmentId)).limit(1);
      if (!all) return sendApiError(res, 404, "ALLOTMENT_NOT_FOUND", "Allotment not found");
      const [assetRow] = await db.select({ yardId: assets.yardId }).from(assets).where(eq(assets.id, all.assetId)).limit(1);
      if (!assetRow) return sendApiError(res, 404, "ASSET_NOT_FOUND", "Asset not found");
      const scopedIds = req.scopedLocationIds;
      if (scopedIds && scopedIds.length > 0 && !scopedIds.includes(assetRow.yardId)) {
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
      const [all] = await db.select().from(assetAllotments).where(eq(assetAllotments.id, existing.allotmentId)).limit(1);
      if (!all) return sendApiError(res, 404, "ALLOTMENT_NOT_FOUND", "Allotment not found");
      const [assetRow] = await db.select({ yardId: assets.yardId }).from(assets).where(eq(assets.id, all.assetId)).limit(1);
      if (!assetRow) return sendApiError(res, 404, "ASSET_NOT_FOUND", "Asset not found");
      const scopedIds = req.scopedLocationIds;
      if (scopedIds && scopedIds.length > 0 && !scopedIds.includes(assetRow.yardId)) {
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
      const nonGstLines = parseNonGstCharges(
        (updates.nonGstChargesJson as unknown) != null
          ? JSON.parse(String(updates.nonGstChargesJson ?? "null"))
          : (existing.nonGstChargesJson ? JSON.parse(String(existing.nonGstChargesJson)) : null),
      );
      const nonGstSum = nonGstLines.ok ? nonGstLines.sum : 0;
      if (existing.status === "Draft" && !statusChange && finalTenant) {
        if (await tenantLicenceIsGstExempt(finalTenant)) {
          updates.cgst = 0;
          updates.sgst = 0;
          updates.totalAmount = finalRent + nonGstSum;
          updates.isGovtEntity = true;
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

          const created = await createIomsReceipt({
            yardId: row.yardId,
            revenueHead,
            payerName: row.tenantLicenceId,
            payerType: "TenantLicence",
            payerRefId: row.tenantLicenceId,
            amount: Number(row.rentAmount ?? 0) + Number(nonGstSum || 0),
            cgst: row.cgst,
            sgst: row.sgst,
            tdsAmount: Number(row.tdsAmount ?? 0) || 0,
            paymentMode: "Cash",
            sourceModule: "M-03",
            sourceRecordId: row.id,
            unifiedEntityId: unifiedEntityIdFromTrackA(row.tenantLicenceId),
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
              await recordRentCollectionForM03Receipt(paidRow);
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
        if (!parsed || parsed.kind !== "TA") {
          return sendApiError(res, 400, "LEDGER_UNIFIED_ID", "unifiedEntityId must be TA:<trader_licence_id>");
        }
        tid = parsed.refId;
      }
      if (!tid) {
        return sendApiError(res, 400, "LEDGER_TENANT_REQUIRED", "tenantLicenceId or unifiedEntityId (TA:) is required");
      }
      const [lic] = await db.select().from(traderLicences).where(eq(traderLicences.id, tid)).limit(1);
      if (!lic) return sendApiError(res, 404, "LICENCE_NOT_FOUND", "Licence not found");
      const scopedIds = (req as Request & { scopedLocationIds?: string[] }).scopedLocationIds;
      if (scopedIds && scopedIds.length > 0 && !scopedIds.includes(lic.yardId)) {
        return sendApiError(res, 404, "LICENCE_NOT_FOUND", "Licence not found");
      }
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
      let list = await db.select().from(rentDepositLedger).orderBy(desc(rentDepositLedger.entryDate));
      if (unifiedRaw) {
        const parsed = parseUnifiedEntityId(unifiedRaw);
        if (!parsed) {
          return sendApiError(res, 400, "LEDGER_UNIFIED_ID", "unifiedEntityId must be TA:<id> | TB:<id> | AH:<id>");
        }
        if (parsed.kind !== "TA") {
          return sendApiError(
            res,
            400,
            "LEDGER_UNIFIED_TRACK",
            "Rent deposit ledger is Track A (tenant licence) scoped — use unifiedEntityId TA:<trader_licence_id>.",
          );
        }
        list = list.filter((r) => r.tenantLicenceId === parsed.refId);
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
      });
      const [row] = await db.select().from(rentDepositLedger).where(eq(rentDepositLedger.id, id));
      if (row) writeAuditLog(req, { module: "Rent/Tax", action: "Create", recordId: id, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create ledger entry");
    }
  });

  // ----- GSTR-1 export (outward supplies JSON for GSTN) -----
  app.get("/api/ioms/rent/gstr1", async (req, res) => {
    try {
      const fromMonth = (req.query.fromMonth as string) || "";
      const toMonth = (req.query.toMonth as string) || "";
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
      const tenantIds = Array.from(new Set(list.map((r) => r.tenantLicenceId)));
      const tenantRows =
        tenantIds.length > 0
          ? await db
              .select({
                id: traderLicences.id,
                gstin: traderLicences.gstin,
                isNonGstEntity: traderLicences.isNonGstEntity,
              })
              .from(traderLicences)
              .where(inArray(traderLicences.id, tenantIds))
          : [];
      const tenantById = new Map(tenantRows.map((t) => [t.id, t]));
      const gstin = process.env.GSTIN?.trim() || null;
      const supplies = list.map((r) => {
        const tl = tenantById.get(r.tenantLicenceId);
        const rawGstin = tl?.gstin != null && String(tl.gstin).trim() ? String(tl.gstin).trim() : null;
        return {
          invoiceNo: r.invoiceNo ?? r.id,
          periodMonth: r.periodMonth,
          tenantLicenceId: r.tenantLicenceId,
          counterpartyGstin: rawGstin,
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
      if (inv.status !== "Approved") {
        return sendApiError(
          res,
          400,
          "RENT_CREDIT_NOTE_INVOICE_NOT_APPROVED",
          "Credit note only for approved invoices",
        );
      }
      const scopedIds = req.scopedLocationIds;
      if (scopedIds && scopedIds.length > 0 && !scopedIds.includes(inv.yardId)) {
        return sendApiError(res, 404, "RENT_INVOICE_NOT_FOUND", "Rent invoice not found");
      }
      const id = nanoid();
      await db.insert(creditNotes).values({
        id,
        creditNoteNo: String(body.creditNoteNo ?? ""),
        invoiceId,
        reason: String(body.reason ?? ""),
        amount: Number(body.amount ?? 0),
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
      if (inv.status !== "Approved") {
        return sendApiError(
          res,
          400,
          "RENT_CREDIT_NOTE_INVOICE_NOT_APPROVED",
          "Credit note only for approved invoices",
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
