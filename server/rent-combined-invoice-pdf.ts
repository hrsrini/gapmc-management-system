/**
 * Combined M-03 rent tax invoice PDF (multiple premises).
 */
import type { InferSelectModel } from "drizzle-orm";
import type PDFDocument from "pdfkit";
import type { rentCombinedInvoices, rentInvoices } from "@shared/db-schema";
import { loadPdfDocumentConstructor } from "./pdfkit-loader";
import {
  buildCombinedRentInvoicePdfContext,
  type CombinedRentInvoicePdfContext,
} from "./rent-combined-invoice-pdf-context";
import { drawGsambRentTaxInvoice } from "./rent-invoice-pdf-layout";
import type { RentInvoicePdfContext } from "./rent-invoice-pdf-context";
import { inferGstRatePercent } from "./rent-invoice-pdf-shared";

type BundleRow = InferSelectModel<typeof rentCombinedInvoices>;
type InvoiceRow = InferSelectModel<typeof rentInvoices>;
type PdfDoc = InstanceType<typeof PDFDocument>;

const PAGE_MARGIN = 18;

export type CombinedRentInvoicePdfInput = {
  bundle: BundleRow;
  children: Array<{
    invoice: InvoiceRow;
    assetCode: string;
    allotmentLabel: string;
  }>;
  yardName: string;
  yardCode?: string | null;
  yardAddress?: string | null;
  counterpartyName: string;
  counterpartyGstin?: string | null;
  cgstPercent?: number | null;
  sgstPercent?: number | null;
};

function toSinglePageContext(combined: CombinedRentInvoicePdfContext): RentInvoicePdfContext {
  const lines = combined.premisesSections.flatMap((s) => s.lines);
  const rent = combined.taxableValue;
  const cgstRate =
    combined.cgstAmount > 0 && rent > 0
      ? inferGstRatePercent(combined.cgstAmount, rent)
      : 0;
  const sgstRate =
    combined.sgstAmount > 0 && rent > 0
      ? inferGstRatePercent(combined.sgstAmount, rent)
      : 0;
  const hsnSac = process.env.RENT_INVOICE_PDF_HSN_SAC?.trim() || "997213";
  let remarks = combined.remarks;
  if (combined.totalTdsAmount > 0) {
    remarks += ` Total TDS (per premises): Rs. ${combined.totalTdsAmount.toFixed(2)}.`;
  }
  return {
    boardBanner: combined.boardBanner,
    sellerTitle: combined.sellerTitle,
    sellerAddress: combined.sellerAddress,
    gstin: combined.gstin,
    stateName: combined.stateName,
    stateCode: combined.stateCode,
    pan: combined.pan,
    invoiceNo: combined.invoiceNo,
    invoiceDate: combined.invoiceDate,
    consigneeName: combined.consigneeName,
    buyerName: combined.buyerName,
    buyerAddress: combined.buyerAddress,
    buyerGstinLine: combined.buyerGstinLine,
    destination: combined.destination,
    dispatchDocNo: combined.invoiceNo,
    particularsTitle: "Combined Rent Receipts",
    hsnSac,
    lines,
    taxableValue: combined.taxableValue,
    cgstRate,
    cgstAmount: combined.cgstAmount,
    sgstRate,
    sgstAmount: combined.sgstAmount,
    totalTaxAmount: combined.totalTaxAmount,
    grandTotal: combined.grandTotal,
    roundOff: 0,
    chargeableWords: combined.chargeableWords,
    taxWords: combined.taxWords,
    remarks,
    signatoryFor: combined.signatoryFor,
    isGstExempt: combined.isGstExempt,
  };
}

export async function buildCombinedRentInvoicePdfA4(input: CombinedRentInvoicePdfInput): Promise<Buffer> {
  const combinedCtx = buildCombinedRentInvoicePdfContext(input);
  const ctx = toSinglePageContext(combinedCtx);
  const PDFDocument = await loadPdfDocumentConstructor();

  const doc = new PDFDocument({ margin: PAGE_MARGIN, size: "A4" });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));

  await new Promise<void>((resolve, reject) => {
    doc.on("end", () => resolve());
    doc.on("error", reject);
    drawGsambRentTaxInvoice(doc as PdfDoc, ctx, PAGE_MARGIN);
    doc.end();
  });

  return Buffer.concat(chunks);
}
