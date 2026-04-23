/**
 * Server-side ORDER BY builders for paged IOMS report APIs (whitelist keys from parseReportSort).
 */
import { asc, desc, type SQL } from "drizzle-orm";
import {
  rentInvoices,
  paymentVouchers,
  iomsReceipts,
  employees,
  traderLicences,
} from "@shared/db-schema";
import type { ReportSortDir } from "./report-paging";

function o(column: Parameters<typeof asc>[0], dir: ReportSortDir): SQL {
  return dir === "asc" ? asc(column) : desc(column);
}

export const RENT_REPORT_SORT_ALLOW = [
  "invoiceNo",
  "yardId",
  "periodMonth",
  "assetId",
  "rentAmount",
  "totalAmount",
  "status",
  "id",
] as const;

export function orderRentReport(sortKey: string, sortDir: ReportSortDir): SQL[] {
  const map: Record<string, SQL> = {
    invoiceNo: o(rentInvoices.invoiceNo, sortDir),
    yardId: o(rentInvoices.yardId, sortDir),
    periodMonth: o(rentInvoices.periodMonth, sortDir),
    assetId: o(rentInvoices.assetId, sortDir),
    rentAmount: o(rentInvoices.rentAmount, sortDir),
    totalAmount: o(rentInvoices.totalAmount, sortDir),
    status: o(rentInvoices.status, sortDir),
    id: o(rentInvoices.id, sortDir),
  };
  const primary = map[sortKey] ?? desc(rentInvoices.periodMonth);
  if (sortKey === "id") return [primary];
  return [primary, desc(rentInvoices.id)];
}

export const VOUCHER_REPORT_SORT_ALLOW = [
  "voucherNo",
  "yardId",
  "voucherType",
  "payeeName",
  "amount",
  "status",
  "createdAt",
  "id",
] as const;

export function orderVoucherReport(sortKey: string, sortDir: ReportSortDir): SQL[] {
  const map: Record<string, SQL> = {
    voucherNo: o(paymentVouchers.voucherNo, sortDir),
    yardId: o(paymentVouchers.yardId, sortDir),
    voucherType: o(paymentVouchers.voucherType, sortDir),
    payeeName: o(paymentVouchers.payeeName, sortDir),
    amount: o(paymentVouchers.amount, sortDir),
    status: o(paymentVouchers.status, sortDir),
    createdAt: o(paymentVouchers.createdAt, sortDir),
    id: o(paymentVouchers.id, sortDir),
  };
  const primary = map[sortKey] ?? desc(paymentVouchers.createdAt);
  if (sortKey === "id") return [primary];
  return [primary, desc(paymentVouchers.id)];
}

export const RECEIPT_REPORT_SORT_ALLOW = [
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
  "id",
] as const;

export function orderReceiptReport(sortKey: string, sortDir: ReportSortDir): SQL[] {
  const map: Record<string, SQL> = {
    receiptNo: o(iomsReceipts.receiptNo, sortDir),
    yardId: o(iomsReceipts.yardId, sortDir),
    revenueHead: o(iomsReceipts.revenueHead, sortDir),
    payerName: o(iomsReceipts.payerName, sortDir),
    unifiedEntityId: o(iomsReceipts.unifiedEntityId, sortDir),
    amount: o(iomsReceipts.amount, sortDir),
    totalAmount: o(iomsReceipts.totalAmount, sortDir),
    paymentMode: o(iomsReceipts.paymentMode, sortDir),
    status: o(iomsReceipts.status, sortDir),
    createdAt: o(iomsReceipts.createdAt, sortDir),
    id: o(iomsReceipts.id, sortDir),
  };
  const primary = map[sortKey] ?? desc(iomsReceipts.createdAt);
  if (sortKey === "id") return [primary];
  return [primary, desc(iomsReceipts.id)];
}

export const STAFF_REPORT_SORT_ALLOW = [
  "empId",
  "firstName",
  "surname",
  "designation",
  "joiningDate",
  "yardId",
  "mobile",
  "status",
  "id",
] as const;

export function orderStaffReport(sortKey: string, sortDir: ReportSortDir): SQL[] {
  const map: Record<string, SQL> = {
    empId: o(employees.empId, sortDir),
    firstName: o(employees.firstName, sortDir),
    surname: o(employees.surname, sortDir),
    designation: o(employees.designation, sortDir),
    joiningDate: o(employees.joiningDate, sortDir),
    yardId: o(employees.yardId, sortDir),
    mobile: o(employees.mobile, sortDir),
    status: o(employees.status, sortDir),
    id: o(employees.id, sortDir),
  };
  const primary = map[sortKey] ?? desc(employees.joiningDate);
  if (sortKey === "id") return [primary];
  return [primary, desc(employees.id)];
}

export const LICENCE_REPORT_SORT_ALLOW = [
  "licenceNo",
  "firmName",
  "licenceType",
  "mobile",
  "yardId",
  "validTo",
  "validFrom",
  "status",
  "feeAmount",
  "createdAt",
  "id",
] as const;

export function orderLicenceReport(sortKey: string, sortDir: ReportSortDir): SQL[] {
  const map: Record<string, SQL> = {
    licenceNo: o(traderLicences.licenceNo, sortDir),
    firmName: o(traderLicences.firmName, sortDir),
    licenceType: o(traderLicences.licenceType, sortDir),
    mobile: o(traderLicences.mobile, sortDir),
    yardId: o(traderLicences.yardId, sortDir),
    validTo: o(traderLicences.validTo, sortDir),
    validFrom: o(traderLicences.validFrom, sortDir),
    status: o(traderLicences.status, sortDir),
    feeAmount: o(traderLicences.feeAmount, sortDir),
    createdAt: o(traderLicences.createdAt, sortDir),
    id: o(traderLicences.id, sortDir),
  };
  const primary = map[sortKey] ?? desc(traderLicences.createdAt);
  if (sortKey === "id") return [primary];
  return [primary, desc(traderLicences.id)];
}
