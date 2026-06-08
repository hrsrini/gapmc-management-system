import type PDFDocument from "pdfkit";
import { pdfSafeText } from "./pdf-safe-text";
import {
  formatReceiptAmountCell,
  formatReceiptTotalLine,
} from "./receipt-pdf-shared";
import type { ReceiptPdfLayoutContext, ReceiptPdfParticularRow } from "./receipt-pdf-context";

type PdfDoc = InstanceType<typeof PDFDocument>;

const PAD = 8;
/** Empty space between Officer Incharge and the board signature line (sign / stamp / seal). */
const SIGNATURE_STAMP_GAP = 52;
const USERNAME_LINE_H = 10;
const BOARD_LINE_H = 12;
const OFFICER_LINE_H = 10;
const GAP_USERNAME_TO_BOARD = 8;
/** ~one printed text line on receipt face (8.5–7.5 pt). */
const TEXT_LINE = 12;
/** Please note, QR, and Officer Incharge — 3 lines below table total. */
const FOOTER_NOTE_QR_OFFICER_DROP = TEXT_LINE * 3;
/** Extra drop for please-note / QR / Verify only (signatures stay fixed). */
const FOOTER_NOTE_QR_EXTRA_DROP = TEXT_LINE * 2;
/** Board signature line — 2 lines below default (username stays fixed). */
const BOARD_LINE_DROP = TEXT_LINE * 2;
/** Officer Incharge + board line — nudge up without moving please-note / QR / username. */
const SIGNATURE_LINES_UP = TEXT_LINE * 2;
/** Move Officer Incharge + board line up (fit A4). */
const LIFT_SIGNATURE_BLOCK = TEXT_LINE * 3;
/** Username sits at slip bottom (no extra lift; board block still lifted). */
const LIFT_USERNAME = 0;
const ROW_H = 12;
const HEADER_H = 15;
const TOTAL_ROW_H = 16;
const TABLE_LINE = 0.5;
const QR_SIZE = 40;

/**
 * Draw wrapped text and advance Y by measured height.
 * PDFKit resets doc.y when a second text() is drawn on the same row — do not rely on doc.y alone.
 */
function advanceAfterWrappedText(
  doc: PdfDoc,
  text: string,
  x: number,
  y: number,
  width: number,
  gap = 4,
): number {
  const safe = pdfSafeText(text);
  const h = doc.heightOfString(safe, { width, lineGap: 0 });
  doc.text(safe, x, y, { width, align: "left", lineGap: 0 });
  return y + h + gap;
}

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

  // Total row: label in particulars column, amount right-aligned
  const totalStr = formatReceiptTotalLine(totalAmount);
  const totalTextY = bodyBottom + (TOTAL_ROW_H - 9) / 2;
  doc.font("Helvetica-Bold").fontSize(8);
  doc.text("Total", partX + 3, totalTextY, { width: partW - 6, align: "left", lineBreak: false });
  doc.text(pdfSafeText(totalStr), amtX, totalTextY, { width: amtW - 3, align: "right", lineBreak: false });

  return tableBottom + 4;
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

  doc.text(pdfSafeText(`Receipt No : ${ctx.receiptNo}`), innerX, cy, { width: halfW, align: "left", lineBreak: false });
  doc.text(pdfSafeText(`Date : ${ctx.dateLabel}`), rightX, cy, { width: rightW, align: "right", lineBreak: false });
  cy += 11;

  cy = advanceAfterWrappedText(doc, ctx.receivedFromLine, innerX, cy, innerW, 3);
  const lic = ctx.licenceNo?.trim() ? ctx.licenceNo.trim() : "—";
  doc.text(pdfSafeText(`Licence No:${lic}`), rightX, cy, { width: rightW, align: "right", lineBreak: false });
  cy += 11;

  if (ctx.allotmentReferenceLine?.trim()) {
    cy = advanceAfterWrappedText(doc, ctx.allotmentReferenceLine.trim(), innerX, cy, innerW, 3);
  }

  doc.fontSize(8);
  cy = advanceAfterWrappedText(doc, `A Sum Of ( INR ${ctx.amountWords} Only )`, innerX, cy, innerW, 3);

  doc.fontSize(7.5);
  cy = advanceAfterWrappedText(doc, `By : ${ctx.paymentDetailLine}`, innerX, cy, innerW, 3);

  doc.fontSize(8.5);
  doc.text(pdfSafeText("Towards as below :"), innerX, cy, { width: innerW, align: "left", lineBreak: false });
  cy += 10;

  doc.fontSize(8);
  cy = advanceAfterWrappedText(doc, `Remarks : ${ctx.remarks}`, innerX, cy, innerW, 4);

  if (ctx.isGracePeriod) {
    doc.fontSize(7).fillColor("#92400e");
    cy = advanceAfterWrappedText(
      doc,
      "Grace period transaction — licence renewal required per policy.",
      innerX,
      cy,
      innerW,
      4,
    );
    doc.fillColor("#000");
  }

  cy = drawParticularsTable(doc, ctx.rows, ctx.totalAmount, innerX, cy, innerW);

  const slipBottom = y + height - PAD;
  const usernameY = slipBottom - USERNAME_LINE_H - LIFT_USERNAME;
  const sigBlockHeight =
    OFFICER_LINE_H + SIGNATURE_STAMP_GAP + BOARD_LINE_H + GAP_USERNAME_TO_BOARD + USERNAME_LINE_H;

  const maxOfficerY = slipBottom - sigBlockHeight;
  const defaultOfficerY = slipBottom - sigBlockHeight - LIFT_SIGNATURE_BLOCK;
  const baseOfficerY = Math.min(maxOfficerY, Math.max(cy + 6, defaultOfficerY));
  const officerLineY = baseOfficerY + FOOTER_NOTE_QR_OFFICER_DROP - SIGNATURE_LINES_UP;

  // Please note + QR + Verify — nudged down; signature block position unchanged.
  const noteQrBlockH = QR_SIZE + 52;
  const maxFooterY = officerLineY - noteQrBlockH - 2;
  let footerY = cy + 4 + FOOTER_NOTE_QR_OFFICER_DROP + FOOTER_NOTE_QR_EXTRA_DROP;
  footerY = Math.min(footerY, maxFooterY);
  footerY = Math.max(footerY, cy + 6);

  doc.font("Helvetica").fontSize(7);
  const note =
    ctx.revenueHead === "MarketFee"
      ? "Please note: 1. This receipt is proof of Market Fee payment. 2.Cheques subject to realisation."
      : "Please note: 2.Cheques subject to realisation.";
  footerY = advanceAfterWrappedText(doc, note, innerX, footerY, innerW * 0.58, 3);

  if (opts.qrPng && opts.verifyUrl) {
    try {
      doc.image(opts.qrPng, innerX, footerY, { width: QR_SIZE, height: QR_SIZE });
      doc.fontSize(5.5).fillColor("#666");
      doc.text(pdfSafeText("Verify"), innerX, footerY + QR_SIZE + 2, { width: QR_SIZE, align: "center" });
      doc.fillColor("#000");
    } catch {
      /* skip QR */
    }
  }

  const sigX = innerX + innerW * 0.42;
  const sigW = innerW * 0.58;
  const boardLineY =
    baseOfficerY + OFFICER_LINE_H + SIGNATURE_STAMP_GAP + BOARD_LINE_DROP - SIGNATURE_LINES_UP;

  doc.font("Helvetica").fontSize(7);
  doc.text(pdfSafeText("Officer Incharge"), sigX, officerLineY, { width: sigW, align: "right", lineBreak: false });

  doc.font("Helvetica-Bold").fontSize(7);
  doc.text(
    pdfSafeText("For THE GOA AGRICULTURAL PRODUCE & LIVESTOCK MARKETING BOARD"),
    sigX,
    boardLineY,
    { width: sigW, align: "right", lineBreak: false },
  );

  doc.font("Helvetica").fontSize(7.5);
  doc.text(
    pdfSafeText(`Username : ${ctx.generatedByUsername}`),
    sigX,
    usernameY,
    { width: sigW, align: "right", lineBreak: false },
  );

  if (opts.signatoryName?.trim()) {
    doc.fontSize(6.5).fillColor("#444");
    doc.text(pdfSafeText(opts.signatoryName.trim()), sigX, usernameY - 11, { width: sigW, align: "right", lineBreak: false });
    doc.fillColor("#000");
  }

  return y + height;
}
