import { integerInrToWords } from "./inr-amount-words";
import { formatInrPdf } from "@shared/format-inr";

/** Receipt face date: DD-MM-YYYY (e.g. 21-05-2025) per GAPLMB sample. */
export function formatReceiptDateDmYyyy(isoLike: string | null | undefined): string {
  const raw = String(isoLike ?? "").trim();
  const d = raw.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    return `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}`;
  }
  const n = new Date();
  const dd = String(n.getDate()).padStart(2, "0");
  const mm = String(n.getMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${n.getFullYear()}`;
}

/** Words inside "A Sum Of ( INR … Only )" on statutory receipt. */
export function formatInrAmountWordsReceiptFace(amountInr: number): string {
  const rounded = Math.round(amountInr * 100) / 100;
  const paise = Math.round((rounded - Math.floor(rounded)) * 100);
  const rupees = Math.floor(rounded);
  let words = integerInrToWords(rupees);
  if (paise > 0) words += ` and ${integerInrToWords(paise)} Paise`;
  return words;
}

/** Table / total amount column (Indian grouping, no currency prefix). */
export function formatReceiptAmountCell(amountInr: number): string {
  const rounded = Math.round(amountInr * 100) / 100;
  const hasPaise = Math.abs(rounded - Math.floor(rounded)) > 0.001;
  return rounded.toLocaleString("en-IN", {
    minimumFractionDigits: hasPaise ? 2 : 2,
    maximumFractionDigits: 2,
  });
}

export function formatReceiptTotalLine(amountInr: number): string {
  return formatInrPdf(amountInr, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function mapReceiptPaymentModeLabel(mode: string | null | undefined): string {
  const m = String(mode ?? "").trim();
  if (m === "Cash") return "Cash";
  if (m === "Cheque" || m === "DD") return "Cheque/DD";
  if (m === "Online") return "RTGS/NEFT";
  return m || "—";
}

type ReceiptPaymentInstrument = {
  paymentMode: string | null | undefined;
  chequeNo?: string | null;
  chequeDate?: string | null;
  bankName?: string | null;
  gatewayRef?: string | null;
  createdAt?: string | null;
};

/** Statutory payment line on GAPLMB receipt face (Cash / Cheque-DD / RTGS-NEFT). */
export function formatReceiptPaymentDetailLine(receipt: ReceiptPaymentInstrument): string {
  const mode = String(receipt.paymentMode ?? "").trim();
  if (mode === "Cash") return "Cash";

  if (mode === "Cheque" || mode === "DD") {
    const instrument = mode === "DD" ? "DD" : "Cheque";
    const no = String(receipt.chequeNo ?? "").trim() || "—";
    const dt = formatReceiptDateDmYyyy(receipt.chequeDate ?? receipt.createdAt);
    const bank = String(receipt.bankName ?? "").trim() || "—";
    return `Cheque/DD Payment made vide ${instrument} No. ${no} dated ${dt} drawn on ${bank}`;
  }

  if (mode === "Online") {
    const utr = String(receipt.gatewayRef ?? "").trim() || "—";
    const dt = formatReceiptDateDmYyyy(receipt.createdAt);
    const bank = String(receipt.bankName ?? "").trim() || "—";
    return `Payment received through RTGS/NEFT vide UTR No. ${utr} dated ${dt} from ${bank}`;
  }

  return mapReceiptPaymentModeLabel(mode);
}

export type ReceiptPdfBranding = {
  boardName: string;
  hoAddressLine: string;
  placeLine: string;
  gstin: string;
};

export function getReceiptPdfBranding(yardAddress: string | null | undefined, yardName: string | null): ReceiptPdfBranding {
  const ho =
    process.env.RECEIPT_PDF_HO_ADDRESS?.trim() ||
    "HO Address : ARLEM , RAIA , SALCETE-GOA 403720 . Phone No: 0832-2741957/58";
  const place =
    process.env.RECEIPT_PDF_PLACE_LINE?.trim() ||
    (yardAddress?.trim() ? yardAddress.trim().toUpperCase() : "ARLEM, RAIA, SALCETE - GOA");
  const gstin = process.env.GSTIN?.trim() || "30AAALT1317M1Z6";
  const boardName =
    process.env.RECEIPT_PDF_BOARD_NAME?.trim() ||
    "THE GOA AGRICULTURAL PRODUCE AND LIVESTOCK MARKETING BOARD";
  return { boardName, hoAddressLine: ho, placeLine: place, gstin };
}

export function rentReceiptTitleForYard(yardCode: string | null | undefined, yardName: string | null): string {
  const override = process.env.RECEIPT_PDF_RENT_TITLE?.trim();
  if (override) return override;
  const name = String(yardName ?? "").trim();
  if (name) return `${name} - Rent Receipt`;
  const code = String(yardCode ?? "").trim();
  if (code) return `${code.toUpperCase()} - Rent Receipt`;
  return "Rent Receipt";
}

export function marketFeeReceiptTitleForYard(yardCode: string | null | undefined): string {
  const override = process.env.RECEIPT_PDF_MARKET_FEE_TITLE?.trim();
  if (override) return override;
  const code = String(yardCode ?? "").trim();
  return code ? `${code.toUpperCase()} - Market Fee Receipt` : "Market Fee Receipt";
}

/** Manual / miscellaneous IOMS receipts (non-rent, non-market-fee). */
export function otherReceiptTitleForYard(
  yardName: string | null | undefined,
  yardCode: string | null | undefined,
): string {
  const override = process.env.RECEIPT_PDF_OTHER_TITLE?.trim();
  if (override) return override;
  const name = String(yardName ?? "").trim();
  if (name) return `${name} - Other Receipts`;
  const code = String(yardCode ?? "").trim();
  if (code) return `${code.toUpperCase()} - Other Receipts`;
  return "Other Receipts";
}
