import type PDFDocument from "pdfkit";
import { pdfSafeText } from "./pdf-safe-text";
import {
  formatReceiptAmountCell,
  formatReceiptTotalLine,
} from "./receipt-pdf-shared";
import type { ReceiptPdfLayoutContext, ReceiptPdfParticularRow } from "./receipt-pdf-context";

type PdfDoc = InstanceType<typeof PDFDocument>;

const PAD = 8;
const ROW_H = 14;
const HEADER_H = 16;
const TOTAL_ROW_H = 18;
const TABLE_LINE = 0.5;

/** Full grid: outer border, column rules, header/body/total separators. */
function drawParticularsTable(
  doc: PdfDoc,
  rows: ReceiptPdfParticularRow[],
  totalAmount: number,
  x: number,
  y: number,
  width: number,
): number {
  const snW = Math.min(32, Math.round(width * 0.1));
  const amtW = Math.round(width * 0.28);
  const partW = width - snW - amtW;
  const partX = x + snW;
  const amtX = x + snW + partW;

  const bodyRows = Math.max(rows.length, 1);
  const tableH = HEADER_H + bodyRows * ROW_H + TOTAL_ROW_H;
  const tableBottom = y + tableH;
  const headerBottom = y + HEADER_H;
  const bodyBottom = headerBottom + bodyRows * ROW_H;

  doc.save();
  doc.lineWidth(TABLE_LINE).strokeColor("#000000");

  // Outer border
  doc.rect(x, y, width, tableH).stroke();

  // Column dividers (full height)
  doc.moveTo(partX, y).lineTo(partX, tableBottom).stroke();
  doc.moveTo(amtX, y).lineTo(amtX, tableBottom).stroke();

  // Header / body and body / total separators
  doc.moveTo(x, headerBottom).lineTo(x + width, headerBottom).stroke();
  doc.moveTo(x, bodyBottom).lineTo(x + width, bodyBottom).stroke();

  doc.restore();

  // Header text
  const headerTextY = y + (HEADER_H - 8) / 2;
  doc.font("Helvetica-Bold").fontSize(8);
  doc.text("S.N", x, headerTextY, { width: snW, align: "center", lineBreak: false });
  doc.text("Particulars", partX + 3, headerTextY, { width: partW - 6, align: "left", lineBreak: false });
  doc.text("Amount", amtX, headerTextY, { width: amtW - 3, align: "right", lineBreak: false });

  // Body rows
  doc.font("Helvetica").fontSize(8);
  let rowY = headerBottom + (ROW_H - 8) / 2;
  const dataRows = rows.length > 0 ? rows : [{ sn: 1, label: "—", amount: 0 }];
  for (const row of dataRows) {
    doc.text(String(row.sn), x, rowY, { width: snW, align: "center", lineBreak: false });
    doc.text(pdfSafeText(row.label), partX + 3, rowY, { width: partW - 6, align: "left", lineBreak: false });
    const amtStr =
      row.amount < 0
        ? `(${formatReceiptAmountCell(Math.abs(row.amount))})`
        : formatReceiptAmountCell(row.amount);
    doc.text(pdfSafeText(amtStr), amtX, rowY, { width: amtW - 3, align: "right", lineBreak: false });
    rowY += ROW_H;
  }

  // Total row (amount column only; borders span full table width)
  const totalStr = formatReceiptTotalLine(totalAmount);
  const totalTextY = bodyBottom + (TOTAL_ROW_H - 9) / 2;
  doc.font("Helvetica-Bold").fontSize(9);
  doc.text(pdfSafeText(totalStr), amtX, totalTextY, { width: amtW - 3, align: "right", lineBreak: false });

  return tableBottom + 6;
}

export type DrawReceiptSlipOptions = {
  bodyOnly: boolean;
  signatoryName?: string | null;
  qrPng?: Buffer | null;
  verifyUrl?: string | null;
};

/** Draw one bordered GAPLMB receipt slip; returns bottom Y. */
export function drawGaplmbReceiptSlip(
  doc: PdfDoc,
  ctx: ReceiptPdfLayoutContext,
  box: { x: number; y: number; width: number; height: number },
  opts: DrawReceiptSlipOptions,
): number {
  const { x, y, width, height } = box;
  doc.rect(x, y, width, height).lineWidth(0.75).stroke();

  const innerX = x + PAD;
  const innerW = width - PAD * 2;
  let cy = y + PAD;

  if (!opts.bodyOnly) {
    doc.font("Helvetica-Bold").fontSize(10);
    doc.text(pdfSafeText(ctx.branding.boardName), innerX, cy, { width: innerW, align: "center" });
    cy += 14;
    doc.font("Helvetica").fontSize(7.5);
    doc.text(pdfSafeText(ctx.branding.hoAddressLine), innerX, cy, { width: innerW, align: "center" });
    cy += 11;
    doc.text(pdfSafeText(ctx.branding.placeLine), innerX, cy, { width: innerW, align: "center" });
    cy += 11;
    doc.text(pdfSafeText(`GSTIN/UIN :${ctx.branding.gstin}`), innerX, cy, { width: innerW, align: "center" });
    cy += 12;
    doc.font("Helvetica-Bold").fontSize(10);
    doc.text(pdfSafeText(ctx.receiptTitle), innerX, cy, { width: innerW, align: "center" });
    cy += 16;
  } else {
    doc.font("Helvetica-Bold").fontSize(10);
    doc.text(pdfSafeText(ctx.receiptTitle), innerX, cy, { width: innerW, align: "center" });
    cy += 14;
  }

  const halfW = innerW * 0.52;
  const rightX = innerX + innerW * 0.48;
  const rightW = innerW * 0.52;
  doc.font("Helvetica").fontSize(8.5);

  doc.text(pdfSafeText(`Receipt No : ${ctx.receiptNo}`), innerX, cy, { width: halfW, align: "left" });
  doc.text(pdfSafeText(`Date : ${ctx.dateLabel}`), rightX, cy, { width: rightW, align: "right" });
  cy += 13;

  doc.text(pdfSafeText(`Received with thanks From : ${ctx.payerDisplayName}`), innerX, cy, {
    width: halfW + 20,
    align: "left",
  });
  const lic = ctx.licenceNo?.trim() ? ctx.licenceNo.trim() : "—";
  doc.text(pdfSafeText(`Licence No:${lic}`), rightX, cy, { width: rightW, align: "right" });
  cy += 14;

  doc.text(pdfSafeText(`A Sum Of ( INR ${ctx.amountWords} Only )`), innerX, cy, { width: innerW, align: "left" });
  cy += 13;

  doc.text(pdfSafeText(`By : ${ctx.paymentModeLabel}`), innerX, cy, { width: innerW, align: "left" });
  cy += 12;

  doc.text(pdfSafeText("Towards as below :"), innerX, cy, { width: innerW, align: "left" });
  cy += 11;

  const remarks = pdfSafeText(`Remarks : ${ctx.remarks}`);
  doc.text(remarks, innerX, cy, { width: innerW, align: "left", lineGap: 1 });
  cy = doc.y + 6;

  if (ctx.isGracePeriod) {
    doc.fontSize(7).fillColor("#92400e");
    doc.text(
      pdfSafeText("Grace period transaction — licence renewal required per policy."),
      innerX,
      cy,
      { width: innerW },
    );
    doc.fillColor("#000");
    cy = doc.y + 4;
  }

  cy = drawParticularsTable(doc, ctx.rows, ctx.totalAmount, innerX, cy, innerW);

  const footerY = Math.min(y + height - PAD - 36, cy);
  doc.font("Helvetica").fontSize(7);
  const note =
    ctx.revenueHead === "MarketFee"
      ? "Please note: 1. This receipt is proof of Market Fee payment. 2.Cheques subject to realisation."
      : "Please note: 2.Cheques subject to realisation.";
  doc.text(pdfSafeText(note), innerX, footerY, { width: innerW * 0.55, align: "left" });

  const sigX = innerX + innerW * 0.42;
  const sigW = innerW * 0.58;
  doc.text(pdfSafeText("Officer Incharge"), sigX, footerY, { width: sigW, align: "right" });
  doc.font("Helvetica-Bold").fontSize(7);
  doc.text(
    pdfSafeText("For THE GOA AGRICULTURAL PRODUCE & LIVESTOCK MARKETING BOARD"),
    sigX,
    footerY + 22,
    { width: sigW, align: "right" },
  );

  if (opts.signatoryName?.trim()) {
    doc.font("Helvetica").fontSize(6.5).fillColor("#444");
    doc.text(pdfSafeText(opts.signatoryName.trim()), sigX, footerY + 38, { width: sigW, align: "right" });
    doc.fillColor("#000");
  }

  if (opts.qrPng && opts.verifyUrl) {
    try {
      const qrSize = 44;
      doc.image(opts.qrPng, innerX, footerY + 8, { width: qrSize, height: qrSize });
      doc.fontSize(5.5).fillColor("#666");
      doc.text(pdfSafeText("Verify"), innerX, footerY + qrSize + 10, { width: qrSize, align: "center" });
      doc.fillColor("#000");
    } catch {
      /* skip QR */
    }
  }

  return y + height;
}
