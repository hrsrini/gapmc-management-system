/**
 * M-03 rent / GST tax invoice PDF (GSAMB / Tally-style layout).
 */
import type { InferSelectModel } from "drizzle-orm";
import type PDFDocument from "pdfkit";
import type { rentInvoices } from "@shared/db-schema";
import { loadPdfDocumentConstructor } from "./pdfkit-loader";
import { buildRentInvoicePdfContext } from "./rent-invoice-pdf-context";
import { drawGsambRentTaxInvoice } from "./rent-invoice-pdf-layout";

type RentInvoiceRow = InferSelectModel<typeof rentInvoices>;
type PdfDoc = InstanceType<typeof PDFDocument>;

const PAGE_MARGIN = 18;

export type RentInvoicePdfInput = {
  invoice: RentInvoiceRow;
  yardName: string;
  yardCode?: string | null;
  yardAddress?: string | null;
  counterpartyName: string;
  counterpartyGstin?: string | null;
  assetCode: string;
  allotmentLabel: string;
  cgstPercent?: number | null;
  sgstPercent?: number | null;
};

export async function buildRentInvoicePdfA4(input: RentInvoicePdfInput): Promise<Buffer> {
  const ctx = buildRentInvoicePdfContext(input);
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
