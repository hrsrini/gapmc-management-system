import PDFDocument from "pdfkit";
import fs from "node:fs";
import { db } from "./db";
import { employees, leaveRequests, employeeLeaveBalances, leaveOrderSequence, yards } from "@shared/db-schema";
import { eq, and } from "drizzle-orm";
import {
  buildDefaultSanctionCopyTo,
  buildSanctionBalanceCertificateParagraph,
  buildSanctionContinuationParagraph,
  buildSanctionGrantParagraph,
  buildSanctionReadLine,
  classifyLeaveYardKind,
  applySalutationsToCopyToLines,
  leaveDaysInWords,
  type LeaveYardKind,
} from "@shared/hr-leave-display";
import { getMergedSystemConfig } from "./system-config";
import { readUploadedLeaveOrderSignatureBuffer } from "./leave-signature-storage";
import {
  formatLeaveCopyToLine,
  formatLeaveOrderDate,
  formatLeaveOrderDateToday,
  resolveLeaveApplicationDateFromAudit,
  resolveLeaveOrderDateFromAudit,
} from "./hr-leave-pdf-shared";
import { allocateNextServiceBookNo } from "./hr-employee-rules";
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

const FONT_REGULAR = "SanctionBody";
const FONT_BOLD = "SanctionBody-Bold";

function resolveSanctionFonts(): { regular: string; bold: string } | null {
  const pairs: Array<[string, string]> = [
    ["C:\\Windows\\Fonts\\calibri.ttf", "C:\\Windows\\Fonts\\calibrib.ttf"],
    ["/usr/share/fonts/truetype/msttcorefonts/Calibri.ttf", "/usr/share/fonts/truetype/msttcorefonts/CalibriBold.ttf"],
    ["/usr/share/fonts/truetype/crosextra/Carlito-Regular.ttf", "/usr/share/fonts/truetype/crosextra/Carlito-Bold.ttf"],
  ];
  for (const [regular, bold] of pairs) {
    if (fs.existsSync(regular) && fs.existsSync(bold)) return { regular, bold };
  }
  return null;
}

function isHeadOfficeYard(y: { type?: string | null; name?: string | null; code?: string | null } | undefined): boolean {
  if (!y) return false;
  if (String(y.type ?? "").trim().toUpperCase() === "HO") return true;
  const name = String(y.name ?? "").toLowerCase();
  const code = String(y.code ?? "").toLowerCase();
  return name.includes("head office") || code === "ho" || code.startsWith("ho-");
}

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

async function ensureEmployeeServiceBookNo(employeeId: string, current: string | null | undefined): Promise<string> {
  const existing = current?.trim();
  if (existing) return existing;
  const allocated = await allocateNextServiceBookNo();
  await db
    .update(employees)
    .set({ serviceBookNo: allocated, updatedAt: new Date().toISOString() })
    .where(eq(employees.id, employeeId));
  return allocated;
}

export async function generateSanctionOrderPdf(leaveRequestId: string): Promise<{ buffer: Buffer; fileNo: string }> {
  const [lr] = await db.select().from(leaveRequests).where(eq(leaveRequests.id, leaveRequestId)).limit(1);
  if (!lr) throw new Error("Leave request not found");

  const [emp] = await db.select().from(employees).where(eq(employees.id, lr.employeeId)).limit(1);
  if (!emp) throw new Error("Employee not found");

  const cfg = await getMergedSystemConfig();
  const signatoryName = cfg.leave_order_signatory_name || "Secretary";
  const signatoryDesig = (cfg.leave_order_signatory_designation || "Secretary").toUpperCase();

  const serviceBookNo = await ensureEmployeeServiceBookNo(emp.id, emp.serviceBookNo);

  const year = new Date().getFullYear();
  const fileNo = lr.fileNo?.trim() ? lr.fileNo.trim() : await getNextFileNo(serviceBookNo, year);

  if (!lr.fileNo?.trim()) {
    await db.update(leaveRequests).set({ fileNo }).where(eq(leaveRequests.id, leaveRequestId));
  }

  const leaveTypeLabel = LEAVE_TYPE_LABELS[lr.leaveType] ?? lr.leaveType;
  const empName = `${emp.firstName} ${emp.middleName ?? ""} ${emp.surname}`.replace(/\s+/g, " ").trim();
  const debitDays = lr.debitDays != null ? Number(lr.debitDays) : 0;
  const isExPostFacto = lr.isExPostFacto === true;

  // Fixed order date = DA approval day (persist if missing so re-download stays stable).
  // Prefer stored order_date; else audit Approved transition; never invent "today" for historical orders.
  let orderDateYmd = String(lr.orderDate ?? "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(orderDateYmd)) {
    orderDateYmd = (await resolveLeaveOrderDateFromAudit(leaveRequestId)) || "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(orderDateYmd) && (lr.status === "Approved" || lr.status === "Superseded")) {
      // Last resort only when no audit trail exists (imported / pre-audit data).
      orderDateYmd = new Date().toISOString().slice(0, 10);
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(orderDateYmd)) {
      await db.update(leaveRequests).set({ orderDate: orderDateYmd }).where(eq(leaveRequests.id, leaveRequestId));
    }
  }
  const orderDateDisplay = orderDateYmd
    ? formatLeaveOrderDate(orderDateYmd)
    : formatLeaveOrderDateToday();

  let applicationDated = String(lr.appliedAt ?? "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(applicationDated)) {
    applicationDated = (await resolveLeaveApplicationDateFromAudit(leaveRequestId)) || "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(applicationDated)) {
      await db.update(leaveRequests).set({ appliedAt: applicationDated }).where(eq(leaveRequests.id, leaveRequestId));
    }
  }

  let primaryLocationName: string | null = null;
  let yardIsHo = false;
  let applicantYardKind: LeaveYardKind = "unknown";
  if (emp.yardId) {
    const [yard] = await db.select().from(yards).where(eq(yards.id, emp.yardId)).limit(1);
    if (yard) {
      primaryLocationName = yard.name ?? yard.code ?? null;
      yardIsHo = isHeadOfficeYard(yard);
      applicantYardKind = classifyLeaveYardKind(yard);
    }
  }
  if (!primaryLocationName && emp.locationPosted?.trim()) {
    primaryLocationName = emp.locationPosted.trim();
  }
  if (applicantYardKind === "unknown" && yardIsHo) applicantYardKind = "ho";
  if (applicantYardKind === "unknown" && primaryLocationName) applicantYardKind = "yard";

  let substituteName: string | null = null;
  let substituteGender: string | null = null;
  let substituteMaritalStatus: string | null = null;
  let substituteSection: string | null = null;
  let substitutePrimaryLocation: string | null = null;
  let substituteYardKind: LeaveYardKind | null = null;
  if (lr.substituteEmployeeId) {
    const [sub] = await db.select().from(employees).where(eq(employees.id, lr.substituteEmployeeId)).limit(1);
    if (sub) {
      substituteName = `${sub.firstName} ${sub.middleName ?? ""} ${sub.surname}`.replace(/\s+/g, " ").trim();
      substituteGender = sub.gender ?? null;
      substituteMaritalStatus = sub.maritalStatus ?? null;
      substituteSection = sub.section ?? null;
      if (sub.yardId) {
        const [subYard] = await db.select().from(yards).where(eq(yards.id, sub.yardId)).limit(1);
        if (subYard) {
          substitutePrimaryLocation = subYard.name ?? subYard.code ?? null;
          substituteYardKind = classifyLeaveYardKind(subYard);
        }
      }
      if (!substitutePrimaryLocation && sub.locationPosted?.trim()) {
        substitutePrimaryLocation = sub.locationPosted.trim();
      }
      if (!substituteYardKind || substituteYardKind === "unknown") {
        if (isHeadOfficeYard({ type: null, name: substitutePrimaryLocation, code: null }) || sub.section) {
          substituteYardKind = sub.section ? "ho" : substituteYardKind;
        }
        if ((!substituteYardKind || substituteYardKind === "unknown") && substitutePrimaryLocation) {
          substituteYardKind = classifyLeaveYardKind({ name: substitutePrimaryLocation });
        }
      }
    }
  }

  const balLeaveType = lr.leaveType === "COMMUTED" ? "HPL" : lr.leaveType;
  const [bal] = await db
    .select()
    .from(employeeLeaveBalances)
    .where(and(eq(employeeLeaveBalances.employeeId, lr.employeeId), eq(employeeLeaveBalances.leaveType, balLeaveType)))
    .limit(1);
  const balanceAfter = bal ? Number(bal.balanceDays ?? 0) : 0;

  const defaultCopyTo = buildDefaultSanctionCopyTo({
    gender: emp.gender,
    maritalStatus: emp.maritalStatus,
    empName,
    section: emp.section,
    primaryLocation: primaryLocationName,
    yardKind: applicantYardKind,
    yardIsHo,
    substituteName,
    substituteGender,
    substituteMaritalStatus,
    substituteSection,
    substitutePrimaryLocation,
    substituteYardKind,
  });

  let copyToList: string[] = [];
  try {
    if (lr.copyToJson) copyToList = JSON.parse(lr.copyToJson);
  } catch {
    /* empty */
  }
  if (!copyToList.length) {
    copyToList = defaultCopyTo;
  } else if (emp.yardId) {
    const yardLabel = primaryLocationName ?? emp.locationPosted?.trim() ?? null;
    if (yardLabel) {
      copyToList = copyToList.map((item) => (item.trim() === emp.yardId ? yardLabel : item));
    }
  }
  copyToList = copyToList
    .map(formatLeaveCopyToLine)
    .filter(Boolean)
    .filter((item) => {
      const t = item.trim().toLowerCase();
      if (t === empName.toLowerCase()) return false;
      if (t === "guard file") return false;
      if (t.includes("entered on service book")) return false;
      return true;
    });

  // Ensure substitute duty (+ other-location) lines when a substitute is selected.
  if (substituteName) {
    const hasDuty = copyToList.some((item) => /will do the duties of/i.test(item));
    if (!hasDuty) {
      const extras = defaultCopyTo.slice(1, -2);
      if (copyToList.length === 0) copyToList = [...extras];
      else copyToList = [copyToList[0]!, ...extras, ...copyToList.slice(1)];
    }
  }

  // Always end with Accounts Section + Personal File when missing from a custom list.
  const hasAccounts = copyToList.some((item) => /^accounts section\b/i.test(item.trim()));
  const hasPersonal = copyToList.some((item) => /^personal file\b/i.test(item.trim()));
  if (!hasAccounts) copyToList.push("Accounts Section");
  if (!hasPersonal) copyToList.push("Personal File");

  // Apply Mr./Mrs./Miss./Ms. to any copy-to line that names the applicant or substitute.
  copyToList = applySalutationsToCopyToLines(copyToList, [
    { name: empName, gender: emp.gender, maritalStatus: emp.maritalStatus },
    ...(substituteName
      ? [{ name: substituteName, gender: substituteGender, maritalStatus: substituteMaritalStatus }]
      : []),
  ]);

  const doc = new PDFDocument({ size: "A4", margin: 54 });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));

  const calibri = resolveSanctionFonts();
  let fontRegular = "Helvetica";
  let fontBold = "Helvetica-Bold";
  if (calibri) {
    try {
      doc.registerFont(FONT_REGULAR, calibri.regular);
      doc.registerFont(FONT_BOLD, calibri.bold);
      fontRegular = FONT_REGULAR;
      fontBold = FONT_BOLD;
    } catch (e) {
      console.warn("[sanction-order] Calibri register failed; using Helvetica", e);
    }
  }

  const bodySize = 14;
  const leftX = doc.page.margins.left;
  const rightEdge = doc.page.width - doc.page.margins.right;
  const contentWidth = rightEdge - leftX;

  /** PDFKit leaves x at the right after width-aligned text — always restore left margin. */
  const goLeft = () => {
    doc.x = leftX;
  };

  const writeLeft = (text: string, opts?: { gap?: number; bold?: boolean }) => {
    goLeft();
    doc.font(opts?.bold ? fontBold : fontRegular).fontSize(bodySize);
    doc.text(text, leftX, doc.y, {
      width: contentWidth,
      align: "left",
      lineGap: 2,
    });
    goLeft();
    if (opts?.gap) doc.moveDown(opts.gap);
  };

  const writeCenter = (text: string, opts?: { gap?: number; bold?: boolean }) => {
    goLeft();
    doc.font(opts?.bold ? fontBold : fontRegular).fontSize(bodySize);
    doc.text(text, leftX, doc.y, {
      width: contentWidth,
      align: "center",
      lineGap: 2,
    });
    goLeft();
    if (opts?.gap) doc.moveDown(opts.gap);
  };

  const writeRight = (text: string, opts?: { gap?: number; bold?: boolean }) => {
    goLeft();
    doc.font(opts?.bold ? fontBold : fontRegular).fontSize(bodySize);
    doc.text(text, leftX, doc.y, {
      width: contentWidth,
      align: "right",
      lineGap: 2,
    });
    goLeft();
    if (opts?.gap) doc.moveDown(opts.gap);
  };

  // Letterhead starts at mid-page, each line left-aligned from that x (not flush-right / centered).
  const headerX = doc.page.width / 2;
  const headerBlockW = Math.max(120, rightEdge - headerX);
  let headerY = doc.y;
  doc.font(fontBold).fontSize(bodySize);
  doc.text(`NO. ${fileNo}`, headerX, headerY, {
    width: headerBlockW,
    align: "left",
    lineGap: 2,
  });
  headerY = doc.y;
  doc.font(fontRegular).fontSize(bodySize);
  doc.text(
    "OFFICE OF THE GOA AGRICULTURAL\nPRODUCE & LIVESTOCK MARKETING\nBOARD, ARLEM, RAIA, SALCETE-GOA.",
    headerX,
    headerY,
    { width: headerBlockW, align: "left", lineGap: 2 },
  );
  headerY = doc.y;
  doc.text(`Date: ${orderDateDisplay}`, headerX, headerY, {
    width: headerBlockW,
    align: "left",
  });
  doc.y = doc.y + bodySize * 1.4;
  goLeft();

  writeCenter("ORDER", { bold: true, gap: 0.7 });

  writeLeft(
    buildSanctionReadLine({
      gender: emp.gender,
      maritalStatus: emp.maritalStatus,
      empName,
      designation: emp.designation,
      primaryLocation: primaryLocationName,
      section: emp.section,
      yardIsHo,
      applicationDated: applicationDated || "________",
    }),
    { gap: 0.8 },
  );

  const fromDisp = formatLeaveOrderDate(lr.fromDate);
  const shortOrderTypes = new Set(["CL", "RH", "SPL_H"]);

  if (shortOrderTypes.has(lr.leaveType)) {
    const daysWord = leaveDaysInWords(debitDays > 0 ? debitDays : 1);
    const dayWord = debitDays === 0.5 ? "day" : debitDays === 1 ? "day" : "days";
    if (lr.leaveType === "CL") {
      const half =
        lr.halfDay === "first_half"
          ? " (first half)"
          : lr.halfDay === "second_half"
            ? " (second half)"
            : "";
      writeLeft(`${daysWord} ${dayWord} Casual leave${half} on ${fromDisp} approved.`, { gap: 1.2 });
    } else if (lr.leaveType === "RH") {
      const occasion = (lr.reason ?? "").trim() || "________";
      writeLeft(`${daysWord} ${dayWord} R.H. on ${fromDisp} approved i.e. of ${occasion}.`, { gap: 1.2 });
    } else {
      const duty = lr.dutyDateForSplH ? formatLeaveOrderDate(lr.dutyDateForSplH) : "________";
      writeLeft(`${daysWord} ${dayWord} Special Holiday on ${fromDisp} approved i.e. of ${duty}.`, { gap: 1.2 });
    }
  } else {
    writeLeft(
      buildSanctionGrantParagraph({
        gender: emp.gender,
        maritalStatus: emp.maritalStatus,
        empName,
        designation: emp.designation,
        primaryLocation: primaryLocationName,
        leaveTypeLabel,
        debitDays,
        fromDate: lr.fromDate,
        toDate: lr.toDate,
        isExPostFacto,
        leaveHq: lr.leaveHq,
        prefixDays: lr.prefixDays,
        suffixDays: lr.suffixDays,
        prefixFromDate: lr.prefixFromDate,
        suffixToDate: lr.suffixToDate,
        prefixSuffixDisallowed: lr.prefixSuffixDisallowed,
      }),
      { gap: 0.7 },
    );
    writeLeft(
      buildSanctionContinuationParagraph({
        gender: emp.gender,
        maritalStatus: emp.maritalStatus,
        empName,
        designation: emp.designation,
      }),
      { gap: 0.7 },
    );
    writeLeft(
      buildSanctionBalanceCertificateParagraph({
        leaveTypeLabel,
        balanceAfter,
        toDate: lr.toDate,
      }),
      { gap: 1.2 },
    );
  }

  const signatureBuffer = await readUploadedLeaveOrderSignatureBuffer();
  const sigW = 110;
  const sigH = 44;
  if (signatureBuffer) {
    try {
      doc.image(signatureBuffer, rightEdge - sigW, doc.y, { fit: [sigW, sigH] });
      doc.y = doc.y + sigH + 8;
      goLeft();
    } catch (e) {
      console.warn("[sanction-order] secretary signature image could not be embedded; continuing without it", e);
      doc.moveDown(0.5);
      goLeft();
    }
  }
  writeRight(`(${signatoryName})`);
  writeRight(signatoryDesig, { bold: true });
  writeRight("Goa Agricultural Produce & Livestock Marketing Board", { gap: 1.2 });

  writeLeft("Copy to:", { bold: true });
  copyToList.forEach((item, i) => {
    writeLeft(`${i + 1}. ${item}`);
  });

  doc.end();

  await new Promise<void>((resolve, reject) => {
    doc.on("end", () => resolve());
    doc.on("error", (err) => reject(err));
  });
  const buffer = Buffer.concat(chunks);

  return { buffer, fileNo };
}
