/**
 * Individual Employee Leave Balance Statement PDF (board specimen layout).
 */
import PDFDocument from "pdfkit";
import { eq } from "drizzle-orm";
import { formatLeaveOrderDateDisplay } from "@shared/hr-leave-display";
import { parseAdditionalChargeYardIds } from "@shared/hr-additional-charge-locations";
import { db } from "./db";
import { employeeLeaveBalances, employees, yards } from "@shared/db-schema";
import {
  buildLeaveBalanceStatementLines,
  healLeaveBalanceEmployeeIds,
  healLeaveBalanceTypeAliases,
  healMissingElSetOffExpiryDates,
} from "./hr-leave-balance-resolve";

function formatAsOnStamp(d = new Date()): { isoDate: string; display: string } {
  const isoDate = d.toISOString().slice(0, 10);
  const months = [
    "JANUARY",
    "FEBRUARY",
    "MARCH",
    "APRIL",
    "MAY",
    "JUNE",
    "JULY",
    "AUGUST",
    "SEPTEMBER",
    "OCTOBER",
    "NOVEMBER",
    "DECEMBER",
  ];
  const day = d.getDate();
  const month = months[d.getMonth()]!;
  const year = d.getFullYear();
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  const display = `${day} ${month} ${year} AT ${String(h).padStart(2, "0")}:${m}:${s} ${ampm}`;
  return { isoDate, display };
}

function empDisplayName(e: {
  firstName: string;
  middleName?: string | null;
  surname: string;
}): string {
  return [e.firstName, e.middleName, e.surname].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

async function yardLabel(yardId: string | null | undefined): Promise<string> {
  const id = String(yardId ?? "").trim();
  if (!id) return "—";
  const [y] = await db.select().from(yards).where(eq(yards.id, id)).limit(1);
  return (y?.name ?? y?.code ?? id).trim() || "—";
}

export async function generateLeaveBalanceStatementPdf(employeeId: string): Promise<{
  buffer: Buffer;
  fileName: string;
}> {
  await healLeaveBalanceEmployeeIds();
  await healLeaveBalanceTypeAliases();
  // Opening balances often imported with set-off days but no expiry — fill half-year end.
  await healMissingElSetOffExpiryDates(employeeId);

  const [emp] = await db.select().from(employees).where(eq(employees.id, employeeId)).limit(1);
  if (!emp) throw new Error("Employee not found");

  const bals = await db
    .select()
    .from(employeeLeaveBalances)
    .where(eq(employeeLeaveBalances.employeeId, employeeId));
  const lines = buildLeaveBalanceStatementLines(bals);
  const primaryLabel = await yardLabel(emp.yardId);
  const addIds = parseAdditionalChargeYardIds(emp.locationPosted, emp.yardId);
  const addLabels: string[] = [];
  for (const id of addIds) addLabels.push(await yardLabel(id));

  const stamp = formatAsOnStamp();
  const doc = new PDFDocument({ size: "A4", margin: 48 });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));

  doc
    .font("Helvetica-Bold")
    .fontSize(12)
    .text(`LEAVE BALANCE STATEMENT AS ON ${stamp.display}`, { align: "center" });
  doc.moveDown(0.8);

  doc.font("Helvetica").fontSize(10);
  const empCode = (emp.empId && String(emp.empId).trim()) || emp.id;
  doc.text(`Employee name : ${empDisplayName(emp)} (${empCode})`);
  doc.text(`Designation : ${String(emp.designation ?? "").trim() || "—"}`);
  doc.text(`Primary Posting : ${primaryLabel}`);
  if (addLabels.length > 0) {
    doc.text(`Additional Posting\\Charge : ${addLabels.join("; ")}`);
  }
  doc.moveDown(0.7);

  const colX = [48, 90, 280, 360] as const;
  const colW = [40, 180, 70, 140] as const;
  const headers = ["Sr. No.", "Leave Type", "Balance (days)", "Set-off days expiring on DD-MM-YYYY"] as const;

  let y = doc.y;
  doc.font("Helvetica-Bold").fontSize(9);
  headers.forEach((h, i) => {
    doc.text(h, colX[i], y, { width: colW[i], align: i === 0 || i === 2 ? "center" : "left" });
  });
  y = Math.max(doc.y, y + 28);
  doc
    .moveTo(48, y - 4)
    .lineTo(547, y - 4)
    .strokeColor("#333333")
    .lineWidth(0.5)
    .stroke();

  doc.font("Helvetica").fontSize(9);
  lines.forEach((line, idx) => {
    const rowY = y;
    let setOffText = "";
    if (line.leaveType === "EL" && line.setOffDays > 0) {
      const lapse = line.setOffExpiryDate
        ? formatLeaveOrderDateDisplay(line.setOffExpiryDate).replace(/\//g, "-")
        : "—";
      setOffText = `${line.setOffDays} ( Lapsing on ${lapse})`;
    }
    const cells = [String(idx + 1), line.label, String(line.balanceDays), setOffText];
    let rowH = 14;
    cells.forEach((c, i) => {
      const h = doc.heightOfString(c || " ", { width: colW[i] });
      rowH = Math.max(rowH, h);
    });
    if (rowY + rowH > doc.page.height - 90) {
      doc.addPage();
      y = doc.page.margins.top;
    }
    cells.forEach((c, i) => {
      doc.text(c, colX[i], y, {
        width: colW[i],
        align: i === 0 || i === 2 ? "center" : "left",
      });
    });
    y += rowH + 6;
    doc.y = y;
  });

  doc.moveDown(1.2);
  const noteX = doc.page.margins.left;
  const noteW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  doc.x = noteX;
  doc.font("Helvetica").fontSize(8);
  doc.text(
    "Note :  The leave balances presented herein reflect the updated position after duly accounting for all leave applications approved and sanctioned up to the date and time of generation of this report.",
    noteX,
    doc.y,
    { align: "left", width: noteW },
  );

  doc.end();
  await new Promise<void>((resolve) => doc.on("end", resolve));
  const buffer = Buffer.concat(chunks);
  const fileName = `Leave_Balance_Statement_${empCode}_${stamp.isoDate}.pdf`;
  return { buffer, fileName };
}
