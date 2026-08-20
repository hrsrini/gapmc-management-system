import PDFDocument from "pdfkit";
import { db } from "./db";
import { employees, leaveRequests } from "@shared/db-schema";
import { eq } from "drizzle-orm";
import { getMergedSystemConfig } from "./system-config";

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

/**
 * Pre-filled Joining Report PDF for the employee to print, sign, and submit offline.
 * Digital signature is out of scope — employee signs on paper / scans separately.
 */
export async function generateJoiningReportPdf(leaveRequestId: string): Promise<{ buffer: Buffer; rejoiningDate: string }> {
  const [lr] = await db.select().from(leaveRequests).where(eq(leaveRequests.id, leaveRequestId)).limit(1);
  if (!lr) throw new Error("Leave request not found");
  if (lr.status !== "Approved") throw new Error("Joining Report is only for approved leave");

  const rejoiningDate = lr.rejoiningDate?.trim() || "";
  if (!rejoiningDate) throw new Error("Rejoining date must be entered before generating Joining Report");

  const [emp] = await db.select().from(employees).where(eq(employees.id, lr.employeeId)).limit(1);
  if (!emp) throw new Error("Employee not found");

  const cfg = await getMergedSystemConfig();
  const signatoryDesig = cfg.leave_order_signatory_designation || "Secretary";

  const empName = `${emp.firstName} ${emp.middleName ?? ""} ${emp.surname}`.replace(/\s+/g, " ").trim();
  const leaveTypeLabel = LEAVE_TYPE_LABELS[lr.leaveType] ?? lr.leaveType;

  const doc = new PDFDocument({ size: "A4", margin: 60 });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));

  doc.fontSize(14).font("Helvetica-Bold").text("OFFICE OF THE GOA AGRICULTURAL PRODUCE &", { align: "center" });
  doc.text("LIVESTOCK MARKETING BOARD", { align: "center" });
  doc.moveDown(0.3);
  doc.fontSize(10).font("Helvetica").text("Panaji, Goa", { align: "center" });
  doc.moveDown(1);

  doc.fontSize(12).font("Helvetica-Bold").text("JOINING REPORT", { align: "center" });
  doc.moveDown(1);

  doc.fontSize(10).font("Helvetica");
  if (lr.fileNo) {
    doc.text(`Reference Sanction Order No.: ${lr.fileNo}`);
    doc.moveDown(0.5);
  }

  doc.text(
    `I, Shri/Smt. ${empName}, ${emp.designation}, hereby report that I have resumed duty on ${rejoiningDate} after availing ${leaveTypeLabel} from ${lr.fromDate} to ${lr.toDate}.`,
  );
  doc.moveDown(0.8);

  doc.text(`Employee ID: ${emp.empId ?? emp.id}`);
  doc.text(`Location / Section: ${emp.locationPosted ?? "—"} / ${emp.section ?? "—"}`);
  if (lr.leaveHq) doc.text(`Leave Headquarters (as sanctioned): ${lr.leaveHq}`);
  doc.moveDown(1);

  doc.text(
    "I confirm that I have reported for duty on the date stated above. This report is generated from the Leave Management System for signature and offline / hard-copy submission.",
  );
  doc.moveDown(2);

  doc.text("_______________________________", { align: "left" });
  doc.text("Signature of Employee", { align: "left" });
  doc.text(`Name: ${empName}`);
  doc.text(`Date: _______________`);
  doc.moveDown(2);

  doc.text("_______________________________", { align: "left" });
  doc.text("Acknowledged by Controlling Officer", { align: "left" });
  doc.text(`Designation: _______________`);
  doc.text(`Date: _______________`);
  doc.moveDown(1.5);

  doc.fontSize(8).fillColor("#666666").text(
    `Generated for submission to ${signatoryDesig}, GAPLMB. Digital signature is not within system scope.`,
    { align: "center" },
  );

  doc.end();
  await new Promise<void>((resolve) => doc.on("end", resolve));
  return { buffer: Buffer.concat(chunks), rejoiningDate };
}
