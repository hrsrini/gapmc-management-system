import type PDFDocument from "pdfkit";
import { pdfSafeText } from "./pdf-safe-text";
import {
  formatReceiptAmountCell,
  formatReceiptTotalLine,
} from "./receipt-pdf-shared";
import type { ReceiptPdfLayoutContext, ReceiptPdfParticularRow } from "./receipt-pdf-context";
import { drawReceiptAmountText } from "./receipt-pdf-rupee-font";

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
export const PARTICULARS_ROW_H = 12;
export const PARTICULARS_HEADER_H = 15;
export const PARTICULARS_TOTAL_ROW_H = 16;
const ROW_H = PARTICULARS_ROW_H;
const HEADER_H = PARTICULARS_HEADER_H;
const TOTAL_ROW_H = PARTICULARS_TOTAL_ROW_H;
const TABLE_LINE = 0.5;
const QR_SIZE = 40;
/** GAPLMB logo from Admin → Receipt PDF logo (top-left of slip). */
const LOGO_SIZE = 56;
const COPY_BADGE_SIZE = 9;

const CHEQUE_REALISATION_NOTE =
  "Note: Payment by cheque is subject to successful realisation of the cheque.";

function receiptPaymentNote(revenueHead: string): string {
  if (revenueHead === "MarketFee") {
    return `Note: 1. This receipt is proof of Market Fee payment. 2. Payment by cheque is subject to successful realisation of the cheque.`;
  }
  return CHEQUE_REALISATION_NOTE;
}
/** Space reserved at slip/page bottom for please-note, QR, signatures. */
export const RECEIPT_FOOTER_RESERVE = 150;
/** Hard cap: Tally / Particulars lines per A5 receipt slip. */
export const MAX_TALLY_LINES_PER_A5 = 10;

/** Split particulars into A5-sized chunks (≤10 lines each). */
export function chunkParticularsForA5(
  rows: ReceiptPdfParticularRow[],
  maxRows = MAX_TALLY_LINES_PER_A5,
): ReceiptPdfParticularRow[][] {
  const list = rows.length > 0 ? rows : [{ sn: 1, label: "—", amount: 0 }];
  const chunks: ReceiptPdfParticularRow[][] = [];
  for (let i = 0; i < list.length; i += maxRows) {
    chunks.push(list.slice(i, i + maxRows));
  }
  return chunks;
}

export function particularsTableHeight(rowCount: number, includeTotal = true): number {
  const bodyRows = Math.max(rowCount, 1);
  return HEADER_H + bodyRows * ROW_H + (includeTotal ? TOTAL_ROW_H : 0) + 4;
}

/** Approx. height of branding + meta + remarks above the particulars table (full header). */
export function estimateReceiptHeaderBlockHeight(args: {
  bodyOnly: boolean;
  showLicenceNo?: boolean;
  hasNewPartyAddress: boolean;
  hasNewPartyContact: boolean;
  hasAllotmentRef?: boolean;
  remarksLines?: number;
  isGracePeriod?: boolean;
}): number {
  let h = 8; // top pad
  // Board + HO + GSTIN + title (location / place line removed from face).
  if (!args.bodyOnly) h += 14 + 11 + 12 + 16;
  else h += 14;
  h += 11; // receipt no / date
  h += 15; // received from (+ optional Licence/Entity No. on same line)
  if (args.hasNewPartyAddress) h += 14;
  if (args.hasNewPartyContact) h += 14;
  h += 16; // sum of
  h += 14; // by
  h += 10; // towards
  h += Math.max(1, args.remarksLines ?? 2) * 11 + 4;
  if (args.isGracePeriod) h += 16;
  return h;
}

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

function drawReceivedFromLine(
  doc: PdfDoc,
  payerDisplayName: string,
  partyIdLine: string | null | undefined,
  x: number,
  y: number,
  width: number,
): number {
  const prefix = "Received with thanks From : ";
  doc.font("Helvetica").fontSize(8.5);
  const prefixW = doc.widthOfString(prefix);
  const name = pdfSafeText(payerDisplayName);
  const idLabel = partyIdLine?.trim() ? pdfSafeText(partyIdLine.trim()) : "";
  let idW = 0;
  if (idLabel) {
    doc.font("Helvetica").fontSize(8);
    idW = Math.min(width * 0.4, doc.widthOfString(idLabel) + 6);
  }
  const nameW = Math.max(width - prefixW - idW - (idW ? 8 : 0), 40);
  doc.font("Helvetica-Bold").fontSize(8.5);
  const nameH = doc.heightOfString(name, { width: nameW, lineGap: 0 });
  doc.font("Helvetica").fontSize(8.5);
  doc.text(prefix, x, y, { lineBreak: false });
  doc.font("Helvetica-Bold").fontSize(8.5);
  doc.text(name, x + prefixW, y, { width: nameW, lineGap: 0 });
  if (idLabel) {
    doc.font("Helvetica").fontSize(8);
    doc.text(idLabel, x + width - idW, y, { width: idW, align: "right", lineBreak: false });
  }
  return y + Math.max(nameH, 12) + 3;
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
    /* skip watermark */
  }
}

type ParticularsTableDrawOpts = {
  /** When false, omit the Total row (continuation pages before the last). */
  showTotal?: boolean;
  totalAmount?: number;
};

/** Full grid: outer border, column rules, header/body/total separators. */
function drawParticularsTable(
  doc: PdfDoc,
  rows: ReceiptPdfParticularRow[],
  totalAmount: number,
  x: number,
  y: number,
  width: number,
  opts?: ParticularsTableDrawOpts,
): number {
  const showTotal = opts?.showTotal !== false;
  const snW = Math.min(32, Math.round(width * 0.1));
  const amtW = Math.round(width * 0.28);
  const partW = width - snW - amtW;
  const partX = x + snW;
  const amtX = x + snW + partW;

  const bodyRows = Math.max(rows.length, 1);
  const tableH = HEADER_H + bodyRows * ROW_H + (showTotal ? TOTAL_ROW_H : 0);
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

  // Header / body separator
  doc.moveTo(x, headerBottom).lineTo(x + width, headerBottom).stroke();
  if (showTotal) {
    doc.moveTo(x, bodyBottom).lineTo(x + width, bodyBottom).stroke();
  }

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
    drawReceiptAmountText(doc, amtStr, amtX, rowY, { width: amtW - 3, align: "right" });
    rowY += ROW_H;
  }

  if (showTotal) {
    const totalTextY = bodyBottom + (TOTAL_ROW_H - 9) / 2;
    doc.font("Helvetica-Bold").fontSize(8);
    doc.text("Total", partX + 3, totalTextY, { width: partW - 6, align: "left", lineBreak: false });
    drawReceiptAmountText(doc, formatReceiptTotalLine(opts?.totalAmount ?? totalAmount), amtX, totalTextY, {
      width: amtW - 3,
      align: "right",
      bold: true,
    });
  }

  return tableBottom + 4;
}

export type DrawReceiptSlipOptions = {
  bodyOnly: boolean;
  signatoryName?: string | null;
  logoPng?: Buffer | null;
  qrPng?: Buffer | null;
  verifyUrl?: string | null;
  /** Top-right copy mark: ORIGINAL / OFFICE COPY. */
  copyBadge?: string | null;
  /** Override particulars rows (already chunked to ≤10). */
  rowsOverride?: ReceiptPdfParticularRow[] | null;
  /** Continuation slip within the same copy. */
  continued?: boolean;
  /** 1-based page index within this copy. */
  pageIndex?: number;
  /** Total A5 pages for this copy. */
  pageCount?: number;
  /** Draw Total row (only on last page of a copy). */
  showTotal?: boolean;
  /** Draw note / QR / signatures (only on last page of a copy). */
  showSignatures?: boolean;
};

/** Draw one bordered GAPLMB receipt slip; returns bottom Y. Content is clipped to the box. */
export function drawGaplmbReceiptSlip(
  doc: PdfDoc,
  ctx: ReceiptPdfLayoutContext,
  box: { x: number; y: number; width: number; height: number },
  opts: DrawReceiptSlipOptions,
): number {
  const { x, y, width, height } = box;
  const showTotal = opts.showTotal !== false;
  const showSignatures = opts.showSignatures !== false;
  const continued = Boolean(opts.continued);
  const pageIndex = opts.pageIndex ?? 1;
  const pageCount = Math.max(1, opts.pageCount ?? 1);
  const rawRows = opts.rowsOverride ?? ctx.rows;
  const rows = rawRows.slice(0, MAX_TALLY_LINES_PER_A5);

  doc.rect(x, y, width, height).lineWidth(0.75).stroke();

  // Hard clip — never paint into the adjacent A5 slip or off the printable box.
  doc.save();
  doc.rect(x, y, width, height).clip();

  if (opts.logoPng && !opts.bodyOnly && !continued) {
    drawLogoWatermark(doc, opts.logoPng, box);
  }

  const innerX = x + PAD;
  const innerW = width - PAD * 2;
  let cy = y + PAD;

  if (opts.copyBadge?.trim()) {
    drawCopyBadge(doc, opts.copyBadge.trim(), innerX, cy, innerW);
  }

  if (continued) {
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#b45309");
    doc.text("CONTINUED", innerX, cy, { width: innerW, align: "center", lineBreak: false });
    doc.fillColor("#000");
    cy += 14;
    doc.font("Helvetica").fontSize(8);
    doc.text(
      pdfSafeText(
        `Receipt No : ${ctx.receiptNo}    Date : ${ctx.dateLabel}    Page ${pageIndex} of ${pageCount}`,
      ),
      innerX,
      cy,
      { width: innerW, align: "center", lineBreak: false },
    );
    cy += 12;
    doc.font("Helvetica-Bold").fontSize(9);
    doc.text(pdfSafeText(ctx.receiptTitle), innerX, cy, { width: innerW, align: "center", lineBreak: false });
    cy += 12;
    doc.moveTo(innerX, cy).lineTo(innerX + innerW, cy).lineWidth(0.6).strokeColor("#000").stroke();
    cy += 8;
  } else {
    if (opts.logoPng) {
      try {
        doc.image(opts.logoPng, innerX, cy, { width: LOGO_SIZE, height: LOGO_SIZE, fit: [LOGO_SIZE, LOGO_SIZE] });
      } catch {
        /* skip logo */
      }
    }

    if (!opts.bodyOnly) {
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

    cy = drawReceivedFromLine(doc, ctx.payerDisplayName, ctx.partyIdLine, innerX, cy, innerW);

    if (ctx.newPartyAddressLine?.trim()) {
      cy = advanceAfterWrappedText(doc, ctx.newPartyAddressLine.trim(), innerX, cy, innerW, 2);
    }
    if (ctx.newPartyContactLine?.trim()) {
      cy = advanceAfterWrappedText(doc, ctx.newPartyContactLine.trim(), innerX, cy, innerW, 2);
    }

    doc.fontSize(8);
    cy = advanceAfterWrappedText(doc, `A Sum Of ( INR ${ctx.amountWords} Only )`, innerX, cy, innerW, 3);

    doc.fontSize(7.5);
    cy = advanceAfterWrappedText(doc, `By : ${ctx.paymentDetailLine}`, innerX, cy, innerW, 3);

    doc.fontSize(8.5);
    doc.text(pdfSafeText("Towards as below :"), innerX, cy, { width: innerW, align: "left", lineBreak: false });
    cy += 10;

    // Keep remarks to one short face line so the 10-row table stays inside the A5 box.
    const remarksFace =
      String(ctx.remarks ?? "").trim().length > 120
        ? `${String(ctx.remarks).trim().slice(0, 117)}...`
        : String(ctx.remarks ?? "");
    doc.fontSize(8);
    cy = advanceAfterWrappedText(doc, remarksFace, innerX, cy, innerW, 4);

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
  }

  // Always print the full chunk (≤10). Never silently drop Tally lines — the slip
  // clip keeps paint inside this A5 box; packing already capped at MAX_TALLY_LINES_PER_A5.
  const slipBottom = y + height - PAD;
  cy = drawParticularsTable(doc, rows, ctx.totalAmount, innerX, cy, innerW, {
    showTotal,
    totalAmount: ctx.totalAmount,
  });

  if (showSignatures) {
    const usernameY = slipBottom - USERNAME_LINE_H - LIFT_USERNAME;
    const sigBlockHeight =
      OFFICER_LINE_H + SIGNATURE_STAMP_GAP + BOARD_LINE_H + GAP_USERNAME_TO_BOARD + USERNAME_LINE_H;

    const maxOfficerY = slipBottom - sigBlockHeight;
    const defaultOfficerY = slipBottom - sigBlockHeight - LIFT_SIGNATURE_BLOCK;
    const baseOfficerY = Math.min(maxOfficerY, Math.max(cy + 6, defaultOfficerY));
    const officerLineY = baseOfficerY + FOOTER_NOTE_QR_OFFICER_DROP - SIGNATURE_LINES_UP;

    const noteQrBlockH = QR_SIZE + 36;
    const maxFooterY = officerLineY - noteQrBlockH - 2;
    let footerY = cy + 4;
    footerY = Math.min(footerY, maxFooterY);
    footerY = Math.max(footerY, cy + 4);

    doc.font("Helvetica").fontSize(7);
    footerY = advanceAfterWrappedText(doc, receiptPaymentNote(ctx.revenueHead), innerX, footerY, innerW * 0.58, 3);

    if (opts.qrPng && opts.verifyUrl) {
      try {
        const qrY = Math.min(footerY, slipBottom - QR_SIZE - 14);
        doc.image(opts.qrPng, innerX, qrY, { width: QR_SIZE, height: QR_SIZE });
        doc.fontSize(5.5).fillColor("#666");
        doc.text(pdfSafeText("Verify"), innerX, qrY + QR_SIZE + 2, { width: QR_SIZE, align: "center" });
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
      pdfSafeText(`CONTINUED on next page — Page ${pageIndex} of ${pageCount}`),
      innerX,
      Math.min(cy + 6, slipBottom - 14),
      { width: innerW, align: "left", lineBreak: false },
    );
    doc.fillColor("#000");
  }

  doc.restore();
  return y + height;
}

export type DrawPaginatedReceiptOpts = DrawReceiptSlipOptions & {
  marginLeft: number;
  marginRight: number;
  marginTop: number;
  marginBottom: number;
  /** e.g. "ORIGINAL" / "OFFICE COPY" — shown in footer strip and optional badge. */
  copyLabel?: string | null;
  /** 1-based copy index for page labels. */
  copyIndex?: number;
  copyCount?: number;
};

export type DualA5PackOptions = DrawReceiptSlipOptions & {
  marginLeft: number;
  contentWidth: number;
  slipHeight: number;
  slipGap: number;
  firstSlipY: number;
  /** Copy badges in print order (e.g. ORIGINAL then OFFICE COPY). */
  copyBadges: string[];
};

/**
 * Pack receipt copies as A5 slips on A4 (2-up).
 * Each slip holds at most {@link MAX_TALLY_LINES_PER_A5} Particulars rows.
 * Overflow continues onto the next A5 slot / A4 page. Total + signatures only on
 * the last slip of each copy.
 */
export function drawDualA5ReceiptCopies(
  doc: PdfDoc,
  ctx: ReceiptPdfLayoutContext,
  opts: DualA5PackOptions,
): void {
  const {
    marginLeft,
    contentWidth,
    slipHeight,
    slipGap,
    firstSlipY,
    copyBadges,
  } = opts;
  const pageMargins = {
    top: firstSlipY,
    bottom: firstSlipY,
    left: marginLeft,
    right: marginLeft,
  };

  let slot = 0; // 0 = top A5, 1 = bottom A5
  let needNewPageBeforeNext = false;

  const placeSlip = (
    rows: ReceiptPdfParticularRow[],
    slipOpts: {
      copyBadge: string;
      continued: boolean;
      pageIndex: number;
      pageCount: number;
      showTotal: boolean;
      showSignatures: boolean;
    },
  ) => {
    if (needNewPageBeforeNext) {
      doc.addPage({ size: "A4", margins: pageMargins });
      needNewPageBeforeNext = false;
      slot = 0;
    }
    const y = slot === 0 ? firstSlipY : firstSlipY + slipHeight + slipGap;
    drawGaplmbReceiptSlip(
      doc,
      ctx,
      { x: marginLeft, y, width: contentWidth, height: slipHeight },
      {
        bodyOnly: opts.bodyOnly,
        signatoryName: opts.signatoryName,
        logoPng: opts.logoPng,
        qrPng: opts.qrPng,
        verifyUrl: opts.verifyUrl,
        copyBadge: slipOpts.copyBadge,
        rowsOverride: rows,
        continued: slipOpts.continued,
        pageIndex: slipOpts.pageIndex,
        pageCount: slipOpts.pageCount,
        showTotal: slipOpts.showTotal,
        showSignatures: slipOpts.showSignatures,
      },
    );
    slot += 1;
    if (slot > 1) {
      slot = 0;
      needNewPageBeforeNext = true;
    }
  };

  for (const badge of copyBadges) {
    const chunks = chunkParticularsForA5(ctx.rows, MAX_TALLY_LINES_PER_A5);
    const pageCount = chunks.length;
    chunks.forEach((chunk, i) => {
      const isLast = i === pageCount - 1;
      placeSlip(chunk, {
        copyBadge: badge,
        continued: i > 0,
        pageIndex: i + 1,
        pageCount,
        showTotal: isLast,
        showSignatures: isLast,
      });
    });
  }
}

/**
 * Draw one receipt copy across as many A4 pages as needed.
 * First page: full header + particulars chunk.
 * Continuation pages: CONTINUED banner + receipt identity + remaining rows.
 * Total + signatures only on the last page of the copy.
 */
export function drawGaplmbReceiptPaginatedCopy(
  doc: PdfDoc,
  ctx: ReceiptPdfLayoutContext,
  opts: DrawPaginatedReceiptOpts,
): void {
  const left = opts.marginLeft;
  const right = doc.page.width - opts.marginRight;
  const width = right - left;
  const top = opts.marginTop;
  const bottomMargin = opts.marginBottom;
  const copyIndex = opts.copyIndex ?? 1;
  const copyCount = opts.copyCount ?? 1;
  const allRows = ctx.rows.length > 0 ? ctx.rows : [{ sn: 1, label: "—", amount: 0 }];

  const pageContentBottom = () => doc.page.height - bottomMargin;
  const pageMargins = {
    top: opts.marginTop,
    bottom: opts.marginBottom,
    left: opts.marginLeft,
    right: opts.marginRight,
  };

  const drawContinuedChrome = (pageNo: number, totalPages: number) => {
    let cy = top;
    doc.font("Helvetica-Bold").fontSize(14).fillColor("#000");
    doc.text("CONTINUED", left, cy, { width, align: "center", lineBreak: false });
    cy += 18;
    doc.font("Helvetica").fontSize(8);
    doc.text(
      pdfSafeText(
        `Receipt No : ${ctx.receiptNo}    Date : ${ctx.dateLabel}    Page ${pageNo} of ${totalPages}` +
          (copyCount > 1 ? `    (${opts.copyLabel ?? `Copy ${copyIndex}`})` : ""),
      ),
      left,
      cy,
      { width, align: "center", lineBreak: false },
    );
    cy += 14;
    doc.font("Helvetica-Bold").fontSize(9);
    doc.text(pdfSafeText(ctx.receiptTitle), left, cy, { width, align: "center", lineBreak: false });
    cy += 14;
    doc
      .moveTo(left, cy)
      .lineTo(right, cy)
      .lineWidth(0.6)
      .strokeColor("#000")
      .stroke();
    cy += 10;
    return cy;
  };

  // First pass: compute how rows chunk across pages (same geometry as draw).
  const chunks: ReceiptPdfParticularRow[][] = [];
  {
    let remaining = [...allRows];
    let isFirst = true;
    while (remaining.length > 0) {
      const headerH = isFirst
        ? estimateReceiptHeaderBlockHeight({
            bodyOnly: Boolean(opts.bodyOnly),
            hasNewPartyAddress: Boolean(ctx.newPartyAddressLine?.trim()),
            hasNewPartyContact: Boolean(ctx.newPartyContactLine?.trim()),
            remarksLines: Math.max(1, Math.ceil(String(ctx.remarks ?? "").length / 90)),
            isGracePeriod: ctx.isGracePeriod,
          })
        : 18 + 14 + 14 + 10; // CONTINUED chrome
      const pageH = 841.89; // A4; actual page set by PDFKit
      const bottomForRows = pageH - bottomMargin - RECEIPT_FOOTER_RESERVE;
      // Prefer leaving room for total+footer on last chunk; for non-last use tighter reserve.
      const avail = Math.max(ROW_H, bottomForRows - top - headerH - HEADER_H - 8);
      let maxRows = Math.max(1, Math.floor(avail / ROW_H));
      // If everything fits with total, keep on one chunk.
      if (
        remaining.length <= maxRows &&
        headerH + particularsTableHeight(remaining.length, true) + RECEIPT_FOOTER_RESERVE <=
          pageH - bottomMargin - top
      ) {
        chunks.push(remaining);
        remaining = [];
      } else {
        // Leave at least one row for a following page if we cannot finish with footer.
        if (remaining.length > maxRows) {
          chunks.push(remaining.slice(0, maxRows));
          remaining = remaining.slice(maxRows);
        } else {
          // Fits rows but not footer — push all but keep going only if needed.
          const withoutFooterAvail = Math.max(
            1,
            Math.floor((pageH - bottomMargin - top - headerH - HEADER_H - 28) / ROW_H),
          );
          if (remaining.length <= withoutFooterAvail) {
            chunks.push(remaining);
            remaining = [];
          } else {
            const n = Math.min(remaining.length - 1, withoutFooterAvail);
            chunks.push(remaining.slice(0, Math.max(1, n)));
            remaining = remaining.slice(Math.max(1, n));
          }
        }
      }
      isFirst = false;
    }
  }

  const totalPages = Math.max(1, chunks.length);

  const drawPageFooterStrip = (pageNo: number, totalPages: number) => {
    doc.font("Helvetica").fontSize(7).fillColor("#666");
    doc.text(
      pdfSafeText(
        `Page ${pageNo} of ${totalPages}` +
          (copyCount > 1 ? `  |  ${opts.copyLabel ?? `Copy ${copyIndex} of ${copyCount}`}` : "") +
          "  |  Generated by IOMS.",
      ),
      left,
      pageContentBottom() - 10,
      { width, align: "center", lineBreak: false },
    );
    doc.fillColor("#000");
  };

  const drawSignatureBlock = (innerX: number, innerW: number, startY: number) => {
    const slipBottom = pageContentBottom() - 14;
    const usernameY = slipBottom - USERNAME_LINE_H;
    let footerY = startY + 8;
    doc.font("Helvetica").fontSize(7);
    footerY = advanceAfterWrappedText(doc, receiptPaymentNote(ctx.revenueHead), innerX, footerY, innerW * 0.58, 3);
    if (opts.qrPng && opts.verifyUrl) {
      try {
        doc.image(opts.qrPng, innerX, footerY, { width: QR_SIZE, height: QR_SIZE });
        doc.fontSize(5.5).fillColor("#666");
        doc.text(pdfSafeText("Verify"), innerX, footerY + QR_SIZE + 2, { width: QR_SIZE, align: "center" });
        doc.fillColor("#000");
      } catch {
        /* skip */
      }
    }
    const sigX = innerX + innerW * 0.42;
    const sigW = innerW * 0.58;
    const officerLineY = Math.min(footerY + 8, usernameY - SIGNATURE_STAMP_GAP - BOARD_LINE_H - 16);
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
      officerLineY + OFFICER_LINE_H + SIGNATURE_STAMP_GAP,
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
  };

  for (let pi = 0; pi < chunks.length; pi++) {
    if (pi > 0) doc.addPage({ size: "A4", margins: pageMargins });
    const isLast = pi === chunks.length - 1;
    const chunk = chunks[pi];
    let cy: number;

    if (pi === 0 && chunks.length === 1) {
      drawGaplmbReceiptSlip(
        doc,
        { ...ctx, rows: chunk },
        { x: left, y: top, width, height: pageContentBottom() - top },
        opts,
      );
      drawPageFooterStrip(1, 1);
      continue;
    }

    const boxH = pageContentBottom() - top;
    doc.rect(left, top, width, boxH).lineWidth(0.75).stroke();
    if (opts.logoPng && !opts.bodyOnly && pi === 0) {
      drawLogoWatermark(doc, opts.logoPng, { x: left, y: top, width, height: boxH });
    }
    const innerX = left + PAD;
    const innerW = width - PAD * 2;

    if (pi === 0) {
      cy = top + PAD;
      if (opts.logoPng) {
        try {
          doc.image(opts.logoPng, innerX, cy, { width: LOGO_SIZE, height: LOGO_SIZE, fit: [LOGO_SIZE, LOGO_SIZE] });
        } catch {
          /* skip */
        }
      }
      if (opts.copyBadge?.trim() || opts.copyLabel?.trim()) {
        drawCopyBadge(doc, (opts.copyBadge ?? opts.copyLabel)!.trim(), innerX, cy, innerW);
      }
      if (!opts.bodyOnly) {
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
        cy += 16;
      } else {
        doc.font("Helvetica-Bold").fontSize(10);
        doc.text(pdfSafeText(ctx.receiptTitle), innerX, cy, { width: innerW, align: "center" });
        cy += 14;
      }

      doc.font("Helvetica").fontSize(8.5);
      doc.text(pdfSafeText(`Receipt No : ${ctx.receiptNo}`), innerX, cy, {
        width: innerW * 0.52,
        align: "left",
        lineBreak: false,
      });
      doc.text(pdfSafeText(`Date : ${ctx.dateLabel}`), innerX + innerW * 0.48, cy, {
        width: innerW * 0.52,
        align: "right",
        lineBreak: false,
      });
      cy += 11;
      cy = drawReceivedFromLine(doc, ctx.payerDisplayName, ctx.partyIdLine, innerX, cy, innerW);
      if (ctx.newPartyAddressLine?.trim()) {
        cy = advanceAfterWrappedText(doc, ctx.newPartyAddressLine.trim(), innerX, cy, innerW, 2);
      }
      if (ctx.newPartyContactLine?.trim()) {
        cy = advanceAfterWrappedText(doc, ctx.newPartyContactLine.trim(), innerX, cy, innerW, 2);
      }
      doc.fontSize(8);
      cy = advanceAfterWrappedText(doc, `A Sum Of ( INR ${ctx.amountWords} Only )`, innerX, cy, innerW, 3);
      doc.fontSize(7.5);
      cy = advanceAfterWrappedText(doc, `By : ${ctx.paymentDetailLine}`, innerX, cy, innerW, 3);
      doc.fontSize(8.5);
      doc.text(pdfSafeText("Towards as below :"), innerX, cy, { width: innerW, align: "left", lineBreak: false });
      cy += 10;
      doc.fontSize(8);
      cy = advanceAfterWrappedText(doc, ctx.remarks, innerX, cy, innerW, 4);
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
      cy = drawParticularsTable(doc, chunk, ctx.totalAmount, innerX, cy, innerW, {
        showTotal: isLast,
        totalAmount: ctx.totalAmount,
      });
      if (!isLast) {
        doc.font("Helvetica-Bold").fontSize(9).fillColor("#b45309");
        doc.text(
          pdfSafeText(`CONTINUED on next page — Page ${pi + 1} of ${totalPages}`),
          innerX,
          cy + 4,
          { width: innerW, align: "left", lineBreak: false },
        );
        doc.fillColor("#000");
      } else {
        drawSignatureBlock(innerX, innerW, cy);
      }
    } else {
      cy = drawContinuedChrome(pi + 1, totalPages);
      cy = drawParticularsTable(doc, chunk, ctx.totalAmount, innerX, cy, innerW, {
        showTotal: isLast,
        totalAmount: ctx.totalAmount,
      });
      if (isLast) {
        drawSignatureBlock(innerX, innerW, cy);
      } else {
        doc.font("Helvetica-Bold").fontSize(9).fillColor("#b45309");
        doc.text(
          pdfSafeText(`CONTINUED on next page — Page ${pi + 1} of ${totalPages}`),
          innerX,
          cy + 4,
          { width: innerW, align: "left", lineBreak: false },
        );
        doc.fillColor("#000");
      }
    }

    drawPageFooterStrip(pi + 1, totalPages);
  }
}
