/**
 * IOMS yard-scoped reports and CSV/Excel export.
 * All reports filter by req.scopedLocationIds when present.
 */
import type { Express } from "express";
import { eq, desc, and, inArray, gte, lte } from "drizzle-orm";
import { db } from "./db";
import { rentInvoices, paymentVouchers, iomsReceipts, employees } from "@shared/db-schema";

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
      res.status(500).json({ error: "Failed to generate rent summary" });
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
      res.status(500).json({ error: "Failed to generate voucher summary" });
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
        const headers = ["id", "receiptNo", "yardId", "revenueHead", "payerName", "amount", "totalAmount", "paymentMode", "status", "createdAt"];
        const rows = list.map((r) => [r.id, r.receiptNo, r.yardId, r.revenueHead, r.payerName, r.amount, r.totalAmount, r.paymentMode, r.status, r.createdAt]);
        const csv = [headers.join(","), ...rows.map(toCsvRow)].join("\r\n");
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", "attachment; filename=receipt-register.csv");
        return res.send("\uFEFF" + csv);
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
      res.status(500).json({ error: "Failed to generate receipt register" });
    }
  });

  // Staff list (HR M-01); optional yardId filter
  app.get("/api/hr/reports/staff-list", async (req, res) => {
    try {
      const yardId = req.query.yardId as string | undefined;
      const format = (req.query.format as string)?.toLowerCase();
      const list = yardId
        ? await db.select().from(employees).where(eq(employees.yardId, yardId)).orderBy(desc(employees.joiningDate))
        : await db.select().from(employees).orderBy(desc(employees.joiningDate));

      if (format === "csv") {
        const headers = ["empId", "firstName", "middleName", "surname", "designation", "yardId", "employeeType", "joiningDate", "status", "mobile", "workEmail", "dob", "retirementDate"];
        const rows = list.map((r) => [r.empId, r.firstName, r.middleName, r.surname, r.designation, r.yardId, r.employeeType, r.joiningDate, r.status, r.mobile, r.workEmail, r.dob, r.retirementDate]);
        const csv = [headers.join(","), ...rows.map(toCsvRow)].join("\r\n");
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", "attachment; filename=staff-list.csv");
        return res.send("\uFEFF" + csv);
      }

      res.json({ count: list.length, rows: list });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to generate staff list" });
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
      res.status(500).json({ error: "Failed to generate consolidated HR report" });
    }
  });
}
