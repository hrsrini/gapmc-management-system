/**
 * M-04 unified market transaction wizard API (cases A–G).
 */
import type { Express } from "express";
import { sql } from "drizzle-orm";
import { db } from "./db";
import { sendApiError } from "./api-errors";
import { canCreatePurchaseTransaction } from "./workflow";
import { writeAuditLog } from "./audit";
import {
  buildCaseESdRefundReconciliation,
  buildWizardTransactionReport,
  calculateMarketTransactionWizard,
  createMarketTransactionDraft,
  finalizeMarketTransaction,
  getCaseESdRefundAudit,
  getCaseESdRefundDashboard,
  listCaseESecurityDepositRefunds,
  listEligibleCaseEForRefund,
  listMarketTransactions,
  loadMarketTransactionWithLines,
  recordSecurityDepositRefund,
  submitMarketTransactionWizard,
  validateMarketTransactionWizard,
} from "./market-transaction-wizard";
import type { MarketTransactionWizardInput } from "@shared/market-transaction-cases";
import { isMarketTransactionCaseId } from "@shared/market-transaction-cases";
import { ensureM04ImmediateCommodityBackfill } from "./m04-immediate-transaction-backfill";
import { hasPermission } from "./auth";
import { todayYmdIst } from "@shared/premises-allocation";

let ensureMarketTransactionTablesPromise: Promise<void> | null = null;

function ensureMarketTransactionTables(): Promise<void> {
  if (ensureMarketTransactionTablesPromise) return ensureMarketTransactionTablesPromise;
  ensureMarketTransactionTablesPromise = (async () => {
    await db.execute(sql`CREATE SCHEMA IF NOT EXISTS gapmc`);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS gapmc.market_transactions (
        id text PRIMARY KEY,
        transaction_no text UNIQUE,
        case_type text NOT NULL,
        entry_location_id text NOT NULL,
        transaction_date text NOT NULL,
        transaction_time text,
        capture_mode text NOT NULL DEFAULT 'Normal',
        capture_location_text text,
        vehicle_number text,
        vehicle_make text,
        vehicle_capacity_kg double precision,
        trader_licence_id text,
        trader_manual_name text,
        trader_manual_contact text,
        trader_manual_address text,
        receiver_trader_licence_id text,
        fee_payer text,
        seller_type text,
        farmer_type text,
        farmer_name text,
        farmer_krishi_card text,
        farmer_contact text,
        farmer_address text,
        commodity_source text,
        place_of_origin text,
        originating_state text,
        destination_state text,
        exit_checkposts_json text,
        any_exit_checkpost boolean DEFAULT false,
        total_commodity_value double precision NOT NULL DEFAULT 0,
        total_market_fee double precision NOT NULL DEFAULT 0,
        fine_amount double precision NOT NULL DEFAULT 0,
        security_deposit_amount double precision NOT NULL DEFAULT 0,
        admin_charges_amount double precision NOT NULL DEFAULT 0,
        total_payable double precision NOT NULL DEFAULT 0,
        payment_mode text,
        payment_detail_json text,
        status text NOT NULL DEFAULT 'Draft',
        receipt_id text,
        created_by text,
        created_at text,
        finalized_at text
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS gapmc.market_transaction_commodities (
        id text PRIMARY KEY,
        transaction_id text NOT NULL REFERENCES gapmc.market_transactions(id) ON DELETE CASCADE,
        sort_order integer NOT NULL DEFAULT 0,
        commodity_id text NOT NULL,
        quantity double precision NOT NULL,
        unit text NOT NULL,
        rate_per_unit double precision NOT NULL,
        commodity_value double precision NOT NULL,
        market_fee_percent double precision NOT NULL,
        market_fee_amount double precision NOT NULL
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS market_transaction_commodities_tx_idx
      ON gapmc.market_transaction_commodities (transaction_id)
    `);
    await db.execute(sql`
      ALTER TABLE gapmc.market_transactions
        ADD COLUMN IF NOT EXISTS sd_refund_check_post_id text,
        ADD COLUMN IF NOT EXISTS sd_refund_txn_ref text,
        ADD COLUMN IF NOT EXISTS sd_refund_receipt_id text,
        ADD COLUMN IF NOT EXISTS sd_refund_date text,
        ADD COLUMN IF NOT EXISTS sd_refund_amount double precision,
        ADD COLUMN IF NOT EXISTS sd_refund_recorded_at text,
        ADD COLUMN IF NOT EXISTS sd_refund_recorded_by text
    `);
  })();
  return ensureMarketTransactionTablesPromise;
}

function parseWizardBody(body: unknown): MarketTransactionWizardInput {
  const b = (body ?? {}) as Record<string, unknown>;
  const caseType = String(b.caseType ?? "");
  if (!isMarketTransactionCaseId(caseType)) {
    throw Object.assign(new Error("Invalid case type"), { code: "MKT_TX_CASE_INVALID" });
  }
  const commodities = Array.isArray(b.commodities)
    ? (b.commodities as Record<string, unknown>[]).map((row) => ({
        commodityId: String(row.commodityId ?? ""),
        quantity: Number(row.quantity),
        unit: String(row.unit ?? "Kg"),
        ratePerUnit: Number(row.ratePerUnit),
        marketFeePercent: row.marketFeePercent != null ? Number(row.marketFeePercent) : undefined,
      }))
    : [];

  return {
    caseType,
    entryLocationId: String(b.entryLocationId ?? ""),
    transactionDate: String(b.transactionDate ?? ""),
    transactionTime: b.transactionTime != null ? String(b.transactionTime) : null,
    captureMode: b.captureMode != null ? (String(b.captureMode) as MarketTransactionWizardInput["captureMode"]) : undefined,
    captureLocationText: b.captureLocationText != null ? String(b.captureLocationText) : null,
    vehicleNumber: b.vehicleNumber != null ? String(b.vehicleNumber) : null,
    vehicleMake: b.vehicleMake != null ? String(b.vehicleMake) : null,
    vehicleCapacityKg: b.vehicleCapacityKg != null ? Number(b.vehicleCapacityKg) : null,
    traderLicenceId: b.traderLicenceId != null ? String(b.traderLicenceId) : null,
    traderManualName: b.traderManualName != null ? String(b.traderManualName) : null,
    traderManualContact: b.traderManualContact != null ? String(b.traderManualContact) : null,
    traderManualAddress: b.traderManualAddress != null ? String(b.traderManualAddress) : null,
    receiverTraderLicenceId: b.receiverTraderLicenceId != null ? String(b.receiverTraderLicenceId) : null,
    feePayer: b.feePayer != null ? (String(b.feePayer) as MarketTransactionWizardInput["feePayer"]) : null,
    sellerType: b.sellerType != null ? (String(b.sellerType) as MarketTransactionWizardInput["sellerType"]) : null,
    farmerType: b.farmerType != null ? (String(b.farmerType) as MarketTransactionWizardInput["farmerType"]) : null,
    farmerName: b.farmerName != null ? String(b.farmerName) : null,
    farmerKrishiCard: b.farmerKrishiCard != null ? String(b.farmerKrishiCard) : null,
    farmerContact: b.farmerContact != null ? String(b.farmerContact) : null,
    farmerAddress: b.farmerAddress != null ? String(b.farmerAddress) : null,
    commoditySource: b.commoditySource != null ? (String(b.commoditySource) as MarketTransactionWizardInput["commoditySource"]) : null,
    placeOfOrigin: b.placeOfOrigin != null ? String(b.placeOfOrigin) : null,
    originatingState: b.originatingState != null ? String(b.originatingState) : null,
    destinationState: b.destinationState != null ? String(b.destinationState) : null,
    exitCheckpostIds: Array.isArray(b.exitCheckpostIds) ? (b.exitCheckpostIds as unknown[]).map(String) : undefined,
    anyExitCheckpost: Boolean(b.anyExitCheckpost),
    fineAmount: b.fineAmount != null ? Number(b.fineAmount) : undefined,
    securityDepositAmount: b.securityDepositAmount != null ? Number(b.securityDepositAmount) : undefined,
    adminChargesAmount: b.adminChargesAmount != null ? Number(b.adminChargesAmount) : undefined,
    collectFine: b.collectFine != null ? Boolean(b.collectFine) : undefined,
    commodities,
  };
}

function assertYardScope(req: { scopedLocationIds?: string[] }, yardId: string): boolean {
  const scopedIds = req.scopedLocationIds;
  if (!scopedIds || scopedIds.length === 0) return true;
  return scopedIds.includes(yardId);
}

export function registerMarketTransactionWizardRoutes(app: Express) {
  app.post("/api/ioms/market/transaction-wizard/calculate", async (req, res) => {
    try {
      await ensureMarketTransactionTables();
      const input = parseWizardBody(req.body);
      if (!assertYardScope(req, input.entryLocationId)) {
        return sendApiError(res, 403, "MKT_TX_YARD_ACCESS_DENIED", "You do not have access to this yard");
      }
      const validation = await validateMarketTransactionWizard(input);
      if (!validation.ok) {
        return sendApiError(res, 400, validation.code, validation.message);
      }
      const calculation = await calculateMarketTransactionWizard(input);
      res.json(calculation);
    } catch (e) {
      const code = (e as { code?: string }).code;
      const msg = e instanceof Error ? e.message : "Calculation failed";
      if (code) return sendApiError(res, 400, code, msg);
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", msg);
    }
  });

  app.post("/api/ioms/market/transaction-wizard/submit", async (req, res) => {
    try {
      if (!canCreatePurchaseTransaction(req.user)) {
        return sendApiError(res, 403, "MKT_TX_SUBMIT_DENIED", "Only Data Originator or Admin can submit transactions");
      }
      await ensureMarketTransactionTables();
      const input = parseWizardBody(req.body);
      if (!assertYardScope(req, input.entryLocationId)) {
        return sendApiError(res, 403, "MKT_TX_YARD_ACCESS_DENIED", "You do not have access to this yard");
      }
      const body = (req.body ?? {}) as Record<string, unknown>;
      const paymentMode = String(body.paymentMode ?? "Cash");
      const paymentDetail =
        body.paymentDetail && typeof body.paymentDetail === "object"
          ? (body.paymentDetail as Record<string, unknown>)
          : undefined;
      const paidAmount = body.paidAmount != null ? Number(body.paidAmount) : undefined;
      const createdBy = req.user?.id ?? "system";
      const result = await submitMarketTransactionWizard({
        input,
        paymentMode,
        paymentDetail,
        paidAmount,
        createdBy,
      });
      writeAuditLog(req, {
        module: "M-04",
        action: "Submit",
        recordId: result.id,
        afterValue: { transactionNo: result.transactionNo, receiptNo: result.receiptNo, caseType: input.caseType },
      }).catch((err) => console.error("Audit log failed:", err));
      res.status(201).json(result);
    } catch (e) {
      const code = (e as { code?: string }).code;
      const msg = e instanceof Error ? e.message : "Failed to submit transaction";
      if (code) return sendApiError(res, 400, code, msg);
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", msg);
    }
  });

  app.post("/api/ioms/market/transaction-wizard/draft", async (req, res) => {
    try {
      if (!canCreatePurchaseTransaction(req.user)) {
        return sendApiError(res, 403, "MKT_TX_CREATE_DENIED", "Only Data Originator or Admin can create transactions");
      }
      await ensureMarketTransactionTables();
      const input = parseWizardBody(req.body);
      if (!assertYardScope(req, input.entryLocationId)) {
        return sendApiError(res, 403, "MKT_TX_YARD_ACCESS_DENIED", "You do not have access to this yard");
      }
      const createdBy = req.user?.id ?? "system";
      const result = await createMarketTransactionDraft({ input, createdBy });
      writeAuditLog(req, {
        module: "M-04",
        action: "Create",
        recordId: result.id,
        afterValue: { transactionNo: result.transactionNo, caseType: input.caseType },
      }).catch((err) => console.error("Audit log failed:", err));
      res.status(201).json(result);
    } catch (e) {
      const code = (e as { code?: string }).code;
      const msg = e instanceof Error ? e.message : "Failed to create draft";
      if (code) return sendApiError(res, 400, code, msg);
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", msg);
    }
  });

  app.post("/api/ioms/market/transaction-wizard/:id/finalize", async (req, res) => {
    try {
      if (!canCreatePurchaseTransaction(req.user)) {
        return sendApiError(res, 403, "MKT_TX_FINALIZE_DENIED", "Only Data Originator or Admin can finalize transactions");
      }
      await ensureMarketTransactionTables();
      const id = req.params.id;
      const existing = await loadMarketTransactionWithLines(id);
      if (!existing) return sendApiError(res, 404, "MKT_TX_NOT_FOUND", "Transaction not found");
      if (!assertYardScope(req, existing.transaction.entryLocationId)) {
        return sendApiError(res, 404, "MKT_TX_NOT_FOUND", "Transaction not found");
      }
      const body = (req.body ?? {}) as Record<string, unknown>;
      const paymentMode = String(body.paymentMode ?? "Cash");
      const paymentDetail =
        body.paymentDetail && typeof body.paymentDetail === "object"
          ? (body.paymentDetail as Record<string, unknown>)
          : undefined;
      const paidAmount = body.paidAmount != null ? Number(body.paidAmount) : undefined;
      const createdBy = req.user?.id ?? "system";
      const result = await finalizeMarketTransaction({
        transactionId: id,
        paymentMode,
        paymentDetail,
        paidAmount,
        createdBy,
      });
      writeAuditLog(req, {
        module: "M-04",
        action: "Finalize",
        recordId: id,
        afterValue: result,
      }).catch((err) => console.error("Audit log failed:", err));
      res.json(result);
    } catch (e) {
      const code = (e as { code?: string }).code;
      const msg = e instanceof Error ? e.message : "Failed to finalize";
      if (code === "MKT_TX_NOT_FOUND") return sendApiError(res, 404, code, msg);
      if (code) return sendApiError(res, 400, code, msg);
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", msg);
    }
  });

  app.get("/api/ioms/market/transaction-wizard", async (req, res) => {
    try {
      await ensureMarketTransactionTables();
      await ensureM04ImmediateCommodityBackfill().catch((e) =>
        console.warn("M-04 immediate commodity backfill (wizard list):", e),
      );
      const scopedIds = req.scopedLocationIds;
      const rows = await listMarketTransactions(scopedIds);
      res.json(rows);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to list wizard transactions");
    }
  });

  app.get("/api/ioms/market/transaction-wizard/report", async (req, res) => {
    try {
      if (!req.user || !hasPermission(req.user, "M-04", "Read")) {
        return sendApiError(res, 403, "AUTH_PERMISSION_DENIED", "M-04 Read required", { required: "M-04:Read" });
      }
      await ensureMarketTransactionTables();
      const from = String(req.query.from ?? "").trim();
      const to = String(req.query.to ?? "").trim();
      const iso = /^\d{4}-\d{2}-\d{2}$/;
      if (!from || !iso.test(from) || !to || !iso.test(to)) {
        return sendApiError(res, 400, "REPORT_DATE_RANGE_REQUIRED", "from and to (YYYY-MM-DD) are required");
      }
      if (from > to) {
        return sendApiError(res, 400, "REPORT_DATE_RANGE_INVALID", "from must be on or before to");
      }
      const caseType = String(req.query.caseType ?? "all").trim();
      const status = String(req.query.status ?? "all").trim();
      const commodityId = String(req.query.commodityId ?? "").trim();
      const format = String(req.query.format ?? "").trim().toLowerCase();
      const report = await buildWizardTransactionReport({
        from,
        to,
        scopedYardIds: req.scopedLocationIds,
        caseType,
        status,
        commodityId: commodityId || undefined,
      });

      if (format === "csv") {
        const headers = [
          "S.No.",
          "Txn No",
          "Case",
          "Date",
          "Time",
          "Location",
          "Status",
          "Trader",
          "Licence No",
          "Seller Type",
          "Farmer",
          "Commodity Source",
          "Place of Origin",
          "Origin State",
          "Destination State",
          "Exit Check Posts",
          "Vehicle",
          "Commodity",
          "Quantity",
          "Unit",
          "Rate",
          "Commodity Value",
          "Market Fee %",
          "Line Market Fee",
          "Total Commodity Value",
          "Total Market Fee",
          "Fine",
          "Security Deposit",
          "Admin Charges",
          "Total Payable",
          "Payment Mode",
          "SD Refund Check Post",
          "SD Refund Txn Ref",
          "SD Refund Date",
          "SD Refund Amount",
        ];
        const esc = (v: unknown) => {
          const s = v == null ? "" : String(v);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        };
        const lines = [headers.join(",")];
        for (const r of report.rows) {
          lines.push(
            [
              r.sNo,
              r.transactionNo,
              r.caseLabel,
              r.transactionDate,
              r.transactionTime ?? "",
              r.entryLocationName,
              r.status,
              r.traderName,
              r.licenceNo,
              r.sellerType ?? "",
              r.farmerName ?? "",
              r.commoditySource ?? "",
              r.placeOfOrigin ?? "",
              r.originatingState ?? "",
              r.destinationState ?? "",
              r.exitCheckposts,
              r.vehicleNumber ?? "",
              r.commodityName,
              r.quantity ?? "",
              r.unit ?? "",
              r.ratePerUnit ?? "",
              r.commodityValue ?? "",
              r.marketFeePercent ?? "",
              r.lineMarketFee ?? "",
              r.totalCommodityValue,
              r.totalMarketFee,
              r.fineAmount,
              r.securityDepositAmount,
              r.adminChargesAmount,
              r.totalPayable,
              r.paymentMode ?? "",
              r.sdRefundCheckPostName ?? "",
              r.sdRefundTxnRef ?? "",
              r.sdRefundDate ?? "",
              r.sdRefundAmount ?? "",
            ]
              .map(esc)
              .join(","),
          );
        }
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename=wizard-transactions-${from}_${to}.csv`);
        return res.send(lines.join("\n"));
      }

      res.json(report);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to build transaction report");
    }
  });

  app.get("/api/ioms/market/transaction-wizard/case-e/refundable", async (req, res) => {
    try {
      if (!req.user || !hasPermission(req.user, "M-04", "Read")) {
        return sendApiError(res, 403, "AUTH_PERMISSION_DENIED", "M-04 Read required", { required: "M-04:Read" });
      }
      await ensureMarketTransactionTables();
      const q = String(req.query.q ?? "").trim();
      const vehicleNumber = String(req.query.vehicleNumber ?? "").trim();
      const paymentMode = String(req.query.paymentMode ?? "").trim();
      const rows = await listEligibleCaseEForRefund({
        q: q || undefined,
        vehicleNumber: vehicleNumber || undefined,
        paymentMode: paymentMode || undefined,
      });
      res.json({ count: rows.length, refundWindowHours: 8, rows });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to list eligible Case E receipts");
    }
  });

  app.get("/api/ioms/market/transaction-wizard/case-e/dashboard", async (req, res) => {
    try {
      if (!req.user || !hasPermission(req.user, "M-04", "Read")) {
        return sendApiError(res, 403, "AUTH_PERMISSION_DENIED", "M-04 Read required", { required: "M-04:Read" });
      }
      await ensureMarketTransactionTables();
      const checkPostId = String(req.query.checkPostId ?? "").trim();
      if (checkPostId && !assertYardScope(req, checkPostId)) {
        return sendApiError(res, 403, "MKT_TX_YARD_ACCESS_DENIED", "You do not have access to this check post");
      }
      const dash = await getCaseESdRefundDashboard({
        checkPostId: checkPostId || undefined,
        todayYmd: todayYmdIst(),
      });
      res.json(dash);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to load Case E SD refund dashboard");
    }
  });

  app.get("/api/ioms/market/transaction-wizard/case-e/reconciliation", async (req, res) => {
    try {
      if (!req.user || !hasPermission(req.user, "M-04", "Read")) {
        return sendApiError(res, 403, "AUTH_PERMISSION_DENIED", "M-04 Read required", { required: "M-04:Read" });
      }
      await ensureMarketTransactionTables();
      const from = String(req.query.from ?? "").trim();
      const to = String(req.query.to ?? "").trim();
      const iso = /^\d{4}-\d{2}-\d{2}$/;
      if (!from || !iso.test(from) || !to || !iso.test(to) || from > to) {
        return sendApiError(res, 400, "REPORT_DATE_RANGE_REQUIRED", "Valid from/to (YYYY-MM-DD) required");
      }
      const report = await buildCaseESdRefundReconciliation({
        from,
        to,
        scopedYardIds: req.scopedLocationIds,
      });
      res.json(report);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to build Case E SD reconciliation");
    }
  });

  app.get("/api/ioms/market/transaction-wizard/case-e/refunds/:id/audit", async (req, res) => {
    try {
      if (!req.user || !hasPermission(req.user, "M-04", "Read")) {
        return sendApiError(res, 403, "AUTH_PERMISSION_DENIED", "M-04 Read required", { required: "M-04:Read" });
      }
      await ensureMarketTransactionTables();
      const audit = await getCaseESdRefundAudit(req.params.id);
      if (!audit) return sendApiError(res, 404, "MKT_TX_NOT_FOUND", "Transaction not found");
      res.json(audit);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to load refund audit record");
    }
  });

  app.get("/api/ioms/market/transaction-wizard/case-e/refunds", async (req, res) => {
    try {
      if (!req.user || !hasPermission(req.user, "M-04", "Read")) {
        return sendApiError(res, 403, "AUTH_PERMISSION_DENIED", "M-04 Read required", { required: "M-04:Read" });
      }
      await ensureMarketTransactionTables();
      const from = String(req.query.from ?? "").trim();
      const to = String(req.query.to ?? "").trim();
      const iso = /^\d{4}-\d{2}-\d{2}$/;
      if (!from || !iso.test(from) || !to || !iso.test(to)) {
        return sendApiError(res, 400, "REPORT_DATE_RANGE_REQUIRED", "from and to (YYYY-MM-DD) are required");
      }
      if (from > to) {
        return sendApiError(res, 400, "REPORT_DATE_RANGE_INVALID", "from must be on or before to");
      }
      const checkPostId = String(req.query.checkPostId ?? "").trim();
      const processedBy = String(req.query.processedBy ?? "").trim();
      const q = String(req.query.q ?? "").trim();
      const format = String(req.query.format ?? "").trim().toLowerCase();
      const rows = await listCaseESecurityDepositRefunds({
        from,
        to,
        checkPostId: checkPostId || undefined,
        scopedYardIds: req.scopedLocationIds,
        processedBy: processedBy || undefined,
        q: q || undefined,
      });
      if (format === "csv") {
        const headers = [
          "S.No.",
          "Refund Receipt",
          "Original Receipt",
          "Txn No",
          "Vehicle",
          "Trader",
          "Payment Mode",
          "Entry Check Post",
          "Refund Check Post",
          "Refund Date",
          "Refund Time",
          "SD Collected",
          "Amount Refunded",
          "Processed By",
          "Status",
        ];
        const esc = (v: unknown) => {
          const s = v == null ? "" : String(v);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        };
        const lines = [headers.join(",")];
        for (const r of rows) {
          lines.push(
            [
              r.sNo,
              r.refundReceiptNo ?? "",
              r.originalReceiptNo ?? "",
              r.transactionNo,
              r.vehicleNumber ?? "",
              r.traderName,
              r.paymentMode ?? "",
              r.entryLocationName,
              r.refundCheckPostName,
              r.refundDate,
              r.recordedAt ?? "",
              r.securityDepositAmount,
              r.refundAmount,
              r.processedByName,
              r.status,
            ]
              .map(esc)
              .join(","),
          );
        }
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename=case-e-sd-refunds-${from}_${to}.csv`);
        return res.send(lines.join("\n"));
      }
      res.json({ from, to, count: rows.length, rows });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to list Case E SD refunds");
    }
  });

  app.post("/api/ioms/market/transaction-wizard/:id/security-deposit-refund", async (req, res) => {
    try {
      if (!canCreatePurchaseTransaction(req.user)) {
        return sendApiError(res, 403, "MKT_TX_SD_REFUND_DENIED", "Only Data Originator or Admin can record SD refunds");
      }
      await ensureMarketTransactionTables();
      const existing = await loadMarketTransactionWithLines(req.params.id);
      if (!existing) return sendApiError(res, 404, "MKT_TX_NOT_FOUND", "Transaction not found");
      const body = (req.body ?? {}) as Record<string, unknown>;
      const checkPostId = String(body.checkPostId ?? "").trim();
      const refundDate = String(body.refundDate ?? "").trim();
      const refundTxnRef = String(body.refundTxnRef ?? "").trim();
      if (!checkPostId) return sendApiError(res, 400, "MKT_TX_SD_REFUND_CHECKPOST", "Exit check post is required");
      if (!assertYardScope(req, checkPostId)) {
        return sendApiError(res, 403, "MKT_TX_YARD_ACCESS_DENIED", "You do not have access to this exit check post");
      }
      if (!refundDate) return sendApiError(res, 400, "MKT_TX_SD_REFUND_DATE", "Refund date is required");
      const result = await recordSecurityDepositRefund({
        transactionId: req.params.id,
        checkPostId,
        refundTxnRef: refundTxnRef || undefined,
        refundDate,
        refundAmount: body.refundAmount != null ? Number(body.refundAmount) : undefined,
        paymentMode: body.paymentMode != null ? String(body.paymentMode) : "Cash",
        recordedBy: req.user?.id ?? "system",
      });
      writeAuditLog(req, {
        module: "M-04",
        action: "Update",
        recordId: req.params.id,
        afterValue: { securityDepositRefund: result },
      }).catch((err) => console.error("Audit log failed:", err));
      res.status(201).json(result);
    } catch (e) {
      const code = (e as { code?: string }).code;
      const msg = e instanceof Error ? e.message : "Failed to record security deposit refund";
      if (code === "MKT_TX_NOT_FOUND") return sendApiError(res, 404, code, msg);
      if (code) return sendApiError(res, 400, code, msg);
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", msg);
    }
  });

  app.get("/api/ioms/market/transaction-wizard/:id", async (req, res) => {
    try {
      await ensureMarketTransactionTables();
      const row = await loadMarketTransactionWithLines(req.params.id);
      if (!row) return sendApiError(res, 404, "MKT_TX_NOT_FOUND", "Transaction not found");
      if (!assertYardScope(req, row.transaction.entryLocationId)) {
        return sendApiError(res, 404, "MKT_TX_NOT_FOUND", "Transaction not found");
      }
      res.json(row);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to load transaction");
    }
  });
}
