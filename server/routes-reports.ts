/**
 * IOMS yard-scoped reports and CSV/Excel export.
 * All reports filter by req.scopedLocationIds when present.
 */
import type { Express } from "express";
import { eq, desc, and, inArray, gte, lte, sql, or, ilike, ne } from "drizzle-orm";
import { db } from "./db";
import { sendApiError } from "./api-errors";
import { parseReportPaging, parseReportSort, reportSearchPattern } from "./report-paging";
import {
  orderRentReport,
  orderVoucherReport,
  orderReceiptReport,
  orderStaffReport,
  RENT_REPORT_SORT_ALLOW,
  VOUCHER_REPORT_SORT_ALLOW,
  RECEIPT_REPORT_SORT_ALLOW,
  STAFF_REPORT_SORT_ALLOW,
} from "./report-order";
import { getMergedSystemConfig } from "./system-config";
import { buildGapmcTallyInterchangeXmlV1, type TallyExportFlatRow } from "./tally-export-xml";
import {
  rentInvoices,
  paymentVouchers,
  iomsReceipts,
  employees,
  tallyLedgers,
  iomsRevenueHeadLedgerMap,
  expenditureHeads,
  checkPostInward,
  checkPostInwardCommodities,
  commodities,
  ltcClaims,
} from "@shared/db-schema";
import { maskPanForExport } from "@shared/india-validation";

function escapeCsvCell(val: unknown): string {
  if (val == null) return "";
  const s = String(val);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsvRow(arr: unknown[]): string {
  return arr.map(escapeCsvCell).join(",");
}

export function registerReportsRoutes(app: Express) {
  // ----- M-01: LTC reports -----
  /**
   * LTC block register: Approved claims within date range.
   * Query: from (ISO), to (ISO), employeeId (optional), format=csv|json
   */
  app.get("/api/hr/reports/ltc-block-register", async (req, res) => {
    try {
      const from = req.query.from as string | undefined;
      const to = req.query.to as string | undefined;
      const employeeId = req.query.employeeId as string | undefined;
      const format = (req.query.format as string)?.toLowerCase();

      const conditions = [eq(ltcClaims.status, "Approved")];
      if (from) conditions.push(gte(ltcClaims.claimDate, from));
      if (to) conditions.push(lte(ltcClaims.claimDate, to));
      if (employeeId) conditions.push(eq(ltcClaims.employeeId, employeeId));

      const rows = await db
        .select({
          id: ltcClaims.id,
          employeeId: ltcClaims.employeeId,
          empId: employees.empId,
          employeeName: sql<string>`${employees.firstName} || ' ' || ${employees.surname}`,
          claimDate: ltcClaims.claimDate,
          period: ltcClaims.period,
          amount: ltcClaims.amount,
        })
        .from(ltcClaims)
        .leftJoin(employees, eq(ltcClaims.employeeId, employees.id))
        .where(and(...conditions))
        .orderBy(desc(ltcClaims.claimDate));

      if (format === "csv") {
        const headers = ["id", "employeeId", "empId", "employeeName", "claimDate", "period", "amount"];
        const csv = [headers.join(","), ...rows.map((r) => toCsvRow([r.id, r.employeeId, r.empId, r.employeeName, r.claimDate, r.period, r.amount]))].join(
          "\r\n",
        );
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", "attachment; filename=ltc-block-register.csv");
        return res.send("\uFEFF" + csv);
      }

      res.json({
        description: "LTC block register (Approved claims only).",
        from: from ?? null,
        to: to ?? null,
        employeeId: employeeId ?? null,
        count: rows.length,
        rows,
      });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to generate LTC block register");
    }
  });

  /**
   * LTC utilization summary: totals by employee + period (Approved claims).
   * Query: from (ISO), to (ISO), employeeId (optional), format=csv|json
   */
  app.get("/api/hr/reports/ltc-utilization", async (req, res) => {
    try {
      const from = req.query.from as string | undefined;
      const to = req.query.to as string | undefined;
      const employeeId = req.query.employeeId as string | undefined;
      const format = (req.query.format as string)?.toLowerCase();

      const conditions = [eq(ltcClaims.status, "Approved")];
      if (from) conditions.push(gte(ltcClaims.claimDate, from));
      if (to) conditions.push(lte(ltcClaims.claimDate, to));
      if (employeeId) conditions.push(eq(ltcClaims.employeeId, employeeId));

      const rows = await db
        .select({
          employeeId: ltcClaims.employeeId,
          empId: employees.empId,
          employeeName: sql<string>`${employees.firstName} || ' ' || ${employees.surname}`,
          period: ltcClaims.period,
          claimCount: sql<number>`count(*)::int`,
          totalAmount: sql<number>`coalesce(sum(${ltcClaims.amount}), 0)::double precision`,
          firstClaimDate: sql<string>`min(${ltcClaims.claimDate})`,
          lastClaimDate: sql<string>`max(${ltcClaims.claimDate})`,
        })
        .from(ltcClaims)
        .leftJoin(employees, eq(ltcClaims.employeeId, employees.id))
        .where(and(...conditions))
        .groupBy(ltcClaims.employeeId, employees.empId, employees.firstName, employees.surname, ltcClaims.period)
        .orderBy(desc(sql`max(${ltcClaims.claimDate})`));

      if (format === "csv") {
        const headers = [
          "employeeId",
          "empId",
          "employeeName",
          "period",
          "claimCount",
          "totalAmount",
          "firstClaimDate",
          "lastClaimDate",
        ];
        const csv = [
          headers.join(","),
          ...rows.map((r) =>
            toCsvRow([
              r.employeeId,
              r.empId,
              r.employeeName,
              r.period,
              r.claimCount,
              r.totalAmount,
              r.firstClaimDate,
              r.lastClaimDate,
            ]),
          ),
        ].join("\r\n");
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", "attachment; filename=ltc-utilization.csv");
        return res.send("\uFEFF" + csv);
      }

      res.json({
        description: "LTC utilization summary (Approved claims only), grouped by employee + period.",
        from: from ?? null,
        to: to ?? null,
        employeeId: employeeId ?? null,
        count: rows.length,
        rows,
      });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to generate LTC utilization report");
    }
  });

  /**
   * Check-post commodity arrivals for "Arrival of Commodities" reporting — excludes Passway/Transit
   * (market fee exempt; tracked separately). Only Verified inward rows.
   */
  app.get("/api/ioms/reports/check-post-arrivals", async (req, res) => {
    try {
      const from = req.query.from as string | undefined;
      const to = req.query.to as string | undefined;
      const checkPostId = req.query.checkPostId as string | undefined;
      const format = (req.query.format as string)?.toLowerCase();

      const conditions = [
        ne(checkPostInward.transactionType, "Passway/Transit"),
        eq(checkPostInward.status, "Verified"),
      ];
      if (from) conditions.push(gte(checkPostInward.entryDate, from));
      if (to) conditions.push(lte(checkPostInward.entryDate, to));
      if (checkPostId) conditions.push(eq(checkPostInward.checkPostId, checkPostId));

      const rows = await db
        .select({
          commodityId: checkPostInwardCommodities.commodityId,
          commodityName: commodities.name,
          unit: checkPostInwardCommodities.unit,
          totalQuantity: sql<number>`coalesce(sum(${checkPostInwardCommodities.quantity}), 0)::double precision`,
          totalValue: sql<number>`coalesce(sum(${checkPostInwardCommodities.value}), 0)::double precision`,
          lineCount: sql<number>`count(*)::int`,
        })
        .from(checkPostInwardCommodities)
        .innerJoin(checkPostInward, eq(checkPostInwardCommodities.inwardId, checkPostInward.id))
        .innerJoin(commodities, eq(checkPostInwardCommodities.commodityId, commodities.id))
        .where(and(...conditions))
        .groupBy(checkPostInwardCommodities.commodityId, commodities.name, checkPostInwardCommodities.unit);

      if (format === "csv") {
        const headers = ["commodityId", "commodityName", "unit", "totalQuantity", "totalValue", "lineCount"];
        const csv = [
          headers.join(","),
          ...rows.map((r) =>
            toCsvRow([r.commodityId, r.commodityName, r.unit, r.totalQuantity, r.totalValue, r.lineCount]),
          ),
        ].join("\r\n");
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", "attachment; filename=check-post-arrivals.csv");
        return res.send("\uFEFF" + csv);
      }

      res.json({
        description: "Aggregated check-post commodity lines; Passway/Transit excluded per client business rule.",
        from: from ?? null,
        to: to ?? null,
        checkPostId: checkPostId ?? null,
        count: rows.length,
        rows,
      });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to generate check-post arrivals report");
    }
  });

  /** Passway / transit volumes only (administrative charges; separate from main arrival totals). */
  app.get("/api/ioms/reports/check-post-passway-transit", async (req, res) => {
    try {
      const from = req.query.from as string | undefined;
      const to = req.query.to as string | undefined;
      const checkPostId = req.query.checkPostId as string | undefined;
      const format = (req.query.format as string)?.toLowerCase();

      const conditions = [eq(checkPostInward.transactionType, "Passway/Transit"), eq(checkPostInward.status, "Verified")];
      if (from) conditions.push(gte(checkPostInward.entryDate, from));
      if (to) conditions.push(lte(checkPostInward.entryDate, to));
      if (checkPostId) conditions.push(eq(checkPostInward.checkPostId, checkPostId));

      const rows = await db
        .select({
          commodityId: checkPostInwardCommodities.commodityId,
          commodityName: commodities.name,
          unit: checkPostInwardCommodities.unit,
          totalQuantity: sql<number>`coalesce(sum(${checkPostInwardCommodities.quantity}), 0)::double precision`,
          totalValue: sql<number>`coalesce(sum(${checkPostInwardCommodities.value}), 0)::double precision`,
          lineCount: sql<number>`count(*)::int`,
        })
        .from(checkPostInwardCommodities)
        .innerJoin(checkPostInward, eq(checkPostInwardCommodities.inwardId, checkPostInward.id))
        .innerJoin(commodities, eq(checkPostInwardCommodities.commodityId, commodities.id))
        .where(and(...conditions))
        .groupBy(checkPostInwardCommodities.commodityId, commodities.name, checkPostInwardCommodities.unit);

      if (format === "csv") {
        const headers = ["commodityId", "commodityName", "unit", "totalQuantity", "totalValue", "lineCount"];
        const csv = [
          headers.join(","),
          ...rows.map((r) =>
            toCsvRow([r.commodityId, r.commodityName, r.unit, r.totalQuantity, r.totalValue, r.lineCount]),
          ),
        ].join("\r\n");
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", "attachment; filename=check-post-passway-transit.csv");
        return res.send("\uFEFF" + csv);
      }

      res.json({
        description: "Passway/Transit commodity lines only (tracked separately from main arrivals).",
        from: from ?? null,
        to: to ?? null,
        checkPostId: checkPostId ?? null,
        count: rows.length,
        rows,
      });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to generate passway/transit report");
    }
  });

  // Rent invoice summary (yard-scoped; optional yardId, from, to on periodMonth)
  app.get("/api/ioms/reports/rent-summary", async (req, res) => {
    try {
      const yardId = req.query.yardId as string | undefined;
      const from = req.query.from as string | undefined;
      const to = req.query.to as string | undefined;
      const format = (req.query.format as string)?.toLowerCase();
      const scopedIds = (req as Express.Request & { scopedLocationIds?: string[] }).scopedLocationIds;

      const conditions = [];
      if (scopedIds && scopedIds.length > 0) conditions.push(inArray(rentInvoices.yardId, scopedIds));
      if (yardId) conditions.push(eq(rentInvoices.yardId, yardId));
      if (from) conditions.push(gte(rentInvoices.periodMonth, from));
      if (to) conditions.push(lte(rentInvoices.periodMonth, to));

      const base = db.select().from(rentInvoices).orderBy(desc(rentInvoices.periodMonth));
      const list = conditions.length > 0 ? await base.where(and(...conditions)) : await base;

      if (format === "csv") {
        const headers = ["id", "invoiceNo", "yardId", "periodMonth", "assetId", "rentAmount", "totalAmount", "status"];
        const rows = list.map((r) => [r.id, r.invoiceNo, r.yardId, r.periodMonth, r.assetId, r.rentAmount, r.totalAmount, r.status]);
        const csv = [headers.join(","), ...rows.map(toCsvRow)].join("\r\n");
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", "attachment; filename=rent-summary.csv");
        return res.send("\uFEFF" + csv);
      }

      if (req.query.paged === "1") {
        const { page, pageSize, q } = parseReportPaging(req);
        const { sortKey, sortDir } = parseReportSort(req, RENT_REPORT_SORT_ALLOW, "periodMonth");
        const pattern = reportSearchPattern(q);
        const all = [...conditions];
        if (pattern) {
          all.push(
            or(
              ilike(rentInvoices.invoiceNo, pattern),
              ilike(rentInvoices.assetId, pattern),
              ilike(rentInvoices.periodMonth, pattern),
              ilike(rentInvoices.status, pattern),
              ilike(rentInvoices.id, pattern),
              sql`cast(${rentInvoices.rentAmount} as text) ilike ${pattern}`,
              sql`cast(${rentInvoices.totalAmount} as text) ilike ${pattern}`,
            )!,
          );
        }
        const wc = all.length ? and(...all) : undefined;
        const countQ = db.select({ c: sql<number>`count(*)::int` }).from(rentInvoices);
        const [{ c: total }] = wc ? await countQ.where(wc) : await countQ;
        const rentBase = db.select().from(rentInvoices);
        const rentFiltered = wc ? rentBase.where(wc) : rentBase;
        const dataQ = rentFiltered.orderBy(...orderRentReport(sortKey, sortDir));
        const rows =
          pageSize === "all"
            ? await dataQ
            : await dataQ.limit(pageSize).offset((page - 1) * pageSize);
        return res.json({ total, page, pageSize, rows });
      }

      const summary = {
        count: list.length,
        totalRent: list.reduce((s, r) => s + Number(r.rentAmount ?? 0), 0),
        totalAmount: list.reduce((s, r) => s + Number(r.totalAmount ?? 0), 0),
        byStatus: list.reduce((acc, r) => {
          acc[r.status] = (acc[r.status] ?? 0) + 1;
          return acc;
        }, {} as Record<string, number>),
        rows: list,
      };
      res.json(summary);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to generate rent summary");
    }
  });

  // Voucher summary (yard-scoped)
  app.get("/api/ioms/reports/voucher-summary", async (req, res) => {
    try {
      const yardId = req.query.yardId as string | undefined;
      const from = req.query.from as string | undefined;
      const to = req.query.to as string | undefined;
      const format = (req.query.format as string)?.toLowerCase();
      const scopedIds = (req as Express.Request & { scopedLocationIds?: string[] }).scopedLocationIds;

      const conditions = [];
      if (scopedIds && scopedIds.length > 0) conditions.push(inArray(paymentVouchers.yardId, scopedIds));
      if (yardId) conditions.push(eq(paymentVouchers.yardId, yardId));
      if (from) conditions.push(gte(paymentVouchers.createdAt ?? "", from));
      if (to) conditions.push(lte(paymentVouchers.createdAt ?? "", to));

      const base = db.select().from(paymentVouchers).orderBy(desc(paymentVouchers.createdAt));
      const list = conditions.length > 0 ? await base.where(and(...conditions)) : await base;

      if (format === "csv") {
        const headers = ["id", "voucherNo", "yardId", "voucherType", "payeeName", "amount", "status", "createdAt"];
        const rows = list.map((r) => [r.id, r.voucherNo, r.yardId, r.voucherType, r.payeeName, r.amount, r.status, r.createdAt]);
        const csv = [headers.join(","), ...rows.map(toCsvRow)].join("\r\n");
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", "attachment; filename=voucher-summary.csv");
        return res.send("\uFEFF" + csv);
      }

      if (req.query.paged === "1") {
        const { page, pageSize, q } = parseReportPaging(req);
        const { sortKey, sortDir } = parseReportSort(req, VOUCHER_REPORT_SORT_ALLOW, "createdAt");
        const pattern = reportSearchPattern(q);
        const all = [...conditions];
        if (pattern) {
          all.push(
            or(
              ilike(paymentVouchers.voucherNo, pattern),
              ilike(paymentVouchers.payeeName, pattern),
              ilike(paymentVouchers.voucherType, pattern),
              ilike(paymentVouchers.status, pattern),
              ilike(paymentVouchers.id, pattern),
              ilike(paymentVouchers.yardId, pattern),
              sql`cast(${paymentVouchers.amount} as text) ilike ${pattern}`,
            )!,
          );
        }
        const wc = all.length ? and(...all) : undefined;
        const countQ = db.select({ c: sql<number>`count(*)::int` }).from(paymentVouchers);
        const [{ c: total }] = wc ? await countQ.where(wc) : await countQ;
        const voucherBase = db.select().from(paymentVouchers);
        const voucherFiltered = wc ? voucherBase.where(wc) : voucherBase;
        const dataQ = voucherFiltered.orderBy(...orderVoucherReport(sortKey, sortDir));
        const rows =
          pageSize === "all"
            ? await dataQ
            : await dataQ.limit(pageSize).offset((page - 1) * pageSize);
        return res.json({ total, page, pageSize, rows });
      }

      const summary = {
        count: list.length,
        totalAmount: list.reduce((s, r) => s + Number(r.amount ?? 0), 0),
        byStatus: list.reduce((acc, r) => {
          acc[r.status] = (acc[r.status] ?? 0) + 1;
          return acc;
        }, {} as Record<string, number>),
        rows: list,
      };
      res.json(summary);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to generate voucher summary");
    }
  });

  // Receipt register (yard-scoped)
  app.get("/api/ioms/reports/receipt-register", async (req, res) => {
    try {
      const yardId = req.query.yardId as string | undefined;
      const from = req.query.from as string | undefined;
      const to = req.query.to as string | undefined;
      const format = (req.query.format as string)?.toLowerCase();
      const scopedIds = (req as Express.Request & { scopedLocationIds?: string[] }).scopedLocationIds;

      const conditions = [];
      if (scopedIds && scopedIds.length > 0) conditions.push(inArray(iomsReceipts.yardId, scopedIds));
      if (yardId) conditions.push(eq(iomsReceipts.yardId, yardId));
      if (from) conditions.push(gte(iomsReceipts.createdAt, from));
      if (to) conditions.push(lte(iomsReceipts.createdAt, to));

      const base = db.select().from(iomsReceipts).orderBy(desc(iomsReceipts.createdAt));
      const list = conditions.length > 0 ? await base.where(and(...conditions)) : await base;

      if (format === "csv") {
        const headers = [
          "id",
          "receiptNo",
          "yardId",
          "revenueHead",
          "payerName",
          "unifiedEntityId",
          "amount",
          "totalAmount",
          "paymentMode",
          "status",
          "createdAt",
        ];
        const rows = list.map((r) => [
          r.id,
          r.receiptNo,
          r.yardId,
          r.revenueHead,
          r.payerName,
          r.unifiedEntityId,
          r.amount,
          r.totalAmount,
          r.paymentMode,
          r.status,
          r.createdAt,
        ]);
        const csv = [headers.join(","), ...rows.map(toCsvRow)].join("\r\n");
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", "attachment; filename=receipt-register.csv");
        return res.send("\uFEFF" + csv);
      }

      if (req.query.paged === "1") {
        const { page, pageSize, q } = parseReportPaging(req);
        const { sortKey, sortDir } = parseReportSort(req, RECEIPT_REPORT_SORT_ALLOW, "createdAt");
        const pattern = reportSearchPattern(q);
        const all = [...conditions];
        if (pattern) {
          all.push(
            or(
              ilike(iomsReceipts.receiptNo, pattern),
              ilike(iomsReceipts.payerName, pattern),
              ilike(iomsReceipts.revenueHead, pattern),
              ilike(iomsReceipts.paymentMode, pattern),
              ilike(iomsReceipts.status, pattern),
              ilike(iomsReceipts.id, pattern),
              ilike(iomsReceipts.unifiedEntityId, pattern),
              sql`cast(${iomsReceipts.amount} as text) ilike ${pattern}`,
              sql`cast(${iomsReceipts.totalAmount} as text) ilike ${pattern}`,
            )!,
          );
        }
        const wc = all.length ? and(...all) : undefined;
        const countQ = db.select({ c: sql<number>`count(*)::int` }).from(iomsReceipts);
        const [{ c: total }] = wc ? await countQ.where(wc) : await countQ;
        const receiptBase = db.select().from(iomsReceipts);
        const receiptFiltered = wc ? receiptBase.where(wc) : receiptBase;
        const dataQ = receiptFiltered.orderBy(...orderReceiptReport(sortKey, sortDir));
        const rows =
          pageSize === "all"
            ? await dataQ
            : await dataQ.limit(pageSize).offset((page - 1) * pageSize);
        return res.json({ total, page, pageSize, rows });
      }

      const summary = {
        count: list.length,
        totalAmount: list.reduce((s, r) => s + Number(r.totalAmount ?? 0), 0),
        byStatus: list.reduce((acc, r) => {
          acc[r.status] = (acc[r.status] ?? 0) + 1;
          return acc;
        }, {} as Record<string, number>),
        rows: list,
      };
      res.json(summary);
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to generate receipt register");
    }
  });

  // Staff list (HR M-01); optional yardId filter
  app.get("/api/hr/reports/staff-list", async (req, res) => {
    try {
      const yardId = req.query.yardId as string | undefined;
      const format = (req.query.format as string)?.toLowerCase();
      const baseConditions = [];
      if (yardId) baseConditions.push(eq(employees.yardId, yardId));
      const baseOrder = desc(employees.joiningDate);
      const listQuery = db.select().from(employees).orderBy(baseOrder);
      const list =
        baseConditions.length > 0 ? await listQuery.where(and(...baseConditions)) : await listQuery;

      if (format === "csv") {
        const headers = [
          "empId",
          "firstName",
          "middleName",
          "surname",
          "designation",
          "yardId",
          "employeeType",
          "joiningDate",
          "status",
          "mobile",
          "workEmail",
          "personalEmail",
          "panMasked",
          "dob",
          "retirementDate",
        ];
        const rows = list.map((r) => [
          r.empId,
          r.firstName,
          r.middleName,
          r.surname,
          r.designation,
          r.yardId,
          r.employeeType,
          r.joiningDate,
          r.status,
          r.mobile,
          r.workEmail,
          r.personalEmail,
          maskPanForExport(r.pan),
          r.dob,
          r.retirementDate,
        ]);
        const csv = [headers.join(","), ...rows.map(toCsvRow)].join("\r\n");
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", "attachment; filename=staff-list.csv");
        return res.send("\uFEFF" + csv);
      }

      if (req.query.paged === "1") {
        const { page, pageSize, q } = parseReportPaging(req);
        const { sortKey, sortDir } = parseReportSort(req, STAFF_REPORT_SORT_ALLOW, "joiningDate");
        const pattern = reportSearchPattern(q);
        const all = [...baseConditions];
        if (pattern) {
          all.push(
            or(
              ilike(employees.empId, pattern),
              ilike(employees.firstName, pattern),
              ilike(employees.middleName, pattern),
              ilike(employees.surname, pattern),
              ilike(employees.designation, pattern),
              ilike(employees.mobile, pattern),
              ilike(employees.workEmail, pattern),
              ilike(employees.personalEmail, pattern),
              ilike(employees.id, pattern),
              ilike(employees.status, pattern),
            )!,
          );
        }
        const wc = all.length ? and(...all) : undefined;
        const countQ = db.select({ c: sql<number>`count(*)::int` }).from(employees);
        const [{ c: total }] = wc ? await countQ.where(wc) : await countQ;
        const staffBase = db.select().from(employees);
        const staffFiltered = wc ? staffBase.where(wc) : staffBase;
        const dataQ = staffFiltered.orderBy(...orderStaffReport(sortKey, sortDir));
        const rows =
          pageSize === "all"
            ? await dataQ
            : await dataQ.limit(pageSize).offset((page - 1) * pageSize);
        return res.json({ total, page, pageSize, rows });
      }

      res.json({ count: list.length, rows: list });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to generate staff list");
    }
  });

  // Consolidated HR (M-01): summary counts by yard, status, employeeType
  app.get("/api/hr/reports/consolidated", async (req, res) => {
    try {
      const yardId = req.query.yardId as string | undefined;
      const list = yardId
        ? await db.select().from(employees).where(eq(employees.yardId, yardId))
        : await db.select().from(employees);

      const byYard: Record<string, number> = {};
      const byStatus: Record<string, number> = {};
      const byEmployeeType: Record<string, number> = {};
      for (const r of list) {
        byYard[r.yardId] = (byYard[r.yardId] ?? 0) + 1;
        byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
        byEmployeeType[r.employeeType] = (byEmployeeType[r.employeeType] ?? 0) + 1;
      }
      res.json({
        total: list.length,
        byYard,
        byStatus,
        byEmployeeType,
      });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to generate consolidated HR report");
    }
  });

  /**
   * Tally-oriented export: IOMS receipts + payment vouchers with mapped ledger names.
   * Query: from, to (ISO date on createdAt), format=csv | xml (default json).
   * CSV: `columns=srs` uses agreed column order (Date, Voucher Type, Receipt No., Party Name, Ledger Head, Tally Group, Amount (Dr), Amount (Cr), Narration); omit for legacy columns.
   * XML: interchange v1 (`gapmcTallyExport`); gated by `tally_xml_export_enabled` in system_config.
   */
  app.get("/api/ioms/reports/tally-export", async (req, res) => {
    try {
      const from = req.query.from as string | undefined;
      const to = req.query.to as string | undefined;
      const format = (req.query.format as string)?.toLowerCase();
      const scopedIds = (req as Express.Request & { scopedLocationIds?: string[] }).scopedLocationIds;

      const receiptConditions = [];
      if (scopedIds && scopedIds.length > 0) receiptConditions.push(inArray(iomsReceipts.yardId, scopedIds));
      if (from) receiptConditions.push(gte(iomsReceipts.createdAt, from));
      if (to) receiptConditions.push(lte(iomsReceipts.createdAt, to));

      const receiptBase = db
        .select({
          kind: sql<string>`'receipt'`,
          docNo: iomsReceipts.receiptNo,
          date: iomsReceipts.createdAt,
          yardId: iomsReceipts.yardId,
          revenueHead: iomsReceipts.revenueHead,
          payerName: iomsReceipts.payerName,
          unifiedEntityId: iomsReceipts.unifiedEntityId,
          amount: iomsReceipts.amount,
          cgst: iomsReceipts.cgst,
          sgst: iomsReceipts.sgst,
          totalAmount: iomsReceipts.totalAmount,
          tallyLedgerName: tallyLedgers.ledgerName,
          tallyLedgerId: tallyLedgers.id,
          tallyGroup: tallyLedgers.primaryGroup,
        })
        .from(iomsReceipts)
        .leftJoin(iomsRevenueHeadLedgerMap, eq(iomsReceipts.revenueHead, iomsRevenueHeadLedgerMap.revenueHead))
        .leftJoin(tallyLedgers, eq(iomsRevenueHeadLedgerMap.tallyLedgerId, tallyLedgers.id))
        .orderBy(desc(iomsReceipts.createdAt));

      const receiptRows =
        receiptConditions.length > 0 ? await receiptBase.where(and(...receiptConditions)) : await receiptBase;

      const voucherConditions = [];
      if (scopedIds && scopedIds.length > 0) voucherConditions.push(inArray(paymentVouchers.yardId, scopedIds));
      if (from) voucherConditions.push(gte(paymentVouchers.createdAt, from));
      if (to) voucherConditions.push(lte(paymentVouchers.createdAt, to));

      const voucherBase = db
        .select({
          kind: sql<string>`'voucher'`,
          docNo: paymentVouchers.voucherNo,
          date: paymentVouchers.createdAt,
          yardId: paymentVouchers.yardId,
          revenueHead: expenditureHeads.description,
          payeeName: paymentVouchers.payeeName,
          voucherType: paymentVouchers.voucherType,
          amount: paymentVouchers.amount,
          cgst: sql<number>`0`,
          sgst: sql<number>`0`,
          totalAmount: paymentVouchers.amount,
          tallyLedgerName: tallyLedgers.ledgerName,
          tallyLedgerId: tallyLedgers.id,
          tallyGroup: tallyLedgers.primaryGroup,
        })
        .from(paymentVouchers)
        .innerJoin(expenditureHeads, eq(paymentVouchers.expenditureHeadId, expenditureHeads.id))
        .leftJoin(tallyLedgers, eq(expenditureHeads.tallyLedgerId, tallyLedgers.id))
        .orderBy(desc(paymentVouchers.createdAt));

      const voucherRows =
        voucherConditions.length > 0 ? await voucherBase.where(and(...voucherConditions)) : await voucherBase;

      const rows = [...receiptRows, ...voucherRows].sort((a, b) => String(b.date).localeCompare(String(a.date)));

      const columnsParam = String(req.query.columns ?? req.query.tallyColumns ?? "").toLowerCase();
      const useSrsColumns = columnsParam === "srs";

      if (format === "xml") {
        const cfg = await getMergedSystemConfig();
        if (String(cfg.tally_xml_export_enabled ?? "true").trim().toLowerCase() !== "true") {
          return sendApiError(
            res,
            403,
            "TALLY_XML_DISABLED",
            "Tally interchange XML is disabled in Admin → Config (tally_xml_export_enabled).",
          );
        }
        const flat: TallyExportFlatRow[] = rows.map((r) => ({
          kind: r.kind,
          docNo: r.docNo,
          date: r.date,
          yardId: r.yardId,
          revenueHead: r.revenueHead,
          payerName: (r as { payerName?: string | null }).payerName,
          payeeName: (r as { payeeName?: string | null }).payeeName,
          voucherType: (r as { voucherType?: string | null }).voucherType,
          unifiedEntityId: (r as { unifiedEntityId?: string | null }).unifiedEntityId,
          amount: r.amount,
          cgst: r.cgst,
          sgst: r.sgst,
          totalAmount: r.totalAmount,
          tallyLedgerName: r.tallyLedgerName,
          tallyLedgerId: r.tallyLedgerId,
          tallyGroup: r.tallyGroup,
        }));
        const xml = buildGapmcTallyInterchangeXmlV1({
          rows: flat,
          from,
          to,
          generatedAt: new Date().toISOString(),
        });
        res.setHeader("Content-Type", "application/xml; charset=utf-8");
        res.setHeader("Content-Disposition", "attachment; filename=tally-export-gapmc-v1.xml");
        return res.send(xml);
      }

      if (format === "csv") {
        if (useSrsColumns) {
          const srsHeaders = [
            "Date",
            "Voucher Type",
            "Receipt No.",
            "Party Name",
            "Ledger Head",
            "Tally Group",
            "Amount (Dr)",
            "Amount (Cr)",
            "Narration",
          ];
          const csv = [
            srsHeaders.join(","),
            ...rows.map((r) => {
              const dateOnly = String(r.date ?? "").slice(0, 10);
              const isReceipt = r.kind === "receipt";
              const voucherType = isReceipt ? "Receipt" : "Payment";
              const party = isReceipt
                ? String((r as { payerName?: string | null }).payerName ?? "")
                : String((r as { payeeName?: string | null }).payeeName ?? "");
              const ledger = r.tallyLedgerName ?? "";
              const group = r.tallyGroup ?? "";
              const total = Number(r.totalAmount ?? 0);
              const dr = isReceipt ? String(total) : "";
              const cr = isReceipt ? "" : String(total);
              const vt = (r as { voucherType?: string | null }).voucherType;
              const uid = String((r as { unifiedEntityId?: string | null }).unifiedEntityId ?? "").trim();
              const narration = (
                isReceipt
                  ? `IOMS receipt ${r.docNo} ${r.revenueHead ?? ""}`.trim()
                  : `IOMS payment ${r.docNo} ${[r.revenueHead, vt].filter(Boolean).join(" · ")}`.trim()
              ).concat(uid ? ` · ${uid}` : "");
              return toCsvRow([dateOnly, voucherType, r.docNo, party, ledger, group, dr, cr, narration]);
            }),
          ].join("\r\n");
          res.setHeader("Content-Type", "text/csv; charset=utf-8");
          res.setHeader("Content-Disposition", "attachment; filename=tally-export-srs.csv");
          return res.send("\uFEFF" + csv);
        }

        const headers = [
          "kind",
          "docNo",
          "date",
          "yardId",
          "head",
          "unifiedEntityId",
          "amount",
          "cgst",
          "sgst",
          "totalAmount",
          "tallyLedgerId",
          "tallyLedgerName",
        ];
        const csv = [
          headers.join(","),
          ...rows.map((r) =>
            toCsvRow([
              r.kind,
              r.docNo,
              r.date,
              r.yardId,
              r.revenueHead,
              (r as { unifiedEntityId?: string | null }).unifiedEntityId ?? "",
              r.amount,
              r.cgst,
              r.sgst,
              r.totalAmount,
              r.tallyLedgerId,
              r.tallyLedgerName,
            ])
          ),
        ].join("\r\n");
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", "attachment; filename=tally-export.csv");
        return res.send("\uFEFF" + csv);
      }

      res.json({
        count: rows.length,
        rows,
        tallyCsvLayouts: ["legacy", "srs"],
        tallyFormats: ["csv", "xml"],
        tallyXmlNote:
          "format=xml emits gapmcTallyExport v1 interchange XML (map to Tally Prime in UAT). Disabled when tally_xml_export_enabled=false.",
      });
    } catch (e) {
      console.error(e);
      sendApiError(res, 500, "INTERNAL_ERROR", "Failed to generate Tally export");
    }
  });
}
