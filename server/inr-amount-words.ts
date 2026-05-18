import { formatInrPdf } from "@shared/format-inr";

/** Whole-number Indian English words for INR amounts (pre-receipts, receipts). */

const ONES = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
];

const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function belowHundred(n: number): string {
  if (n < 20) return ONES[n] ?? "";
  const t = Math.floor(n / 10);
  const u = n % 10;
  const ten = TENS[t] ?? "";
  return u ? `${ten} ${ONES[u]}`.trim() : ten;
}

function belowThousand(n: number): string {
  if (n === 0) return "";
  if (n < 100) return belowHundred(n);
  const h = Math.floor(n / 100);
  const rest = n % 100;
  const head = `${ONES[h]} Hundred`;
  if (!rest) return head;
  return `${head} ${belowHundred(rest)}`.trim();
}

/** Integer 0 .. 99,99,99,999 → words (Indian grouping: Crore, Lakh, Thousand). */
export function integerInrToWords(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "Zero";
  const x = Math.floor(n);
  if (x === 0) return "Zero";
  let rem = x;
  const parts: string[] = [];
  if (rem >= 10000000) {
    parts.push(`${belowThousand(Math.floor(rem / 10000000))} Crore`.trim());
    rem %= 10000000;
  }
  if (rem >= 100000) {
    parts.push(`${belowThousand(Math.floor(rem / 100000))} Lakh`.trim());
    rem %= 100000;
  }
  if (rem >= 1000) {
    parts.push(`${belowThousand(Math.floor(rem / 1000))} Thousand`.trim());
    rem %= 1000;
  }
  if (rem > 0) parts.push(belowThousand(rem));
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/** "Rupees … Only" for rupees + optional paise. */
export function formatInrAmountWordsLine(amountInr: number): string {
  const paise = Math.round((amountInr - Math.floor(amountInr)) * 100);
  const rupees = Math.floor(amountInr);
  let core = `Rupees ${integerInrToWords(rupees)}`;
  if (paise > 0) {
    core += ` and ${integerInrToWords(paise)} Paise`;
  }
  return `${core} Only`;
}

/** Digits line for receipts/PDF (Indian grouping; Rs. prefix for PDF font safety). */
export function formatInrDigitsRs(amountInr: number): string {
  const rounded = Math.round(amountInr * 100) / 100;
  const hasPaise = Math.abs(rounded - Math.floor(rounded)) > 0.001;
  const digits = formatInrPdf(rounded, {
    minimumFractionDigits: hasPaise ? 2 : 0,
    maximumFractionDigits: 2,
  });
  return hasPaise ? `${digits}/-` : `${digits}/-`;
}
