import { eq } from "drizzle-orm";
import { db } from "./db";
import { employees, yards } from "@shared/db-schema";
import { getMergedSystemConfig } from "./system-config";
import { sendTransactionalEmailTo } from "./notify";

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

function parseHoSectionEmails(raw: string | undefined): Record<string, string> {
  try {
    const parsed = JSON.parse(raw || "{}") as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const email = String(v ?? "").trim();
      if (k.trim() && email.includes("@")) out[k.trim().toLowerCase()] = email;
    }
    return out;
  } catch {
    return {};
  }
}

function isHoLocation(
  locationPosted: string,
  yard: { type?: string | null; name?: string | null; code?: string | null } | undefined,
): boolean {
  if (yard?.type && String(yard.type).toUpperCase() === "HO") return true;
  const loc = locationPosted.toUpperCase();
  return loc === "HO" || locationPosted.toLowerCase().includes("head office");
}

/**
 * Resolve sanction-order email: To = employee work email; CC = yard (or HO section email).
 */
export async function resolveSanctionOrderEmailRecipients(employeeId: string): Promise<{
  to: string | null;
  cc: string[];
}> {
  const [emp] = await db.select().from(employees).where(eq(employees.id, employeeId)).limit(1);
  if (!emp) return { to: null, cc: [] };

  const to = (emp.workEmail || emp.personalEmail || "").trim();
  const toOk = to.includes("@") ? to.toLowerCase() : null;

  const cfg = await getMergedSystemConfig();
  const locationPosted = String(emp.locationPosted ?? "").trim();
  const section = String(emp.section ?? "").trim();
  const cc = new Set<string>();

  let matchedYard: (typeof yards.$inferSelect) | undefined;
  if (locationPosted) {
    const allYards = await db.select().from(yards);
    matchedYard = allYards.find(
      (y) =>
        y.name.trim().toLowerCase() === locationPosted.toLowerCase() ||
        y.code.trim().toLowerCase() === locationPosted.toLowerCase() ||
        y.id === locationPosted,
    );
  }

  if (isHoLocation(locationPosted, matchedYard)) {
    if (section) {
      const map = parseHoSectionEmails(cfg.leave_ho_section_emails_json);
      const sectionEmail = map[section.toLowerCase()];
      if (sectionEmail) cc.add(sectionEmail.toLowerCase());
    }
  } else if (matchedYard?.email) {
    const yardEmail = String(matchedYard.email).trim();
    if (yardEmail.includes("@")) cc.add(yardEmail.toLowerCase());
  } else if (section) {
    const map = parseHoSectionEmails(cfg.leave_ho_section_emails_json);
    const sectionEmail = map[section.toLowerCase()];
    if (sectionEmail) cc.add(sectionEmail.toLowerCase());
  }

  if (toOk) cc.delete(toOk);
  return { to: toOk, cc: Array.from(cc) };
}

export async function emailSanctionOrderPdf(params: {
  employeeId: string;
  leaveRequestId: string;
  fileNo: string;
  leaveType: string;
  fromDate: string;
  toDate: string;
  pdfBuffer: Buffer;
}): Promise<void> {
  const { to, cc } = await resolveSanctionOrderEmailRecipients(params.employeeId);
  if (!to) {
    console.log(`[NOTIFY] leave sanction email skipped (no employee To) leave=${params.leaveRequestId}`);
    return;
  }

  const [emp] = await db.select().from(employees).where(eq(employees.id, params.employeeId)).limit(1);
  const name = emp
    ? `${emp.firstName} ${emp.middleName ?? ""} ${emp.surname}`.replace(/\s+/g, " ").trim()
    : params.employeeId;
  const empIdLabel = emp?.empId?.trim() || params.employeeId;
  const leaveLabel = LEAVE_TYPE_LABELS[params.leaveType] ?? params.leaveType;

  const subject = `Sanction Order Generated – ${leaveLabel} – ${empIdLabel} – ${name}`;
  const text =
    `Dear ${name},\n\n` +
    `Please find attached the Leave Sanction Order for your ${leaveLabel} ` +
    `(${params.fromDate} to ${params.toDate}).\n\n` +
    `File No.: ${params.fileNo}\n\n` +
    `Regards,\n` +
    `Admin Section\n` +
    `GAPLMB\n` +
    `Arlem Raia, Salcete, Goa.\n`;

  const filename = `Sanction_Order_${params.fileNo.replace(/\//g, "_")}.pdf`;
  const attachments = [{ filename, content: params.pdfBuffer, contentType: "application/pdf" }];

  await sendTransactionalEmailTo(to, subject, text, attachments, cc);
}
