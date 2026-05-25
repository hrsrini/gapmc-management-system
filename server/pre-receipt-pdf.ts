import type { InferSelectModel } from "drizzle-orm";
import type PDFDocument from "pdfkit";
import { preReceipts } from "@shared/db-schema";
import { loadPdfDocumentConstructor } from "./pdfkit-loader";
import { formatInrAmountWordsLine, formatInrDigitsRs } from "./inr-amount-words";
import { pdfSafeText } from "./pdf-safe-text";

type PreReceiptRow = InferSelectModel<typeof preReceipts>;
type PdfDoc = InstanceType<typeof PDFDocument>;

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function formatBillingMonthLabel(ym: string | null | undefined, issuedYmd: string): string {
  const raw = String(ym ?? "").trim();
  let yStr: string;
  let mIdx: number;
  if (/^\d{4}-\d{2}$/.test(raw)) {
    yStr = raw.slice(0, 4);
    mIdx = Number(raw.slice(5, 7)) - 1;
  } else {
    const d = issuedYmd.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      yStr = d.slice(0, 4);
      mIdx = Number(d.slice(5, 7)) - 1;
    } else {
      const now = new Date();
      yStr = String(now.getFullYear());
      mIdx = now.getMonth();
    }
  }
  if (mIdx < 0 || mIdx > 11) mIdx = 0;
  return `${MONTH_NAMES[mIdx]},${yStr}`;
}

export function formatReceiptDateDdMmYyyy(isoLike: string | null | undefined): string {
  const d = String(isoLike ?? "").slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    return `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;
  }
  const n = new Date();
  const dd = String(n.getDate()).padStart(2, "0");
  const mm = String(n.getMonth() + 1).padStart(2, "0");
  return `${dd}.${mm}.${n.getFullYear()}`;
}

export type PreReceiptPdfBuildInput = {
  pre: PreReceiptRow;
  entityName: string;
  yardDisplayName: string;
};

function drawOneReceiptBlock(
  doc: PdfDoc,
  params: {
    amountDigits: string;
    amountWordsLine: string;
    payerName: string;
    assetType: string;
    assetNo: string;
    yardName: string;
    billingLabel: string;
    dateLabel: string;
    placeLine: string;
    supervisorTitle: string;
    yardCaps: string;
    leftX: number;
    contentWidth: number;
    startY: number;
  },
): void {
  const {
    amountDigits,
    amountWordsLine,
    payerName,
    assetType,
    assetNo,
    yardName,
    billingLabel,
    dateLabel,
    placeLine,
    supervisorTitle,
    yardCaps,
    leftX,
    contentWidth,
    startY,
  } = params;

  doc.x = leftX;
  doc.y = startY;

  doc.font("Helvetica-Bold").fontSize(13).text("PRE-RECEIPT", leftX, startY, {
    width: contentWidth,
    align: "center",
    underline: true,
  });
  doc.moveDown(1.1);

  const bodyY = doc.y;
  doc.font("Helvetica").fontSize(11);
  doc.text("Received an amount of ", leftX, bodyY, { continued: true, width: contentWidth, align: "left" });
  doc.font("Helvetica-Bold").text(amountDigits, { continued: true });
  doc.font("Helvetica").text(" (", { continued: true });
  doc.font("Helvetica-Bold").text(amountWordsLine, { continued: true });
  doc.font("Helvetica").text(") from the ", { continued: true });
  doc.font("Helvetica-Bold").text(payerName, { continued: true });
  doc.font("Helvetica").text(", being the rent of ", { continued: true });
  doc.font("Helvetica-Bold").text(assetType, { continued: true });
  doc.font("Helvetica").text(" No. ", { continued: true });
  doc.font("Helvetica-Bold").text(assetNo, { continued: true });
  doc.font("Helvetica").text(" Occupied at ", { continued: true });
  doc.font("Helvetica-Bold").text(yardName, { continued: true });
  doc.font("Helvetica").text(" for the month of ", { continued: true });
  doc.font("Helvetica-Bold").text(`${billingLabel}.`, { width: contentWidth, align: "left" });
  doc.moveDown(1.2);

  const SIGNATURE_STAMP_GAP = 44;
  const sigBlockY = doc.y + SIGNATURE_STAMP_GAP;
  doc.font("Helvetica").fontSize(11);
  doc.text(`Date:- ${dateLabel}`, leftX, sigBlockY, { width: contentWidth * 0.55 });
  doc.text(supervisorTitle, leftX + contentWidth * 0.45, sigBlockY, { width: contentWidth * 0.55, align: "right" });
  doc.text(`Place :- ${placeLine}`, leftX, sigBlockY + 16, { width: contentWidth * 0.55 });
  doc.font("Helvetica-Bold").text(yardCaps, leftX + contentWidth * 0.45, sigBlockY + 16, { width: contentWidth * 0.55, align: "right" });
}

export async function buildPreReceiptPdfA4Double(input: PreReceiptPdfBuildInput): Promise<Buffer> {
  const { pre, entityName, yardDisplayName } = input;
  const amount = Number(pre.amount ?? 0) || 0;
  const amountDigits = pdfSafeText(formatInrDigitsRs(amount));
  const amountWordsLine = pdfSafeText(formatInrAmountWordsLine(amount));
  const issuedYmd = String(pre.issuedAt ?? pre.updatedAt ?? new Date().toISOString()).slice(0, 10);
  const billingLabel = pdfSafeText(formatBillingMonthLabel(pre.rentBillingMonth ?? null, issuedYmd));
  const dateLabel = pdfSafeText(formatReceiptDateDdMmYyyy(pre.issuedAt ?? pre.updatedAt));
  const assetType = pdfSafeText(String(pre.rentPremisesType ?? "").trim() || "Premises");
  const assetNo = pdfSafeText(
    String(pre.rentPremisesRef ?? "").trim() || String(pre.preReceiptNo ?? pre.id).trim(),
  );
  const yardName = pdfSafeText(yardDisplayName.trim() || "-");
  const placeLine = pdfSafeText(`${yardDisplayName.trim() || "-"}.`);
  const supervisorTitle = pdfSafeText("Market Supervisor");
  const yardCaps = pdfSafeText(yardName.toUpperCase());
  const payerName = pdfSafeText(entityName);

  const PDFDocument = await loadPdfDocumentConstructor();
  const doc = new PDFDocument({ size: "A4", margin: 48 });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));

  await new Promise<void>((resolve, reject) => {
    doc.on("end", () => resolve());
    doc.on("error", reject);

    const leftX = doc.page.margins.left;
    const rightX = doc.page.width - doc.page.margins.right;
    const contentWidth = rightX - leftX;

    drawOneReceiptBlock(doc, {
      amountDigits,
      amountWordsLine,
      payerName,
      assetType,
      assetNo,
      yardName,
      billingLabel,
      dateLabel,
      placeLine,
      supervisorTitle,
      yardCaps,
      leftX,
      contentWidth,
      startY: 48,
    });

    const secondStart = 400;
    drawOneReceiptBlock(doc, {
      amountDigits,
      amountWordsLine,
      payerName,
      assetType,
      assetNo,
      yardName,
      billingLabel,
      dateLabel,
      placeLine,
      supervisorTitle,
      yardCaps,
      leftX,
      contentWidth,
      startY: secondStart,
    });

    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor("#666")
      .text(
        pdfSafeText(
          "System-generated pre-receipt (IOMS). Duplicate copy on the same A4 sheet for office use.",
        ),
        leftX,
        doc.page.height - doc.page.margins.bottom - 24,
        { width: contentWidth, align: "center" },
      );
    doc.fillColor("#000");
    doc.end();
  });

  return Buffer.concat(chunks);
}
