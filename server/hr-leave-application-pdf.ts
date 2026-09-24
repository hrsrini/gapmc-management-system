/**
 * Printable leave application PDFs — specimen-aligned layouts per leave type.
 * Form-1 (CCS Leave Rules 1972 Rule 14): EL / HPL / COMMUTED / ML / PL / EOL / CCL
 * Short letter: CL / RH / SPL_H
 */
import PDFDocument from "pdfkit";
import { and, desc, eq, ne } from "drizzle-orm";
import { formatLeaveOrderDateDisplay } from "@shared/hr-leave-display";
import { db } from "./db";
import { employees, leaveRequests, employeeLeaveBalances, yards, users } from "@shared/db-schema";

export const LEAVE_TYPE_LABELS: Record<string, string> = {
  EL: "Earned Leave",
  HPL: "Half Pay Leave",
  COMMUTED: "Commuted Leave",
  CL: "Casual Leave",
  RH: "Restricted Holiday",
  SPL_H: "Special Holiday",
  ML: "Maternity Leave",
  PL: "Paternity Leave",
  EOL: "Extraordinary Leave",
  CCL: "Child Care Leave",
};

const SHORT_FORM_TYPES = new Set(["CL", "RH", "SPL_H"]);

function empDisplayName(emp: {
  firstName: string;
  middleName?: string | null;
  surname: string;
}): string {
  return `${emp.firstName} ${emp.middleName ?? ""} ${emp.surname}`.replace(/\s+/g, " ").trim();
}

function payLine(emp: { basicPayInr?: number | null; payLevel?: number | null }): string {
  const parts: string[] = [];
  if (emp.basicPayInr != null && Number.isFinite(Number(emp.basicPayInr))) {
    parts.push(`Rs. ${Number(emp.basicPayInr).toLocaleString("en-IN")}/-`);
  }
  if (emp.payLevel != null) parts.push(`(Pay Matrix Level ${emp.payLevel})`);
  return parts.length ? parts.join(" ") : "Rs. ___________/- (Pay Matrix Level ___)";
}

function fmtDate(iso: string | null | undefined): string {
  return formatLeaveOrderDateDisplay(iso) || "—";
}

function blankOr(value: string | null | undefined, blank = "_______________"): string {
  const t = String(value ?? "").trim();
  return t || blank;
}

async function lastLeaveSummary(employeeId: string, excludeId: string): Promise<string> {
  const rows = await db
    .select()
    .from(leaveRequests)
    .where(
      and(
        eq(leaveRequests.employeeId, employeeId),
        eq(leaveRequests.status, "Approved"),
        ne(leaveRequests.id, excludeId),
      ),
    )
    .orderBy(desc(leaveRequests.toDate))
    .limit(1);
  const last = rows[0];
  if (!last) return "N.A.";
  const label = LEAVE_TYPE_LABELS[last.leaveType] ?? last.leaveType;
  const daysNum =
    last.debitDays != null
      ? Number(last.debitDays)
      : Math.max(
          0,
          Math.round((new Date(last.toDate).getTime() - new Date(last.fromDate).getTime()) / 86400000) + 1,
        );
  const singleDay = last.fromDate === last.toDate || daysNum === 1;
  if (singleDay) {
    return `1 day ${label} on ${fmtDate(last.fromDate)}`;
  }
  return `${daysNum} days of ${label} w.e.f. ${fmtDate(last.fromDate)} to ${fmtDate(last.toDate)}`;
}

async function balanceHint(employeeId: string, leaveType: string): Promise<string> {
  const balType = leaveType === "COMMUTED" ? "HPL" : leaveType;
  const [bal] = await db
    .select()
    .from(employeeLeaveBalances)
    .where(and(eq(employeeLeaveBalances.employeeId, employeeId), eq(employeeLeaveBalances.leaveType, balType)))
    .limit(1);
  if (!bal) return "Balance on record: N/A";
  const days = Number(bal.balanceDays ?? 0);
  if (leaveType === "EL" && Number(bal.setOffDays ?? 0) > 0) {
    return `EL balance: ${days} day(s) (+ set-off ${Number(bal.setOffDays)} day(s))`;
  }
  if (leaveType === "COMMUTED") return `HPL balance: ${days} day(s) (Commuted debits at 2× calendar days)`;
  return `${balType} balance: ${days} day(s)`;
}

/** Two-column Form-1 row matching specimen (no. + label | value). */
function form1Row(
  doc: PDFKit.PDFDocument,
  no: string,
  label: string,
  value: string,
  opts?: { labelWidth?: number; valueWidth?: number },
): void {
  const leftX = doc.page.margins.left;
  const labelW = opts?.labelWidth ?? 250;
  const gap = 8;
  const valueX = leftX + labelW + gap;
  const valueW = opts?.valueWidth ?? doc.page.width - doc.page.margins.right - valueX;
  const startY = doc.y;

  doc.font("Helvetica").fontSize(9);
  const labelText = `${no}.  ${label}`;
  const labelH = doc.heightOfString(labelText, { width: labelW });
  const valueH = doc.heightOfString(value || "—", { width: valueW });
  const rowH = Math.max(labelH, valueH, 14);

  doc.text(labelText, leftX, startY, { width: labelW, align: "left" });
  doc.text(value || "—", valueX, startY, { width: valueW, align: "left" });
  doc.y = startY + rowH + 6;
}

function form1FullWidth(
  doc: PDFKit.PDFDocument,
  text: string,
  opts?: { bold?: boolean; size?: number; gapAfter?: number },
): void {
  const leftX = doc.page.margins.left;
  const contentW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const startY = doc.y;
  doc.font(opts?.bold ? "Helvetica-Bold" : "Helvetica").fontSize(opts?.size ?? 9);
  const h = doc.heightOfString(text, { width: contentW });
  doc.text(text, leftX, startY, { width: contentW, align: "left" });
  doc.y = startY + h + (opts?.gapAfter ?? 6);
}

function drawBoardHeader(doc: PDFKit.PDFDocument): void {
  doc.fontSize(11).font("Helvetica-Bold").text("OFFICE OF THE GOA AGRICULTURAL PRODUCE &", { align: "center" });
  doc.text("LIVESTOCK MARKETING BOARD", { align: "center" });
  doc.moveDown(0.15);
  doc.fontSize(9).font("Helvetica").text("Panaji, Goa", { align: "center" });
  doc.moveDown(0.6);
}

function renderForm1(
  doc: PDFKit.PDFDocument,
  ctx: {
    leaveType: string;
    leaveTypeLabel: string;
    empName: string;
    designation: string;
    department: string;
    pay: string;
    fromDate: string;
    toDate: string;
    debitDays: number;
    prefixDays: number;
    suffixDays: number;
    prefixFromDate: string | null;
    suffixToDate: string | null;
    reason: string;
    lastLeave: string;
    ltcProposed: boolean;
    ltcBlockYear: string;
    addressDuringLeave: string;
    leaveHq: string;
    substituteLabel: string;
    refundUndertakingI: string;
    refundUndertakingIi: string;
    controllingRemarks: string;
    controllingOfficerName: string;
    controllingOfficerDesignation: string;
    status: string;
    isExPostFacto: boolean;
    isRetrospective: boolean;
    revisedFromLeaveId: string | null;
    halfDay: string | null;
  },
): void {
  drawBoardHeader(doc);

  doc.fontSize(12).font("Helvetica-Bold").text("FORM - 1", { align: "center" });
  doc.fontSize(8).font("Helvetica").text("(SEE RULE - 14)", { align: "center" });
  doc.moveDown(0.25);
  doc
    .fontSize(9)
    .font("Helvetica-Bold")
    .text("APPLICATION FOR LEAVE OR EXTENSION OF LEAVE PRESCRIBED", { align: "center" });
  doc
    .fontSize(8)
    .font("Helvetica")
    .text("UNDER CENTRAL CIVIL SERVICES (LEAVE) RULES, 1972", { align: "center" });
  doc.moveDown(0.35);
  doc.fontSize(9).font("Helvetica-Bold").text(`Leave type: ${ctx.leaveTypeLabel}`, { align: "center" });
  if (ctx.isExPostFacto) doc.fontSize(8).font("Helvetica").text("(Ex-post facto)", { align: "center" });
  if (ctx.revisedFromLeaveId) {
    doc.fontSize(8).font("Helvetica").text("(Revised application against previously sanctioned leave)", { align: "center" });
  }
  doc.moveDown(0.5);

  const ruleY = doc.y;
  doc
    .moveTo(doc.page.margins.left, ruleY)
    .lineTo(doc.page.width - doc.page.margins.right, ruleY)
    .strokeColor("#333333")
    .lineWidth(0.5)
    .stroke();
  doc.moveDown(0.5);

  const fromDisp = fmtDate(ctx.fromDate);
  const toDisp = fmtDate(ctx.toDate);

  form1Row(doc, "1", "Name of Applicant", ctx.empName);
  form1Row(doc, "2", "Post held", ctx.designation);
  form1Row(doc, "3", "Department, Office and Section", ctx.department);
  form1Row(doc, "4", "Pay", ctx.pay);
  form1Row(
    doc,
    "5",
    "House Rent and other compensatory Allowance drawn in the present post",
    "As applicable for the staff of Goa Agricultural Produce & Livestock Marketing Board",
  );

  const period =
    ctx.halfDay && ctx.fromDate === ctx.toDate
      ? `${ctx.leaveTypeLabel} — ${ctx.halfDay === "first_half" ? "first half" : ctx.halfDay === "second_half" ? "second half" : ctx.halfDay} on ${fromDisp} (${ctx.debitDays} day)`
      : `${ctx.leaveTypeLabel} for ${ctx.debitDays} day(s) from ${fromDisp} to ${toDisp}`;
  form1Row(doc, "6", "Nature and period of leave applied for", period);

  const holidayNote = " (being Saturday and Sunday and holiday)";
  let prefixSuffix = "Prefixed — Nil; Suffixed — Nil";
  if (ctx.prefixDays > 0 || ctx.suffixDays > 0) {
    const pre =
      ctx.prefixDays > 0
        ? `Prefixed — ${ctx.prefixDays} day(s)${ctx.prefixFromDate ? ` being from ${fmtDate(ctx.prefixFromDate)}` : ""}${holidayNote}`
        : "Prefixed — Nil";
    const suf =
      ctx.suffixDays > 0
        ? `Suffixed — ${ctx.suffixDays} day(s)${ctx.suffixToDate ? ` being up to ${fmtDate(ctx.suffixToDate)}` : ""}${holidayNote}`
        : "Suffixed — Nil";
    prefixSuffix = `${pre}; ${suf}`;
  }
  form1Row(doc, "7", "Sunday and holidays, if any, proposed to be prefixed / suffixed", prefixSuffix);
  form1Row(doc, "8", "Ground on which leave is applied for", ctx.reason || ctx.leaveTypeLabel);
  form1Row(doc, "9", "Date of return from last leave and the nature and period of that leave", ctx.lastLeave);

  const blockYear = blankOr(ctx.ltcBlockYear, "_______");
  const ltcText = ctx.ltcProposed
    ? `I propose to avail myself of leave travel concession for the block year ${blockYear} ensuing leave.`
    : `I do not propose to avail myself of leave travel concession for the block year ${blockYear} ensuing leave.`;
  form1Row(doc, "10", "Leave Travel Concession", ltcText);
  form1Row(doc, "11", "Address during the leave period", ctx.addressDuringLeave || "—");
  if (ctx.leaveHq) form1Row(doc, "11A", "Leave headquarters / destination", ctx.leaveHq);
  if (ctx.substituteLabel) form1Row(doc, "11B", "Substitute arrangement", ctx.substituteLabel);

  // Item 12 — full-width left-aligned (same margin as items 1–11)
  form1FullWidth(
    doc,
    "12.  In the event of my resignation or Voluntary retirement from service I undertake to refund:",
    { size: 9, gapAfter: 8 },
  );
  form1Row(
    doc,
    "(i)",
    "The difference between the leave salary drawn during the commuted leave and that admissible during the half pay leave which would not have been admissible had sub-rule (1) of rule 30 not been applied",
    blankOr(ctx.refundUndertakingI),
    { labelWidth: 320 },
  );
  form1Row(
    doc,
    "(ii)",
    "The leave salary during the leave which would have been admissible had sub-rule (1) of rule 31 not been applied",
    blankOr(ctx.refundUndertakingIi),
    { labelWidth: 320 },
  );
  form1FullWidth(doc, "(Score out whichever be not applicable)", { size: 8, gapAfter: 8 });

  if (ctx.leaveType === "ML") {
    form1FullWidth(doc, "• Maternity Leave — supporting medical / maternity documents enclosed when leave exceeds 3 days.", {
      size: 8,
    });
  } else if (ctx.leaveType === "PL") {
    form1FullWidth(doc, "• Paternity Leave — supporting documents enclosed when leave exceeds 3 days.", { size: 8 });
  } else if (ctx.leaveType === "COMMUTED") {
    form1FullWidth(
      doc,
      "• Commuted Leave — medical certificate / grounds enclosed when leave exceeds 3 days; HPL debited at 2× days on approval.",
      { size: 8 },
    );
  } else if (ctx.leaveType === "CCL") {
    form1FullWidth(doc, "• Child Care Leave — subject to lifetime / annual caps as configured.", { size: 8 });
  } else if (ctx.leaveType === "EOL") {
    form1FullWidth(doc, "• Extraordinary Leave — no balance debit from EL/HPL/CL.", { size: 8 });
  }

  doc.moveDown(1.2);
  doc.font("Helvetica").fontSize(9).text("_______________________________", { align: "right" });
  doc.text("(SIGNATURE WITH DATE)", { align: "right" });
  doc.text(ctx.empName, { align: "right" });

  doc.moveDown(1);
  const ruleY2 = doc.y;
  doc
    .moveTo(doc.page.margins.left, ruleY2)
    .lineTo(doc.page.width - doc.page.margins.right, ruleY2)
    .strokeColor("#333333")
    .lineWidth(0.5)
    .stroke();
  doc.moveDown(0.5);

  form1FullWidth(doc, "13.  Remarks and / or recommendations of Controlling Officer.", {
    bold: true,
    size: 9,
    gapAfter: 8,
  });
  form1FullWidth(
    doc,
    ctx.controllingRemarks || "_______________________________________________________________",
    { size: 9, gapAfter: 12 },
  );
  doc.font("Helvetica").fontSize(9).text("_______________________________", { align: "right" });
  doc.text("(SIGNATURE WITH DATE)", { align: "right" });
  if (ctx.controllingOfficerName) {
    doc.text(ctx.controllingOfficerName, { align: "right" });
  }
  if (ctx.controllingOfficerDesignation) {
    doc.text(ctx.controllingOfficerDesignation, { align: "right" });
  }
}

function renderShortForm(
  doc: PDFKit.PDFDocument,
  ctx: {
    leaveType: string;
    leaveTypeLabel: string;
    empName: string;
    designation: string;
    department: string;
    fromDate: string;
    toDate: string;
    debitDays: number;
    reason: string;
    halfDay: string | null;
    dutyDateForSplH: string | null;
    balanceHint: string;
    status: string;
    addressDuringLeave: string;
    leaveHq: string;
  },
): void {
  drawBoardHeader(doc);

  let title = `Format of ${ctx.leaveTypeLabel} application`;
  if (ctx.leaveType === "CL") title = "Format of Casual Leave application";
  if (ctx.leaveType === "RH") title = "Format of Restricted Holiday Leave application";
  if (ctx.leaveType === "SPL_H") title = "Format of Special Holiday Leave application";

  const fromDisp = fmtDate(ctx.fromDate);
  const toDisp = fmtDate(ctx.toDate);

  doc.fontSize(11).font("Helvetica-Bold").text(title, { align: "center" });
  doc.moveDown(0.8);

  doc.font("Helvetica").fontSize(10);
  doc.text("To,");
  doc.text("The Secretary,");
  doc.text("Goa Agricultural Produce & Livestock Marketing Board,");
  doc.text("Panaji — Goa.");
  doc.moveDown(0.6);

  doc.font("Helvetica-Bold").text(
    `Subject: Application for ${ctx.leaveTypeLabel}${ctx.fromDate === ctx.toDate ? ` on ${fromDisp}` : ` from ${fromDisp} to ${toDisp}`}.`,
  );
  doc.moveDown(0.5);

  doc.font("Helvetica").text("Sir / Madam,");
  doc.moveDown(0.35);

  if (ctx.leaveType === "SPL_H" && ctx.dutyDateForSplH) {
    doc.text(
      `I, ${ctx.empName}, ${ctx.designation}, request that I may kindly be granted Special Holiday on ${fromDisp} in lieu of duty attended on ${fmtDate(ctx.dutyDateForSplH)}.`,
      { align: "justify" },
    );
  } else if (ctx.leaveType === "RH") {
    doc.text(
      `I, ${ctx.empName}, ${ctx.designation}, request permission to avail Restricted Holiday on ${fromDisp}.`,
      { align: "justify" },
    );
  } else if (ctx.leaveType === "CL" && ctx.halfDay) {
    const half =
      ctx.halfDay === "first_half" ? "first half" : ctx.halfDay === "second_half" ? "second half" : ctx.halfDay;
    doc.text(
      `I, ${ctx.empName}, ${ctx.designation}, request Casual Leave for the ${half} on ${fromDisp} (${ctx.debitDays} day).`,
      { align: "justify" },
    );
  } else {
    doc.text(
      `I, ${ctx.empName}, ${ctx.designation}, request ${ctx.leaveTypeLabel} for ${ctx.debitDays} day(s) from ${fromDisp} to ${toDisp}.`,
      { align: "justify" },
    );
  }

  doc.moveDown(0.45);
  doc.text(`Reason / occasion: ${ctx.reason || "—"}`);
  doc.moveDown(0.25);
  doc.text(`Office / Section / Location: ${ctx.department}`);
  if (ctx.addressDuringLeave) {
    doc.moveDown(0.25);
    doc.text(`Address during leave: ${ctx.addressDuringLeave}`);
  }
  if (ctx.leaveHq) {
    doc.moveDown(0.25);
    doc.text(`Leave headquarters: ${ctx.leaveHq}`);
  }
  doc.moveDown(0.25);
  doc.text(ctx.balanceHint);
  doc.moveDown(0.8);
  doc.text("I shall be grateful if the above leave is sanctioned.");
  doc.moveDown(0.8);
  doc.text("Thanking you,");
  doc.moveDown(1.2);
  doc.text("Yours faithfully,");
  doc.moveDown(1.6);
  doc.text("_______________________________");
  doc.text(`(${ctx.empName})`);
  doc.text(ctx.designation);
  doc.moveDown(0.3);
  doc.fontSize(8).fillColor("#555555").text(`Date: _______________`, { align: "left" });
  doc.moveDown(1);
  doc
    .fontSize(7)
    .text(`Status: ${ctx.status} | Short application format. Print, sign and submit offline / hard copy as required.`, {
      align: "center",
    });
  doc.fillColor("#000000");
}

export async function generateLeaveApplicationPdf(
  leaveRequestId: string,
): Promise<{ buffer: Buffer; leaveType: string; layout: "form1" | "short" }> {
  const [lr] = await db.select().from(leaveRequests).where(eq(leaveRequests.id, leaveRequestId)).limit(1);
  if (!lr) throw new Error("Leave request not found");

  const [emp] = await db.select().from(employees).where(eq(employees.id, lr.employeeId)).limit(1);
  if (!emp) throw new Error("Employee not found");

  let substituteLabel = "";
  if (lr.substituteEmployeeId) {
    const [sub] = await db.select().from(employees).where(eq(employees.id, lr.substituteEmployeeId)).limit(1);
    if (sub) substituteLabel = `${empDisplayName(sub)} (${sub.empId ?? sub.id})`;
  }

  let controllingOfficerName = "";
  let controllingOfficerDesignation = "";
  if (lr.dvUser) {
    const [dv] = await db.select().from(users).where(eq(users.id, lr.dvUser)).limit(1);
    if (dv) {
      controllingOfficerName = dv.name;
      if (dv.employeeId) {
        const [dvEmp] = await db.select().from(employees).where(eq(employees.id, dv.employeeId)).limit(1);
        if (dvEmp) controllingOfficerDesignation = dvEmp.designation;
      }
    }
  }

  const leaveType = String(lr.leaveType).trim().toUpperCase();
  const leaveTypeLabel = LEAVE_TYPE_LABELS[leaveType] ?? leaveType;
  const empName = empDisplayName(emp);
  let primaryLocationName: string | null = null;
  let yardIsHo = false;
  if (emp.yardId) {
    const [yard] = await db.select().from(yards).where(eq(yards.id, emp.yardId)).limit(1);
    if (yard) {
      primaryLocationName = yard.name ?? yard.code ?? null;
      const t = String(yard.type ?? "").trim().toUpperCase();
      const n = String(yard.name ?? "").toLowerCase();
      yardIsHo = t === "HO" || n.includes("head office");
    }
  }
  const department = [
    "The Goa Agricultural Produce & Livestock Marketing Board",
    primaryLocationName ? primaryLocationName : null,
    yardIsHo && emp.section ? emp.section : null,
    emp.locationPosted ? emp.locationPosted : null,
  ]
    .filter(Boolean)
    .join(", ");

  const lastLeave = await lastLeaveSummary(lr.employeeId, lr.id);
  const balHint = await balanceHint(lr.employeeId, leaveType);
  const debitDays =
    lr.debitDays != null
      ? Number(lr.debitDays)
      : Math.max(0, Math.round((new Date(lr.toDate).getTime() - new Date(lr.fromDate).getTime()) / 86400000) + 1);

  const doc = new PDFDocument({ size: "A4", margin: 48 });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));

  const layout: "form1" | "short" = SHORT_FORM_TYPES.has(leaveType) ? "short" : "form1";

  if (layout === "short") {
    renderShortForm(doc, {
      leaveType,
      leaveTypeLabel,
      empName,
      designation: emp.designation,
      department,
      fromDate: lr.fromDate,
      toDate: lr.toDate,
      debitDays,
      reason: lr.reason ?? "",
      halfDay: lr.halfDay ?? null,
      dutyDateForSplH: lr.dutyDateForSplH ?? null,
      balanceHint: balHint,
      status: lr.status,
      addressDuringLeave: lr.addressDuringLeave ?? "",
      leaveHq: lr.leaveHq ?? "",
    });
  } else {
    renderForm1(doc, {
      leaveType,
      leaveTypeLabel,
      empName,
      designation: emp.designation,
      department,
      pay: payLine(emp),
      fromDate: lr.fromDate,
      toDate: lr.toDate,
      debitDays,
      prefixDays: Number(lr.prefixDays ?? 0),
      suffixDays: Number(lr.suffixDays ?? 0),
      prefixFromDate: lr.prefixFromDate ?? null,
      suffixToDate: lr.suffixToDate ?? null,
      reason: lr.reason ?? "",
      lastLeave,
      ltcProposed: lr.ltcProposed === true,
      ltcBlockYear: lr.ltcBlockYear ?? "",
      addressDuringLeave: lr.addressDuringLeave ?? "",
      leaveHq: lr.leaveHq ?? "",
      substituteLabel,
      refundUndertakingI: lr.refundUndertakingI ?? "",
      refundUndertakingIi: lr.refundUndertakingIi ?? "",
      controllingRemarks: lr.controllingOfficerRemarks ?? "",
      controllingOfficerName,
      controllingOfficerDesignation,
      status: lr.status,
      isExPostFacto: lr.isExPostFacto === true,
      isRetrospective: lr.isRetrospective === true,
      revisedFromLeaveId: lr.revisedFromLeaveId ?? null,
      halfDay: lr.halfDay ?? null,
    });
  }

  doc.end();
  await new Promise<void>((resolve) => doc.on("end", resolve));
  return { buffer: Buffer.concat(chunks), leaveType, layout };
}
