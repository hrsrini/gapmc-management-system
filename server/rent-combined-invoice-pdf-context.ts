/**
 * Combined M-03 rent tax invoice PDF context (multiple premises, TDS per premises).
 */
import type { InferSelectModel } from "drizzle-orm";
import type { rentCombinedInvoices, rentInvoices } from "@shared/db-schema";
import { buildRentInvoicePdfContext, type RentInvoicePdfLine } from "./rent-invoice-pdf-context";
import { getReceiptPdfBranding } from "./receipt-pdf-shared";
import {
  formatRentInvoiceRemarksMonth,
  formatTaxInvoiceChargeableWords,
  formatTaxInvoiceDate,
  formatTaxInvoicePartyGstinLine,
  formatTaxInvoiceTaxWords,
  rentInvoicePdfBoardBanner,
  rentInvoicePdfSignatoryLine,
} from "./rent-invoice-pdf-shared";

type BundleRow = InferSelectModel<typeof rentCombinedInvoices>;
type InvoiceRow = InferSelectModel<typeof rentInvoices>;

export type CombinedPremisesPdfSection = {
  assetCode: string;
  allotmentLabel: string;
  invoiceNo: string;
  rentAmount: number;
  cgst: number;
  sgst: number;
  tdsAmount: number;
  totalAmount: number;
  lines: RentInvoicePdfLine[];
};

export type CombinedRentInvoicePdfContext = {
  boardBanner: string;
  sellerTitle: string;
  sellerAddress: string;
  gstin: string;
  stateName: string;
  stateCode: string;
  pan: string;
  invoiceNo: string;
  invoiceDate: string;
  consigneeName: string;
  buyerName: string;
  buyerAddress: string;
  buyerGstinLine: string;
  destination: string;
  remarks: string;
  signatoryFor: string;
  premisesSections: CombinedPremisesPdfSection[];
  taxableValue: number;
  cgstAmount: number;
  sgstAmount: number;
  totalTdsAmount: number;
  totalTaxAmount: number;
  grandTotal: number;
  chargeableWords: string;
  taxWords: string;
  isGstExempt: boolean;
};

export type BuildCombinedRentInvoicePdfInput = {
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

export function buildCombinedRentInvoicePdfContext(input: BuildCombinedRentInvoicePdfInput): CombinedRentInvoicePdfContext {
  const { bundle, yardName, yardCode, yardAddress, counterpartyName } = input;
  const branding = getReceiptPdfBranding(yardAddress, yardName);

  const stateName = process.env.RENT_INVOICE_PDF_STATE_NAME?.trim() || "Goa";
  const stateCode = process.env.RENT_INVOICE_PDF_STATE_CODE?.trim() || "30";
  const pan = process.env.RENT_INVOICE_PDF_PAN?.trim() || "AAALT1317M";
  const boardBanner = rentInvoicePdfBoardBanner();
  const sellerTitle = process.env.RENT_INVOICE_PDF_SELLER_TITLE?.trim() || boardBanner;
  const sellerAddress =
    process.env.RENT_INVOICE_PDF_SELLER_ADDRESS?.trim() ||
    branding.hoAddressLine.replace(/^HO Address\s*:\s*/i, "").trim().toUpperCase();
  const destination = yardName.toUpperCase();
  const buyerAddress =
    process.env.RENT_INVOICE_PDF_SHIP_TO_LOCATION?.trim() ||
    process.env.RENT_INVOICE_PDF_BUYER_ADDRESS?.trim() ||
    destination;

  const premisesSections: CombinedPremisesPdfSection[] = [];
  let serial = 1;
  let taxableValue = 0;
  let cgstAmount = 0;
  let sgstAmount = 0;
  let totalTdsAmount = 0;
  let grandTotal = 0;
  let isGstExempt = false;

  for (const child of input.children) {
    const singleCtx = buildRentInvoicePdfContext({
      invoice: child.invoice,
      yardName,
      yardCode,
      yardAddress,
      counterpartyName,
      counterpartyGstin: input.counterpartyGstin,
      assetCode: child.assetCode,
      allotmentLabel: child.allotmentLabel,
      cgstPercent: input.cgstPercent,
      sgstPercent: input.sgstPercent,
    });
    isGstExempt = isGstExempt || singleCtx.isGstExempt;
    const rent = Number(child.invoice.rentAmount ?? 0);
    const cgst = Number(child.invoice.cgst ?? 0);
    const sgst = Number(child.invoice.sgst ?? 0);
    const tds = Number(child.invoice.tdsAmount ?? 0);
    const total = Number(child.invoice.totalAmount ?? 0);

    taxableValue += rent;
    cgstAmount += cgst;
    sgstAmount += sgst;
    totalTdsAmount += tds;
    grandTotal += total;

    const headerLabel = `Premises ${child.assetCode} (${child.allotmentLabel})`;
    const lines: RentInvoicePdfLine[] = [
      { label: headerLabel, amount: 0, serialNo: serial },
      ...singleCtx.lines.map((ln) => ({ ...ln, serialNo: ln.serialNo != null ? serial + (ln.serialNo > 1 ? ln.serialNo - 1 : 0) : undefined })),
    ];
    if (tds > 0) {
      lines.push({ label: `TDS u/s 194-I (${child.assetCode})`, amount: tds, indent: true });
    }
    serial += 1;

    premisesSections.push({
      assetCode: child.assetCode,
      allotmentLabel: child.allotmentLabel,
      invoiceNo: String(child.invoice.invoiceNo ?? child.invoice.id),
      rentAmount: rent,
      cgst,
      sgst,
      tdsAmount: tds,
      totalAmount: total,
      lines,
    });
  }

  const remarksMonth = formatRentInvoiceRemarksMonth(bundle.periodMonth);
  const remarks =
    process.env.RENT_INVOICE_PDF_COMBINED_REMARKS?.trim() ||
    `COMBINED RENT TAX INVOICE FOR ${premisesSections.length} PREMISES — RENT FOR THE MONTH OF ${remarksMonth}. TDS COMPUTED PER PREMISES.`;

  const totalTax = Math.round((cgstAmount + sgstAmount) * 100) / 100;

  return {
    boardBanner,
    sellerTitle,
    sellerAddress,
    gstin: branding.gstin,
    stateName,
    stateCode,
    pan,
    invoiceNo: bundle.bundleInvoiceNo,
    invoiceDate: formatTaxInvoiceDate(bundle.invoiceDate),
    consigneeName: counterpartyName,
    buyerName: counterpartyName,
    buyerAddress,
    buyerGstinLine: formatTaxInvoicePartyGstinLine(input.counterpartyGstin),
    destination,
    remarks,
    signatoryFor: rentInvoicePdfSignatoryLine(),
    premisesSections,
    taxableValue: Math.round(taxableValue * 100) / 100,
    cgstAmount: Math.round(cgstAmount * 100) / 100,
    sgstAmount: Math.round(sgstAmount * 100) / 100,
    totalTdsAmount: Math.round(totalTdsAmount * 100) / 100,
    totalTaxAmount: totalTax,
    grandTotal: Math.round(grandTotal * 100) / 100,
    chargeableWords: formatTaxInvoiceChargeableWords(Math.round(grandTotal * 100) / 100),
    taxWords: formatTaxInvoiceTaxWords(totalTax),
    isGstExempt,
  };
}
