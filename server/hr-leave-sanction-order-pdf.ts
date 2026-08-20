import PDFDocument from "pdfkit";
import { db } from "./db";
import { employees, leaveRequests, employeeLeaveBalances, leaveOrderSequence } from "@shared/db-schema";
import { eq, and } from "drizzle-orm";
import { getMergedSystemConfig } from "./system-config";
import { nanoid } from "nanoid";

const LEAVE_TYPE_LABELS: Record<string, string> = {
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

async function getNextFileNo(serviceBookNo: string, year: number): Promise<string> {
  const [seqRow] = await db.select().from(leaveOrderSequence).where(eq(leaveOrderSequence.year, year)).limit(1);
  let seq: number;
  if (seqRow) {
    seq = seqRow.lastSeq + 1;
    await db.update(leaveOrderSequence).set({ lastSeq: seq }).where(eq(leaveOrderSequence.id, seqRow.id));
  } else {
    seq = 1;
    await db.insert(leaveOrderSequence).values({ id: nanoid(), year, lastSeq: seq });
  }
  return `GAPLMB/${serviceBookNo}/ADM-${year}/${seq}`;
}

export async function generateSanctionOrderPdf(leaveRequestId: string): Promise<{ buffer: Buffer; fileNo: string }> {
  const [lr] = await db.select().from(leaveRequests).where(eq(leaveRequests.id, leaveRequestId)).limit(1);
  if (!lr) throw new Error("Leave request not found");

  const [emp] = await db.select().from(employees).where(eq(employees.id, lr.employeeId)).limit(1);
  if (!emp) throw new Error("Employee not found");

  const cfg = await getMergedSystemConfig();
  const signatoryName = cfg.leave_order_signatory_name || "Secretary";
  const signatoryDesig = cfg.leave_order_signatory_designation || "Secretary";

  const year = new Date().getFullYear();
  const serviceBookNo = emp.serviceBookNo || emp.empId || emp.id;
  const fileNo = lr.fileNo?.trim() ? lr.fileNo.trim() : await getNextFileNo(serviceBookNo, year);

  if (!lr.fileNo?.trim()) {
    await db.update(leaveRequests).set({ fileNo }).where(eq(leaveRequests.id, leaveRequestId));
  }

  const leaveTypeLabel = LEAVE_TYPE_LABELS[lr.leaveType] ?? lr.leaveType;
  const empName = `${emp.firstName} ${emp.middleName ?? ""} ${emp.surname}`.replace(/\s+/g, " ").trim();
  const debitDays = lr.debitDays != null ? Number(lr.debitDays) : 0;
  const isExPostFacto = lr.isExPostFacto === true;

  // Get balance after debit
  const balLeaveType = lr.leaveType === "COMMUTED" ? "HPL" : lr.leaveType;
  const [bal] = await db.select().from(employeeLeaveBalances).where(
    and(eq(employeeLeaveBalances.employeeId, lr.employeeId), eq(employeeLeaveBalances.leaveType, balLeaveType))
  ).limit(1);
  const balanceAfter = bal ? Number(bal.balanceDays ?? 0) : 0;

  // Parse copy-to list
  let copyToList: string[] = [];
  try {
    if (lr.copyToJson) copyToList = JSON.parse(lr.copyToJson);
  } catch { /* empty */ }
  if (!copyToList.length) {
    copyToList = [
      `${empName} (Employee)`,
      emp.section ? `${emp.section}, HO` : (emp.locationPosted ?? emp.yardId),
      "Accounts Section",
      "Personal File",
      "Guard File",
    ];
  }

  // Generate PDF
  const doc = new PDFDocument({ size: "A4", margin: 60 });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));

  // Header
  doc.fontSize(14).font("Helvetica-Bold").text("OFFICE OF THE GOA AGRICULTURAL PRODUCE &", { align: "center" });
  doc.text("LIVESTOCK MARKETING BOARD", { align: "center" });
  doc.moveDown(0.3);
  doc.fontSize(10).font("Helvetica").text("Panaji, Goa", { align: "center" });
  doc.moveDown(1);

  // File No & Date
  doc.fontSize(10).font("Helvetica");
  doc.text(`No. ${fileNo}`, { continued: true });
  doc.text(`Date: ${new Date().toLocaleDateString("en-IN")}`, { align: "right" });
  doc.moveDown(1);

  // ORDER heading
  doc.fontSize(12).font("Helvetica-Bold").text("ORDER", { align: "center" });
  doc.moveDown(0.5);

  // READ clause
  doc.fontSize(10).font("Helvetica");
  doc.text(`READ: Leave application of Shri/Smt. ${empName}, ${emp.designation}, dated ${lr.fromDate}.`);
  doc.moveDown(0.8);

  // Sanction paragraph
  const sanctionPrefix = isExPostFacto ? "Ex-post facto sanction is hereby accorded" : "Sanction is hereby accorded";
  let sanctionText = `${sanctionPrefix} to Shri/Smt. ${empName}, ${emp.designation}, `;
  sanctionText += `${leaveTypeLabel} for a period of ${debitDays} day(s) `;
  sanctionText += `from ${lr.fromDate} to ${lr.toDate}`;

  if (lr.prefixDays && lr.prefixDays > 0 && !lr.prefixSuffixDisallowed) {
    sanctionText += ` with prefix of ${lr.prefixDays} day(s) from ${lr.prefixFromDate}`;
  }
  if (lr.suffixDays && lr.suffixDays > 0 && !lr.prefixSuffixDisallowed) {
    sanctionText += ` and suffix of ${lr.suffixDays} day(s) up to ${lr.suffixToDate}`;
  }
  if (lr.prefixSuffixDisallowed) {
    sanctionText += " (Prefix/Suffix: Nil)";
  }
  sanctionText += ".";

  doc.text(sanctionText);
  doc.moveDown(0.5);

  if (lr.leaveHq) {
    doc.text(`Leave Headquarters: ${lr.leaveHq}`);
    doc.moveDown(0.3);
  }

  // Balance certificate
  doc.moveDown(0.5);
  doc.font("Helvetica-Bold").text("Balance Certificate:");
  doc.font("Helvetica");
  doc.text(`${leaveTypeLabel} balance as on date of this Order: ${balanceAfter} day(s).`);
  doc.moveDown(0.5);

  // Continuance clause
  doc.text("The employee shall report back to duty on the day following the expiry of leave. " +
    "If the employee fails to resume duty on the due date, the absence will be treated as per rules.");
  doc.moveDown(1.5);

  // Signatory
  doc.text(`(${signatoryName})`, { align: "right" });
  doc.text(signatoryDesig, { align: "right" });
  doc.text("Goa Agricultural Produce & Livestock Marketing Board", { align: "right" });
  doc.moveDown(1.5);

  // Copy to
  doc.font("Helvetica-Bold").text("Copy to:");
  doc.font("Helvetica");
  copyToList.forEach((item, i) => {
    doc.text(`${i + 1}. ${item}`);
  });
  doc.moveDown(0.5);

  // Service book checklist
  doc.font("Helvetica-Bold").text("☐ Entered on Service Book", { align: "left" });

  doc.end();

  await new Promise<void>((resolve) => doc.on("end", resolve));
  const buffer = Buffer.concat(chunks);

  return { buffer, fileNo };
}
