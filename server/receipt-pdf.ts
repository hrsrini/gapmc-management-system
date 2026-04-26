/**
 * M-05: server-generated receipt PDF (branded header + line items + embedded QR).
 * Logo order: (1) Admin → Config upload (`uploads/branding/receipt-pdf-logo.*`), (2) `RECEIPT_PDF_LOGO_PATH`, (3) `RECEIPT_PDF_LOGO_URL`.
 */
import fs from "fs";
import path from "path";
import QRCode from "qrcode";
import type { InferSelectModel } from "drizzle-orm";
import { iomsReceipts } from "@shared/db-schema";
import { readUploadedReceiptLogoBuffer } from "./receipt-logo-storage";

type ReceiptRow = InferSelectModel<typeof iomsReceipts>;

export type ReceiptPdfArrearsDisclosure = {
  approxInterestInr: number;
  overdueDays: number;
  dueDateIso: string;
  asOfIso: string;
  ratePercentPerAnnum: number;
  principalInr: number;
  note: string;
};

async function loadOptionalReceiptLogo(): Promise<Buffer | null> {
  const uploaded = await readUploadedReceiptLogoBuffer();
  if (uploaded) return uploaded;

  const filePath = process.env.RECEIPT_PDF_LOGO_PATH?.trim();
  if (filePath) {
    const abs = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
    try {
      if (fs.existsSync(abs)) return fs.readFileSync(abs);
    } catch {
      /* ignore */
    }
  }
  const url = process.env.RECEIPT_PDF_LOGO_URL?.trim();
  if (url?.startsWith("http://") || url?.startsWith("https://")) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timer);
      if (res.ok) return Buffer.from(await res.arrayBuffer());
    } catch {
      /* ignore */
    }
  }
  return null;
}

export async function buildIomsReceiptPdf(params: {
  receipt: ReceiptRow;
  yardName?: string | null;
  verifyBaseUrl: string;
  /** Optional M-03 rent arrears line (after prior dishonour for same invoice). */
  arrearsDisclosure?: ReceiptPdfArrearsDisclosure | null;
  /** US-M05-004: render authorised duplicate watermark/label. */
  duplicateLabel?: string | null;
}): Promise<Buffer> {
  const { receipt, yardName, verifyBaseUrl, arrearsDisclosure, duplicateLabel } = params;
  const printMode = (process.env.RECEIPT_PDF_PRINT_MODE ?? "full").trim().toLowerCase();
  const bodyOnly = printMode === "body-only" || printMode === "preprinted";
  const signatoryName = process.env.RECEIPT_PDF_SIGNATORY_NAME?.trim();
  const { default: PDFDocument } = await import("pdfkit");
  const verifyUrl = `${verifyBaseUrl.replace(/\/$/, "")}/verify/${encodeURIComponent(receipt.receiptNo)}`;
  const [qrPng, logoBuf] = await Promise.all([
    QRCode.toBuffer(verifyUrl, { type: "png", margin: 1, width: 200 }),
    bodyOnly ? Promise.resolve(null as Buffer | null) : loadOptionalReceiptLogo(),
  ]);

  const doc = new PDFDocument({ margin: 48, size: "A4" });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));

  await new Promise<void>((resolve, reject) => {
    doc.on("end", () => resolve());
    doc.on("error", reject);

    if (!bodyOnly && logoBuf) {
      const logoW = 132;
      const x = (doc.page.width - logoW) / 2;
      doc.image(logoBuf, x, doc.y, { width: logoW });
      doc.moveDown(2.2);
    }

    if (duplicateLabel) {
      doc
        .save()
        .rotate(-18, { origin: [doc.page.width / 2, doc.page.height / 2] })
        .fontSize(44)
        .fillColor("#d1d5db")
        .opacity(0.35)
        .text(String(duplicateLabel).slice(0, 40), 0, doc.page.height / 2 - 40, { align: "center" })
        .opacity(1)
        .restore();
      doc.moveDown(0.2);
    }

    if (!bodyOnly) {
      doc.fontSize(18).text("Goa Agricultural Produce and Livestock Marketing Board (GAPLMB)", { align: "center" });
      doc.moveDown(0.25);
      doc.fontSize(11).fillColor("#444").text("Integrated Online Management System — Receipt", { align: "center" });
      doc.fillColor("#000");
      doc.moveDown(1.2);
    } else {
      doc.fontSize(12).text("Receipt (body)", { align: "left" });
      doc.moveDown(0.6);
    }
    doc.fontSize(10).text(`Yard / location: ${yardName ?? receipt.yardId}`);
    doc.text(`Receipt no.: ${receipt.receiptNo}`);
    doc.text(`Date: ${String(receipt.createdAt ?? "").slice(0, 19).replace("T", " ")}`);
    doc.text(`Status: ${receipt.status}`);
    if ((receipt as { isGracePeriod?: boolean | null }).isGracePeriod) {
      doc
        .moveDown(0.25)
        .fontSize(9)
        .fillColor("#b45309")
        .text("Grace period transaction: licence renewal required before transaction window end date (see policy).");
      doc.fillColor("#000");
    }
    doc.moveDown(0.6);
    doc.fontSize(11).text("Payer", { underline: true });
    doc.fontSize(10).text(receipt.payerName ?? receipt.payerRefId ?? "—");
    if (receipt.payerType) doc.text(`Type: ${receipt.payerType}`);
    if (receipt.unifiedEntityId) doc.text(`Unified entity: ${receipt.unifiedEntityId}`);
    doc.moveDown(0.8);
    doc.fontSize(11).text("Amounts (INR)", { underline: true });
    doc.fontSize(10);
    doc.text(`Revenue head: ${receipt.revenueHead}`);
    doc.text(`Base amount: ₹${Number(receipt.amount ?? 0).toFixed(2)}`);
    if (Number(receipt.cgst ?? 0) > 0 || Number(receipt.sgst ?? 0) > 0) {
      doc.text(`CGST: ₹${Number(receipt.cgst ?? 0).toFixed(2)}   SGST: ₹${Number(receipt.sgst ?? 0).toFixed(2)}`);
    }
    doc.fontSize(12).text(`Total: ₹${Number(receipt.totalAmount ?? 0).toFixed(2)}`, { continued: false });
    doc.moveDown(0.35);
    const tds = Number(receipt.tdsAmount ?? 0);
    if (tds > 0) {
      doc
        .fontSize(9)
        .fillColor("#444")
        .text(`TDS u/s 194-I (on rent component): ₹${tds.toFixed(2)} — shown for statutory disclosure; total above is gross invoice amount.`);
      doc.fillColor("#000");
    }
    if (arrearsDisclosure) {
      doc.moveDown(0.25);
      doc
        .fontSize(9)
        .fillColor("#444")
        .text(
          `Arrears interest (after prior dishonour, ${arrearsDisclosure.overdueDays} day(s) from due ${arrearsDisclosure.dueDateIso} to ${arrearsDisclosure.asOfIso} at ${arrearsDisclosure.ratePercentPerAnnum}% p.a. on ₹${arrearsDisclosure.principalInr.toFixed(2)}): approx ₹${arrearsDisclosure.approxInterestInr.toFixed(2)} — not included in total above.`,
        );
      doc.fillColor("#000");
    }
    doc.moveDown(0.4);
    doc.fontSize(10).text(`Payment mode: ${receipt.paymentMode}`);
    if (receipt.chequeNo) doc.text(`Cheque no.: ${receipt.chequeNo}`);
    if (receipt.bankName) doc.text(`Bank: ${receipt.bankName}`);
    if (receipt.gatewayRef) doc.text(`Reference: ${receipt.gatewayRef}`);
    doc.moveDown(1);
    doc.fontSize(9).fillColor("#555").text("Verify this receipt (QR):", { continued: false });
    doc.fillColor("#000");
    doc.image(qrPng, { fit: [120, 120] });
    doc.moveDown(0.3);
    doc.fontSize(8).fillColor("#666").text(verifyUrl, { link: verifyUrl, underline: true });
    doc.fillColor("#000");
    doc.moveDown(1);
    if (signatoryName) {
      doc.fontSize(9).text(`Authorised signatory: ${signatoryName}`, { align: "right" });
      doc.moveDown(0.5);
    }
    doc.fontSize(8).text("This document was generated by the IOMS server. For queries, contact GAPLMB accounts.", {
      align: "center",
    });
    doc.end();
  });

  return Buffer.concat(chunks);
}
