/**
 * Verify Market Fee receipt PDF helpers (chunking + nearest-rupee round-off).
 * Run: npx tsx scripts/verify-market-fee-receipt-pdf.ts
 */
import { applyInvoiceNearestRupeeRounding } from "../shared/invoice-rounding";
import {
  chunkMarketFeeCommodityPages,
  computeMarketFeeReceiptRounding,
  formatMarketFeeRoundOffLabel,
} from "../shared/market-fee-receipt-pdf";
import { computeMarketTransactionTotals } from "../shared/market-transaction-cases";

const fails: string[] = [];
function check(cond: boolean, msg: string) {
  if (!cond) fails.push(msg);
}

function sizes(n: number): string {
  return chunkMarketFeeCommodityPages(n)
    .map((r) => r.end - r.start)
    .join(",");
}

check(sizes(1) === "1", "1 row → 1 page");
check(sizes(4) === "4", "4 rows → 1 page");
check(sizes(5) === "4,1", "5 → 4+1");
check(sizes(10) === "9,1", "10 → 9+1");
check(sizes(12) === "10,2", "12 → 10+2");
check(sizes(17) === "10,7", "17 → 10+7");
check(sizes(18) === "10,7,1", "18 → 10+7+1");
check(sizes(22) === "10,10,2", "22 → 10+10+2");

const cases: Array<[number, number, number, string, number]> = [
  // mf, fine, before, roundLabel, payable
  [3000, 200, 3200, "whole", 3200],
  [3164.5, 200, 3364.5, "(+) Rs. 0.50", 3365],
  [3163.1, 200, 3363.1, "(-) Rs. 0.10", 3363],
  [11204.7, 200, 11404.7, "(+) Rs. 0.30", 11405],
  [3164.49, 200, 3364.49, "(-) Rs. 0.49", 3364],
];

for (const [mf, fine, before, label, payable] of cases) {
  const r = computeMarketFeeReceiptRounding(mf, fine);
  check(Math.abs(r.originalAmount - before) < 0.001, `before ${before}: got ${r.originalAmount}`);
  check(r.finalAmount === payable, `payable ${before} → ${payable}: got ${r.finalAmount}`);
  if (label === "whole") {
    check(r.roundingType === "NoRounding", `no round for ${before}`);
  } else {
    check(formatMarketFeeRoundOffLabel(r.roundingAmount) === label, `label ${before}: ${formatMarketFeeRoundOffLabel(r.roundingAmount)} vs ${label}`);
  }
}

check(applyInvoiceNearestRupeeRounding(3364.5).finalAmount === 3365, "half-up 3364.50");

const calc = computeMarketTransactionTotals(
  "C",
  [
    {
      commodityId: "x",
      quantity: 1,
      unit: "Kg",
      ratePerUnit: 3164.5,
      commodityValue: 3164.5,
      marketFeePercent: 0,
      marketFeeAmount: 3164.5,
    },
  ],
  { fineAmount: 200, collectFine: true },
);
check(calc.totalPayable === 3365, `wizard totals round: ${calc.totalPayable}`);

if (fails.length) {
  console.error("FAIL:\n" + fails.map((f) => ` - ${f}`).join("\n"));
  process.exit(1);
}
console.log("OK verify-market-fee-receipt-pdf");
