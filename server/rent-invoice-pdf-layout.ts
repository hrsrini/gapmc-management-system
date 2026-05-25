import type PDFDocument from "pdfkit";
import { pdfSafeText } from "./pdf-safe-text";
import { formatTaxInvoiceAmountCell } from "./rent-invoice-pdf-shared";
import type { RentInvoicePdfContext } from "./rent-invoice-pdf-context";

type PdfDoc = InstanceType<typeof PDFDocument>;

const LINE = 0.5;
const PAD = 5;
const FS_TITLE = 13;
const FS_LABEL = 7;
const FS_VALUE = 8;
const FS_SMALL = 7;
const ROW_H = 16;
const PARTY_ROW_H = 44;

function strokeBox(doc: PdfDoc, x: number, y: number, w: number, h: number): void {
  doc.save().lineWidth(LINE).strokeColor("#000000").rect(x, y, w, h).stroke().restore();
}

function hLine(doc: PdfDoc, x: number, y: number, w: number): void {
  doc.save().lineWidth(LINE).strokeColor("#000000").moveTo(x, y).lineTo(x + w, y).stroke().restore();
}

function vLine(doc: PdfDoc, x: number, y: number, h: number): void {
  doc.save().lineWidth(LINE).strokeColor("#000000").moveTo(x, y).lineTo(x, y + h).stroke().restore();
}

/** Label on first line, value below (avoids overlap in narrow cells). */
function drawLabeledCell(
  doc: PdfDoc,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  value: string,
): void {
  const innerW = w - PAD * 2;
  doc.font("Helvetica").fontSize(FS_LABEL).fillColor("#000000");
  doc.text(pdfSafeText(label), x + PAD, y + 3, { width: innerW, lineBreak: false });
  doc.font("Helvetica-Bold").fontSize(FS_VALUE);
  const val = value.trim() || " ";
  doc.text(pdfSafeText(val), x + PAD, y + 11, { width: innerW, height: Math.max(8, h - 13), lineGap: 0.5 });
}

function drawPartyInBox(
  doc: PdfDoc,
  x: number,
  y: number,
  w: number,
  h: number,
  title: string,
  name: string,
  locationName: string,
  stateLine: string,
): void {
  const innerW = w - PAD * 2;
  doc.font("Helvetica-Bold").fontSize(FS_LABEL).fillColor("#000000");
  doc.text(pdfSafeText(title), x + PAD, y + 4, { width: innerW, lineBreak: false });
  doc.font("Helvetica-Bold").fontSize(FS_VALUE);
  doc.text(pdfSafeText(name), x + PAD, y + 14, { width: innerW, lineBreak: false });
  doc.font("Helvetica").fontSize(FS_VALUE);
  doc.text(pdfSafeText(locationName), x + PAD, y + 26, { width: innerW, lineBreak: false });
  doc.text(pdfSafeText(stateLine), x + PAD, y + 38, { width: innerW, lineBreak: false });
}

function drawParticularsTable(
  doc: PdfDoc,
  ctx: RentInvoicePdfContext,
  x: number,
  y: number,
  w: number,
  minBodyRows: number,
): number {
  const slW = 24;
  const hsnW = 64;
  const qtyW = 40;
  const rateW = 46;
  const perW = 28;
  const amtW = 72;
  const partW = w - slW - hsnW - qtyW - rateW - perW - amtW;
  const headerH = 18;
  const totalH = 20;
  const bodyRows = Math.max(ctx.lines.length, minBodyRows);
  const bodyH = bodyRows * ROW_H;
  const tableH = headerH + bodyH + totalH;

  strokeBox(doc, x, y, w, tableH);

  const slX = x;
  const partX = x + slW;
  const hsnX = partX + partW;
  const qtyX = hsnX + hsnW;
  const rateX = qtyX + qtyW;
  const perX = rateX + rateW;
  const amtX = perX + perW;

  for (const vx of [partX, hsnX, qtyX, rateX, perX, amtX]) {
    vLine(doc, vx, y, tableH);
  }
  hLine(doc, x, y + headerH, w);
  hLine(doc, x, y + headerH + bodyH, w);

  const hy = y + 5;
  doc.font("Helvetica-Bold").fontSize(FS_LABEL);
  doc.text("Sl No.", slX, hy, { width: slW, align: "center", lineBreak: false });
  doc.text("Description of Goods", partX + PAD, hy, { width: partW - PAD, align: "left", lineBreak: false });
  doc.text("HSN/SAC", hsnX, hy, { width: hsnW, align: "center", lineBreak: false });
  doc.text("Quantity", qtyX, hy, { width: qtyW, align: "center", lineBreak: false });
  doc.text("Rate", rateX, hy, { width: rateW, align: "center", lineBreak: false });
  doc.text("per", perX, hy, { width: perW, align: "center", lineBreak: false });
  doc.text("Amount", amtX, hy, { width: amtW - PAD, align: "right", lineBreak: false });

  doc.font("Helvetica").fontSize(FS_VALUE);
  for (let i = 0; i < bodyRows; i++) {
    const line = ctx.lines[i];
    const rowY = y + headerH + i * ROW_H + 4;
    if (i === 0) {
      doc.text("1", slX, rowY, { width: slW, align: "center", lineBreak: false });
    }
    if (!line) continue;

    const labelX = partX + PAD + (line.indent ? 10 : 0);
    doc.text(pdfSafeText(line.label), labelX, rowY, {
      width: partW - PAD - (line.indent ? 10 : 0),
      lineBreak: false,
    });
    if (line.hsnSac && !line.indent) {
      doc.text(pdfSafeText(line.hsnSac), hsnX + 2, rowY, { width: hsnW - 4, align: "left", lineBreak: false });
    }
    if (line.rateLabel) {
      doc.text(pdfSafeText(line.rateLabel), rateX, rowY, { width: rateW, align: "center", lineBreak: false });
    }
    if (line.perLabel) {
      doc.text(pdfSafeText(line.perLabel), perX, rowY, { width: perW, align: "center", lineBreak: false });
    }
    doc.text(pdfSafeText(formatTaxInvoiceAmountCell(line.amount)), amtX, rowY, {
      width: amtW - PAD,
      align: "right",
      lineBreak: false,
    });
  }

  const totalY = y + headerH + bodyH + 5;
  doc.font("Helvetica-Bold").fontSize(8);
  doc.text("Total", partX + PAD, totalY, { width: partW, align: "left", lineBreak: false });
  doc.font("Helvetica-Bold").fontSize(10);
  doc.text(pdfSafeText(`Rs. ${formatTaxInvoiceAmountCell(ctx.grandTotal)}`), amtX, totalY, {
    width: amtW - PAD,
    align: "right",
    lineBreak: false,
  });

  return y + tableH;
}

function drawTaxSummaryTable(doc: PdfDoc, ctx: RentInvoicePdfContext, x: number, y: number, w: number): number {
  const hsnW = 76;
  const restW = w - hsnW;
  const taxableW = restW * 0.22;
  const centralW = restW * 0.28;
  const stateW = restW * 0.28;
  const totalTaxW = restW - taxableW - centralW - stateW;
  const headerH = 24;
  const rowH = 18;
  const tableH = headerH + rowH * 2;

  const cHsn = x;
  const cTaxable = x + hsnW;
  const cCentral = cTaxable + taxableW;
  const cState = cCentral + centralW;
  const cTotalTax = cState + stateW;
  const midCentral = centralW / 2;
  const midState = stateW / 2;

  strokeBox(doc, x, y, w, tableH);

  // Column rules: HSN | Taxable | Central (rate|amt) | State (rate|amt) | Total tax — no rule between Central & State
  vLine(doc, cTaxable, y, tableH);
  vLine(doc, cCentral, y, tableH);
  vLine(doc, cTotalTax, y, tableH);
  vLine(doc, cCentral + midCentral, y, headerH + rowH);
  vLine(doc, cState + midState, y, headerH + rowH);
  hLine(doc, x, y + headerH, w);
  hLine(doc, x, y + headerH + rowH, w);

  doc.font("Helvetica-Bold").fontSize(6.5);
  doc.text("HSN/SAC", cHsn + PAD, y + 4, { width: hsnW - PAD, lineBreak: false });
  doc.text("Taxable Value", cTaxable + PAD, y + 9, { width: taxableW - PAD, lineBreak: false });
  doc.text("Central Tax", cCentral + PAD, y + 4, { width: centralW - PAD, align: "center", lineBreak: false });
  doc.text("State Tax", cState + PAD, y + 4, { width: stateW - PAD, align: "center", lineBreak: false });
  doc.text("Total Tax Amount", cTotalTax + PAD, y + 9, { width: totalTaxW - PAD, lineBreak: false });

  doc.font("Helvetica").fontSize(6);
  doc.text("Rate", cCentral + PAD, y + 14, { width: midCentral - PAD, lineBreak: false });
  doc.text("Amount", cCentral + midCentral + PAD, y + 14, { width: midCentral - PAD, lineBreak: false });
  doc.text("Rate", cState + PAD, y + 14, { width: midState - PAD, lineBreak: false });
  doc.text("Amount", cState + midState + PAD, y + 14, { width: midState - PAD, lineBreak: false });

  const dataY = y + headerH + 5;
  const rateStr = (r: number) => (r % 1 === 0 ? `${r}%` : `${r.toFixed(2)}%`);
  doc.font("Helvetica").fontSize(FS_VALUE);
  doc.text(pdfSafeText(ctx.hsnSac), cHsn + PAD, dataY, { width: hsnW - PAD, lineBreak: false });
  doc.text(pdfSafeText(formatTaxInvoiceAmountCell(ctx.taxableValue)), cTaxable + PAD, dataY, {
    width: taxableW - PAD,
    align: "right",
    lineBreak: false,
  });
  if (ctx.isGstExempt) {
    doc.text("-", cCentral + PAD, dataY, { width: midCentral - PAD, lineBreak: false });
    doc.text("-", cCentral + midCentral + PAD, dataY, { width: midCentral - PAD, align: "right", lineBreak: false });
    doc.text("-", cState + PAD, dataY, { width: midState - PAD, lineBreak: false });
    doc.text("-", cState + midState + PAD, dataY, { width: midState - PAD, align: "right", lineBreak: false });
    doc.text("-", cTotalTax + PAD, dataY, { width: totalTaxW - PAD, align: "right", lineBreak: false });
  } else {
    doc.text(pdfSafeText(rateStr(ctx.cgstRate)), cCentral + PAD, dataY, { width: midCentral - PAD, lineBreak: false });
    doc.text(pdfSafeText(formatTaxInvoiceAmountCell(ctx.cgstAmount)), cCentral + midCentral + PAD, dataY, {
      width: midCentral - PAD,
      align: "right",
      lineBreak: false,
    });
    doc.text(pdfSafeText(rateStr(ctx.sgstRate)), cState + PAD, dataY, { width: midState - PAD, lineBreak: false });
    doc.text(pdfSafeText(formatTaxInvoiceAmountCell(ctx.sgstAmount)), cState + midState + PAD, dataY, {
      width: midState - PAD,
      align: "right",
      lineBreak: false,
    });
    doc.text(pdfSafeText(formatTaxInvoiceAmountCell(ctx.totalTaxAmount)), cTotalTax + PAD, dataY, {
      width: totalTaxW - PAD,
      align: "right",
      lineBreak: false,
    });
  }

  const totalY = y + headerH + rowH + 5;
  doc.font("Helvetica-Bold").fontSize(FS_VALUE);
  doc.text("Total", cHsn + PAD, totalY, { width: hsnW - PAD, lineBreak: false });
  doc.text(pdfSafeText(formatTaxInvoiceAmountCell(ctx.taxableValue)), cTaxable + PAD, totalY, {
    width: taxableW - PAD,
    align: "right",
    lineBreak: false,
  });
  if (!ctx.isGstExempt) {
    doc.text(pdfSafeText(formatTaxInvoiceAmountCell(ctx.cgstAmount)), cCentral + midCentral + PAD, totalY, {
      width: midCentral - PAD,
      align: "right",
      lineBreak: false,
    });
    doc.text(pdfSafeText(formatTaxInvoiceAmountCell(ctx.sgstAmount)), cState + midState + PAD, totalY, {
      width: midState - PAD,
      align: "right",
      lineBreak: false,
    });
    doc.text(pdfSafeText(formatTaxInvoiceAmountCell(ctx.totalTaxAmount)), cTotalTax + PAD, totalY, {
      width: totalTaxW - PAD,
      align: "right",
      lineBreak: false,
    });
  }

  return y + tableH;
}

/** Draw full-page GSAMB-style tax invoice; returns bottom Y. */
export function drawGsambRentTaxInvoice(doc: PdfDoc, ctx: RentInvoicePdfContext, margin: number): number {
  const pageH = doc.page.height;
  const x = margin;
  const w = doc.page.width - margin * 2;
  const startY = margin;
  let y = startY;

  const titleH = 18;
  const headerTopH = 72;
  const headerMidH = PARTY_ROW_H * 2;
  const wordsH = 26;
  const taxTableH = 24 + 18 * 2;
  const taxWordsH = 22;
  const footH = 58;
  const disclaimerH = 16;

  const fixedBelow = wordsH + taxTableH + taxWordsH + footH;
  const fixedAbove = titleH + headerTopH + headerMidH;
  const particularsOverhead = 18 + 20;
  const availableBody =
    pageH - margin - startY - fixedAbove - fixedBelow - disclaimerH - particularsOverhead;
  const minBodyRows = Math.max(ctx.lines.length, Math.floor(availableBody / ROW_H));

  doc.font("Helvetica-Bold").fontSize(FS_TITLE).fillColor("#000000");
  doc.text("Tax Invoice", x, y, { width: w, align: "center", lineBreak: false });
  y += titleH;

  const rightW = w * 0.5;
  const leftW = w - rightW;
  strokeBox(doc, x, y, w, headerTopH);
  vLine(doc, x + leftW, y, headerTopH);

  const sellerY = y + 4;
  doc.font("Helvetica-Bold").fontSize(7.5);
  doc.text(pdfSafeText(ctx.sellerTitle), x + PAD, sellerY, { width: leftW - PAD * 2, lineGap: 0.5 });
  let detailY = doc.y + 4;
  doc.font("Helvetica").fontSize(FS_VALUE);
  doc.text(pdfSafeText(ctx.sellerAddress), x + PAD, detailY, { width: leftW - PAD * 2, lineBreak: false });
  detailY += 12;
  doc.text(pdfSafeText(`GSTIN/UIN: ${ctx.gstin}`), x + PAD, detailY, { width: leftW - PAD * 2, lineBreak: false });
  doc.text(pdfSafeText(`State Name: ${ctx.stateName}, Code: ${ctx.stateCode}`), x + PAD, detailY + 11, {
    width: leftW - PAD * 2,
    lineBreak: false,
  });

  const metaX = x + leftW;
  const metaRows: [string, string, string, string][] = [
    ["Invoice No.", ctx.invoiceNo, "Dated", ctx.invoiceDate],
    ["Delivery Note", "", "Mode/Terms of Payment", ""],
    ["Reference No. & Date.", "", "Other References", ""],
  ];
  const rowMetaH = headerTopH / metaRows.length;
  for (let i = 0; i < metaRows.length; i++) {
    const ry = y + i * rowMetaH;
    if (i > 0) hLine(doc, metaX, ry, rightW);
    const [l1, v1, l2, v2] = metaRows[i]!;
    const half = rightW / 2;
    vLine(doc, metaX + half, ry, rowMetaH);
    drawLabeledCell(doc, metaX, ry, half, rowMetaH, l1, v1);
    drawLabeledCell(doc, metaX + half, ry, half, rowMetaH, l2, v2);
  }

  y += headerTopH;

  strokeBox(doc, x, y, w, headerMidH);
  const midLeftW = w * 0.5;
  vLine(doc, x + midLeftW, y, headerMidH);
  hLine(doc, x, y + PARTY_ROW_H, midLeftW);

  const stateLine = `State Name: ${ctx.stateName}, Code: ${ctx.stateCode}`;
  drawPartyInBox(doc, x, y, midLeftW, PARTY_ROW_H, "Consignee (Ship to)", ctx.consigneeName, ctx.buyerAddress, stateLine);
  drawPartyInBox(doc, x, y + PARTY_ROW_H, midLeftW, PARTY_ROW_H, "Buyer (Bill to)", ctx.buyerName, ctx.buyerAddress, stateLine);

  const rx = x + midLeftW;
  const rightMeta: [string, string, string, string][] = [
    ["Buyer's Order No.", "", "Dated", ""],
    ["Dispatch Doc No.", ctx.dispatchDocNo, "Delivery Note Date", ""],
    ["Dispatched through", "", "Destination", ctx.destination],
    ["Terms of Delivery", "", "", ""],
  ];
  const rRowH = headerMidH / rightMeta.length;
  const midRightW = w - midLeftW;
  for (let i = 0; i < rightMeta.length; i++) {
    const ry = y + i * rRowH;
    if (i > 0) hLine(doc, rx, ry, midRightW);
    const [l1, v1, l2, v2] = rightMeta[i]!;
    const half = midRightW / 2;
    vLine(doc, rx + half, ry, rRowH);
    drawLabeledCell(doc, rx, ry, half, rRowH, l1, v1);
    drawLabeledCell(doc, rx + half, ry, half, rRowH, l2, v2);
  }

  y += headerMidH;

  y = drawParticularsTable(doc, ctx, x, y, w, minBodyRows);

  strokeBox(doc, x, y, w, wordsH);
  doc.font("Helvetica").fontSize(FS_LABEL);
  doc.text("Amount Chargeable (in words)", x + PAD, y + 4, { lineBreak: false });
  doc.font("Helvetica-Bold").fontSize(FS_VALUE);
  doc.text(pdfSafeText(ctx.chargeableWords), x + PAD, y + 13, { width: w * 0.75, lineBreak: false });
  doc.font("Helvetica").fontSize(FS_LABEL);
  doc.text("E. & O.E", x + w - 52, y + 13, { width: 44, align: "right", lineBreak: false });
  y += wordsH;

  y = drawTaxSummaryTable(doc, ctx, x, y, w);

  strokeBox(doc, x, y, w, taxWordsH);
  doc.font("Helvetica").fontSize(FS_LABEL);
  doc.text("Tax Amount (in words):", x + PAD, y + 5, { lineBreak: false });
  doc.font("Helvetica-Bold").fontSize(FS_VALUE);
  doc.text(pdfSafeText(ctx.taxWords), x + 120, y + 5, { width: w - 128, lineBreak: false });
  y += taxWordsH;

  strokeBox(doc, x, y, w, footH);
  vLine(doc, x + w * 0.55, y, footH);
  doc.font("Helvetica").fontSize(FS_LABEL);
  doc.text("Remarks:", x + PAD, y + 5, { lineBreak: false });
  doc.font("Helvetica-Bold").fontSize(FS_VALUE);
  doc.text(pdfSafeText(ctx.remarks), x + PAD, y + 14, { width: w * 0.52 - PAD, lineGap: 0.5 });
  doc.font("Helvetica").fontSize(FS_LABEL);
  doc.text(pdfSafeText(`Company's PAN: ${ctx.pan}`), x + PAD, y + 38, { lineBreak: false });

  const sigX = x + w * 0.55 + PAD;
  const sigW = w * 0.45 - PAD * 2;
  doc.font("Helvetica").fontSize(FS_VALUE);
  doc.text(pdfSafeText(ctx.signatoryFor), sigX, y + footH - 28, { width: sigW, align: "right", lineBreak: false });
  doc.text("Authorised Signatory", sigX, y + footH - 14, { width: sigW, align: "right", lineBreak: false });
  y += footH;

  doc.font("Helvetica").fontSize(FS_SMALL);
  doc.text("This is a Computer Generated Invoice", x, y + 4, { width: w, align: "center", lineBreak: false });
  y += disclaimerH;

  doc.save().lineWidth(1).strokeColor("#000000").rect(x, startY, w, y - startY).stroke().restore();

  return y;
}
