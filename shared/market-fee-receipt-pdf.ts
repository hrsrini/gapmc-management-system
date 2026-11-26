/**
 * Market Fee receipt PDF helpers (pagination + round-off face labels).
 * Spec: docs/Market_Fee_Reciept_correction/Receipt_Modification_Requirements_Market_Fee.pdf
 */
import {
  applyInvoiceNearestRupeeRounding,
  formatInvoiceRoundingOffAmount,
  roundInr2,
  type InvoiceRoundingResult,
} from "./invoice-rounding";

export const MARKET_FEE_MAX_COMMODITY_ROWS_PER_PAGE = 10;
/** Page 1 with amount-in-words + payment + totals-on-last can hold at most this many when multi-page. */
export const MARKET_FEE_PAGE1_MAX_WHEN_MULTIPAGE_SHORT = 9;
/** Single A5 half can hold this many commodity rows together with MF/Fine/RoundOff/Total footer. */
export const MARKET_FEE_SINGLE_PAGE_MAX_WITH_TOTALS = 4;
/** Last page (with Fine / Round Off / Total Amount Payable) — from spec 11–17 → 10+(1..7). */
export const MARKET_FEE_LAST_PAGE_MAX_WITH_TOTALS = 7;

export type MarketFeeCommodityPdfRow = {
  name: string;
  unit: string;
  quantity: number;
  ratePerUnit: number;
  commodityValue: number;
  marketFee: number;
};

export type MarketFeeReceiptPdfDetail = {
  vehicleNo: string | null;
  commodities: MarketFeeCommodityPdfRow[];
  totalCommodityValue: number;
  totalMarketFee: number;
  fineAmount: number;
  /** Unrounded MF + fine. */
  totalBeforeRounding: number;
  rounding: InvoiceRoundingResult;
};

/** Round Off face: "(+) Rs. 0.50" / "(-) Rs. 0.10". */
export function formatMarketFeeRoundOffLabel(roundingAmount: number): string {
  const a = roundInr2(roundingAmount);
  if (Math.abs(a) < 0.005) return "Rs. 0.00";
  const abs = Math.abs(a).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return a > 0 ? `(+) Rs. ${abs}` : `(-) Rs. ${abs}`;
}

/** Prefer signed +0.20 style when embedding in Amount column (compact). */
export function formatMarketFeeRoundOffAmountCell(roundingAmount: number): string {
  return formatInvoiceRoundingOffAmount(roundingAmount);
}

export function computeMarketFeeReceiptRounding(
  totalMarketFee: number,
  fineAmount: number,
): InvoiceRoundingResult {
  const before = roundInr2(roundInr2(totalMarketFee) + roundInr2(Math.max(0, fineAmount)));
  return applyInvoiceNearestRupeeRounding(before);
}

/**
 * Split commodity rows across A5 pages per spec §3.7.
 * Returns array of [start, end) index ranges into the commodities array.
 *
 * Rules:
 * - 1–4 → one page (all + totals)
 * - 5–10 → two pages: ≤9 on page 1, remainder on last (≥1)
 * - 11–17 → two pages: 10 + rest
 * - 18+ → 10 per middle page; last page always ≥1
 */
export function chunkMarketFeeCommodityPages(commodityCount: number): Array<{ start: number; end: number }> {
  const n = Math.max(0, Math.floor(commodityCount));
  if (n <= 0) return [{ start: 0, end: 0 }];
  if (n <= MARKET_FEE_SINGLE_PAGE_MAX_WITH_TOTALS) {
    return [{ start: 0, end: n }];
  }

  const max = MARKET_FEE_MAX_COMMODITY_ROWS_PER_PAGE;
  const lastMax = MARKET_FEE_LAST_PAGE_MAX_WITH_TOTALS;
  const pages: Array<{ start: number; end: number }> = [];

  if (n <= max) {
    // 5–10: up to 9 on page 1 so last page has ≥1 row + totals
    const first = Math.min(MARKET_FEE_PAGE1_MAX_WHEN_MULTIPAGE_SHORT, n - 1);
    pages.push({ start: 0, end: first });
    pages.push({ start: first, end: n });
    return pages;
  }

  // 11+: fill pages with ≤10 until remainder fits on last page (≤ lastMax), always ≥1 on last.
  let remaining = n;
  let offset = 0;
  while (remaining > lastMax) {
    const leaveAtLeastOne = remaining - 1;
    let take = Math.min(max, leaveAtLeastOne);
    if (remaining - take > lastMax) take = max;
    pages.push({ start: offset, end: offset + take });
    offset += take;
    remaining -= take;
  }
  pages.push({ start: offset, end: n });
  return pages;
}

export function buildMarketFeeReceiptDetailFromParts(args: {
  vehicleNo?: string | null;
  commodities: MarketFeeCommodityPdfRow[];
  fineAmount?: number | null;
}): MarketFeeReceiptPdfDetail {
  const commodities = (args.commodities ?? []).map((c) => ({
    name: String(c.name ?? "").trim() || "—",
    unit: String(c.unit ?? "").trim() || "—",
    quantity: Number(c.quantity) || 0,
    ratePerUnit: Number(c.ratePerUnit) || 0,
    commodityValue: roundInr2(Number(c.commodityValue) || 0),
    marketFee: roundInr2(Number(c.marketFee) || 0),
  }));
  const totalCommodityValue = roundInr2(commodities.reduce((s, r) => s + r.commodityValue, 0));
  const totalMarketFee = roundInr2(commodities.reduce((s, r) => s + r.marketFee, 0));
  const fineAmount = roundInr2(Math.max(0, Number(args.fineAmount ?? 0) || 0));
  const rounding = computeMarketFeeReceiptRounding(totalMarketFee, fineAmount);
  const vehicle = String(args.vehicleNo ?? "").trim();
  return {
    vehicleNo: vehicle || null,
    commodities,
    totalCommodityValue,
    totalMarketFee,
    fineAmount,
    totalBeforeRounding: rounding.originalAmount,
    rounding,
  };
}
