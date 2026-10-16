/**
 * Organisation Employee Leave Report — sanctioned leave for a date or date range.
 * Specimen: Employees_Leave_report_for_Organisation.pdf
 */
import PDFDocument from "pdfkit";
import { and, asc, eq, inArray, lte, gte } from "drizzle-orm";
import { formatLeaveOrderDateDisplay } from "@shared/hr-leave-display";
import { parseAdditionalChargeYardIds } from "@shared/hr-additional-charge-locations";
import { db } from "./db";
import { employees, leaveRequests, yards } from "@shared/db-schema";
import { LEAVE_BALANCE_TYPE_LABELS, normalizeLeaveBalanceType } from "./hr-leave-balance-resolve";

export type EmployeeLeaveReportMode = "date" | "range";

export type EmployeeLeaveReportRow = {
  srNo: number;
  empId: string;
  employeeName: string;
  designation: string;
  primaryLocation: string;
  secondaryLocation: string;
  thirdLocation: string;
  leaveType: string;
  daysInPeriod: number;
  sanctionedPeriod: string;
  fromDate: string;
  toDate: string;
};

export type EmployeeLeaveReportPayload = {
  title: string;
  mode: EmployeeLeaveReportMode;
  fromDate: string;
  toDate: string;
  filterLabel: string;
  generatedAtDisplay: string;
  rows: EmployeeLeaveReportRow[];
};

function empDisplayName(e: {
  firstName: string;
  middleName?: string | null;
  surname: string;
}): string {
  return [e.firstName, e.middleName, e.surname].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function parseIso(ymd: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.slice(0, 10));
  if (!m) return NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Inclusive overlap days between [aFrom,aTo] and [bFrom,bTo] (ISO dates). */
export function inclusiveOverlapDays(aFrom: string, aTo: string, bFrom: string, bTo: string): number {
  const a0 = parseIso(aFrom);
  const a1 = parseIso(aTo);
  const b0 = parseIso(bFrom);
  const b1 = parseIso(bTo);
  if (![a0, a1, b0, b1].every(Number.isFinite) || a1 < a0 || b1 < b0) return 0;
  const start = Math.max(a0, b0);
  const end = Math.min(a1, b1);
  if (end < start) return 0;
  return Math.round((end - start) / 86400000) + 1;
}

function formatPeriodLong(fromIso: string, toIso: string): string {
  const from = formatLeaveOrderDateDisplay(fromIso).replace(/\//g, " ");
  // specimen uses "10 Oct 2026" — convert DD/MM/YYYY → "DD Mon YYYY"
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const fmt = (iso: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.slice(0, 10));
    if (!m) return formatLeaveOrderDateDisplay(iso);
    return `${Number(m[3])} ${monthNames[Number(m[2]) - 1]} ${m[1]}`;
  };
  const a = fmt(fromIso);
  const b = fmt(toIso);
  return a === b ? a : `${a} to ${b}`;
  void from;
}

function longDateTimeNow(): string {
  const d = new Date();
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

export async function buildEmployeeLeaveReport(opts: {
  mode: EmployeeLeaveReportMode;
  date?: string;
  fromDate?: string;
  toDate?: string;
}): Promise<EmployeeLeaveReportPayload> {
  let fromDate: string;
  let toDate: string;
  let filterLabel: string;
  let title: string;

  if (opts.mode === "date") {
    const d = String(opts.date ?? "").trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error("date must be YYYY-MM-DD");
    fromDate = d;
    toDate = d;
    const disp = formatLeaveOrderDateDisplay(d);
    filterLabel = `On a Particular Date  [ ${disp.replace(/\//g, "-")} ]`;
    title = `Employee Leave Report for a Selected Date  [ ${disp.replace(/\//g, "-")} ]`;
  } else {
    fromDate = String(opts.fromDate ?? "").trim().slice(0, 10);
    toDate = String(opts.toDate ?? "").trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate) || fromDate > toDate) {
      throw new Error("fromDate and toDate must be YYYY-MM-DD with fromDate <= toDate");
    }
    const a = formatLeaveOrderDateDisplay(fromDate).replace(/\//g, "-");
    const b = formatLeaveOrderDateDisplay(toDate).replace(/\//g, "-");
    filterLabel = `Between a Date Range  From Date [ ${a} ] to Date  [ ${b} ]`;
    title = `Employee Leave Report for Date Range  [ ${a} ] to  [ ${b} ]`;
  }

  const leaves = await db
    .select()
    .from(leaveRequests)
    .where(
      and(
        eq(leaveRequests.status, "Approved"),
        lte(leaveRequests.fromDate, toDate),
        gte(leaveRequests.toDate, fromDate),
      ),
    )
    .orderBy(asc(leaveRequests.fromDate));

  const empIds = [...new Set(leaves.map((l) => l.employeeId))];
  const empRows =
    empIds.length === 0
      ? []
      : await db.select().from(employees).where(inArray(employees.id, empIds));
  const empById = new Map(empRows.map((e) => [e.id, e]));

  const yardIds = new Set<string>();
  for (const e of empRows) {
    if (e.yardId) yardIds.add(e.yardId);
    for (const id of parseAdditionalChargeYardIds(e.locationPosted, e.yardId)) yardIds.add(id);
  }
  const yardRows =
    yardIds.size === 0 ? [] : await db.select().from(yards).where(inArray(yards.id, [...yardIds]));
  const yardById = new Map(yardRows.map((y) => [y.id, y]));
  const yardName = (id: string | null | undefined) => {
    if (!id) return "—";
    const y = yardById.get(id);
    return (y?.name ?? y?.code ?? id).trim() || "—";
  };

  const rows: EmployeeLeaveReportRow[] = [];
  let sr = 0;
  for (const lr of leaves) {
    const emp = empById.get(lr.employeeId);
    if (!emp) continue;
    const days = inclusiveOverlapDays(String(lr.fromDate), String(lr.toDate), fromDate, toDate);
    if (days <= 0) continue;
    const add = parseAdditionalChargeYardIds(emp.locationPosted, emp.yardId);
    const code = normalizeLeaveBalanceType(lr.leaveType);
    const leaveLabel = LEAVE_BALANCE_TYPE_LABELS[code] ?? lr.leaveType;
    sr += 1;
    rows.push({
      srNo: sr,
      empId: (emp.empId && String(emp.empId).trim()) || emp.id,
      employeeName: empDisplayName(emp),
      designation: String(emp.designation ?? "").trim() || "—",
      primaryLocation: yardName(emp.yardId),
      secondaryLocation: add[0] ? yardName(add[0]) : "—",
      thirdLocation: add[1] ? yardName(add[1]) : "—",
      leaveType: leaveLabel,
      daysInPeriod: days,
      sanctionedPeriod: formatPeriodLong(String(lr.fromDate), String(lr.toDate)),
      fromDate: String(lr.fromDate).slice(0, 10),
      toDate: String(lr.toDate).slice(0, 10),
    });
  }

  return {
    title,
    mode: opts.mode,
    fromDate,
    toDate,
    filterLabel,
    generatedAtDisplay: longDateTimeNow(),
    rows,
  };
}

export function buildEmployeeLeaveReportAoa(payload: EmployeeLeaveReportPayload): (string | number)[][] {
  const headers = [
    "Sr. No.",
    "Employee ID",
    "Employee Name",
    "Designation",
    "Primary Location Posted",
    "Secondary Location Posted (Additional Charge)",
    "Third Location Posted (Additional Charge)",
    "Leave Type",
    "Days in Report Period",
    "Actual Sanctioned Leave Period",
  ];
  return [
    [payload.title],
    [`Filter Criteria : ${payload.filterLabel}`],
    [`Generated : ${payload.generatedAtDisplay}`],
    [],
    headers,
    ...payload.rows.map((r) => [
      r.srNo,
      r.empId,
      r.employeeName,
      r.designation,
      r.primaryLocation,
      r.secondaryLocation,
      r.thirdLocation,
      r.leaveType,
      r.daysInPeriod,
      r.sanctionedPeriod,
    ]),
  ];
}

export async function generateEmployeeLeaveReportPdf(payload: EmployeeLeaveReportPayload): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 28 });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));

  doc.font("Helvetica-Bold").fontSize(11).text(payload.title, { align: "center" });
  doc.moveDown(0.3);
  doc.font("Helvetica").fontSize(8).text(`Filter Criteria : ${payload.filterLabel}`, { align: "left" });
  doc.text(`Generated : ${payload.generatedAtDisplay}`);
  doc.moveDown(0.5);

  const headers = [
    "Sr.",
    "Emp ID",
    "Employee Name",
    "Designation",
    "Primary Location",
    "Secondary Loc.",
    "Third Loc.",
    "Leave Type",
    "Days",
    "Sanctioned Period",
  ];
  const widths = [28, 55, 95, 85, 90, 80, 80, 75, 35, 110];
  const startX = 28;
  let y = doc.y;

  const drawHeader = () => {
    doc.font("Helvetica-Bold").fontSize(7);
    let x = startX;
    headers.forEach((h, i) => {
      doc.text(h, x, y, { width: widths[i], align: "left" });
      x += widths[i]!;
    });
    y += 18;
    doc.moveTo(startX, y - 4).lineTo(startX + widths.reduce((a, b) => a + b, 0), y - 4).stroke("#444");
  };

  drawHeader();
  doc.font("Helvetica").fontSize(7);

  if (payload.rows.length === 0) {
    doc.text("No sanctioned leave found for the selected criteria.", startX, y);
  } else {
    for (const r of payload.rows) {
      const cells = [
        String(r.srNo),
        r.empId,
        r.employeeName,
        r.designation,
        r.primaryLocation,
        r.secondaryLocation,
        r.thirdLocation,
        r.leaveType,
        String(r.daysInPeriod),
        r.sanctionedPeriod,
      ];
      let rowH = 12;
      cells.forEach((c, i) => {
        rowH = Math.max(rowH, doc.heightOfString(c, { width: widths[i]! - 2 }));
      });
      if (y + rowH > doc.page.height - 36) {
        doc.addPage();
        y = doc.page.margins.top;
        drawHeader();
        doc.font("Helvetica").fontSize(7);
      }
      let x = startX;
      cells.forEach((c, i) => {
        doc.text(c, x, y, { width: widths[i]! - 2, align: i === 0 || i === 8 ? "center" : "left" });
        x += widths[i]!;
      });
      y += rowH + 4;
    }
  }

  doc.end();
  await new Promise<void>((resolve) => doc.on("end", resolve));
  return Buffer.concat(chunks);
}
