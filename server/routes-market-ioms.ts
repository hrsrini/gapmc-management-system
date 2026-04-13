/**
 * IOMS M-04: Market Fee & Commodities API routes.
 * Tables: commodities, market_fee_rates, farmers, purchase_transactions,
 * check_post_inward, check_post_inward_commodities, check_post_outward, exit_permits, check_post_bank_deposits.
 * Does not touch existing gapmc.market_fees (live table).
 */
import type { Express, Response } from "express";
import { eq, desc, and, or, inArray, sql } from "drizzle-orm";
import { db } from "./db";
import {
  commodities,
  marketFeeRates,
  farmers,
  purchaseTransactions,
  checkPostInward,
  checkPostInwardCommodities,
  checkPostOutward,
  exitPermits,
  checkPostBankDeposits,
  traderLicences,
  iomsReceipts,
} from "@shared/db-schema";
import { nanoid } from "nanoid";
import {
  canCreatePurchaseTransaction,
  canEditDraftPurchaseTransaction,
  canTransitionPurchaseTransaction,
  canVerifyCheckPostInward,
  assertSegregationDoDvDa,
} from "./workflow";
import { writeAuditLog } from "./audit";
import { sendApiError } from "./api-errors";
import { HrEmployeeRuleError, normalizeAadhaarMasked, normalizeMobile10 } from "./hr-employee-rules";
import { validateDvReturnToDraft } from "@shared/workflow-rejection";
import { createIomsReceipt } from "./routes-receipts-ioms";
import { getMergedSystemConfig, parseSystemConfigNumber } from "./system-config";

function sendHrRule(res: Response, e: unknown): boolean {
  if (e instanceof HrEmployeeRuleError) {
    sendApiError(res, 400, e.code, e.message);
    return true;
  }
  return false;
}

export function registerMarketIomsRoutes(app: Express) {
  const isScopedCheckPost = (req: { scopedLocationIds?: string[] }, checkPostId: string) => {
    const scopedIds = req.scopedLocationIds;
    if (!checkPostId) return false;
    if (!scopedIds || scopedIds.length === 0) return true;
    return scopedIds.includes(checkPostId);
  };

  const isValidStatus = (value: string, allowed: string[]) => allowed.includes(value);

  // ----- Commodities -----
  app.get("/api/ioms/commodities", async (_req, res) => {
    try {
      const list = await db.select().from(commodities).orderBy(commodities.name);
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch commodities");
    }
  });

  app.post("/api/ioms/commodities", async (req, res) => {
    try {
      const body = req.body;
      const id = nanoid();
      await db.insert(commodities).values({
        id,
        name: String(body.name ?? ""),
        variety: body.variety ? String(body.variety) : null,
        unit: body.unit ? String(body.unit) : null,
        gradeType: body.gradeType ? String(body.gradeType) : null,
        isActive: body.isActive !== undefined ? Boolean(body.isActive) : true,
      });
      const [row] = await db.select().from(commodities).where(eq(commodities.id, id));
      if (row) writeAuditLog(req, { module: "Market", action: "Create", recordId: id, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create commodity");
    }
  });

  app.put("/api/ioms/commodities/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const [existingCommodity] = await db.select().from(commodities).where(eq(commodities.id, id)).limit(1);
      if (!existingCommodity) return sendApiError(res, 404, "IOMS_COMMODITY_NOT_FOUND", "Not found");
      const body = req.body;
      const updates: Record<string, unknown> = {};
      ["name", "variety", "unit", "gradeType", "isActive"].forEach((k) => {
        if (body[k] === undefined) return;
        if (k === "isActive") updates.isActive = Boolean(body.isActive);
        else updates[k] = body[k] == null ? null : String(body[k]);
      });
      await db.update(commodities).set(updates as Record<string, string | boolean | null>).where(eq(commodities.id, id));
      const [row] = await db.select().from(commodities).where(eq(commodities.id, id));
      if (!row) return sendApiError(res, 404, "IOMS_COMMODITY_NOT_FOUND", "Not found");
      writeAuditLog(req, { module: "Market", action: "Update", recordId: id, beforeValue: existingCommodity, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to update commodity");
    }
  });

  // ----- Market fee rates (scoped by user yards; null yardId = global) -----
  app.get("/api/ioms/market/fee-rates", async (req, res) => {
    try {
      const yardId = req.query.yardId as string | undefined;
      const conditions = [];
      const scopedIds = req.scopedLocationIds;
      if (scopedIds && scopedIds.length > 0) {
        conditions.push(or(sql`${marketFeeRates.yardId} IS NULL`, inArray(marketFeeRates.yardId, scopedIds)));
      }
      if (yardId) conditions.push(eq(marketFeeRates.yardId, yardId));
      const base = db.select().from(marketFeeRates).orderBy(desc(marketFeeRates.validTo));
      const list = conditions.length > 0 ? await base.where(and(...conditions)) : await base;
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch fee rates");
    }
  });

  app.post("/api/ioms/market/fee-rates", async (req, res) => {
    try {
      const body = req.body;
      const yardId = body.yardId ? String(body.yardId) : null;
      const scopedIds = req.scopedLocationIds;
      if (yardId && scopedIds && scopedIds.length > 0 && !scopedIds.includes(yardId)) {
        return sendApiError(res, 403, "IOMS_MARKET_YARD_ACCESS_DENIED", "You do not have access to this yard");
      }
      const sys = await getMergedSystemConfig();
      const defaultPct = parseSystemConfigNumber(sys, "market_fee_percent");
      const id = nanoid();
      await db.insert(marketFeeRates).values({
        id,
        commodityId: String(body.commodityId ?? ""),
        validFrom: String(body.validFrom ?? ""),
        validTo: String(body.validTo ?? ""),
        feePercent: body.feePercent != null && body.feePercent !== "" ? Number(body.feePercent) : defaultPct,
        yardId,
      });
      const [row] = await db.select().from(marketFeeRates).where(eq(marketFeeRates.id, id));
      if (row) writeAuditLog(req, { module: "Market", action: "Create", recordId: id, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create fee rate");
    }
  });

  // ----- Farmers (scoped by user yards) -----
  app.get("/api/ioms/farmers", async (req, res) => {
    try {
      const yardId = req.query.yardId as string | undefined;
      const conditions = [];
      const scopedIds = req.scopedLocationIds;
      if (scopedIds && scopedIds.length > 0) conditions.push(inArray(farmers.yardId, scopedIds));
      if (yardId) conditions.push(eq(farmers.yardId, yardId));
      const base = db.select().from(farmers).orderBy(farmers.name);
      const list = conditions.length > 0 ? await base.where(and(...conditions)) : await base;
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch farmers");
    }
  });

  app.post("/api/ioms/farmers", async (req, res) => {
    try {
      const body = req.body;
      const yardId = String(body.yardId ?? "");
      const scopedIds = req.scopedLocationIds;
      if (scopedIds && scopedIds.length > 0 && !scopedIds.includes(yardId)) {
        return sendApiError(res, 403, "IOMS_MARKET_YARD_ACCESS_DENIED", "You do not have access to this yard");
      }
      let aadhaarNorm: string | null;
      let mobileNorm: string | null;
      try {
        aadhaarNorm = normalizeAadhaarMasked(body.aadhaarToken ?? null);
        mobileNorm = normalizeMobile10(body.mobile ?? null);
      } catch (e) {
        if (sendHrRule(res, e)) return;
        throw e;
      }
      const id = nanoid();
      await db.insert(farmers).values({
        id,
        name: String(body.name ?? ""),
        yardId,
        krishiCardNo: body.krishiCardNo ? String(body.krishiCardNo) : null,
        village: body.village ? String(body.village) : null,
        taluk: body.taluk ? String(body.taluk) : null,
        district: body.district ? String(body.district) : null,
        mobile: mobileNorm,
        aadhaarToken: aadhaarNorm,
      });
      const [row] = await db.select().from(farmers).where(eq(farmers.id, id));
      if (row) writeAuditLog(req, { module: "Market", action: "Create", recordId: id, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create farmer");
    }
  });

  app.put("/api/ioms/farmers/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const [existing] = await db.select().from(farmers).where(eq(farmers.id, id)).limit(1);
      if (!existing) return sendApiError(res, 404, "IOMS_FARMER_NOT_FOUND", "Not found");
      const scopedIds = req.scopedLocationIds;
      if (scopedIds && scopedIds.length > 0 && !scopedIds.includes(existing.yardId)) {
        return sendApiError(res, 404, "IOMS_FARMER_NOT_FOUND", "Not found");
      }
      const body = req.body;
      const updates: Record<string, unknown> = {};
      ["name", "yardId", "krishiCardNo", "village", "taluk", "district"].forEach((k) => {
        if (body[k] !== undefined) updates[k] = body[k] == null ? null : String(body[k]);
      });
      if (body.mobile !== undefined) {
        try {
          updates.mobile = normalizeMobile10(
            body.mobile == null || String(body.mobile).trim() === "" ? null : String(body.mobile),
          );
        } catch (e) {
          if (sendHrRule(res, e)) return;
          throw e;
        }
      }
      if (body.aadhaarToken !== undefined) {
        try {
          updates.aadhaarToken = normalizeAadhaarMasked(
            body.aadhaarToken == null || String(body.aadhaarToken).trim() === ""
              ? null
              : String(body.aadhaarToken),
          );
        } catch (e) {
          if (sendHrRule(res, e)) return;
          throw e;
        }
      }
      if (updates.yardId && scopedIds && scopedIds.length > 0 && !scopedIds.includes(updates.yardId as string)) {
        return sendApiError(res, 403, "IOMS_MARKET_YARD_ACCESS_DENIED", "You do not have access to this yard");
      }
      await db.update(farmers).set(updates as Record<string, string | null>).where(eq(farmers.id, id));
      const [row] = await db.select().from(farmers).where(eq(farmers.id, id));
      if (!row) return sendApiError(res, 404, "IOMS_FARMER_NOT_FOUND", "Not found");
      writeAuditLog(req, { module: "Market", action: "Update", recordId: id, beforeValue: existing, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to update farmer");
    }
  });

  // ----- Purchase transactions (scoped by user yards) -----
  app.get("/api/ioms/market/transactions", async (req, res) => {
    try {
      const yardId = req.query.yardId as string | undefined;
      const status = req.query.status as string | undefined;
      const conditions = [];
      const scopedIds = req.scopedLocationIds;
      if (scopedIds && scopedIds.length > 0) conditions.push(inArray(purchaseTransactions.yardId, scopedIds));
      if (yardId) conditions.push(eq(purchaseTransactions.yardId, yardId));
      if (status) conditions.push(eq(purchaseTransactions.status, status));
      const parentTransactionId = req.query.parentTransactionId as string | undefined;
      if (parentTransactionId) conditions.push(eq(purchaseTransactions.parentTransactionId, parentTransactionId));
      const base = db.select().from(purchaseTransactions).orderBy(desc(purchaseTransactions.transactionDate));
      const list = conditions.length > 0 ? await base.where(and(...conditions)) : await base;
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch transactions");
    }
  });

  app.post("/api/ioms/market/transactions", async (req, res) => {
    try {
      if (!canCreatePurchaseTransaction(req.user)) {
        return sendApiError(
          res,
          403,
          "PURCHASE_TX_CREATE_DENIED",
          "Only Data Originator or Admin can create purchase transactions",
        );
      }
      const body = req.body;
      const parentTransactionId = body.parentTransactionId ? String(body.parentTransactionId) : null;
      if (parentTransactionId) {
        const [parent] = await db
          .select()
          .from(purchaseTransactions)
          .where(eq(purchaseTransactions.id, parentTransactionId))
          .limit(1);
        if (!parent) {
          return sendApiError(res, 404, "PURCHASE_TX_PARENT_NOT_FOUND", "Original transaction not found");
        }
        if (parent.status !== "Approved") {
          return sendApiError(
            res,
            400,
            "PURCHASE_TX_ADJUSTMENT_PARENT_NOT_APPROVED",
            "Adjusted return must reference an Approved purchase",
          );
        }
        const scopedIds = req.scopedLocationIds;
        if (scopedIds && scopedIds.length > 0 && !scopedIds.includes(parent.yardId)) {
          return sendApiError(res, 403, "PURCHASE_TX_YARD_ACCESS_DENIED", "You do not have access to this yard");
        }
        const marketFeeAmount = Number(body.marketFeeAmount ?? 0);
        if (Number.isNaN(marketFeeAmount) || marketFeeAmount >= 0) {
          return sendApiError(
            res,
            400,
            "PURCHASE_TX_ADJUSTMENT_FEE_NEGATIVE",
            "Adjustment requires negative marketFeeAmount (market fee credit)",
          );
        }
        const declaredValue = Number(body.declaredValue ?? 0);
        if (Number.isNaN(declaredValue) || declaredValue < 0) {
          return sendApiError(
            res,
            400,
            "PURCHASE_TX_DECLARED_VALUE_INVALID",
            "declaredValue must be a non-negative number",
          );
        }
        const quantity = Number(body.quantity ?? parent.quantity);
        if (Number.isNaN(quantity) || quantity <= 0) {
          return sendApiError(res, 400, "PURCHASE_TX_QUANTITY_INVALID", "quantity must be greater than 0");
        }
        const id = nanoid();
        await db.insert(purchaseTransactions).values({
          id,
          yardId: parent.yardId,
          commodityId: parent.commodityId,
          traderLicenceId: parent.traderLicenceId,
          quantity,
          unit: String(body.unit ?? parent.unit),
          weight: body.weight != null ? Number(body.weight) : parent.weight,
          declaredValue,
          marketFeePercent: Number(body.marketFeePercent ?? parent.marketFeePercent),
          marketFeeAmount,
          purchaseType: String(body.purchaseType ?? parent.purchaseType),
          grade: body.grade != null ? String(body.grade) : parent.grade,
          transactionDate: String(body.transactionDate ?? new Date().toISOString().slice(0, 10)),
          status: "Draft",
          farmerId: body.farmerId != null ? String(body.farmerId) : parent.farmerId,
          receiptId: null,
          doUser: req.user?.id ?? null,
          dvUser: null,
          daUser: null,
          parentTransactionId,
          entryKind: "Adjustment",
        });
        const [row] = await db.select().from(purchaseTransactions).where(eq(purchaseTransactions.id, id));
        if (row) {
          writeAuditLog(req, { module: "Market", action: "CreateAdjustment", recordId: id, afterValue: row }).catch((e) =>
            console.error("Audit log failed:", e),
          );
        }
        return res.status(201).json(row);
      }

      const yardId = String(body.yardId ?? "");
      const commodityId = String(body.commodityId ?? "");
      const traderLicenceId = String(body.traderLicenceId ?? "");
      const quantity = Number(body.quantity ?? 0);
      const declaredValue = Number(body.declaredValue ?? 0);
      const marketFeePercent = Number(body.marketFeePercent ?? 0);
      const computedMarketFeeAmount = Number(((declaredValue * marketFeePercent) / 100).toFixed(2));
      const marketFeeAmount = body.marketFeeAmount != null ? Number(body.marketFeeAmount) : computedMarketFeeAmount;
      const transactionDate = String(body.transactionDate ?? "");
      const unit = String(body.unit ?? "");
      const purchaseType = String(body.purchaseType ?? "");
      const weight = body.weight != null ? Number(body.weight) : null;

      if (!yardId || !commodityId || !traderLicenceId || !transactionDate || !unit || !purchaseType) {
        return sendApiError(
          res,
          400,
          "PURCHASE_TX_FIELDS_REQUIRED",
          "yardId, commodityId, traderLicenceId, transactionDate, unit and purchaseType are required",
        );
      }
      if (Number.isNaN(quantity) || quantity <= 0) {
        return sendApiError(res, 400, "PURCHASE_TX_QUANTITY_INVALID", "quantity must be greater than 0");
      }
      if (Number.isNaN(declaredValue) || declaredValue < 0) {
        return sendApiError(
          res,
          400,
          "PURCHASE_TX_DECLARED_VALUE_INVALID",
          "declaredValue must be a non-negative number",
        );
      }
      if (Number.isNaN(marketFeePercent) || marketFeePercent < 0 || marketFeePercent > 100) {
        return sendApiError(
          res,
          400,
          "PURCHASE_TX_MARKET_FEE_PERCENT_INVALID",
          "marketFeePercent must be between 0 and 100",
        );
      }
      if (Number.isNaN(marketFeeAmount) || marketFeeAmount < 0) {
        return sendApiError(
          res,
          400,
          "PURCHASE_TX_MARKET_FEE_AMOUNT_INVALID",
          "marketFeeAmount must be a non-negative number",
        );
      }
      if (weight != null && (Number.isNaN(weight) || weight < 0)) {
        return sendApiError(res, 400, "PURCHASE_TX_WEIGHT_INVALID", "weight must be a non-negative number");
      }

      const scopedIds = req.scopedLocationIds;
      if (scopedIds && scopedIds.length > 0 && !scopedIds.includes(yardId)) {
        return sendApiError(res, 403, "PURCHASE_TX_YARD_ACCESS_DENIED", "You do not have access to this yard");
      }
      const [commodity] = await db.select({ id: commodities.id }).from(commodities).where(eq(commodities.id, commodityId)).limit(1);
      if (!commodity) return sendApiError(res, 404, "PURCHASE_TX_COMMODITY_NOT_FOUND", "Commodity not found");
      const [licence] = await db
        .select({ id: traderLicences.id, yardId: traderLicences.yardId, status: traderLicences.status })
        .from(traderLicences)
        .where(eq(traderLicences.id, traderLicenceId))
        .limit(1);
      if (!licence) return sendApiError(res, 404, "PURCHASE_TX_LICENCE_NOT_FOUND", "Trader licence not found");
      if (licence.yardId && licence.yardId !== yardId) {
        return sendApiError(
          res,
          400,
          "PURCHASE_TX_LICENCE_YARD_MISMATCH",
          "Trader licence belongs to a different yard",
        );
      }

      const id = nanoid();
      await db.insert(purchaseTransactions).values({
        id,
        yardId,
        commodityId,
        traderLicenceId,
        quantity,
        unit,
        declaredValue,
        marketFeePercent,
        marketFeeAmount,
        purchaseType,
        transactionDate,
        status: "Draft",
        farmerId: body.farmerId ? String(body.farmerId) : null,
        weight,
        grade: body.grade ? String(body.grade) : null,
        receiptId: body.receiptId ? String(body.receiptId) : null,
        doUser: req.user?.id ?? null,
        dvUser: null,
        daUser: null,
        parentTransactionId: null,
        entryKind: "Original",
      });
      const [row] = await db.select().from(purchaseTransactions).where(eq(purchaseTransactions.id, id));
      if (row) {
        writeAuditLog(req, { module: "Market", action: "Create", recordId: id, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      }
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create transaction");
    }
  });

  app.put("/api/ioms/market/transactions/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const [existing] = await db.select().from(purchaseTransactions).where(eq(purchaseTransactions.id, id));
      if (!existing) {
        return sendApiError(res, 404, "PURCHASE_TX_NOT_FOUND", "Purchase transaction not found");
      }
      const scopedIds = req.scopedLocationIds;
      if (scopedIds && scopedIds.length > 0 && !scopedIds.includes(existing.yardId)) {
        return sendApiError(res, 404, "PURCHASE_TX_NOT_FOUND", "Purchase transaction not found");
      }
      const body = req.body;
      const newStatus = body.status !== undefined ? String(body.status) : existing.status;
      const statusChange = newStatus !== existing.status;
      const transition = statusChange ? canTransitionPurchaseTransaction(req.user, existing.status, newStatus) : null;

      let dvReturnRemarks: string | null = null;
      if (statusChange) {
        if (!transition?.allowed) {
          return sendApiError(
            res,
            403,
            "PURCHASE_TX_STATUS_TRANSITION_DENIED",
            `You cannot change status from ${existing.status} to ${newStatus}. Only DV can verify; only DA can approve.`,
          );
        }
        const seg = assertSegregationDoDvDa(req.user, existing, {
          setDvUser: transition?.setDvUser,
          setDaUser: transition?.setDaUser,
        });
        if (!seg.ok) {
          return sendApiError(res, 403, "PURCHASE_TX_DO_DV_DA_SEGREGATION", seg.error);
        }
        if (existing.status === "Verified" && newStatus === "Draft") {
          const ret = validateDvReturnToDraft(body as Record<string, unknown>);
          if (!ret.ok) return sendApiError(res, 400, "PURCHASE_TX_DV_RETURN_INVALID", ret.error);
          dvReturnRemarks = ret.remarks;
        }
      } else if (existing.status === "Draft" && !canEditDraftPurchaseTransaction(req.user)) {
        return sendApiError(
          res,
          403,
          "PURCHASE_TX_DRAFT_EDIT_DENIED",
          "Only Data Originator or Admin can edit draft transactions",
        );
      }

      const updates: Record<string, unknown> = {};
      ["transactionNo", "yardId", "commodityId", "farmerId", "traderLicenceId", "quantity", "unit", "weight", "declaredValue", "marketFeePercent", "marketFeeAmount", "purchaseType", "grade", "transactionDate", "status", "receiptId", "doUser", "dvUser", "daUser"].forEach((k) => {
        if (body[k] === undefined) return;
        if (["quantity", "weight", "declaredValue", "marketFeePercent", "marketFeeAmount"].includes(k)) updates[k] = Number(body[k]);
        else updates[k] = body[k] == null ? null : String(body[k]);
      });
      if (updates.yardId && scopedIds && scopedIds.length > 0 && !scopedIds.includes(String(updates.yardId))) {
        return sendApiError(res, 403, "PURCHASE_TX_YARD_ACCESS_DENIED", "You do not have access to this yard");
      }
      if (updates.quantity != null && (Number.isNaN(Number(updates.quantity)) || Number(updates.quantity) <= 0)) {
        return sendApiError(res, 400, "PURCHASE_TX_QUANTITY_INVALID", "quantity must be greater than 0");
      }
      if (updates.declaredValue != null && (Number.isNaN(Number(updates.declaredValue)) || Number(updates.declaredValue) < 0)) {
        return sendApiError(
          res,
          400,
          "PURCHASE_TX_DECLARED_VALUE_INVALID",
          "declaredValue must be a non-negative number",
        );
      }
      if (
        updates.marketFeePercent != null &&
        (Number.isNaN(Number(updates.marketFeePercent)) ||
          Number(updates.marketFeePercent) < 0 ||
          Number(updates.marketFeePercent) > 100)
      ) {
        return sendApiError(
          res,
          400,
          "PURCHASE_TX_MARKET_FEE_PERCENT_INVALID",
          "marketFeePercent must be between 0 and 100",
        );
      }
      if (updates.marketFeeAmount != null && (Number.isNaN(Number(updates.marketFeeAmount)) || Number(updates.marketFeeAmount) < 0)) {
        return sendApiError(
          res,
          400,
          "PURCHASE_TX_MARKET_FEE_AMOUNT_INVALID",
          "marketFeeAmount must be a non-negative number",
        );
      }
      if (updates.weight != null && (Number.isNaN(Number(updates.weight)) || Number(updates.weight) < 0)) {
        return sendApiError(res, 400, "PURCHASE_TX_WEIGHT_INVALID", "weight must be a non-negative number");
      }
      if (transition?.setDvUser) updates.dvUser = req.user?.id ?? null;
      if (transition?.setDaUser) updates.daUser = req.user?.id ?? null;
      if (dvReturnRemarks !== null) {
        updates.dvReturnRemarks = dvReturnRemarks;
        updates.workflowRevisionCount = Number(existing.workflowRevisionCount ?? 0) + 1;
      }

      await db.update(purchaseTransactions).set(updates as Record<string, string | number | null>).where(eq(purchaseTransactions.id, id));
      const [row] = await db.select().from(purchaseTransactions).where(eq(purchaseTransactions.id, id));
      if (!row) return sendApiError(res, 404, "PURCHASE_TX_NOT_FOUND", "Not found");
      let responseRow = row;

      // Phase-1 linkage: when a market purchase transaction is Approved,
      // ensure a MarketFee receipt exists and link it back.
      if (statusChange && newStatus === "Approved") {
        const shouldCreateReceipt =
          (responseRow.receiptId == null || responseRow.receiptId === "") &&
          responseRow.marketFeeAmount != null &&
          Number(responseRow.marketFeeAmount) >= 0;

        if (shouldCreateReceipt) {
          const [existingReceipt] = await db
            .select()
            .from(iomsReceipts)
            .where(and(eq(iomsReceipts.sourceModule, "M-04"), eq(iomsReceipts.sourceRecordId, responseRow.id)))
            .limit(1);

          let receiptRow = existingReceipt ?? null;
          if (!receiptRow) {
            const [licence] = await db
              .select()
              .from(traderLicences)
              .where(eq(traderLicences.id, responseRow.traderLicenceId))
              .limit(1);

            const createdBy = req.user?.id ?? "system";
            const created = await createIomsReceipt({
              yardId: responseRow.yardId,
              revenueHead: "MarketFee",
              payerName: licence?.firmName ?? responseRow.traderLicenceId,
              payerType: "TraderLicence",
              payerRefId: responseRow.traderLicenceId,
              amount: Number(responseRow.marketFeeAmount ?? 0),
              paymentMode: "Cash",
              sourceModule: "M-04",
              sourceRecordId: responseRow.id,
              createdBy,
            });

            const [createdRow] = await db
              .select()
              .from(iomsReceipts)
              .where(eq(iomsReceipts.id, created.id))
              .limit(1);

            receiptRow = createdRow ?? null;
            if (createdRow) {
              await writeAuditLog(req, {
                module: "Receipts",
                action: "Create",
                recordId: createdRow.id,
                afterValue: createdRow,
              }).catch((e) => console.error("Audit log failed:", e));
            }
          }

          if (receiptRow?.id) {
            await db
              .update(purchaseTransactions)
              .set({ receiptId: receiptRow.id })
              .where(eq(purchaseTransactions.id, responseRow.id));

            const [updated] = await db
              .select()
              .from(purchaseTransactions)
              .where(eq(purchaseTransactions.id, responseRow.id))
              .limit(1);
            if (updated) responseRow = updated;
          }
        }
      }

      writeAuditLog(req, { module: "Market", action: "Update", recordId: id, beforeValue: existing, afterValue: responseRow }).catch((e) => console.error("Audit log failed:", e));
      res.json(responseRow);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to update purchase transaction");
    }
  });

  // ----- Check post inward -----
  app.get("/api/ioms/checkpost/inward", async (req, res) => {
    try {
      const checkPostId = req.query.checkPostId as string | undefined;
      const scopedIds = req.scopedLocationIds;
      const conditions = [];
      if (scopedIds && scopedIds.length > 0) conditions.push(inArray(checkPostInward.checkPostId, scopedIds));
      if (checkPostId) conditions.push(eq(checkPostInward.checkPostId, checkPostId));
      const base = db.select().from(checkPostInward).orderBy(desc(checkPostInward.entryDate));
      let list = conditions.length > 0 ? await base.where(and(...conditions)) : await base;
      if (checkPostId) list = list.filter((r) => r.checkPostId === checkPostId);
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch inward entries");
    }
  });

  app.post("/api/ioms/checkpost/inward", async (req, res) => {
    try {
      const body = req.body;
      const checkPostId = String(body.checkPostId ?? "");
      const transactionType = String(body.transactionType ?? "Permanent");
      const entryDate = String(body.entryDate ?? "");
      const status = String(body.status ?? "Draft");
      const totalCharges = body.totalCharges != null ? Number(body.totalCharges) : null;
      const isDvOrAdmin = Boolean(req.user?.roles?.some((r) => r.tier === "DV" || r.tier === "ADMIN"));

      if (!checkPostId || !entryDate) {
        return sendApiError(res, 400, "CHECKPOST_INWARD_FIELDS_REQUIRED", "checkPostId and entryDate are required");
      }
      if (!isScopedCheckPost(req, checkPostId)) {
        return sendApiError(res, 403, "CHECKPOST_ACCESS_DENIED", "You do not have access to this check post");
      }
      if (!isValidStatus(status, ["Draft", "Verified"])) {
        return sendApiError(res, 400, "CHECKPOST_INWARD_STATUS_INVALID", "Invalid status. Allowed: Draft, Verified");
      }
      if (status === "Verified" && !isDvOrAdmin) {
        return sendApiError(
          res,
          403,
          "CHECKPOST_INWARD_CREATE_VERIFY_DENIED",
          "Only DV or Admin can create inward entries as Verified",
        );
      }
      if (totalCharges != null && (Number.isNaN(totalCharges) || totalCharges < 0)) {
        return sendApiError(
          res,
          400,
          "CHECKPOST_INWARD_TOTAL_CHARGES_INVALID",
          "totalCharges must be a non-negative number",
        );
      }

      const id = nanoid();
      await db.insert(checkPostInward).values({
        id,
        checkPostId,
        transactionType,
        entryDate,
        status,
        traderLicenceId: body.traderLicenceId ? String(body.traderLicenceId) : null,
        invoiceNumber: body.invoiceNumber ? String(body.invoiceNumber) : null,
        vehicleNumber: body.vehicleNumber ? String(body.vehicleNumber) : null,
        fromFirm: body.fromFirm ? String(body.fromFirm) : null,
        toFirm: body.toFirm ? String(body.toFirm) : null,
        fromState: body.fromState ? String(body.fromState) : null,
        toState: body.toState ? String(body.toState) : null,
        totalCharges,
        encodedData: body.encodedData ? String(body.encodedData) : null,
        officerId: body.officerId ? String(body.officerId) : null,
      });
      const [row] = await db.select().from(checkPostInward).where(eq(checkPostInward.id, id));
      if (row) {
        writeAuditLog(req, { module: "CheckPost", action: "Create", recordId: id, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      }
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create inward entry");
    }
  });

  app.put("/api/ioms/checkpost/inward/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const [existing] = await db.select().from(checkPostInward).where(eq(checkPostInward.id, id));
      if (!existing) return sendApiError(res, 404, "CHECKPOST_INWARD_NOT_FOUND", "Check post inward entry not found");
      if (!isScopedCheckPost(req, existing.checkPostId)) {
        return sendApiError(res, 403, "CHECKPOST_ACCESS_DENIED", "You do not have access to this check post");
      }
      const body = req.body;
      const newStatus = body.status !== undefined ? String(body.status) : existing.status;
      if (!isValidStatus(newStatus, ["Draft", "Verified"])) {
        return sendApiError(res, 400, "CHECKPOST_INWARD_STATUS_INVALID", "Invalid status. Allowed: Draft, Verified");
      }
      if (existing.status === "Draft" && newStatus === "Verified") {
        if (!canVerifyCheckPostInward(req.user)) {
          return sendApiError(
            res,
            403,
            "CHECKPOST_INWARD_VERIFY_DENIED",
            "Only DV or Admin can verify check post inward entries.",
          );
        }
      }
      if (existing.status === "Verified" && newStatus !== "Verified") {
        return sendApiError(
          res,
          400,
          "CHECKPOST_INWARD_NO_REVERT_FROM_VERIFIED",
          "Verified inward entries cannot be moved back to Draft",
        );
      }

      // Once verified, core fields are immutable.
      if (existing.status === "Verified") {
        const forbiddenAfterVerify = [
          "checkPostId",
          "transactionType",
          "entryDate",
          "traderLicenceId",
          "invoiceNumber",
          "vehicleNumber",
          "fromFirm",
          "toFirm",
          "fromState",
          "toState",
          "totalCharges",
          "encodedData",
          "officerId",
        ];
        const tried = forbiddenAfterVerify.some((k) => body[k] !== undefined);
        if (tried) {
          return sendApiError(
            res,
            400,
            "CHECKPOST_INWARD_VERIFIED_IMMUTABLE",
            "Verified inward entries are immutable; only status metadata can be updated.",
          );
        }
      }

      const updates: Record<string, unknown> = {};
      ["checkPostId", "transactionType", "entryDate", "status", "traderLicenceId", "invoiceNumber", "vehicleNumber", "fromFirm", "toFirm", "fromState", "toState", "totalCharges", "encodedData", "officerId"].forEach((k) => {
        if (body[k] === undefined) return;
        if (k === "totalCharges") updates[k] = body[k] == null ? null : Number(body[k]);
        else updates[k] = body[k] == null ? null : String(body[k]);
      });
      if (updates.checkPostId && !isScopedCheckPost(req, String(updates.checkPostId))) {
        return sendApiError(res, 403, "CHECKPOST_ACCESS_DENIED", "You do not have access to this check post");
      }
      await db.update(checkPostInward).set(updates as Record<string, string | number | null>).where(eq(checkPostInward.id, id));
      const [row] = await db.select().from(checkPostInward).where(eq(checkPostInward.id, id));
      if (!row) return sendApiError(res, 404, "CHECKPOST_INWARD_NOT_FOUND", "Not found");
      writeAuditLog(req, { module: "CheckPost", action: "Update", recordId: id, beforeValue: existing, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to update check post inward");
    }
  });

  // ----- Check post inward commodities (line items) -----
  app.get("/api/ioms/checkpost/inward/:inwardId/commodities", async (req, res) => {
    try {
      const [inward] = await db.select().from(checkPostInward).where(eq(checkPostInward.id, req.params.inwardId)).limit(1);
      if (!inward) return sendApiError(res, 404, "CHECKPOST_INWARD_NOT_FOUND", "Inward entry not found");
      if (!isScopedCheckPost(req, inward.checkPostId)) {
        return sendApiError(res, 403, "CHECKPOST_ACCESS_DENIED", "You do not have access to this check post");
      }
      const list = await db.select().from(checkPostInwardCommodities).where(eq(checkPostInwardCommodities.inwardId, req.params.inwardId));
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch inward commodities");
    }
  });

  app.post("/api/ioms/checkpost/inward/:inwardId/commodities", async (req, res) => {
    try {
      const inwardId = req.params.inwardId;
      const body = req.body;
      const [inward] = await db.select().from(checkPostInward).where(eq(checkPostInward.id, inwardId)).limit(1);
      if (!inward) return sendApiError(res, 404, "CHECKPOST_INWARD_NOT_FOUND", "Inward entry not found");
      if (!isScopedCheckPost(req, inward.checkPostId)) {
        return sendApiError(res, 403, "CHECKPOST_ACCESS_DENIED", "You do not have access to this check post");
      }

      const commodityId = String(body.commodityId ?? "");
      const unit = String(body.unit ?? "");
      const quantity = Number(body.quantity ?? 0);
      const value = Number(body.value ?? 0);
      const marketFeePercent = body.marketFeePercent != null ? Number(body.marketFeePercent) : null;
      const marketFeeAmount = body.marketFeeAmount != null ? Number(body.marketFeeAmount) : null;

      if (!commodityId || !unit) {
        return sendApiError(res, 400, "CHECKPOST_LINE_COMMODITY_REQUIRED", "commodityId and unit are required");
      }
      if (Number.isNaN(quantity) || quantity <= 0) {
        return sendApiError(res, 400, "CHECKPOST_LINE_QUANTITY_INVALID", "quantity must be greater than 0");
      }
      if (Number.isNaN(value) || value < 0) {
        return sendApiError(res, 400, "CHECKPOST_LINE_VALUE_INVALID", "value must be a non-negative number");
      }
      if (marketFeePercent != null && (Number.isNaN(marketFeePercent) || marketFeePercent < 0 || marketFeePercent > 100)) {
        return sendApiError(
          res,
          400,
          "CHECKPOST_LINE_MARKET_FEE_PERCENT_INVALID",
          "marketFeePercent must be between 0 and 100",
        );
      }
      if (marketFeeAmount != null && (Number.isNaN(marketFeeAmount) || marketFeeAmount < 0)) {
        return sendApiError(
          res,
          400,
          "CHECKPOST_LINE_MARKET_FEE_AMOUNT_INVALID",
          "marketFeeAmount must be a non-negative number",
        );
      }

      const id = nanoid();
      await db.insert(checkPostInwardCommodities).values({
        id,
        inwardId,
        commodityId,
        unit,
        quantity,
        value,
        marketFeePercent,
        marketFeeAmount,
      });
      const [row] = await db.select().from(checkPostInwardCommodities).where(eq(checkPostInwardCommodities.id, id));
      if (row) {
        writeAuditLog(req, { module: "CheckPost", action: "Create", recordId: id, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      }
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create inward commodity");
    }
  });

  // ----- Check post outward -----
  app.get("/api/ioms/checkpost/outward", async (req, res) => {
    try {
      const checkPostId = req.query.checkPostId as string | undefined;
      const scopedIds = req.scopedLocationIds;
      const conditions = [];
      if (scopedIds && scopedIds.length > 0) conditions.push(inArray(checkPostOutward.checkPostId, scopedIds));
      if (checkPostId) conditions.push(eq(checkPostOutward.checkPostId, checkPostId));
      const base = db.select().from(checkPostOutward).orderBy(desc(checkPostOutward.entryDate));
      let list = conditions.length > 0 ? await base.where(and(...conditions)) : await base;
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch outward entries");
    }
  });

  app.post("/api/ioms/checkpost/outward", async (req, res) => {
    try {
      const body = req.body;
      const checkPostId = String(body.checkPostId ?? "");
      const inwardRefId = String(body.inwardRefId ?? "");
      const entryDate = String(body.entryDate ?? "");
      if (!checkPostId || !inwardRefId || !entryDate) {
        return sendApiError(
          res,
          400,
          "CHECKPOST_OUTWARD_FIELDS_REQUIRED",
          "checkPostId, inwardRefId and entryDate are required",
        );
      }
      if (!isScopedCheckPost(req, checkPostId)) {
        return sendApiError(res, 403, "CHECKPOST_ACCESS_DENIED", "You do not have access to this check post");
      }
      const id = nanoid();
      await db.insert(checkPostOutward).values({
        id,
        checkPostId,
        inwardRefId,
        entryDate,
        vehicleNumber: body.vehicleNumber ? String(body.vehicleNumber) : null,
        receiptNumber: body.receiptNumber ? String(body.receiptNumber) : null,
      });
      const [row] = await db.select().from(checkPostOutward).where(eq(checkPostOutward.id, id));
      if (row) {
        writeAuditLog(req, { module: "CheckPost", action: "Create", recordId: id, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      }
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create outward entry");
    }
  });

  app.put("/api/ioms/checkpost/outward/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const [existing] = await db.select().from(checkPostOutward).where(eq(checkPostOutward.id, id)).limit(1);
      if (!existing) return sendApiError(res, 404, "CHECKPOST_OUTWARD_NOT_FOUND", "Not found");
      if (!isScopedCheckPost(req, existing.checkPostId)) {
        return sendApiError(res, 403, "CHECKPOST_ACCESS_DENIED", "You do not have access to this check post");
      }
      const body = req.body;
      const updates: Record<string, unknown> = {};
      ["checkPostId", "inwardRefId", "entryDate", "vehicleNumber", "receiptNumber"].forEach((k) => {
        if (body[k] === undefined) return;
        updates[k] = body[k] == null ? null : String(body[k]);
      });
      if (updates.checkPostId && !isScopedCheckPost(req, String(updates.checkPostId))) {
        return sendApiError(res, 403, "CHECKPOST_ACCESS_DENIED", "You do not have access to this check post");
      }
      await db.update(checkPostOutward).set(updates as Record<string, string | null>).where(eq(checkPostOutward.id, id));
      const [row] = await db.select().from(checkPostOutward).where(eq(checkPostOutward.id, id));
      if (!row) return sendApiError(res, 404, "CHECKPOST_OUTWARD_NOT_FOUND", "Not found");
      writeAuditLog(req, { module: "CheckPost", action: "Update", recordId: id, beforeValue: existing, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to update outward entry");
    }
  });

  // ----- Exit permits -----
  app.get("/api/ioms/checkpost/exit-permits", async (req, res) => {
    try {
      const scopedIds = req.scopedLocationIds;
      const list = await db.select().from(exitPermits).orderBy(desc(exitPermits.issuedDate));
      if (!scopedIds || scopedIds.length === 0) {
        return res.json(list);
      }
      const inwardIds = Array.from(new Set(list.map((p) => p.inwardId)));
      if (inwardIds.length === 0) return res.json([]);
      const inwardRows = await db
        .select({ id: checkPostInward.id, checkPostId: checkPostInward.checkPostId })
        .from(checkPostInward)
        .where(inArray(checkPostInward.id, inwardIds));
      const allowedInwardIds = new Set(
        inwardRows.filter((r) => scopedIds.includes(r.checkPostId)).map((r) => r.id)
      );
      const scoped = list.filter((p) => allowedInwardIds.has(p.inwardId));
      res.json(scoped);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch exit permits");
    }
  });

  app.post("/api/ioms/checkpost/exit-permits", async (req, res) => {
    try {
      const body = req.body;
      const permitNo = String(body.permitNo ?? "");
      const inwardId = String(body.inwardId ?? "");
      const issuedDate = String(body.issuedDate ?? "");
      const officerId = String(body.officerId ?? "");
      if (!permitNo || !inwardId || !issuedDate || !officerId) {
        return sendApiError(
          res,
          400,
          "CHECKPOST_EXIT_PERMIT_FIELDS_REQUIRED",
          "permitNo, inwardId, issuedDate and officerId are required",
        );
      }
      const [inward] = await db.select().from(checkPostInward).where(eq(checkPostInward.id, inwardId)).limit(1);
      if (!inward) return sendApiError(res, 404, "CHECKPOST_INWARD_NOT_FOUND", "Inward entry not found");
      if (!isScopedCheckPost(req, inward.checkPostId)) {
        return sendApiError(res, 403, "CHECKPOST_ACCESS_DENIED", "You do not have access to this check post");
      }
      const id = nanoid();
      await db.insert(exitPermits).values({
        id,
        permitNo,
        inwardId,
        issuedDate,
        officerId,
      });
      const [row] = await db.select().from(exitPermits).where(eq(exitPermits.id, id));
      if (row) {
        writeAuditLog(req, { module: "CheckPost", action: "Create", recordId: id, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      }
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create exit permit");
    }
  });

  app.put("/api/ioms/checkpost/exit-permits/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const [existing] = await db.select().from(exitPermits).where(eq(exitPermits.id, id)).limit(1);
      if (!existing) return sendApiError(res, 404, "CHECKPOST_EXIT_PERMIT_NOT_FOUND", "Not found");
      const [existingInward] = await db.select().from(checkPostInward).where(eq(checkPostInward.id, existing.inwardId)).limit(1);
      if (existingInward && !isScopedCheckPost(req, existingInward.checkPostId)) {
        return sendApiError(res, 403, "CHECKPOST_ACCESS_DENIED", "You do not have access to this check post");
      }
      const body = req.body;
      const updates: Record<string, unknown> = {};
      ["permitNo", "inwardId", "issuedDate", "officerId"].forEach((k) => {
        if (body[k] === undefined) return;
        updates[k] = body[k] == null ? null : String(body[k]);
      });
      if (updates.inwardId) {
        const [newInward] = await db.select().from(checkPostInward).where(eq(checkPostInward.id, String(updates.inwardId))).limit(1);
        if (!newInward) return sendApiError(res, 404, "CHECKPOST_INWARD_NOT_FOUND", "Inward entry not found");
        if (!isScopedCheckPost(req, newInward.checkPostId)) {
          return sendApiError(res, 403, "CHECKPOST_ACCESS_DENIED", "You do not have access to this check post");
        }
      }
      await db.update(exitPermits).set(updates as Record<string, string | null>).where(eq(exitPermits.id, id));
      const [row] = await db.select().from(exitPermits).where(eq(exitPermits.id, id));
      if (!row) return sendApiError(res, 404, "CHECKPOST_EXIT_PERMIT_NOT_FOUND", "Not found");
      writeAuditLog(req, { module: "CheckPost", action: "Update", recordId: id, beforeValue: existing, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to update exit permit");
    }
  });

  // ----- Check post bank deposits -----
  app.get("/api/ioms/checkpost/bank-deposits", async (req, res) => {
    try {
      const checkPostId = req.query.checkPostId as string | undefined;
      const scopedIds = req.scopedLocationIds;
      const conditions = [];
      if (scopedIds && scopedIds.length > 0) conditions.push(inArray(checkPostBankDeposits.checkPostId, scopedIds));
      if (checkPostId) conditions.push(eq(checkPostBankDeposits.checkPostId, checkPostId));
      const base = db.select().from(checkPostBankDeposits).orderBy(desc(checkPostBankDeposits.depositDate));
      let list = conditions.length > 0 ? await base.where(and(...conditions)) : await base;
      res.json(list);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to fetch bank deposits");
    }
  });

  app.post("/api/ioms/checkpost/bank-deposits", async (req, res) => {
    try {
      const body = req.body;
      const checkPostId = String(body.checkPostId ?? "");
      const depositDate = String(body.depositDate ?? "");
      const bankName = String(body.bankName ?? "");
      const amount = Number(body.amount ?? 0);
      const status = String(body.status ?? "Recorded");
      const isDvOrAdmin = Boolean(req.user?.roles?.some((r) => r.tier === "DV" || r.tier === "ADMIN"));
      if (!checkPostId || !depositDate || !bankName) {
        return sendApiError(
          res,
          400,
          "CHECKPOST_DEPOSIT_FIELDS_REQUIRED",
          "checkPostId, depositDate and bankName are required",
        );
      }
      if (!isScopedCheckPost(req, checkPostId)) {
        return sendApiError(res, 403, "CHECKPOST_ACCESS_DENIED", "You do not have access to this check post");
      }
      if (Number.isNaN(amount) || amount <= 0) {
        return sendApiError(res, 400, "CHECKPOST_DEPOSIT_AMOUNT_POSITIVE", "amount must be greater than 0");
      }
      if (!isValidStatus(status, ["Recorded", "Verified"])) {
        return sendApiError(res, 400, "CHECKPOST_DEPOSIT_STATUS_INVALID", "Invalid status. Allowed: Recorded, Verified");
      }
      if (status === "Verified" && !isDvOrAdmin) {
        return sendApiError(
          res,
          403,
          "CHECKPOST_DEPOSIT_VERIFY_DENIED",
          "Only DV or Admin can mark bank deposits as Verified",
        );
      }
      const id = nanoid();
      await db.insert(checkPostBankDeposits).values({
        id,
        checkPostId,
        depositDate,
        bankName,
        amount,
        status,
        accountNumber: body.accountNumber ? String(body.accountNumber) : null,
        voucherDetails: body.voucherDetails ? String(body.voucherDetails) : null,
        narration: body.narration ? String(body.narration) : null,
        verifiedBy: status === "Verified" ? (req.user?.id ?? null) : (body.verifiedBy ? String(body.verifiedBy) : null),
      });
      const [row] = await db.select().from(checkPostBankDeposits).where(eq(checkPostBankDeposits.id, id));
      if (row) {
        writeAuditLog(req, { module: "CheckPost", action: "Create", recordId: id, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      }
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create bank deposit");
    }
  });

  app.put("/api/ioms/checkpost/bank-deposits/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const [existing] = await db.select().from(checkPostBankDeposits).where(eq(checkPostBankDeposits.id, id)).limit(1);
      if (!existing) return sendApiError(res, 404, "CHECKPOST_DEPOSIT_NOT_FOUND", "Not found");
      if (!isScopedCheckPost(req, existing.checkPostId)) {
        return sendApiError(res, 403, "CHECKPOST_ACCESS_DENIED", "You do not have access to this check post");
      }
      const body = req.body;
      const updates: Record<string, unknown> = {};
      ["checkPostId", "depositDate", "bankName", "status", "accountNumber", "voucherDetails", "narration", "verifiedBy"].forEach((k) => {
        if (body[k] !== undefined) updates[k] = body[k] == null ? null : String(body[k]);
      });
      if (body.amount !== undefined) updates.amount = body.amount == null ? null : Number(body.amount);
      const isDvOrAdmin = Boolean(req.user?.roles?.some((r) => r.tier === "DV" || r.tier === "ADMIN"));
      const newStatus = String((updates.status ?? existing.status) as string);

      // Once verified, deposit core fields become immutable.
      if (existing.status === "Verified") {
        const forbiddenAfterVerify = ["checkPostId", "depositDate", "bankName", "amount", "accountNumber", "voucherDetails", "narration"];
        const tried = forbiddenAfterVerify.some((k) => body[k] !== undefined);
        if (tried) {
          return sendApiError(
            res,
            400,
            "CHECKPOST_DEPOSIT_VERIFIED_IMMUTABLE",
            "Verified deposits are immutable; only status metadata can be updated.",
          );
        }
      }

      // Only DV/Admin can move Recorded -> Verified; do not allow downgrade.
      if (newStatus === "Verified" && existing.status !== "Verified" && !isDvOrAdmin) {
        return sendApiError(
          res,
          403,
          "CHECKPOST_DEPOSIT_VERIFY_DENIED",
          "Only DV or Admin can mark bank deposits as Verified",
        );
      }
      if (existing.status === "Verified" && newStatus !== "Verified") {
        return sendApiError(
          res,
          400,
          "CHECKPOST_DEPOSIT_NO_REVERT_FROM_VERIFIED",
          "Verified deposits cannot be moved back to Recorded",
        );
      }

      if (updates.checkPostId && !isScopedCheckPost(req, String(updates.checkPostId))) {
        return sendApiError(res, 403, "CHECKPOST_ACCESS_DENIED", "You do not have access to this check post");
      }
      if (updates.amount != null && (Number.isNaN(Number(updates.amount)) || Number(updates.amount) < 0)) {
        return sendApiError(res, 400, "CHECKPOST_DEPOSIT_AMOUNT_INVALID", "amount must be a non-negative number");
      }
      if (updates.status != null && !isValidStatus(String(updates.status), ["Recorded", "Verified"])) {
        return sendApiError(res, 400, "CHECKPOST_DEPOSIT_STATUS_INVALID", "Invalid status. Allowed: Recorded, Verified");
      }
      if (newStatus === "Verified") {
        updates.verifiedBy = req.user?.id ?? existing.verifiedBy ?? null;
      }
      await db.update(checkPostBankDeposits).set(updates as Record<string, string | number | null>).where(eq(checkPostBankDeposits.id, id));
      const [row] = await db.select().from(checkPostBankDeposits).where(eq(checkPostBankDeposits.id, id));
      if (!row) return sendApiError(res, 404, "CHECKPOST_DEPOSIT_NOT_FOUND", "Not found");
      writeAuditLog(req, { module: "CheckPost", action: "Update", recordId: id, beforeValue: existing, afterValue: row }).catch((e) => console.error("Audit log failed:", e));
      res.json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to update bank deposit");
    }
  });
}
