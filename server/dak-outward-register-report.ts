/**
 * Tapal Outward register report — columns for print/paste into the physical Outward Register.
 * Layout mirrors Inward Register (A4). No Inward Ref / Status columns.
 */
import PDFDocument from "pdfkit";
import { and, desc, gte, lte, or, isNull, inArray, sql, type SQL } from "drizzle-orm";
import { db } from "./db";
import { dakOutward } from "@shared/db-schema";

export type DakOutwardRegisterRow = {
  id: string;
  srNo: number;
  outwardNo: string;
  date: string;
  dateYmd: string;
  toParty: string;
  address: string;
  subject: string;
  modeOfDespatch: string;
};

export type DakOutwardRegisterPayload = {
  title: string;
  mode: "date" | "range";
  fromDate: string;
  toDate: string;
  filterLabel: string;
  generatedAtDisplay: string;
  subjectFilter: string | null;
  rows: DakOutwardRegisterRow[];
};

function ymdOk(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function displayYmd(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.slice(0, 10));
  if (!m) return ymd;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function nowDisplayIst(): string {
  const d = new Date();
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")}-${get("month")}-${get("year")} ${get("hour")}:${get("minute")}`;
}

export async function buildDakOutwardRegisterReport(opts: {
  mode: "date" | "range";
  date?: string;
  fromDate?: string;
  toDate?: string;
  subject?: string;
  scopedLocationIds?: string[];
}): Promise<DakOutwardRegisterPayload> {
  let fromDate: string;
  let toDate: string;
  if (opts.mode === "date") {
    const d = String(opts.date ?? "").trim().slice(0, 10);
    if (!ymdOk(d)) throw new Error("date must be YYYY-MM-DD");
    fromDate = d;
    toDate = d;
  } else {
    fromDate = String(opts.fromDate ?? "").trim().slice(0, 10);
    toDate = String(opts.toDate ?? "").trim().slice(0, 10);
    if (!ymdOk(fromDate) || !ymdOk(toDate)) throw new Error("fromDate and toDate must be YYYY-MM-DD");
    if (fromDate > toDate) throw new Error("fromDate must be <= toDate");
  }

  const conditions: SQL[] = [
    gte(dakOutward.despatchDate, fromDate),
    lte(dakOutward.despatchDate, toDate),
  ];
  const scoped = opts.scopedLocationIds;
  if (scoped && scoped.length > 0) {
    conditions.push(or(isNull(dakOutward.yardId), inArray(dakOutward.yardId, scoped))!);
  }
  const subjectQ = String(opts.subject ?? "").trim();
  if (subjectQ) {
    conditions.push(sql`position(lower(${subjectQ}) in lower(${dakOutward.subject})) > 0`);
  }

  const list = await db
    .select()
    .from(dakOutward)
    .where(and(...conditions))
    .orderBy(desc(dakOutward.despatchDate), desc(dakOutward.despatchNo));

  const rows: DakOutwardRegisterRow[] = list.map((r, i) => {
    const ymd = String(r.despatchDate ?? "").slice(0, 10);
    return {
      id: r.id,
      srNo: i + 1,
      outwardNo: String(r.despatchNo ?? r.id).trim() || r.id,
      date: displayYmd(ymd),
      dateYmd: ymd,
      toParty: String(r.toParty ?? "").trim() || "—",
      address: String(r.toAddress ?? "").trim() || "—",
      subject: String(r.subject ?? "").trim() || "—",
      modeOfDespatch: String(r.modeOfDespatch ?? "").trim() || "—",
    };
  });

  const filterLabel =
    opts.mode === "date"
      ? `Particular date: ${displayYmd(fromDate)}`
      : `Date range: ${displayYmd(fromDate)} to ${displayYmd(toDate)}`;

  return {
    title: "Tapal Outward Register",
    mode: opts.mode,
    fromDate,
    toDate,
    filterLabel: subjectQ ? `${filterLabel}; Subject contains: ${subjectQ}` : filterLabel,
    generatedAtDisplay: nowDisplayIst(),
    subjectFilter: subjectQ || null,
    rows,
  };
}

export function buildDakOutwardRegisterAoa(payload: DakOutwardRegisterPayload): (string | number)[][] {
  const headers = ["Outward No.", "Date", "To", "Address", "Subject", "Mode"];
  return [
    [payload.title],
    [`Filter: ${payload.filterLabel}`],
    [`Generated: ${payload.generatedAtDisplay}`],
    [],
    headers,
    ...payload.rows.map((r) => [r.outwardNo, r.date, r.toParty, r.address, r.subject, r.modeOfDespatch]),
  ];
}

/** A4 portrait PDF optimised for printing / pasting into the Outward Register. */
export async function generateDakOutwardRegisterPdf(payload: DakOutwardRegisterPayload): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", layout: "portrait", margin: 36 });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));

  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  doc.font("Helvetica-Bold").fontSize(12).text(payload.title, { align: "center" });
  doc.moveDown(0.25);
  doc.font("Helvetica").fontSize(8).text(payload.filterLabel, { align: "left" });
  doc.text(`Generated: ${payload.generatedAtDisplay}`);
  doc.moveDown(0.4);

  const headers = ["Outward No.", "Date", "To", "Address", "Subject", "Mode"];
  const widths = [72, 58, 95, 95, 140, 63];
  const startX = 36;
  let y = doc.y;

  const drawHeader = () => {
    doc.font("Helvetica-Bold").fontSize(7.5);
    let x = startX;
    headers.forEach((h, i) => {
      doc.text(h, x, y, { width: widths[i]! - 2, align: "left" });
      x += widths[i]!;
    });
    y += 14;
    doc
      .moveTo(startX, y - 3)
      .lineTo(startX + widths.reduce((a, b) => a + b, 0), y - 3)
      .stroke("#333");
  };

  drawHeader();
  doc.font("Helvetica").fontSize(7);

  if (payload.rows.length === 0) {
    doc.text("No outward items for the selected criteria.", startX, y);
  } else {
    for (const r of payload.rows) {
      const cells = [r.outwardNo, r.date, r.toParty, r.address, r.subject, r.modeOfDespatch];
      let rowH = 11;
      cells.forEach((c, i) => {
        rowH = Math.max(rowH, doc.heightOfString(String(c), { width: widths[i]! - 2 }) + 2);
      });
      if (y + rowH > doc.page.height - 36) {
        doc.addPage();
        y = doc.page.margins.top;
        drawHeader();
        doc.font("Helvetica").fontSize(7);
      }
      let x = startX;
      cells.forEach((c, i) => {
        doc.text(String(c), x, y, { width: widths[i]! - 2, align: "left" });
        x += widths[i]!;
      });
      y += rowH;
    }
  }

  doc.end();
  return done;
}
