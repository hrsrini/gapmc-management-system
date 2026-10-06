/**
 * M-01 Employee Posting Report (Primary Location Posted + Additional Charge Locations).
 * Groups Active employees by Yard / Checkpost / HO section for Excel + PDF.
 */
import PDFDocument from "pdfkit";
import { asc, eq } from "drizzle-orm";
import { classifyLeaveYardKind, employeeMrHonorific, type LeaveYardKind } from "@shared/hr-leave-display";
import {
  formatAdditionalChargeLabels,
  parseAdditionalChargeYardIds,
} from "@shared/hr-additional-charge-locations";
import { db } from "./db";
import { employees, yards } from "@shared/db-schema";

export type PostingPerson = {
  employeeId: string;
  empId: string | null;
  displayName: string;
  honorific: string;
  designation: string;
  nameLine: string;
  primaryLocationLabel: string;
  additionalChargeLabels: string[];
};

export type PostingLocationBlock = {
  key: string;
  title: string;
  kind: LeaveYardKind | "ho_section" | "ho_exec";
  people: PostingPerson[];
};

export type EmployeePostingReportData = {
  title: string;
  updatedOnDisplay: string;
  yards: PostingLocationBlock[];
  checkposts: PostingLocationBlock[];
  hoSections: PostingLocationBlock[];
  hoExecutive: PostingLocationBlock;
};

function empName(e: {
  firstName: string;
  middleName?: string | null;
  surname: string;
}): string {
  return [e.firstName, e.middleName, e.surname].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function formatUpdatedOn(d = new Date()): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

function normalizeHoSection(section: string | null | undefined): string {
  const s = String(section ?? "").trim().toLowerCase();
  if (!s) return "Unassigned Section";
  if (s.includes("account")) return "Accounts Section";
  if (s.includes("inspect")) return "Inspection Section";
  if (s.includes("admin") || s === "adm" || s.startsWith("adm ")) return "Admin Section";
  return String(section ?? "").trim() || "Unassigned Section";
}

const HO_SECTION_ORDER = ["Admin Section", "Inspection Section", "Accounts Section"];

function isExecutiveDesignation(designation: string): boolean {
  const d = designation.trim().toLowerCase();
  if (!d) return false;
  if (/\basst\.?\s*secretary\b/.test(d) || /\bassistant\s+secretary\b/.test(d)) return false;
  if (/\bjt\.?\s*secretary\b/.test(d) || /\bjoint\s+secretary\b/.test(d)) return true;
  return /\bsecretary\b/.test(d);
}

function personCellText(p: PostingPerson): string {
  const lines = [`${p.nameLine}`, p.designation];
  if (p.additionalChargeLabels.length > 0) {
    lines.push(`Additional Charge: ${p.additionalChargeLabels.join("; ")}`);
  }
  return lines.join("\n");
}

function sortPeople(a: PostingPerson, b: PostingPerson): number {
  return a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" });
}

export async function buildEmployeePostingReportData(): Promise<EmployeePostingReportData> {
  const updatedOnDisplay = formatUpdatedOn();
  const yardRows = await db.select().from(yards).orderBy(asc(yards.name));
  const empRows = await db
    .select({
      id: employees.id,
      empId: employees.empId,
      firstName: employees.firstName,
      middleName: employees.middleName,
      surname: employees.surname,
      designation: employees.designation,
      gender: employees.gender,
      maritalStatus: employees.maritalStatus,
      yardId: employees.yardId,
      section: employees.section,
      locationPosted: employees.locationPosted,
      status: employees.status,
    })
    .from(employees)
    .where(eq(employees.status, "Active"))
    .orderBy(asc(employees.surname), asc(employees.firstName));

  const yardById = Object.fromEntries(yardRows.map((y) => [y.id, y]));

  const yardBlocks = new Map<string, PostingLocationBlock>();
  const cpBlocks = new Map<string, PostingLocationBlock>();
  const hoSectionBlocks = new Map<string, PostingLocationBlock>();
  const hoExecPeople: PostingPerson[] = [];

  for (const y of yardRows) {
    const kind = classifyLeaveYardKind(y);
    if (kind === "yard" || kind === "unknown") {
      yardBlocks.set(y.id, { key: y.id, title: y.name, kind: "yard", people: [] });
    } else if (kind === "checkpost") {
      cpBlocks.set(y.id, { key: y.id, title: y.name, kind: "checkpost", people: [] });
    }
  }

  for (const e of empRows) {
    const yard = yardById[e.yardId];
    const primaryLocationLabel = yard?.name ?? yard?.code ?? e.yardId;
    const additionalChargeLabels = formatAdditionalChargeLabels(
      e.locationPosted,
      e.yardId,
      yardById,
    );
    // Ensure parsed IDs that no longer exist still show as id.
    const orphanIds = parseAdditionalChargeYardIds(e.locationPosted, e.yardId).filter((id) => !yardById[id]);
    for (const id of orphanIds) {
      if (!additionalChargeLabels.includes(id)) additionalChargeLabels.push(id);
    }

    const displayName = empName(e);
    const honorific = employeeMrHonorific(e.gender, e.maritalStatus);
    const person: PostingPerson = {
      employeeId: e.id,
      empId: e.empId,
      displayName,
      honorific,
      designation: e.designation,
      nameLine: `${honorific} ${displayName}`.replace(/\s+/g, " ").trim(),
      primaryLocationLabel,
      additionalChargeLabels,
    };

    const kind = yard ? classifyLeaveYardKind(yard) : "unknown";

    if (kind === "ho") {
      const sectionTitle = normalizeHoSection(e.section);
      let block = hoSectionBlocks.get(sectionTitle);
      if (!block) {
        block = { key: `ho:${sectionTitle}`, title: sectionTitle, kind: "ho_section", people: [] };
        hoSectionBlocks.set(sectionTitle, block);
      }
      block.people.push(person);
      if (isExecutiveDesignation(e.designation)) hoExecPeople.push(person);
      continue;
    }

    if (kind === "checkpost") {
      let block = cpBlocks.get(e.yardId);
      if (!block) {
        block = { key: e.yardId, title: primaryLocationLabel, kind: "checkpost", people: [] };
        cpBlocks.set(e.yardId, block);
      }
      block.people.push(person);
      continue;
    }

    let block = yardBlocks.get(e.yardId);
    if (!block) {
      block = { key: e.yardId, title: primaryLocationLabel, kind: "yard", people: [] };
      yardBlocks.set(e.yardId, block);
    }
    block.people.push(person);
  }

  const yardsOut = Array.from(yardBlocks.values())
    .filter((b) => b.people.length > 0)
    .map((b) => ({ ...b, people: [...b.people].sort(sortPeople) }))
    .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));

  const checkpostsOut = Array.from(cpBlocks.values())
    .filter((b) => b.people.length > 0)
    .map((b) => ({ ...b, people: [...b.people].sort(sortPeople) }))
    .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));

  const hoSectionsOut = Array.from(hoSectionBlocks.values())
    .map((b) => ({ ...b, people: [...b.people].sort(sortPeople) }))
    .sort((a, b) => {
      const ia = HO_SECTION_ORDER.indexOf(a.title);
      const ib = HO_SECTION_ORDER.indexOf(b.title);
      if (ia >= 0 && ib >= 0) return ia - ib;
      if (ia >= 0) return -1;
      if (ib >= 0) return 1;
      return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
    });

  return {
    title: `PROPOSED POSTING (updated on ${updatedOnDisplay})`,
    updatedOnDisplay,
    yards: yardsOut,
    checkposts: checkpostsOut,
    hoSections: hoSectionsOut,
    hoExecutive: {
      key: "ho-exec",
      title: "HEAD OFFICE",
      kind: "ho_exec",
      people: [...hoExecPeople].sort(sortPeople),
    },
  };
}

export function postingReportToAoa(data: EmployeePostingReportData): (string | number)[][] {
  const aoa: (string | number)[][] = [[data.title], []];

  const pushGroup = (groupTitle: string, blocks: PostingLocationBlock[]) => {
    if (blocks.length === 0) return;
    aoa.push([groupTitle]);
    aoa.push([]);
    blocks.forEach((block, bi) => {
      aoa.push([`${bi + 1}. ${block.title}`]);
      aoa.push(["Sr. Nos.", "Employee (Primary Location)", "Additional Charge Location(s)"]);
      block.people.forEach((p, i) => {
        aoa.push([
          i + 1,
          `${p.nameLine}, ${p.designation}`,
          p.additionalChargeLabels.join("; ") || "—",
        ]);
      });
      aoa.push([]);
    });
  };

  pushGroup("YARDS", data.yards);
  pushGroup("CHECKPOSTS", data.checkposts);

  if (data.hoSections.length > 0 || data.hoExecutive.people.length > 0) {
    aoa.push(["HEAD OFFICE"]);
    aoa.push([]);
    data.hoSections.forEach((block) => {
      aoa.push(["Sr. Nos.", block.title, "Additional Charge Location(s)"]);
      block.people.forEach((p, i) => {
        aoa.push([
          i + 1,
          `${p.nameLine}, ${p.designation}`,
          p.additionalChargeLabels.join("; ") || "—",
        ]);
      });
      aoa.push([]);
    });
    if (data.hoExecutive.people.length > 0) {
      aoa.push(["Sr. Nos.", data.hoExecutive.title, "Additional Charge Location(s)"]);
      data.hoExecutive.people.forEach((p, i) => {
        aoa.push([
          i + 1,
          `${p.nameLine}, ${p.designation}`,
          p.additionalChargeLabels.join("; ") || "—",
        ]);
      });
    }
  }

  return aoa;
}

function drawLocationTable(
  doc: PDFKit.PDFDocument,
  block: PostingLocationBlock,
  x: number,
  y: number,
  width: number,
  opts?: { indexLabel?: string },
): number {
  const srW = 36;
  const nameW = width - srW;
  const pad = 3;
  const titleSize = 8;
  const bodySize = 7.5;
  let cy = y;

  const headerLabel = opts?.indexLabel ? `${opts.indexLabel}. ${block.title}` : block.title;
  doc.font("Helvetica-Bold").fontSize(titleSize);
  const headerH = Math.max(16, doc.heightOfString(headerLabel, { width: nameW - pad * 2 }) + pad * 2);

  doc.rect(x, cy, srW, headerH).stroke();
  doc.rect(x + srW, cy, nameW, headerH).stroke();
  doc.font("Helvetica-Bold").fontSize(7);
  doc.text("Sr. Nos.", x + pad, cy + pad, { width: srW - pad * 2, align: "center" });
  doc.font("Helvetica-Bold").fontSize(titleSize);
  doc.text(headerLabel, x + srW + pad, cy + pad, { width: nameW - pad * 2, align: "left" });
  cy += headerH;

  block.people.forEach((p, i) => {
    const cellText = personCellText(p);
    doc.font("Helvetica").fontSize(bodySize);
    const textH = doc.heightOfString(cellText, { width: nameW - pad * 2 });
    const rowH = Math.max(22, textH + pad * 2);
    if (cy + rowH > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      cy = doc.page.margins.top;
    }
    doc.rect(x, cy, srW, rowH).stroke();
    doc.rect(x + srW, cy, nameW, rowH).stroke();
    doc.font("Helvetica").fontSize(bodySize);
    doc.text(String(i + 1), x + pad, cy + pad, { width: srW - pad * 2, align: "center" });
    doc.text(cellText, x + srW + pad, cy + pad, { width: nameW - pad * 2, align: "left" });
    cy += rowH;
  });

  return cy;
}

export async function generateEmployeePostingReportPdf(data: EmployeePostingReportData): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 36, layout: "landscape" });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));

  const contentW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const colGap = 12;
  const colW = (contentW - colGap) / 2;

  doc.font("Helvetica-Bold").fontSize(12).text(data.title, { align: "center" });
  doc.moveDown(0.6);

  const drawGroup = (label: string, blocks: PostingLocationBlock[]) => {
    if (blocks.length === 0) return;
    if (doc.y > doc.page.height - doc.page.margins.bottom - 40) doc.addPage();
    doc.font("Helvetica-Bold").fontSize(10).text(label, doc.page.margins.left, doc.y);
    doc.moveDown(0.35);

    let leftY = doc.y;
    let rightY = doc.y;
    let useLeft = true;
    blocks.forEach((block, i) => {
      const x = useLeft ? doc.page.margins.left : doc.page.margins.left + colW + colGap;
      let y = useLeft ? leftY : rightY;
      if (y > doc.page.height - doc.page.margins.bottom - 50) {
        doc.addPage();
        leftY = doc.page.margins.top;
        rightY = doc.page.margins.top;
        y = doc.page.margins.top;
        useLeft = true;
      }
      const endY = drawLocationTable(doc, block, x, y, colW, { indexLabel: String(i + 1) });
      if (useLeft) leftY = endY + 10;
      else rightY = endY + 10;
      useLeft = !useLeft;
      if (useLeft) {
        doc.y = Math.max(leftY, rightY);
        leftY = doc.y;
        rightY = doc.y;
      }
    });
    doc.y = Math.max(leftY, rightY) + 6;
  };

  drawGroup("YARDS", data.yards);
  drawGroup("CHECKPOSTS", data.checkposts);

  if (data.hoSections.length > 0 || data.hoExecutive.people.length > 0) {
    if (doc.y > doc.page.height - doc.page.margins.bottom - 40) doc.addPage();
    doc.font("Helvetica-Bold").fontSize(10).text("HEAD OFFICE", doc.page.margins.left, doc.y);
    doc.moveDown(0.35);

    const leftX = doc.page.margins.left;
    const rightX = doc.page.margins.left + colW + colGap;
    let y = doc.y;
    let leftBottom = y;
    for (const block of data.hoSections) {
      leftBottom = drawLocationTable(doc, block, leftX, leftBottom, colW) + 8;
    }
    if (data.hoExecutive.people.length > 0) {
      drawLocationTable(doc, data.hoExecutive, rightX, y, colW);
    }
    doc.y = Math.max(leftBottom, doc.y) + 4;
  }

  doc.end();
  await new Promise<void>((resolve, reject) => {
    doc.on("end", () => resolve());
    doc.on("error", (err) => reject(err));
  });
  return Buffer.concat(chunks);
}
