import type { InferSelectModel } from "drizzle-orm";
import type { rentInvoices } from "@shared/db-schema";
import { buildRentInvoiceBillingBreakdown } from "@shared/rent-invoice-billing-display";
import { getReceiptPdfBranding } from "./receipt-pdf-shared";
import {
  formatRentInvoiceRemarksMonth,
  formatTaxInvoiceChargeableWords,
  formatTaxInvoiceDate,
  formatTaxInvoiceTaxWords,
  inferGstRatePercent,
  lastDayOfPeriodMonthYmd,
} from "./rent-invoice-pdf-shared";

type RentInvoiceRow = InferSelectModel<typeof rentInvoices>;

export type RentInvoicePdfLine = {
  label: string;
  amount: number;
  hsnSac?: string;
  rateLabel?: string;
  perLabel?: string;
  indent?: boolean;
};

export type RentInvoicePdfContext = {
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
  destination: string;
  dispatchDocNo: string;
  particularsTitle: string;
  hsnSac: string;
  lines: RentInvoicePdfLine[];
  taxableValue: number;
  cgstRate: number;
  cgstAmount: number;
  sgstRate: number;
  sgstAmount: number;
  totalTaxAmount: number;
  grandTotal: number;
  roundOff: number;
  chargeableWords: string;
  taxWords: string;
  remarks: string;
  signatoryFor: string;
  isGstExempt: boolean;
};

export type BuildRentInvoicePdfContextInput = {
  invoice: RentInvoiceRow;
  yardName: string;
  yardCode?: string | null;
  yardAddress?: string | null;
  counterpartyName: string;
  assetCode: string;
  allotmentLabel: string;
  cgstPercent?: number | null;
  sgstPercent?: number | null;
};

function parseNonGstCharges(json: string | null | undefined): Array<{ label: string; amount: number }> {
  if (!json?.trim()) return [];
  try {
    const arr = JSON.parse(json) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr
      .map((row) => {
        const o = row as { label?: string; amount?: number };
        const amount = Number(o.amount);
        if (!Number.isFinite(amount) || amount <= 0) return null;
        return { label: String(o.label ?? "Charge").trim() || "Charge", amount };
      })
      .filter((x): x is { label: string; amount: number } => x != null);
  } catch {
    return [];
  }
}

export function buildRentInvoicePdfContext(input: BuildRentInvoicePdfContextInput): RentInvoicePdfContext {
  const { invoice, yardName, yardCode, yardAddress, counterpartyName, assetCode, allotmentLabel } = input;
  const breakdown = buildRentInvoiceBillingBreakdown(invoice);
  const branding = getReceiptPdfBranding(yardAddress, yardName);

  const hsnSac = process.env.RENT_INVOICE_PDF_HSN_SAC?.trim() || "997213";
  const stateName = process.env.RENT_INVOICE_PDF_STATE_NAME?.trim() || "Goa";
  const stateCode = process.env.RENT_INVOICE_PDF_STATE_CODE?.trim() || "30";
  const pan = process.env.RENT_INVOICE_PDF_PAN?.trim() || "AAALT1317M";

  const sellerTitle =
    process.env.RENT_INVOICE_PDF_SELLER_TITLE?.trim() ||
    (yardCode?.trim() ? `${yardCode.trim().toUpperCase()} GST` : yardName.toUpperCase());
  const sellerAddress =
    process.env.RENT_INVOICE_PDF_SELLER_ADDRESS?.trim() ||
    yardAddress?.trim() ||
    `${yardName.toUpperCase()}, ${branding.placeLine.toUpperCase()}`;

  const destination = yardName.toUpperCase();
  const buyerAddressParts = [
    counterpartyName !== allotmentLabel ? allotmentLabel : null,
    assetCode?.trim() || null,
    yardName.trim() || null,
  ].filter((p): p is string => Boolean(p?.trim()));
  const buyerAddress =
    process.env.RENT_INVOICE_PDF_BUYER_ADDRESS?.trim() ||
    (buyerAddressParts.length > 0 ? buyerAddressParts.join(", ") : yardName);

  const invoiceDateIso =
    invoice.approvedAt?.trim() ||
    invoice.generatedAt?.trim() ||
    lastDayOfPeriodMonthYmd(invoice.periodMonth);
  const invoiceDate = formatTaxInvoiceDate(invoiceDateIso);

  const rent = Number(invoice.rentAmount ?? 0);
  const cgst = Number(invoice.cgst ?? 0);
  const sgst = Number(invoice.sgst ?? 0);
  const total = Number(invoice.totalAmount ?? 0);
  const isGstExempt = Boolean(invoice.isGovtEntity);

  const cgstRate =
    input.cgstPercent != null && Number.isFinite(Number(input.cgstPercent))
      ? Number(input.cgstPercent)
      : inferGstRatePercent(cgst, rent);
  const sgstRate =
    input.sgstPercent != null && Number.isFinite(Number(input.sgstPercent))
      ? Number(input.sgstPercent)
      : inferGstRatePercent(sgst, rent);

  const nonGst = parseNonGstCharges(invoice.nonGstChargesJson);
  const nonGstSum = nonGst.reduce((s, c) => s + c.amount, 0);
  const computed = Math.round((rent + nonGstSum + cgst + sgst) * 100) / 100;
  let roundOff = Math.round((total - computed) * 100) / 100;
  if (Math.abs(roundOff) < 0.005) roundOff = 0;

  const particularsTitle =
    process.env.RENT_INVOICE_PDF_PARTICULARS?.trim() ||
    (breakdown.billingType === "Overstay" ? "Overstay / Fine Rent" : "Rent Receipts");

  const lines: RentInvoicePdfLine[] = [
    { label: particularsTitle, amount: rent, hsnSac, rateLabel: "", perLabel: "" },
  ];
  for (const c of nonGst) {
    lines.push({ label: c.label, amount: c.amount, indent: true });
  }
  if (!isGstExempt && cgst > 0) {
    lines.push({
      label: `CGST ${cgstRate % 1 === 0 ? cgstRate : cgstRate.toFixed(2)}%`,
      amount: cgst,
      rateLabel: `${cgstRate % 1 === 0 ? cgstRate : cgstRate.toFixed(2)} %`,
      perLabel: "%",
      indent: true,
    });
  }
  if (!isGstExempt && sgst > 0) {
    lines.push({
      label: `SGST ${sgstRate % 1 === 0 ? sgstRate : sgstRate.toFixed(2)}%`,
      amount: sgst,
      rateLabel: `${sgstRate % 1 === 0 ? sgstRate : sgstRate.toFixed(2)} %`,
      perLabel: "%",
      indent: true,
    });
  }
  if (roundOff !== 0) {
    lines.push({ label: "R. Off", amount: roundOff, indent: true });
  }

  const fy = invoice.periodMonth?.slice(0, 4);
  const dispatchDocNo =
    process.env.RENT_INVOICE_PDF_DISPATCH_PREFIX?.trim() ||
    [yardCode?.trim() || "YRD", assetCode, fy].filter(Boolean).join("/");

  const remarksMonth = formatRentInvoiceRemarksMonth(invoice.periodMonth);
  const remarks =
    process.env.RENT_INVOICE_PDF_REMARKS?.trim() ||
    `RENT FOR THE MONTH OF ${remarksMonth}.`;

  const totalTax = Math.round((cgst + sgst) * 100) / 100;

  return {
    sellerTitle,
    sellerAddress,
    gstin: branding.gstin,
    stateName,
    stateCode,
    pan,
    invoiceNo: String(invoice.invoiceNo ?? invoice.id),
    invoiceDate,
    consigneeName: counterpartyName,
    buyerName: counterpartyName,
    buyerAddress,
    destination,
    dispatchDocNo,
    particularsTitle,
    hsnSac,
    lines,
    taxableValue: rent,
    cgstRate,
    cgstAmount: cgst,
    sgstRate,
    sgstAmount: sgst,
    totalTaxAmount: totalTax,
    grandTotal: total,
    roundOff,
    chargeableWords: formatTaxInvoiceChargeableWords(total),
    taxWords: formatTaxInvoiceTaxWords(totalTax),
    remarks,
    signatoryFor: sellerTitle,
    isGstExempt,
  };
}
