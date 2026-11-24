/**
 * M-05: server-generated receipt PDF — GAPLMB statutory layout (A4).
 * Two A5 slips per A4 sheet (ORIGINAL + OFFICE COPY when short).
 * Long Particulars: max 10 Tally lines per A5; overflow continues on the next
 * A5 slot / A4 page (same 2-up packing), with CONTINUED markers.
 */
import QRCode from "qrcode";
import type { InferSelectModel } from "drizzle-orm";
import { iomsReceipts } from "@shared/db-schema";
import { loadPdfDocumentConstructor } from "./pdfkit-loader";
import { pdfSafeText } from "./pdf-safe-text";
import { loadReceiptPdfLayoutContext } from "./receipt-pdf-context";
import {
  drawDualA5ReceiptCopies,
  MAX_TALLY_LINES_PER_A5,
} from "./receipt-pdf-layout";
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

const A4_MARGIN = 36;
/** Two slips + gap must stay above bottom margin on A4 (~842pt). */
const SLIP_HEIGHT = 364;
const SLIP_GAP = 8;
const FIRST_SLIP_Y = 36;

export async function buildIomsReceiptPdf(params: {
  receipt: ReceiptRow;
  yardName?: string | null;
  verifyBaseUrl: string;
  arrearsDisclosure?: ReceiptPdfArrearsDisclosure | null;
  duplicateLabel?: string | null;
}): Promise<Buffer> {
  const { receipt, verifyBaseUrl, arrearsDisclosure, duplicateLabel } = params;
  const printMode = (process.env.RECEIPT_PDF_PRINT_MODE ?? "full").trim().toLowerCase();
  const bodyOnly = printMode === "body-only" || printMode === "preprinted";
  const signatoryName = process.env.RECEIPT_PDF_SIGNATORY_NAME?.trim();

  let layoutCtx = await loadReceiptPdfLayoutContext(receipt);
  if (arrearsDisclosure && arrearsDisclosure.approxInterestInr > 0.005) {
    layoutCtx = {
      ...layoutCtx,
      remarks: `${layoutCtx.remarks} (Prior dishonour: approx. arrears interest ${arrearsDisclosure.approxInterestInr.toFixed(2)} INR — not in total above.)`,
    };
  }

  const PDFDocument = await loadPdfDocumentConstructor().catch((e) => {
    console.error("[receipt-pdf] pdfkit module load failed", e);
    throw e;
  });

  const verifyUrl = `${verifyBaseUrl.replace(/\/$/, "")}/verify/${encodeURIComponent(receipt.receiptNo)}`;
  let qrPng: Buffer | null = null;
  try {
    qrPng = await QRCode.toBuffer(verifyUrl, { type: "png", margin: 1, width: 160 });
  } catch (e) {
    console.warn("[receipt-pdf] QR generation failed", e);
  }

  const logoPng = bodyOnly ? null : await readUploadedReceiptLogoBuffer();

  const doc = new PDFDocument({
    size: "A4",
    margins: { top: A4_MARGIN, bottom: A4_MARGIN, left: A4_MARGIN, right: A4_MARGIN },
  });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));

  await new Promise<void>((resolve, reject) => {
    doc.on("end", () => resolve());
    doc.on("error", reject);

    if (duplicateLabel) {
      doc
        .save()
        .rotate(-18, { origin: [doc.page.width / 2, doc.page.height / 2] })
        .fontSize(44)
        .fillColor("#d1d5db")
        .opacity(0.35)
        .text(pdfSafeText(String(duplicateLabel).slice(0, 40)), 0, doc.page.height / 2 - 40, {
          align: "center",
        })
        .opacity(1)
        .restore();
    }

    const leftX = doc.page.margins.left;
    const rightX = doc.page.width - doc.page.margins.right;
    const contentWidth = rightX - leftX;

    // Always 2-up A5 packing. Chunks of ≤10 Tally lines; ORIGINAL then OFFICE COPY.
    drawDualA5ReceiptCopies(doc, layoutCtx, {
      bodyOnly,
      signatoryName: signatoryName || null,
      logoPng,
      qrPng: bodyOnly ? null : qrPng,
      verifyUrl: bodyOnly ? null : verifyUrl,
      marginLeft: leftX,
      contentWidth,
      slipHeight: SLIP_HEIGHT,
      slipGap: SLIP_GAP,
      firstSlipY: FIRST_SLIP_Y,
      copyBadges: ["ORIGINAL", "OFFICE COPY"],
    });

    // Guard log for diagnostics (does not affect print).
    if (layoutCtx.rows.length > MAX_TALLY_LINES_PER_A5) {
      console.info(
        `[receipt-pdf] paginated ${layoutCtx.rows.length} particulars into A5 chunks of ≤${MAX_TALLY_LINES_PER_A5} (${receipt.receiptNo})`,
      );
    }

    doc.end();
  });

  return Buffer.concat(chunks);
}
