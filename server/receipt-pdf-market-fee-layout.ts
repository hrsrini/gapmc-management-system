/**
 * Market Fee receipt A5 slip drawing (commodity grid, Fine, Round Off, vehicle).
 */
import type PDFDocument from "pdfkit";
import {
  chunkMarketFeeCommodityPages,
  formatMarketFeeRoundOffAmountCell,
  formatMarketFeeRoundOffLabel,
  type MarketFeeCommodityPdfRow,
  type MarketFeeReceiptPdfDetail,
} from "@shared/market-fee-receipt-pdf";
import { pdfSafeText } from "./pdf-safe-text";
import type { ReceiptPdfLayoutContext } from "./receipt-pdf-context";
import { formatReceiptAmountCell, formatReceiptTotalLine } from "./receipt-pdf-shared";
import { drawReceiptAmountText } from "./receipt-pdf-rupee-font";

type PdfDoc = InstanceType<typeof PDFDocument>;

const PAD = 8;
const LOGO_SIZE = 56;
const COPY_BADGE_SIZE = 9;
const QR_SIZE = 40;
const TABLE_LINE = 0.5;
const GRID_HEADER_H = 11;
const GRID_ROW_H = 10;
const OUTER_HEADER_H = 14;
const SUMMARY_ROW_H = 13;
const TEXT_LINE = 12;
const SIGNATURE_STAMP_GAP = 52;
const USERNAME_LINE_H = 10;
const BOARD_LINE_H = 12;
const OFFICER_LINE_H = 10;
const GAP_USERNAME_TO_BOARD = 8;
const FOOTER_NOTE_QR_OFFICER_DROP = TEXT_LINE * 3;
const BOARD_LINE_DROP = TEXT_LINE * 2;
const SIGNATURE_LINES_UP = TEXT_LINE * 2;
const LIFT_SIGNATURE_BLOCK = TEXT_LINE * 3;

function fmtQty(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n - Math.round(n)) < 1e-9) {
    return Math.round(n).toLocaleString("en-IN");
  }
  return n.toLocaleString("en-IN", { maximumFractionDigits: 3 });
}

function fmtMoney(n: number): string {
  return Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

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

function drawCopyBadge(doc: PdfDoc, badge: string, x: number, y: number, width: number): void {
  doc.font("Helvetica-Bold").fontSize(COPY_BADGE_SIZE).fillColor("#166534");
  doc.text(pdfSafeText(badge), x, y, { width, align: "right", lineBreak: false });
  doc.fillColor("#000");
}

function drawLogoWatermark(
  doc: PdfDoc,
  logoPng: Buffer,
  box: { x: number; y: number; width: number; height: number },
): void {
  try {
    const size = Math.min(box.width * 0.42, box.height * 0.38);
    const wx = box.x + (box.width - size) / 2;
    const wy = box.y + box.height * 0.36;
    doc.save().opacity(0.1).image(logoPng, wx, wy, { fit: [size, size] }).opacity(1).restore();
  } catch {
    /* skip */
  }
}

function drawFromAndVehicle(
  doc: PdfDoc,
  payerDisplayName: string,
  partyIdLine: string | null | undefined,
  vehicleNo: string | null | undefined,
  x: number,
  y: number,
  width: number,
): number {
  const prefix = "Received with thanks From : ";
  doc.font("Helvetica").fontSize(8.5);
  const prefixW = doc.widthOfString(prefix);
  const name = pdfSafeText(payerDisplayName);
  const vehicle = vehicleNo?.trim() ? `Vehicle No : ${vehicleNo.trim()}` : "";
  let rightW = 0;
  if (vehicle) {
    doc.font("Helvetica").fontSize(8);
    rightW = Math.min(width * 0.42, doc.widthOfString(pdfSafeText(vehicle)) + 4);
  }
  const nameW = Math.max(width - prefixW - rightW - (rightW ? 6 : 0), 40);
  doc.font("Helvetica").fontSize(8.5);
  doc.text(prefix, x, y, { lineBreak: false });
  doc.font("Helvetica-Bold").fontSize(8.5);
  const nameH = doc.heightOfString(name, { width: nameW, lineGap: 0 });
  doc.text(name, x + prefixW, y, { width: nameW, lineGap: 0 });
  if (vehicle) {
    doc.font("Helvetica").fontSize(8);
    doc.text(pdfSafeText(vehicle), x + width - rightW, y, { width: rightW, align: "right", lineBreak: false });
  }
  let cy = y + Math.max(nameH, 12) + 2;
  if (partyIdLine?.trim() && !vehicle) {
    // Party id already handled in non-MF path; when no vehicle keep id on same line via right slot above.
  } else if (partyIdLine?.trim() && vehicle) {
    doc.font("Helvetica").fontSize(7.5);
    cy = advanceAfterWrappedText(doc, partyIdLine.trim(), x, cy, width, 2);
  }
  return cy + 1;
}

function drawOrgHeader(
  doc: PdfDoc,
  ctx: ReceiptPdfLayoutContext,
  innerX: number,
  cy: number,
  innerW: number,
  logoPng: Buffer | null | undefined,
  bodyOnly: boolean,
): number {
  if (logoPng && !bodyOnly) {
    try {
      doc.image(logoPng, innerX, cy, { width: LOGO_SIZE, height: LOGO_SIZE, fit: [LOGO_SIZE, LOGO_SIZE] });
    } catch {
      /* skip */
    }
  }
  if (!bodyOnly) {
    doc.font("Helvetica-Bold").fontSize(10);
    doc.text(pdfSafeText(ctx.branding.boardName), innerX, cy, { width: innerW, align: "center" });
    cy += 14;
    doc.font("Helvetica").fontSize(7.5);
    doc.text(pdfSafeText(ctx.branding.hoAddressLine), innerX, cy, { width: innerW, align: "center" });
    cy += 11;
    doc.text(pdfSafeText(`GSTIN/UIN :${ctx.branding.gstin}`), innerX, cy, { width: innerW, align: "center" });
    cy += 12;
    doc.font("Helvetica-Bold").fontSize(10);
    doc.text(pdfSafeText(ctx.receiptTitle), innerX, cy, { width: innerW, align: "center" });
    cy += 14;
  } else {
    doc.font("Helvetica-Bold").fontSize(10);
    doc.text(pdfSafeText(ctx.receiptTitle), innerX, cy, { width: innerW, align: "center" });
    cy += 14;
  }
  return cy;
}

function drawCommodityGrid(
  doc: PdfDoc,
  rows: MarketFeeCommodityPdfRow[],
  x: number,
  y: number,
  width: number,
  opts: { showGridTotal: boolean; totalValue: number; totalFee: number },
): number {
  // Columns: Name | Unit | Qty | Rate | Value | Fee
  const unitW = Math.round(width * 0.12);
  const qtyW = Math.round(width * 0.1);
  const rateW = Math.round(width * 0.12);
  const valueW = Math.round(width * 0.16);
  const feeW = Math.round(width * 0.14);
  const nameW = width - unitW - qtyW - rateW - valueW - feeW;
  const cols = [
    { x, w: nameW, align: "left" as const, pad: 2 },
    { x: x + nameW, w: unitW, align: "left" as const, pad: 1 },
    { x: x + nameW + unitW, w: qtyW, align: "right" as const, pad: 1 },
    { x: x + nameW + unitW + qtyW, w: rateW, align: "right" as const, pad: 1 },
    { x: x + nameW + unitW + qtyW + rateW, w: valueW, align: "right" as const, pad: 1 },
    { x: x + nameW + unitW + qtyW + rateW + valueW, w: feeW, align: "right" as const, pad: 1 },
  ];

  const bodyH = Math.max(rows.length, 1) * GRID_ROW_H;
  const totalH = opts.showGridTotal ? GRID_ROW_H : 0;
  const tableH = GRID_HEADER_H + bodyH + totalH;
  const bottom = y + tableH;

  doc.save();
  doc.lineWidth(0.4).strokeColor("#666");
  doc.rect(x, y, width, tableH).stroke();
  for (let i = 1; i < cols.length; i++) {
    doc.moveTo(cols[i]!.x, y).lineTo(cols[i]!.x, bottom).stroke();
  }
  doc.moveTo(x, y + GRID_HEADER_H).lineTo(x + width, y + GRID_HEADER_H).stroke();
  if (opts.showGridTotal) {
    doc.moveTo(x, bottom - GRID_ROW_H).lineTo(x + width, bottom - GRID_ROW_H).stroke();
  }
  doc.restore();

  const headers = ["Commodity Name", "Unit", "Qty", "Rate/Unit", "Value (Rs.)", "Mkt Fee"];
  doc.font("Helvetica-Bold").fontSize(5.5);
  const hy = y + 2.5;
  headers.forEach((h, i) => {
    const c = cols[i]!;
    doc.text(h, c.x + c.pad, hy, { width: c.w - c.pad * 2, align: c.align, lineBreak: false });
  });

  doc.font("Helvetica").fontSize(6);
  let ry = y + GRID_HEADER_H + 1.5;
  const data = rows.length > 0 ? rows : [{ name: "—", unit: "—", quantity: 0, ratePerUnit: 0, commodityValue: 0, marketFee: 0 }];
  for (const r of data) {
    const cells = [
      pdfSafeText(r.name),
      pdfSafeText(r.unit),
      fmtQty(r.quantity),
      fmtMoney(r.ratePerUnit),
      fmtMoney(r.commodityValue),
      fmtMoney(r.marketFee),
    ];
    cells.forEach((t, i) => {
      const c = cols[i]!;
      doc.text(t, c.x + c.pad, ry, { width: c.w - c.pad * 2, align: c.align, lineBreak: false });
    });
    ry += GRID_ROW_H;
  }

  if (opts.showGridTotal) {
    doc.font("Helvetica-Bold").fontSize(6);
    doc.text("Total", cols[0]!.x + 2, ry, { width: cols[0]!.w + cols[1]!.w + cols[2]!.w + cols[3]!.w - 4, align: "left", lineBreak: false });
    doc.text(fmtMoney(opts.totalValue), cols[4]!.x + 1, ry, { width: cols[4]!.w - 2, align: "right", lineBreak: false });
    doc.text(fmtMoney(opts.totalFee), cols[5]!.x + 1, ry, { width: cols[5]!.w - 2, align: "right", lineBreak: false });
  }

  return bottom + 2;
}

function drawMarketFeeTable(
  doc: PdfDoc,
  detail: MarketFeeReceiptPdfDetail,
  pageRows: MarketFeeCommodityPdfRow[],
  x: number,
  y: number,
  width: number,
  opts: {
    continued: boolean;
    isLast: boolean;
  },
): number {
  const snW = Math.min(28, Math.round(width * 0.08));
  const amtW = Math.round(width * 0.22);
  const partW = width - snW - amtW;
  const partX = x + snW;
  const amtX = x + snW + partW;

  const showFine = opts.isLast && detail.fineAmount > 0.005;
  const showRound =
    opts.isLast && detail.rounding.roundingType !== "NoRounding" && Math.abs(detail.rounding.roundingAmount) >= 0.005;
  const showPayable = opts.isLast;

  const gridH =
    GRID_HEADER_H +
    Math.max(pageRows.length, 1) * GRID_ROW_H +
    (opts.isLast ? GRID_ROW_H : 0) +
    2;
  const mfLabelH = 12;
  const mfBlockH = mfLabelH + gridH;
  let bodyH = mfBlockH;
  if (showFine) bodyH += SUMMARY_ROW_H;
  if (showRound) bodyH += SUMMARY_ROW_H;
  if (showPayable) bodyH += SUMMARY_ROW_H + 2;

  const tableH = OUTER_HEADER_H + bodyH;
  const tableBottom = y + tableH;

  doc.save();
  doc.lineWidth(TABLE_LINE).strokeColor("#000");
  doc.rect(x, y, width, tableH).stroke();
  doc.moveTo(partX, y).lineTo(partX, tableBottom).stroke();
  doc.moveTo(amtX, y).lineTo(amtX, tableBottom).stroke();
  doc.moveTo(x, y + OUTER_HEADER_H).lineTo(x + width, y + OUTER_HEADER_H).stroke();
  doc.restore();

  doc.font("Helvetica-Bold").fontSize(8);
  const htY = y + (OUTER_HEADER_H - 8) / 2;
  doc.text("S.N", x, htY, { width: snW, align: "center", lineBreak: false });
  doc.text("Particulars", partX + 3, htY, { width: partW - 6, align: "left", lineBreak: false });
  doc.text("Amount", amtX, htY, { width: amtW - 3, align: "right", lineBreak: false });

  let cy = y + OUTER_HEADER_H + 2;
  const mfTitle = opts.continued ? "Market Fee (continued)" : "Market Fee";
  doc.font("Helvetica-Bold").fontSize(8);
  doc.text("1", x, cy, { width: snW, align: "center", lineBreak: false });
  doc.text(mfTitle, partX + 3, cy, { width: partW - 6, align: "left", lineBreak: false });
  if (opts.isLast) {
    drawReceiptAmountText(doc, formatReceiptAmountCell(detail.totalMarketFee), amtX, cy, {
      width: amtW - 3,
      align: "right",
    });
  }
  cy += mfLabelH;

  cy = drawCommodityGrid(doc, pageRows, partX + 2, cy, partW - 4, {
    showGridTotal: opts.isLast,
    totalValue: detail.totalCommodityValue,
    totalFee: detail.totalMarketFee,
  });

  if (showFine) {
    doc.save();
    doc.lineWidth(TABLE_LINE).strokeColor("#000");
    doc.moveTo(x, cy).lineTo(x + width, cy).stroke();
    doc.restore();
    const ty = cy + 2;
    doc.font("Helvetica").fontSize(8);
    doc.text("2", x, ty, { width: snW, align: "center", lineBreak: false });
    doc.text("Fine", partX + 3, ty, { width: partW - 6, align: "left", lineBreak: false });
    drawReceiptAmountText(doc, formatReceiptAmountCell(detail.fineAmount), amtX, ty, {
      width: amtW - 3,
      align: "right",
    });
    cy += SUMMARY_ROW_H;
  }

  if (showRound) {
    doc.save();
    doc.lineWidth(TABLE_LINE).strokeColor("#000");
    doc.moveTo(x, cy).lineTo(x + width, cy).stroke();
    doc.restore();
    const ty = cy + 2;
    doc.font("Helvetica").fontSize(8);
    doc.text(formatMarketFeeRoundOffLabel(detail.rounding.roundingAmount).startsWith("(") ? "" : "", x, ty, {
      width: snW,
      align: "center",
      lineBreak: false,
    });
    doc.text("Round Off (+/-)", partX + 3, ty, { width: partW - 6, align: "left", lineBreak: false });
    drawReceiptAmountText(doc, formatMarketFeeRoundOffAmountCell(detail.rounding.roundingAmount), amtX, ty, {
      width: amtW - 3,
      align: "right",
    });
    cy += SUMMARY_ROW_H;
  }

  if (showPayable) {
    doc.save();
    doc.lineWidth(TABLE_LINE).strokeColor("#000");
    doc.moveTo(x, cy).lineTo(x + width, cy).stroke();
    doc.restore();
    const ty = cy + 3;
    doc.font("Helvetica-Bold").fontSize(8);
    doc.text("Total Amount Payable", partX + 3, ty, { width: partW - 6, align: "left", lineBreak: false });
    drawReceiptAmountText(doc, formatReceiptTotalLine(detail.rounding.finalAmount), amtX, ty, {
      width: amtW - 3,
      align: "right",
      bold: true,
    });
  }

  return tableBottom + 4;
}

export type DrawMarketFeeSlipOpts = {
  bodyOnly: boolean;
  signatoryName?: string | null;
  logoPng?: Buffer | null;
  qrPng?: Buffer | null;
  verifyUrl?: string | null;
  copyBadge?: string | null;
  continued: boolean;
  pageIndex: number;
  pageCount: number;
  isLast: boolean;
  pageCommodityRows: MarketFeeCommodityPdfRow[];
};

export function drawMarketFeeGaplmbReceiptSlip(
  doc: PdfDoc,
  ctx: ReceiptPdfLayoutContext,
  detail: MarketFeeReceiptPdfDetail,
  box: { x: number; y: number; width: number; height: number },
  opts: DrawMarketFeeSlipOpts,
): number {
  const { x, y, width, height } = box;
  doc.rect(x, y, width, height).lineWidth(0.75).stroke();
  doc.save();
  doc.rect(x, y, width, height).clip();

  if (opts.logoPng && !opts.bodyOnly) {
    drawLogoWatermark(doc, opts.logoPng, box);
  }

  const innerX = x + PAD;
  const innerW = width - PAD * 2;
  let cy = y + PAD;

  if (opts.copyBadge?.trim()) {
    drawCopyBadge(doc, opts.copyBadge.trim(), innerX, cy, innerW);
  }

  // Spec: continuation pages also repeat organisation header
  cy = drawOrgHeader(doc, ctx, innerX, cy, innerW, opts.logoPng, opts.bodyOnly);

  if (opts.continued) {
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#b45309");
    doc.text("CONTINUED", innerX, cy, { width: innerW, align: "center", lineBreak: false });
    doc.fillColor("#000");
    cy += 12;
    doc.font("Helvetica").fontSize(8);
    doc.text(pdfSafeText(`Page ${opts.pageIndex} of ${opts.pageCount}`), innerX, cy, {
      width: innerW,
      align: "center",
      lineBreak: false,
    });
    cy += 11;
  }

  const halfW = innerW * 0.52;
  const rightX = innerX + innerW * 0.48;
  const rightW = innerW * 0.52;
  doc.font("Helvetica").fontSize(8.5);
  doc.text(pdfSafeText(`Receipt No : ${ctx.receiptNo}`), innerX, cy, {
    width: halfW,
    align: "left",
    lineBreak: false,
  });
  doc.text(pdfSafeText(`Date : ${ctx.dateLabel}`), rightX, cy, {
    width: rightW,
    align: "right",
    lineBreak: false,
  });
  cy += 11;

  cy = drawFromAndVehicle(doc, ctx.payerDisplayName, ctx.partyIdLine, detail.vehicleNo, innerX, cy, innerW);

  if (ctx.newPartyAddressLine?.trim()) {
    cy = advanceAfterWrappedText(doc, ctx.newPartyAddressLine.trim(), innerX, cy, innerW, 2);
  }
  if (ctx.newPartyContactLine?.trim()) {
    cy = advanceAfterWrappedText(doc, ctx.newPartyContactLine.trim(), innerX, cy, innerW, 2);
  }

  // Amount in words / By / Towards — page 1 only
  if (!opts.continued) {
    doc.fontSize(8);
    cy = advanceAfterWrappedText(doc, `A Sum Of ( INR ${ctx.amountWords} Only )`, innerX, cy, innerW, 3);
    doc.fontSize(7.5);
    cy = advanceAfterWrappedText(doc, `By : ${ctx.paymentDetailLine}`, innerX, cy, innerW, 3);
    doc.fontSize(8.5);
    doc.text(pdfSafeText("Towards as below :"), innerX, cy, { width: innerW, align: "left", lineBreak: false });
    cy += 10;
    const remarksFace =
      String(ctx.remarks ?? "").trim().length > 120
        ? `${String(ctx.remarks).trim().slice(0, 117)}...`
        : String(ctx.remarks ?? "");
    doc.fontSize(8);
    cy = advanceAfterWrappedText(doc, remarksFace, innerX, cy, innerW, 4);
  }

  cy = drawMarketFeeTable(doc, detail, opts.pageCommodityRows, innerX, cy, innerW, {
    continued: opts.continued,
    isLast: opts.isLast,
  });

  const slipBottom = y + height - PAD;

  if (opts.isLast) {
    const usernameY = slipBottom - USERNAME_LINE_H;
    const sigBlockHeight =
      OFFICER_LINE_H + SIGNATURE_STAMP_GAP + BOARD_LINE_H + GAP_USERNAME_TO_BOARD + USERNAME_LINE_H;
    const maxOfficerY = slipBottom - sigBlockHeight;
    const defaultOfficerY = slipBottom - sigBlockHeight - LIFT_SIGNATURE_BLOCK;
    const baseOfficerY = Math.min(maxOfficerY, Math.max(cy + 6, defaultOfficerY));
    const officerLineY = baseOfficerY + FOOTER_NOTE_QR_OFFICER_DROP - SIGNATURE_LINES_UP;

    const noteQrBlockH = QR_SIZE + 36;
    const maxFooterY = officerLineY - noteQrBlockH - 2;
    let footerY = Math.max(cy + 4, Math.min(cy + 4, maxFooterY));

    // Note: line 2 always on new line
    doc.font("Helvetica").fontSize(7);
    doc.text(pdfSafeText("Note: 1. This receipt is proof of Market Fee payment."), innerX, footerY, {
      width: innerW * 0.58,
      align: "left",
    });
    footerY += 9;
    doc.text(pdfSafeText("2. Payment by cheque is subject to successful realisation of the cheque."), innerX, footerY, {
      width: innerW * 0.58,
      align: "left",
    });
    footerY += 12;

    if (opts.qrPng && opts.verifyUrl) {
      try {
        const qrY = Math.min(footerY, slipBottom - QR_SIZE - 14);
        doc.image(opts.qrPng, innerX, qrY, { width: QR_SIZE, height: QR_SIZE });
        doc.fontSize(5.5).fillColor("#666");
        doc.text(pdfSafeText("Verify"), innerX, qrY + QR_SIZE + 2, { width: QR_SIZE, align: "center" });
        doc.fillColor("#000");
      } catch {
        /* skip */
      }
    }

    const sigX = innerX + innerW * 0.42;
    const sigW = innerW * 0.58;
    const boardLineY =
      baseOfficerY + OFFICER_LINE_H + SIGNATURE_STAMP_GAP + BOARD_LINE_DROP - SIGNATURE_LINES_UP;

    doc.font("Helvetica").fontSize(7);
    doc.text(pdfSafeText("Officer Incharge"), sigX, officerLineY, {
      width: sigW,
      align: "right",
      lineBreak: false,
    });
    doc.font("Helvetica-Bold").fontSize(7);
    doc.text(
      pdfSafeText("For THE GOA AGRICULTURAL PRODUCE & LIVESTOCK MARKETING BOARD"),
      sigX,
      boardLineY,
      { width: sigW, align: "right", lineBreak: false },
    );
    doc.font("Helvetica").fontSize(7.5);
    doc.text(pdfSafeText(`Username : ${ctx.generatedByUsername}`), sigX, usernameY, {
      width: sigW,
      align: "right",
      lineBreak: false,
    });
    if (opts.signatoryName?.trim()) {
      doc.fontSize(6.5).fillColor("#444");
      doc.text(pdfSafeText(opts.signatoryName.trim()), sigX, usernameY - 11, {
        width: sigW,
        align: "right",
        lineBreak: false,
      });
      doc.fillColor("#000");
    }
  } else {
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#b45309");
    doc.text(
      pdfSafeText(`CONTINUED on next page - Page ${opts.pageIndex} of ${opts.pageCount}`),
      innerX,
      Math.min(cy + 6, slipBottom - 14),
      { width: innerW, align: "left", lineBreak: false },
    );
    doc.fillColor("#000");
  }

  doc.restore();
  return y + height;
}

/** Pack Market Fee Original + Office Copy as dual A5 slips. */
export function drawDualA5MarketFeeReceiptCopies(
  doc: PdfDoc,
  ctx: ReceiptPdfLayoutContext,
  detail: MarketFeeReceiptPdfDetail,
  opts: {
    bodyOnly: boolean;
    signatoryName?: string | null;
    logoPng?: Buffer | null;
    qrPng?: Buffer | null;
    verifyUrl?: string | null;
    marginLeft: number;
    contentWidth: number;
    slipHeight: number;
    slipGap: number;
    firstSlipY: number;
    copyBadges: string[];
  },
): void {
  const pageMargins = {
    top: opts.firstSlipY,
    bottom: opts.firstSlipY,
    left: opts.marginLeft,
    right: opts.marginLeft,
  };
  const ranges = chunkMarketFeeCommodityPages(detail.commodities.length);
  const pageCount = ranges.length;

  let slot = 0;
  let needNewPageBeforeNext = false;

  const place = (pageIndex: number, badge: string) => {
    if (needNewPageBeforeNext) {
      doc.addPage({ size: "A4", margins: pageMargins });
      needNewPageBeforeNext = false;
      slot = 0;
    }
    const y = slot === 0 ? opts.firstSlipY : opts.firstSlipY + opts.slipHeight + opts.slipGap;
    const range = ranges[pageIndex - 1]!;
    const pageRows = detail.commodities.slice(range.start, range.end);
    drawMarketFeeGaplmbReceiptSlip(
      doc,
      ctx,
      detail,
      { x: opts.marginLeft, y, width: opts.contentWidth, height: opts.slipHeight },
      {
        bodyOnly: opts.bodyOnly,
        signatoryName: opts.signatoryName,
        logoPng: opts.logoPng,
        qrPng: opts.qrPng,
        verifyUrl: opts.verifyUrl,
        copyBadge: badge,
        continued: pageIndex > 1,
        pageIndex,
        pageCount,
        isLast: pageIndex === pageCount,
        pageCommodityRows: pageRows,
      },
    );
    slot += 1;
    if (slot > 1) {
      slot = 0;
      needNewPageBeforeNext = true;
    }
  };

  for (const badge of opts.copyBadges) {
    for (let i = 1; i <= pageCount; i++) {
      place(i, badge);
    }
  }
}
