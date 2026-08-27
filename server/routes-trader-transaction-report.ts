/**
 * M-04 Trader Transaction Report + AI/IVR voice recording session APIs.
 */
import type { Express } from "express";
import { and, desc, eq, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  commodities,
  farmers,
  marketTransactionCommodities,
  marketTransactions,
  purchaseTransactions,
  systemConfig,
  traderLicences,
  traderVoiceSessions,
  type TraderVoiceSessionLine,
} from "@shared/db-schema";
import {
  TRADER_VOICE_SCENARIOS_CONFIG_KEY,
  TRADER_VOICE_SCENARIOS_DEFAULT,
  TRADER_VOICE_TRANSCRIPT_CONFIG_KEY,
  flattenVoiceTranscriptScenarios,
  mergeVoiceTranscriptScenarios,
  type VoiceTranscriptScenariosConfig,
} from "@shared/trader-voice-transcript-default";
import { db } from "./db";
import { sendApiError } from "./api-errors";
import { writeAuditLog } from "./audit";
import { hasPermission } from "./auth";
import { canCreatePurchaseTransaction } from "./workflow";
import { routeParamString } from "./route-params";
import { resolveMarketFeePercentForPurchase } from "./market-fee-resolve";
import { generateNextPurchaseTransactionNo, persistAllocatedTransactionNoIfMissing } from "./market-purchase-transaction-no";
import { resolvePurchaseTransactionTraderRef } from "./market-purchase-trader-resolve";

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function nowIso(): string {
  return new Date().toISOString();
}

function digitsOnly(v: string): string {
  return String(v ?? "").replace(/\D/g, "");
}

/** Report UI: Approved → Submitted; Draft/Verified → Pending (mockup labels). */
function reportStatusLabel(raw: string): "Submitted" | "Pending" {
  return raw === "Approved" ? "Submitted" : "Pending";
}

function sumLines(lines: TraderVoiceSessionLine[]): number {
  return Math.round(lines.reduce((s, l) => s + Number(l.totalValue || 0), 0) * 100) / 100;
}

async function resolveCommodityByName(name: string): Promise<{ id: string; name: string; unit: string | null } | null> {
  const q = name.trim();
  if (!q) return null;
  const [exact] = await db
    .select({ id: commodities.id, name: commodities.name, unit: commodities.unit })
    .from(commodities)
    .where(sql`lower(trim(${commodities.name})) = ${q.toLowerCase()}`)
    .limit(1);
  if (exact) return exact;
  const [fuzzy] = await db
    .select({ id: commodities.id, name: commodities.name, unit: commodities.unit })
    .from(commodities)
    .where(ilike(commodities.name, `%${q}%`))
    .limit(1);
  return fuzzy ?? null;
}

async function findOrCreateFarmer(params: {
  yardId: string;
  name: string;
  placeOfPurchase?: string;
}): Promise<string | null> {
  const name = params.name.trim();
  if (!name) return null;
  const [existing] = await db
    .select({ id: farmers.id })
    .from(farmers)
    .where(and(eq(farmers.yardId, params.yardId), sql`lower(trim(${farmers.name})) = ${name.toLowerCase()}`))
    .limit(1);
  if (existing) return existing.id;
  const id = nanoid();
  await db.insert(farmers).values({
    id,
    name,
    yardId: params.yardId,
    village: params.placeOfPurchase?.trim() || null,
  });
  return id;
}

export function registerTraderTransactionReportRoutes(app: Express) {
  console.log("[M-04] Trader transaction report + voice session routes registered");
  // ----- Trader Transaction Report -----
  app.get("/api/ioms/market/reports/trader-transactions", async (req, res) => {
    try {
      if (!req.user || !hasPermission(req.user, "M-04", "Read")) {
        return sendApiError(res, 403, "AUTH_PERMISSION_DENIED", "M-04 Read required", { required: "M-04:Read" });
      }

      const from = String(req.query.from ?? "").trim();
      const to = String(req.query.to ?? "").trim();
      const iso = /^\d{4}-\d{2}-\d{2}$/;
      if (!from || !iso.test(from) || !to || !iso.test(to)) {
        return sendApiError(res, 400, "REPORT_DATE_RANGE_REQUIRED", "from and to (YYYY-MM-DD) are required");
      }
      if (from > to) {
        return sendApiError(res, 400, "REPORT_DATE_RANGE_INVALID", "from must be on or before to");
      }

      const traderLicenceId = String(req.query.traderLicenceId ?? "").trim();
      const q = String(req.query.q ?? "").trim();
      const commodityId = String(req.query.commodityId ?? "").trim();
      const statusFilter = String(req.query.status ?? "all").trim(); // all | Submitted | Pending | Draft | Verified | Approved
      const format = String(req.query.format ?? "").trim().toLowerCase();

      const scopedIds = (req as Express.Request & { scopedLocationIds?: string[] }).scopedLocationIds;
      const conds = [gte(purchaseTransactions.transactionDate, from), lte(purchaseTransactions.transactionDate, to)];
      if (scopedIds && scopedIds.length > 0) conds.push(inArray(purchaseTransactions.yardId, scopedIds));
      if (traderLicenceId) conds.push(eq(purchaseTransactions.traderLicenceId, traderLicenceId));
      if (commodityId) conds.push(eq(purchaseTransactions.commodityId, commodityId));

      if (statusFilter && statusFilter !== "all") {
        if (statusFilter === "Submitted") conds.push(eq(purchaseTransactions.status, "Approved"));
        else if (statusFilter === "Pending") conds.push(inArray(purchaseTransactions.status, ["Draft", "Verified"]));
        else conds.push(eq(purchaseTransactions.status, statusFilter));
      }

      if (q.length >= 2) {
        const pattern = `%${q}%`;
        conds.push(
          or(
            ilike(purchaseTransactions.traderLicenceNoSnapshot, pattern),
            ilike(purchaseTransactions.traderFirmNameSnapshot, pattern),
            ilike(traderLicences.licenceNo, pattern),
            ilike(traderLicences.firmName, pattern),
            ilike(traderLicences.mobile, pattern),
          )!,
        );
      }

      const rows = await db
        .select({
          id: purchaseTransactions.id,
          transactionNo: purchaseTransactions.transactionNo,
          transactionDate: purchaseTransactions.transactionDate,
          yardId: purchaseTransactions.yardId,
          commodityId: purchaseTransactions.commodityId,
          commodityName: commodities.name,
          commodityUnit: commodities.unit,
          quantity: purchaseTransactions.quantity,
          unit: purchaseTransactions.unit,
          ratePerUnit: purchaseTransactions.ratePerUnit,
          declaredValue: purchaseTransactions.declaredValue,
          marketFeePercent: purchaseTransactions.marketFeePercent,
          marketFeeAmount: purchaseTransactions.marketFeeAmount,
          status: purchaseTransactions.status,
          placeOfPurchase: purchaseTransactions.placeOfPurchase,
          farmerNameSnapshot: purchaseTransactions.farmerNameSnapshot,
          farmerId: purchaseTransactions.farmerId,
          farmerName: farmers.name,
          farmerVillage: farmers.village,
          traderLicenceId: purchaseTransactions.traderLicenceId,
          traderFirmNameSnapshot: purchaseTransactions.traderFirmNameSnapshot,
          traderLicenceNoSnapshot: purchaseTransactions.traderLicenceNoSnapshot,
          traderFirmName: traderLicences.firmName,
          traderLicenceNo: traderLicences.licenceNo,
        })
        .from(purchaseTransactions)
        .leftJoin(commodities, eq(commodities.id, purchaseTransactions.commodityId))
        .leftJoin(farmers, eq(farmers.id, purchaseTransactions.farmerId))
        .leftJoin(traderLicences, eq(traderLicences.id, purchaseTransactions.traderLicenceId))
        .where(and(...conds))
        .orderBy(desc(purchaseTransactions.transactionDate), desc(purchaseTransactions.transactionNo))
        .limit(5000);

      const mapped = rows.map((r, idx) => {
        const qty = Number(r.quantity ?? 0);
        const value = Number(r.declaredValue ?? 0);
        const rate =
          r.ratePerUnit != null && Number(r.ratePerUnit) > 0
            ? Number(r.ratePerUnit)
            : qty > 0
              ? Math.round((value / qty) * 100) / 100
              : 0;
        const traderName = (r.traderFirmName ?? r.traderFirmNameSnapshot ?? "").trim() || "—";
        const licenceNo = (r.traderLicenceNo ?? r.traderLicenceNoSnapshot ?? "").trim() || "—";
        const farmerName = (r.farmerNameSnapshot ?? r.farmerName ?? "").trim() || "—";
        const place = (r.placeOfPurchase ?? r.farmerVillage ?? "").trim() || "—";
        const unit = (r.unit || r.commodityUnit || "").trim() || "—";
        const rawStatus = String(r.status ?? "");
        return {
          sNo: idx + 1,
          id: r.id,
          transactionId: r.transactionNo ?? r.id,
          transactionDate: r.transactionDate,
          transactionDateTime: r.transactionDate,
          traderLicenceId: r.traderLicenceId,
          traderName,
          licenceNo,
          traderDisplay: `${traderName} (${licenceNo})`,
          commodityId: r.commodityId,
          commodity: r.commodityName ?? "—",
          quantity: qty,
          unit,
          quantityDisplay: `${qty.toLocaleString("en-IN")} (${unit})`,
          ratePerUnit: rate,
          totalValue: value,
          marketFeePercent: Number(r.marketFeePercent ?? 0),
          marketFee: Number(r.marketFeeAmount ?? 0),
          farmerName,
          placeOfPurchase: place,
          status: rawStatus,
          statusLabel: reportStatusLabel(rawStatus),
        };
      });

      if (format === "csv") {
        const header = [
          "S.No.",
          "Transaction ID",
          "Transaction Date",
          "Trader Name",
          "License No.",
          "Commodity",
          "Quantity",
          "Unit",
          "Rate (Per Unit)",
          "Total Value (INR)",
          "Market Fee (INR)",
          "Farmer Name",
          "Place of Purchase",
          "Status",
        ];
        const lines = [header.join(",")];
        for (const row of mapped) {
          const cells = [
            row.sNo,
            row.transactionId,
            row.transactionDate,
            row.traderName,
            row.licenceNo,
            row.commodity,
            row.quantity,
            row.unit,
            row.ratePerUnit,
            row.totalValue,
            row.marketFee,
            row.farmerName,
            row.placeOfPurchase,
            row.statusLabel,
          ].map((c) => `"${String(c).replace(/"/g, '""')}"`);
          lines.push(cells.join(","));
        }
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename=trader-transactions-${from}_${to}.csv`);
        return res.send(lines.join("\n"));
      }

      res.json({
        from,
        to,
        traderLicenceId: traderLicenceId || null,
        q: q || null,
        commodityId: commodityId || null,
        status: statusFilter,
        count: mapped.length,
        rows: mapped,
      });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to build trader transaction report");
    }
  });

  // ----- AI / IVR voice session -----
  app.post("/api/ioms/market/voice-sessions/verify", async (req, res) => {
    try {
      if (!req.user || !hasPermission(req.user, "M-04", "Create")) {
        return sendApiError(res, 403, "AUTH_PERMISSION_DENIED", "M-04 Create required", { required: "M-04:Create" });
      }
      const licenceNo = String(req.body?.licenceNo ?? "").trim();
      const mobile = digitsOnly(String(req.body?.mobile ?? ""));
      const licenceClass = req.body?.licenceClass != null ? String(req.body.licenceClass).trim() : null;
      if (!licenceNo || mobile.length < 10) {
        return sendApiError(res, 400, "VOICE_VERIFY_FIELDS", "licenceNo and registered mobile (10 digits) are required");
      }

      const [lic] = await db
        .select()
        .from(traderLicences)
        .where(eq(traderLicences.licenceNo, licenceNo))
        .limit(1);
      if (!lic) {
        return sendApiError(res, 404, "VOICE_TRADER_NOT_FOUND", "Trader licence not found");
      }
      if (lic.status !== "Active" || lic.isBlocked) {
        return sendApiError(res, 400, "VOICE_TRADER_NOT_ACTIVE", "Trader licence is not active");
      }
      const licMobile = digitsOnly(lic.mobile);
      if (licMobile.slice(-10) !== mobile.slice(-10)) {
        return sendApiError(res, 401, "VOICE_MOBILE_MISMATCH", "Mobile number does not match registered details");
      }

      const primaryCommodities = await db
        .select({ name: commodities.name })
        .from(commodities)
        .where(eq(commodities.isActive, true))
        .orderBy(commodities.name)
        .limit(12);

      res.json({
        verified: true,
        traderLicenceId: lic.id,
        licenceNo: lic.licenceNo,
        firmName: lic.firmName,
        contactName: lic.contactName,
        yardId: lic.yardId,
        licenceType: lic.licenceType,
        licenceClass,
        mobile: lic.mobile,
        primaryCommodities: primaryCommodities.map((c) => c.name),
      });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to verify trader for voice session");
    }
  });

  app.post("/api/ioms/market/voice-sessions", async (req, res) => {
    try {
      if (!canCreatePurchaseTransaction(req.user)) {
        return sendApiError(res, 403, "VOICE_SESSION_CREATE_DENIED", "Only DO/Admin can open voice sessions");
      }
      const traderLicenceId = String(req.body?.traderLicenceId ?? "").trim();
      const licenceClass = req.body?.licenceClass != null ? String(req.body.licenceClass).trim() : null;
      if (!traderLicenceId) {
        return sendApiError(res, 400, "VOICE_TRADER_REQUIRED", "traderLicenceId is required");
      }
      const resolved = await resolvePurchaseTransactionTraderRef(traderLicenceId);
      if (!resolved) return sendApiError(res, 404, "VOICE_TRADER_NOT_FOUND", "Trader licence not found");
      const [lic] = await db.select().from(traderLicences).where(eq(traderLicences.id, resolved.id)).limit(1);
      if (!lic || lic.status !== "Active" || lic.isBlocked) {
        return sendApiError(res, 400, "VOICE_TRADER_NOT_ACTIVE", "Trader licence is not active");
      }

      const id = nanoid();
      const ts = nowIso();
      await db.insert(traderVoiceSessions).values({
        id,
        traderLicenceId: lic.id,
        yardId: lic.yardId,
        status: "Open",
        mobileVerified: true,
        licenceClass,
        linesJson: [],
        totalPurchaseValue: 0,
        createdBy: req.user?.id ?? null,
        createdAt: ts,
        updatedAt: ts,
      });
      const [row] = await db.select().from(traderVoiceSessions).where(eq(traderVoiceSessions.id, id));
      writeAuditLog(req, { module: "Market", action: "VoiceSessionCreate", recordId: id, afterValue: row }).catch(console.error);
      res.status(201).json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to create voice session");
    }
  });

  app.get("/api/ioms/market/voice-sessions", async (req, res) => {
    try {
      if (!req.user || !hasPermission(req.user, "M-04", "Read")) {
        return sendApiError(res, 403, "AUTH_PERMISSION_DENIED", "M-04 Read required", { required: "M-04:Read" });
      }
      const status = String(req.query.status ?? "").trim();
      const traderLicenceId = String(req.query.traderLicenceId ?? "").trim();
      const scopedIds = (req as Express.Request & { scopedLocationIds?: string[] }).scopedLocationIds;
      const conds = [];
      if (status && ["Open", "Submitted", "Abandoned"].includes(status)) {
        conds.push(eq(traderVoiceSessions.status, status));
      }
      if (traderLicenceId) conds.push(eq(traderVoiceSessions.traderLicenceId, traderLicenceId));
      if (scopedIds && scopedIds.length > 0) conds.push(inArray(traderVoiceSessions.yardId, scopedIds));

      const q = db
        .select({
          id: traderVoiceSessions.id,
          traderLicenceId: traderVoiceSessions.traderLicenceId,
          yardId: traderVoiceSessions.yardId,
          status: traderVoiceSessions.status,
          mobileVerified: traderVoiceSessions.mobileVerified,
          licenceClass: traderVoiceSessions.licenceClass,
          linesJson: traderVoiceSessions.linesJson,
          totalPurchaseValue: traderVoiceSessions.totalPurchaseValue,
          createdBy: traderVoiceSessions.createdBy,
          createdAt: traderVoiceSessions.createdAt,
          updatedAt: traderVoiceSessions.updatedAt,
          submittedAt: traderVoiceSessions.submittedAt,
          firmName: traderLicences.firmName,
          licenceNo: traderLicences.licenceNo,
          mobile: traderLicences.mobile,
        })
        .from(traderVoiceSessions)
        .leftJoin(traderLicences, eq(traderLicences.id, traderVoiceSessions.traderLicenceId));

      const rows = await (conds.length ? q.where(and(...conds)) : q)
        .orderBy(desc(traderVoiceSessions.createdAt))
        .limit(200);
      res.json({
        count: rows.length,
        rows: rows.map((r) => ({
          ...r,
          lineCount: Array.isArray(r.linesJson) ? r.linesJson.length : 0,
        })),
      });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to list voice sessions");
    }
  });

  app.get("/api/ioms/market/voice-sessions/:id", async (req, res) => {
    try {
      if (!req.user || !hasPermission(req.user, "M-04", "Read")) {
        return sendApiError(res, 403, "AUTH_PERMISSION_DENIED", "M-04 Read required", { required: "M-04:Read" });
      }
      const id = routeParamString(req.params.id);
      const [row] = await db.select().from(traderVoiceSessions).where(eq(traderVoiceSessions.id, id)).limit(1);
      if (!row) return sendApiError(res, 404, "VOICE_SESSION_NOT_FOUND", "Session not found");
      const [lic] = await db
        .select({
          firmName: traderLicences.firmName,
          licenceNo: traderLicences.licenceNo,
          mobile: traderLicences.mobile,
        })
        .from(traderLicences)
        .where(eq(traderLicences.id, row.traderLicenceId))
        .limit(1);
      res.json({
        ...row,
        firmName: lic?.firmName ?? null,
        licenceNo: lic?.licenceNo ?? null,
        mobile: lic?.mobile ?? null,
        lineCount: Array.isArray(row.linesJson) ? row.linesJson.length : 0,
      });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to load voice session");
    }
  });

  app.post("/api/ioms/market/voice-sessions/:id/abandon", async (req, res) => {
    try {
      if (!canCreatePurchaseTransaction(req.user)) {
        return sendApiError(res, 403, "VOICE_ABANDON_DENIED", "Only DO/Admin can abandon voice sessions");
      }
      const id = routeParamString(req.params.id);
      const [session] = await db.select().from(traderVoiceSessions).where(eq(traderVoiceSessions.id, id)).limit(1);
      if (!session) return sendApiError(res, 404, "VOICE_SESSION_NOT_FOUND", "Session not found");
      if (session.status !== "Open") {
        return sendApiError(res, 400, "VOICE_SESSION_CLOSED", "Only Open sessions can be abandoned");
      }
      const ts = nowIso();
      await db
        .update(traderVoiceSessions)
        .set({ status: "Abandoned", updatedAt: ts })
        .where(eq(traderVoiceSessions.id, id));
      const [row] = await db.select().from(traderVoiceSessions).where(eq(traderVoiceSessions.id, id));
      writeAuditLog(req, {
        module: "Market",
        action: "VoiceSessionAbandon",
        recordId: id,
        beforeValue: session,
        afterValue: row,
      }).catch(console.error);
      res.json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to abandon voice session");
    }
  });

  app.delete("/api/ioms/market/voice-sessions/:id/lines/:seq", async (req, res) => {
    try {
      if (!canCreatePurchaseTransaction(req.user)) {
        return sendApiError(res, 403, "VOICE_LINE_DENIED", "Only DO/Admin can delete session lines");
      }
      const sessionId = routeParamString(req.params.id);
      const seq = Number(routeParamString(req.params.seq));
      const [session] = await db.select().from(traderVoiceSessions).where(eq(traderVoiceSessions.id, sessionId)).limit(1);
      if (!session) return sendApiError(res, 404, "VOICE_SESSION_NOT_FOUND", "Session not found");
      if (session.status !== "Open") {
        return sendApiError(res, 400, "VOICE_SESSION_CLOSED", "Session is not open");
      }
      const lines = (session.linesJson ?? []).filter((l) => l.seq !== seq);
      if (lines.length === (session.linesJson ?? []).length) {
        return sendApiError(res, 404, "VOICE_LINE_NOT_FOUND", "Line not found");
      }
      const totalPurchaseValue = sumLines(lines);
      await db
        .update(traderVoiceSessions)
        .set({ linesJson: lines, totalPurchaseValue, updatedAt: nowIso() })
        .where(eq(traderVoiceSessions.id, sessionId));
      const [row] = await db.select().from(traderVoiceSessions).where(eq(traderVoiceSessions.id, sessionId));
      res.json({ session: row });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to delete voice session line");
    }
  });

  app.post("/api/ioms/market/voice-sessions/:id/lines", async (req, res) => {
    try {
      if (!canCreatePurchaseTransaction(req.user)) {
        return sendApiError(res, 403, "VOICE_LINE_DENIED", "Only DO/Admin can add session lines");
      }
      const sessionId = routeParamString(req.params.id);
      const [session] = await db.select().from(traderVoiceSessions).where(eq(traderVoiceSessions.id, sessionId)).limit(1);
      if (!session) return sendApiError(res, 404, "VOICE_SESSION_NOT_FOUND", "Session not found");
      if (session.status !== "Open") {
        return sendApiError(res, 400, "VOICE_SESSION_CLOSED", "Session is not open");
      }

      const body = req.body ?? {};
      let commodityId = body.commodityId ? String(body.commodityId).trim() : "";
      let commodityName = String(body.commodityName ?? "").trim();
      if (commodityId) {
        const [c] = await db.select().from(commodities).where(eq(commodities.id, commodityId)).limit(1);
        if (!c) return sendApiError(res, 404, "VOICE_COMMODITY_NOT_FOUND", "Commodity not found");
        commodityName = c.name;
      } else if (commodityName) {
        const resolved = await resolveCommodityByName(commodityName);
        if (!resolved) {
          return sendApiError(res, 400, "VOICE_COMMODITY_UNRESOLVED", `Could not match commodity "${commodityName}"`);
        }
        commodityId = resolved.id;
        commodityName = resolved.name;
      } else {
        return sendApiError(res, 400, "VOICE_COMMODITY_REQUIRED", "commodityId or commodityName is required");
      }

      const quantity = Number(body.quantity ?? 0);
      const ratePerUnit = Number(body.ratePerUnit ?? 0);
      const unit = String(body.unit ?? "").trim();
      const farmerName = String(body.farmerName ?? "").trim();
      const placeOfPurchase = String(body.placeOfPurchase ?? "").trim();
      if (!(quantity > 0) || !(ratePerUnit > 0) || !unit || !farmerName || !placeOfPurchase) {
        return sendApiError(
          res,
          400,
          "VOICE_LINE_INCOMPLETE",
          "quantity, ratePerUnit, unit, farmerName, and placeOfPurchase are required",
        );
      }
      const totalValue = Math.round(quantity * ratePerUnit * 100) / 100;
      const lines = [...(session.linesJson ?? [])];
      const seq = lines.length ? Math.max(...lines.map((l) => l.seq)) + 1 : 1;
      const line: TraderVoiceSessionLine = {
        seq,
        commodityId,
        commodityName,
        quantity,
        unit,
        ratePerUnit,
        farmerName,
        placeOfPurchase,
        totalValue,
        confirmed: body.confirmed !== false,
      };
      lines.push(line);
      const totalPurchaseValue = sumLines(lines);
      await db
        .update(traderVoiceSessions)
        .set({ linesJson: lines, totalPurchaseValue, updatedAt: nowIso() })
        .where(eq(traderVoiceSessions.id, session.id));
      const [row] = await db.select().from(traderVoiceSessions).where(eq(traderVoiceSessions.id, session.id));
      res.status(201).json({ session: row, line });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to add voice session line");
    }
  });

  app.put("/api/ioms/market/voice-sessions/:id/lines/:seq", async (req, res) => {
    try {
      if (!canCreatePurchaseTransaction(req.user)) {
        return sendApiError(res, 403, "VOICE_LINE_DENIED", "Only DO/Admin can update session lines");
      }
      const sessionId = routeParamString(req.params.id);
      const seq = Number(routeParamString(req.params.seq));
      const [session] = await db.select().from(traderVoiceSessions).where(eq(traderVoiceSessions.id, sessionId)).limit(1);
      if (!session) return sendApiError(res, 404, "VOICE_SESSION_NOT_FOUND", "Session not found");
      if (session.status !== "Open") {
        return sendApiError(res, 400, "VOICE_SESSION_CLOSED", "Session is not open");
      }
      const lines = [...(session.linesJson ?? [])];
      const idx = lines.findIndex((l) => l.seq === seq);
      if (idx < 0) return sendApiError(res, 404, "VOICE_LINE_NOT_FOUND", "Line not found");

      const body = req.body ?? {};
      const cur = { ...lines[idx] };
      if (body.commodityName != null || body.commodityId != null) {
        let commodityId = body.commodityId ? String(body.commodityId).trim() : cur.commodityId ?? "";
        let commodityName = body.commodityName != null ? String(body.commodityName).trim() : cur.commodityName;
        if (commodityId) {
          const [c] = await db.select().from(commodities).where(eq(commodities.id, commodityId)).limit(1);
          if (!c) return sendApiError(res, 404, "VOICE_COMMODITY_NOT_FOUND", "Commodity not found");
          commodityName = c.name;
        } else if (commodityName) {
          const resolved = await resolveCommodityByName(commodityName);
          if (!resolved) {
            return sendApiError(res, 400, "VOICE_COMMODITY_UNRESOLVED", `Could not match commodity "${commodityName}"`);
          }
          commodityId = resolved.id;
          commodityName = resolved.name;
        }
        cur.commodityId = commodityId || null;
        cur.commodityName = commodityName;
      }
      if (body.quantity != null) cur.quantity = Number(body.quantity);
      if (body.ratePerUnit != null) cur.ratePerUnit = Number(body.ratePerUnit);
      if (body.unit != null) cur.unit = String(body.unit).trim();
      if (body.farmerName != null) cur.farmerName = String(body.farmerName).trim();
      if (body.placeOfPurchase != null) cur.placeOfPurchase = String(body.placeOfPurchase).trim();
      if (body.confirmed != null) cur.confirmed = Boolean(body.confirmed);
      cur.totalValue = Math.round(Number(cur.quantity) * Number(cur.ratePerUnit) * 100) / 100;
      lines[idx] = cur;

      const totalPurchaseValue = sumLines(lines);
      await db
        .update(traderVoiceSessions)
        .set({ linesJson: lines, totalPurchaseValue, updatedAt: nowIso() })
        .where(eq(traderVoiceSessions.id, session.id));
      const [row] = await db.select().from(traderVoiceSessions).where(eq(traderVoiceSessions.id, session.id));
      res.json({ session: row, line: cur });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to update voice session line");
    }
  });

  app.post("/api/ioms/market/voice-sessions/:id/submit", async (req, res) => {
    try {
      if (!canCreatePurchaseTransaction(req.user)) {
        return sendApiError(res, 403, "VOICE_SUBMIT_DENIED", "Only DO/Admin can submit voice sessions");
      }
      const sessionId = routeParamString(req.params.id);
      const [session] = await db.select().from(traderVoiceSessions).where(eq(traderVoiceSessions.id, sessionId)).limit(1);
      if (!session) return sendApiError(res, 404, "VOICE_SESSION_NOT_FOUND", "Session not found");
      if (session.status !== "Open") {
        return sendApiError(res, 400, "VOICE_SESSION_CLOSED", "Session is not open");
      }
      const lines = (session.linesJson ?? []).filter((l) => l.confirmed);
      if (!lines.length) {
        return sendApiError(res, 400, "VOICE_NO_LINES", "No confirmed transactions to submit");
      }

      const resolvedTrader = await resolvePurchaseTransactionTraderRef(session.traderLicenceId);
      if (!resolvedTrader) {
        return sendApiError(res, 400, "VOICE_TRADER_UNRESOLVED", "Trader could not be resolved");
      }

      const transactionDate = String(req.body?.transactionDate ?? isoToday()).slice(0, 10);
      const createdIds: string[] = [];

      for (const line of lines) {
        if (!line.commodityId) {
          return sendApiError(res, 400, "VOICE_COMMODITY_MISSING", `Line ${line.seq} has no commodityId`);
        }
        const declaredValue = Number(line.totalValue);
        const fee = await resolveMarketFeePercentForPurchase({
          yardId: session.yardId,
          commodityId: line.commodityId,
          transactionDate,
        });
        const marketFeePercent = fee.feePercent;
        const marketFeeAmount = Number(((declaredValue * marketFeePercent) / 100).toFixed(2));
        const farmerId = await findOrCreateFarmer({
          yardId: session.yardId,
          name: line.farmerName,
          placeOfPurchase: line.placeOfPurchase,
        });
        const id = nanoid();
        const transactionNo = await generateNextPurchaseTransactionNo({
          yardId: session.yardId,
          transactionDateIso: transactionDate,
        });
        await db.insert(purchaseTransactions).values({
          id,
          transactionNo,
          yardId: session.yardId,
          commodityId: line.commodityId,
          traderLicenceId: resolvedTrader.id,
          traderFirmNameSnapshot: resolvedTrader.firmName,
          traderLicenceNoSnapshot: resolvedTrader.licenceDisplay,
          quantity: line.quantity,
          unit: line.unit,
          weight: null,
          declaredValue,
          marketFeePercent,
          marketFeeAmount,
          purchaseType: "TraderPurchase",
          grade: null,
          transactionDate,
          status: "Approved",
          farmerId,
          placeOfPurchase: line.placeOfPurchase,
          ratePerUnit: line.ratePerUnit,
          farmerNameSnapshot: line.farmerName,
          receiptId: null,
          doUser: req.user?.id ?? null,
          dvUser: null,
          daUser: req.user?.id ?? null,
          parentTransactionId: null,
          entryKind: "Original",
        });
        await persistAllocatedTransactionNoIfMissing(id, transactionNo);
        createdIds.push(id);
      }

      const ts = nowIso();
      await db
        .update(traderVoiceSessions)
        .set({
          status: "Submitted",
          totalPurchaseValue: sumLines(lines),
          submittedAt: ts,
          updatedAt: ts,
        })
        .where(eq(traderVoiceSessions.id, session.id));

      writeAuditLog(req, {
        module: "Market",
        action: "VoiceSessionSubmit",
        recordId: session.id,
        afterValue: { purchaseIds: createdIds, count: createdIds.length },
      }).catch(console.error);

      const [row] = await db.select().from(traderVoiceSessions).where(eq(traderVoiceSessions.id, session.id));
      res.json({
        session: row,
        submittedCount: createdIds.length,
        purchaseTransactionIds: createdIds,
        totalPurchaseValue: sumLines(lines),
      });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to submit voice session");
    }
  });

  /** Viewable/editable AI calling dialogue scripts by transaction / flow type. */
  async function loadVoiceScenariosConfig(): Promise<{
    cfg: VoiceTranscriptScenariosConfig;
    isDefault: boolean;
    updatedAt: string | null;
    updatedBy: string | null;
  }> {
    const [row] = await db
      .select()
      .from(systemConfig)
      .where(eq(systemConfig.key, TRADER_VOICE_SCENARIOS_CONFIG_KEY))
      .limit(1);
    if (row?.value?.trim()) {
      try {
        const parsed = JSON.parse(row.value) as VoiceTranscriptScenariosConfig;
        return {
          cfg: mergeVoiceTranscriptScenarios(parsed),
          isDefault: false,
          updatedAt: row.updatedAt ?? null,
          updatedBy: row.updatedBy ?? null,
        };
      } catch {
        /* fall through to default */
      }
    }
    return {
      cfg: mergeVoiceTranscriptScenarios(null),
      isDefault: true,
      updatedAt: null,
      updatedBy: null,
    };
  }

  app.get("/api/ioms/market/voice-transcript-script", async (req, res) => {
    try {
      if (!req.user || !hasPermission(req.user, "M-04", "Read")) {
        return sendApiError(res, 403, "AUTH_PERMISSION_DENIED", "M-04 Read required", { required: "M-04:Read" });
      }
      const { cfg, isDefault, updatedAt, updatedBy } = await loadVoiceScenariosConfig();
      const scenarios = [...cfg.scenarios].sort((a, b) => a.sortOrder - b.sortOrder);
      res.setHeader("Cache-Control", "no-store");
      res.json({
        key: TRADER_VOICE_SCENARIOS_CONFIG_KEY,
        version: cfg.version,
        scenarios,
        script: flattenVoiceTranscriptScenarios(cfg),
        isDefault,
        updatedAt,
        updatedBy,
      });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to load voice transcript script");
    }
  });

  app.put("/api/ioms/market/voice-transcript-script", async (req, res) => {
    try {
      if (!req.user || !hasPermission(req.user, "M-04", "Update")) {
        return sendApiError(res, 403, "AUTH_PERMISSION_DENIED", "M-04 Update required", { required: "M-04:Update" });
      }
      const body = req.body ?? {};
      let next: VoiceTranscriptScenariosConfig;

      if (Array.isArray(body.scenarios)) {
        next = mergeVoiceTranscriptScenarios({ version: 1, scenarios: body.scenarios });
      } else if (body.scenario && typeof body.scenario === "object" && body.scenario.id) {
        const loaded = await loadVoiceScenariosConfig();
        const patch = body.scenario as Record<string, unknown>;
        const scenarios = loaded.cfg.scenarios.map((s) => {
          if (s.id !== patch.id) return s;
          return {
            ...s,
            title: patch.title != null ? String(patch.title) : s.title,
            description: patch.description != null ? String(patch.description) : s.description,
            body: patch.body != null ? String(patch.body) : s.body,
            enabled: patch.enabled != null ? Boolean(patch.enabled) : s.enabled,
            apiStep: (patch.apiStep as typeof s.apiStep) || s.apiStep,
            sortOrder: patch.sortOrder != null ? Number(patch.sortOrder) : s.sortOrder,
          };
        });
        next = { version: 1, scenarios };
      } else if (typeof body.script === "string") {
        // Legacy: save as single enabled "capture_first" body only is wrong —
        // store flat script in legacy key and keep scenarios default structure with note.
        const tsLegacy = nowIso();
        await db
          .insert(systemConfig)
          .values({
            key: TRADER_VOICE_TRANSCRIPT_CONFIG_KEY,
            value: body.script,
            updatedBy: req.user.id,
            updatedAt: tsLegacy,
          })
          .onConflictDoUpdate({
            target: systemConfig.key,
            set: { value: body.script, updatedBy: req.user.id, updatedAt: tsLegacy },
          });
        return sendApiError(
          res,
          400,
          "VOICE_SCRIPT_USE_SCENARIOS",
          "Send { scenarios: [...] } or { scenario: { id, ... } } to update by transaction type",
        );
      } else {
        return sendApiError(
          res,
          400,
          "VOICE_SCRIPT_BODY",
          "Provide scenarios array or a single scenario patch with id",
        );
      }

      const json = JSON.stringify(next);
      if (json.length > 400_000) {
        return sendApiError(res, 400, "VOICE_SCRIPT_TOO_LARGE", "Script config exceeds size limit");
      }
      const ts = nowIso();
      await db
        .insert(systemConfig)
        .values({
          key: TRADER_VOICE_SCENARIOS_CONFIG_KEY,
          value: json,
          updatedBy: req.user.id,
          updatedAt: ts,
        })
        .onConflictDoUpdate({
          target: systemConfig.key,
          set: { value: json, updatedBy: req.user.id, updatedAt: ts },
        });
      writeAuditLog(req, {
        module: "Market",
        action: "VoiceTranscriptScenariosUpdate",
        recordId: TRADER_VOICE_SCENARIOS_CONFIG_KEY,
        afterValue: {
          count: next.scenarios.length,
          enabled: next.scenarios.filter((s) => s.enabled).map((s) => s.id),
        },
      }).catch(console.error);
      const scenarios = [...next.scenarios].sort((a, b) => a.sortOrder - b.sortOrder);
      res.json({
        key: TRADER_VOICE_SCENARIOS_CONFIG_KEY,
        version: next.version,
        scenarios,
        script: flattenVoiceTranscriptScenarios(next),
        isDefault: false,
        updatedAt: ts,
        updatedBy: req.user.id,
      });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to save voice transcript script");
    }
  });

  app.post("/api/ioms/market/voice-transcript-script/reset", async (req, res) => {
    try {
      if (!req.user || !hasPermission(req.user, "M-04", "Update")) {
        return sendApiError(res, 403, "AUTH_PERMISSION_DENIED", "M-04 Update required", { required: "M-04:Update" });
      }
      await db.delete(systemConfig).where(eq(systemConfig.key, TRADER_VOICE_SCENARIOS_CONFIG_KEY));
      await db.delete(systemConfig).where(eq(systemConfig.key, TRADER_VOICE_TRANSCRIPT_CONFIG_KEY));
      writeAuditLog(req, {
        module: "Market",
        action: "VoiceTranscriptScenariosReset",
        recordId: TRADER_VOICE_SCENARIOS_CONFIG_KEY,
      }).catch(console.error);
      const cfg = mergeVoiceTranscriptScenarios(null);
      const scenarios = [...cfg.scenarios].sort((a, b) => a.sortOrder - b.sortOrder);
      res.json({
        key: TRADER_VOICE_SCENARIOS_CONFIG_KEY,
        version: cfg.version,
        scenarios,
        script: flattenVoiceTranscriptScenarios(cfg),
        isDefault: true,
        updatedAt: null,
        updatedBy: null,
      });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to reset voice transcript script");
    }
  });
}
