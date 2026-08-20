import { eq } from "drizzle-orm";
import { db } from "./db";
import { employees, yards } from "@shared/db-schema";
import { getMergedSystemConfig } from "./system-config";
import { sendTransactionalEmailTo } from "./notify";

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

/**
 * Resolve sanction-order email recipients: employee + location + HO section (when applicable).
 */
export async function resolveSanctionOrderEmailRecipients(employeeId: string): Promise<string[]> {
  const [emp] = await db.select().from(employees).where(eq(employees.id, employeeId)).limit(1);
  if (!emp) return [];

  const recipients = new Set<string>();
  const empEmail = (emp.workEmail || emp.personalEmail || "").trim();
  if (empEmail.includes("@")) recipients.add(empEmail.toLowerCase());

  const cfg = await getMergedSystemConfig();
  const locationPosted = String(emp.locationPosted ?? "").trim();
  const section = String(emp.section ?? "").trim();

  // Location email from yards master (match by name or code, case-insensitive)
  if (locationPosted) {
    const allYards = await db.select().from(yards);
    const loc = allYards.find(
      (y) =>
        y.name.trim().toLowerCase() === locationPosted.toLowerCase() ||
        y.code.trim().toLowerCase() === locationPosted.toLowerCase() ||
        y.id === locationPosted,
    );
    const yardEmail = loc?.email ? String(loc.email).trim() : "";
    if (yardEmail.includes("@")) recipients.add(yardEmail.toLowerCase());

    // HO: also use section→email map from system config
    const isHo =
      (loc?.type && String(loc.type).toUpperCase() === "HO") ||
      locationPosted.toUpperCase() === "HO" ||
      locationPosted.toLowerCase().includes("head office");
    if (isHo && section) {
      const map = parseHoSectionEmails(cfg.leave_ho_section_emails_json);
      const sectionEmail = map[section.toLowerCase()];
      if (sectionEmail) recipients.add(sectionEmail.toLowerCase());
    }
  } else if (section) {
    const map = parseHoSectionEmails(cfg.leave_ho_section_emails_json);
    const sectionEmail = map[section.toLowerCase()];
    if (sectionEmail) recipients.add(sectionEmail.toLowerCase());
  }

  return Array.from(recipients);
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
  const recipients = await resolveSanctionOrderEmailRecipients(params.employeeId);
  if (recipients.length === 0) {
    console.log(`[NOTIFY] leave sanction email skipped (no recipients) leave=${params.leaveRequestId}`);
    return;
  }

  const [emp] = await db.select().from(employees).where(eq(employees.id, params.employeeId)).limit(1);
  const name = emp ? `${emp.firstName} ${emp.surname}`.trim() : params.employeeId;
  const subject = `[GAPMC HR] Leave Sanction Order: ${name} (${params.leaveType})`;
  const text =
    `Please find attached the Leave Sanction Order.\n\n` +
    `Employee: ${name}\n` +
    `Leave type: ${params.leaveType}\n` +
    `Period: ${params.fromDate} to ${params.toDate}\n` +
    `File No.: ${params.fileNo}\n` +
    `Leave request ID: ${params.leaveRequestId}\n`;

  const filename = `Sanction_Order_${params.fileNo.replace(/\//g, "_")}.pdf`;
  const attachments = [{ filename, content: params.pdfBuffer, contentType: "application/pdf" }];

  for (const to of recipients) {
    await sendTransactionalEmailTo(to, subject, text, attachments);
  }
}
