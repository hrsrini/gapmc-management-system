import { integerInrToWords } from "./inr-amount-words";
import { formatRentInvoiceNo } from "./rent-invoice-number";

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_LONG_UPPER = [
  "JANUARY",
  "FEBRUARY",
  "MARCH",
  "APRIL",
  "MAY",
  "JUNE",
  "JULY",
  "AUGUST",
  "SEPTEMBER",
  "OCTOBER",
  "NOVEMBER",
  "DECEMBER",
];

/** Tax invoice date: 30-Apr-25 (Tally / GSAMB sample). */
export function formatTaxInvoiceDate(isoLike: string | null | undefined): string {
  const d = String(isoLike ?? "").trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    const idx = Number(d.slice(5, 7)) - 1;
    const mon = idx >= 0 && idx < 12 ? MONTH_SHORT[idx] : d.slice(5, 7);
    return `${d.slice(8, 10)}-${mon}-${d.slice(2, 4)}`;
  }
  const n = new Date();
  return `${String(n.getDate()).padStart(2, "0")}-${MONTH_SHORT[n.getMonth()]}-${String(n.getFullYear()).slice(2)}`;
}

/** Amount column in particulars / tax tables (Indian grouping, 2 decimals). */
export function formatTaxInvoiceAmountCell(amountInr: number): string {
  const rounded = Math.round(amountInr * 100) / 100;
  return rounded.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Chargeable total in words: INR Eight Thousand … Only */
export function formatTaxInvoiceChargeableWords(amountInr: number): string {
  const rounded = Math.round(amountInr * 100) / 100;
  const rupees = Math.floor(rounded);
  const paise = Math.round((rounded - rupees) * 100);
  if (paise > 0) {
    return `INR ${integerInrToWords(rupees)} and ${integerInrToWords(paise)} paise Only`;
  }
  return `INR ${integerInrToWords(rupees)} Only`;
}

/** Tax summary words (may include paise). */
export function formatTaxInvoiceTaxWords(amountInr: number): string {
  return formatTaxInvoiceChargeableWords(amountInr);
}

export function formatRentInvoiceRemarksMonth(periodMonth: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(String(periodMonth ?? "").trim().slice(0, 7));
  if (!m) return String(periodMonth ?? "").toUpperCase();
  const idx = Number(m[2]) - 1;
  const mon = idx >= 0 && idx < 12 ? MONTH_LONG_UPPER[idx] : m[2];
  return `${mon} ${m[1]}`;
}

export function lastDayOfPeriodMonthYmd(periodMonth: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(String(periodMonth ?? "").trim().slice(0, 7));
  if (!m) return new Date().toISOString().slice(0, 10);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const last = new Date(y, mo, 0);
  const dd = String(last.getDate()).padStart(2, "0");
  const mm = String(last.getMonth() + 1).padStart(2, "0");
  return `${y}-${mm}-${dd}`;
}

/** Letterhead line above "Tax Invoice" (static per GAPLMB sample). */
export function rentInvoicePdfBoardBanner(): string {
  return (
    process.env.RENT_INVOICE_PDF_BOARD_BANNER?.trim() ||
    "Goa State Agricultural Produce and Livestock Marketing Board - GST"
  );
}

/** Footer signatory line (static "For GAPLMB GST", not yard code). */
export function rentInvoicePdfSignatoryLine(): string {
  const raw = process.env.RENT_INVOICE_PDF_SIGNATORY_FOR?.trim();
  if (raw) return raw.startsWith("For ") || raw.startsWith("for ") ? raw : `For ${raw}`;
  return "For GAPLMB GST";
}

/** Party GSTIN line on tax invoice (hyphen when absent). */
export function formatTaxInvoicePartyGstinLine(gstin: string | null | undefined): string {
  const t = String(gstin ?? "").trim();
  return t ? `GSTIN/UIN : ${t}` : "GSTIN/UIN : -";
}

/**
 * PDF display for stored invoice numbers — converts legacy M03/{yard}/{YYYY-MM}/{seq} to Jan/2026/YARD/011.
 */
export function formatRentInvoiceNoForPdfDisplay(
  invoiceNo: string | null | undefined,
  periodMonth?: string | null,
  yardCode?: string | null,
): string {
  const raw = String(invoiceNo ?? "").trim();
  if (!raw) return "";
  const legacy = /^M03\/([^/]+)\/(\d{4})-(\d{2})\/(\d+)$/i.exec(raw);
  if (legacy) {
    const [, yc, year, mo, seq] = legacy;
    const idx = Number(mo) - 1;
    const mon = idx >= 0 && idx < 12 ? MONTH_SHORT[idx] : mo;
    const seqNum = Number(seq);
    const padded = Number.isFinite(seqNum) ? String(seqNum).padStart(3, "0") : seq;
    return `${mon}/${year}/${yc}/${padded}`;
  }
  if (/^[A-Za-z]{3}\/\d{4}\//.test(raw)) return raw;
  if (periodMonth && yardCode) {
    const seqTail = raw.split("/").pop();
    if (seqTail && /^\d+$/.test(seqTail)) {
      return formatRentInvoiceNo(yardCode, periodMonth, Number(seqTail));
    }
  }
  return raw;
}

export function inferGstRatePercent(taxAmount: number, taxableRent: number): number {
  const rent = Number(taxableRent);
  const tax = Number(taxAmount);
  if (!Number.isFinite(rent) || rent <= 0 || !Number.isFinite(tax) || tax <= 0) return 0;
  return Math.round((tax / rent) * 10000) / 100;
}
