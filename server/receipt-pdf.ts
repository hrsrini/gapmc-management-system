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
import { attachPayerDisplayNames } from "./ioms-receipt-payer-display";

type ReceiptRow = InferSelectModel<typeof iomsReceipts>;

/** PDFKit built-in fonts use WinAnsi; rupee, smart quotes, em dash, and non-Latin1 glyphs often throw at render time. */
function pdfSafeText(s: string): string {
  let t = String(s ?? "")
    .replace(/\u20b9/g, "Rs.")
    .replace(/\u2014/g, "-")
    .replace(/\u2013/g, "-")
    .replace(/\u2019/g, "'")
    .replace(/\u2018/g, "'")
    .replace(/\u201c/g, '"')
    .replace(/\u201d/g, '"')
    .replace(/\u2026/g, "...")
    .replace(/\u00a0/g, " ");
  let out = "";
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!;
    const code = c.charCodeAt(0);
    if (code >= 0x20 && code <= 0x7e) out += c;
    else if (code === 0x0a || code === 0x0d) out += c;
    else out += "?";
  }
  return out;
}

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
  let payerDisplayName: string;
  let unifiedEntityDisplayName: string | null | undefined;
  try {
    const enriched = await attachPayerDisplayNames([receipt]);
    const row0 = enriched[0];
    payerDisplayName = row0?.payerDisplayName ?? String(receipt.payerName ?? receipt.payerRefId ?? "—");
    unifiedEntityDisplayName = row0?.unifiedEntityDisplayName;
  } catch {
    payerDisplayName = String(receipt.payerName ?? receipt.payerRefId ?? "—");
    unifiedEntityDisplayName = undefined;
  }
  const unifiedEntityPdfLine =
    (unifiedEntityDisplayName ?? receipt.unifiedEntityId)?.trim() || null;
  const printMode = (process.env.RECEIPT_PDF_PRINT_MODE ?? "full").trim().toLowerCase();
  const bodyOnly = printMode === "body-only" || printMode === "preprinted";
  const signatoryName = process.env.RECEIPT_PDF_SIGNATORY_NAME?.trim();
  const pdfkitMod = await import("pdfkit").catch((e) => {
    console.error("[receipt-pdf] pdfkit module load failed", e);
    throw e;
  });
  const PDFDocument = pdfkitMod.default;
  const verifyUrl = `${verifyBaseUrl.replace(/\/$/, "")}/verify/${encodeURIComponent(receipt.receiptNo)}`;
  let qrPng: Buffer;
  let logoBuf: Buffer | null;
  try {
    [qrPng, logoBuf] = await Promise.all([
      QRCode.toBuffer(verifyUrl, { type: "png", margin: 1, width: 200 }),
      bodyOnly ? Promise.resolve(null as Buffer | null) : loadOptionalReceiptLogo(),
    ]);
  } catch (e) {
    console.error("[receipt-pdf] QR or logo preparation failed", e);
    throw e;
  }

  const doc = new PDFDocument({ margin: 48, size: "A4" });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));

  await new Promise<void>((resolve, reject) => {
    doc.on("end", () => resolve());
    doc.on("error", reject);

    if (!bodyOnly && logoBuf) {
      try {
        const logoW = 132;
        const x = (doc.page.width - logoW) / 2;
        doc.image(logoBuf, x, doc.y, { width: logoW });
        doc.moveDown(2.2);
      } catch {
        /* unsupported or corrupt logo buffer — continue without image */
      }
    }

    if (duplicateLabel) {
      doc
        .save()
        .rotate(-18, { origin: [doc.page.width / 2, doc.page.height / 2] })
        .fontSize(44)
        .fillColor("#d1d5db")
        .opacity(0.35)
        .text(pdfSafeText(String(duplicateLabel).slice(0, 40)), 0, doc.page.height / 2 - 40, { align: "center" })
        .opacity(1)
        .restore();
      doc.moveDown(0.2);
    }

    if (!bodyOnly) {
      doc
        .fontSize(18)
        .text(pdfSafeText("Goa Agricultural Produce and Livestock Marketing Board (GAPLMB)"), { align: "center" });
      doc.moveDown(0.25);
      doc
        .fontSize(11)
        .fillColor("#444")
        .text(pdfSafeText("Integrated Online Management System - Receipt"), { align: "center" });
      doc.fillColor("#000");
      doc.moveDown(1.2);
    } else {
      doc.fontSize(12).text(pdfSafeText("Receipt (body)"), { align: "left" });
      doc.moveDown(0.6);
    }
    doc.fontSize(10).text(pdfSafeText(`Yard / location: ${yardName ?? receipt.yardId}`));
    doc.text(pdfSafeText(`Receipt no.: ${receipt.receiptNo}`));
    doc.text(pdfSafeText(`Date: ${String(receipt.createdAt ?? "").slice(0, 19).replace("T", " ")}`));
    doc.text(pdfSafeText(`Status: ${receipt.status}`));
    if ((receipt as { isGracePeriod?: boolean | null }).isGracePeriod) {
      doc
        .moveDown(0.25)
        .fontSize(9)
        .fillColor("#b45309")
        .text(
          pdfSafeText(
            "Grace period transaction: licence renewal required before transaction window end date (see policy).",
          ),
        );
      doc.fillColor("#000");
    }
    doc.moveDown(0.6);
    doc.fontSize(11).text(pdfSafeText("Payer"), { underline: true });
    doc.fontSize(10).text(pdfSafeText(payerDisplayName));
    if (receipt.payerType) doc.text(pdfSafeText(`Type: ${receipt.payerType}`));
    if (unifiedEntityPdfLine) doc.text(pdfSafeText(`Unified entity: ${unifiedEntityPdfLine}`));
    doc.moveDown(0.8);
    doc.fontSize(11).text(pdfSafeText("Amounts (INR)"), { underline: true });
    doc.fontSize(10);
    doc.text(pdfSafeText(`Revenue head: ${receipt.revenueHead}`));
    doc.text(`Base amount: Rs.${Number(receipt.amount ?? 0).toFixed(2)}`);
    if (Number(receipt.cgst ?? 0) > 0 || Number(receipt.sgst ?? 0) > 0) {
      doc.text(`CGST: Rs.${Number(receipt.cgst ?? 0).toFixed(2)}   SGST: Rs.${Number(receipt.sgst ?? 0).toFixed(2)}`);
    }
    doc.fontSize(12).text(`Total: Rs.${Number(receipt.totalAmount ?? 0).toFixed(2)}`, { continued: false });
    doc.moveDown(0.35);
    const tds = Number(receipt.tdsAmount ?? 0);
    if (tds > 0) {
      doc
        .fontSize(9)
        .fillColor("#444")
        .text(
          pdfSafeText(
            `TDS u/s 194-I (on rent component): Rs.${tds.toFixed(2)} - shown for statutory disclosure; total above is gross invoice amount.`,
          ),
        );
      doc.fillColor("#000");
    }
    if (arrearsDisclosure) {
      doc.moveDown(0.25);
      doc
        .fontSize(9)
        .fillColor("#444")
        .text(
          pdfSafeText(
            `Arrears interest (after prior dishonour, ${arrearsDisclosure.overdueDays} day(s) from due ${arrearsDisclosure.dueDateIso} to ${arrearsDisclosure.asOfIso} at ${arrearsDisclosure.ratePercentPerAnnum}% p.a. on Rs.${arrearsDisclosure.principalInr.toFixed(2)}): approx Rs.${arrearsDisclosure.approxInterestInr.toFixed(2)} - not included in total above.`,
          ),
        );
      doc.fillColor("#000");
    }
    doc.moveDown(0.4);
    doc.fontSize(10).text(pdfSafeText(`Payment mode: ${receipt.paymentMode}`));
    if (receipt.chequeNo) doc.text(pdfSafeText(`Cheque no.: ${receipt.chequeNo}`));
    if (receipt.bankName) doc.text(pdfSafeText(`Bank: ${receipt.bankName}`));
    if (receipt.gatewayRef) doc.text(pdfSafeText(`Reference: ${receipt.gatewayRef}`));
    doc.moveDown(1);
    doc.fontSize(9).fillColor("#555").text(pdfSafeText("Verify this receipt (QR):"), { continued: false });
    doc.fillColor("#000");
    try {
      doc.image(qrPng, { fit: [120, 120] });
    } catch {
      doc.fontSize(9).text("(QR image unavailable)");
    }
    doc.moveDown(0.3);
    const verifyLine = pdfSafeText(verifyUrl);
    try {
      doc.fontSize(8).fillColor("#666").text(verifyLine, { link: verifyUrl, underline: true });
    } catch {
      doc.fontSize(8).fillColor("#666").text(verifyLine);
    }
    doc.fillColor("#000");
    doc.moveDown(1);
    if (signatoryName) {
      doc.fontSize(9).text(pdfSafeText(`Authorised signatory: ${signatoryName}`), { align: "right" });
      doc.moveDown(0.5);
    }
    doc.fontSize(8).text(
      pdfSafeText("This document was generated by the IOMS server. For queries, contact GAPLMB accounts."),
      {
        align: "center",
      },
    );
    doc.end();
  });

  return Buffer.concat(chunks);
}
