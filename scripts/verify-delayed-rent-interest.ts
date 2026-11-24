/**
 * Verifies GAPLMB delayed-rent interest examples from
 * Delayed_Rent_Interest_Formula_and_Rules (R=10150, Oct 2026, 15% p.a.).
 * Run: npx tsx scripts/verify-delayed-rent-interest.ts
 */
import {
  computeDelayedRentInterest,
  computeDelayedRentInterestMonthsN,
  normalizeRentPeriodMonth,
  rentInterestDueDateIso,
  todayIsoLocal,
} from "../server/rent-interest";
import { chunkParticularsForA5, MAX_TALLY_LINES_PER_A5 } from "../server/receipt-pdf-layout";
import { appendBranchWord, formatReceiptAmountCell } from "../server/receipt-pdf-shared";

const fails: string[] = [];
function check(cond: boolean, msg: string) {
  if (!cond) fails.push(msg);
}

check(normalizeRentPeriodMonth("2026-10") === "2026-10", "normalize ym");
check(normalizeRentPeriodMonth("2026-10-15") === "2026-10", "normalize ymd");
check(normalizeRentPeriodMonth("01-10-2026") === "2026-10", "normalize dmy");
check(rentInterestDueDateIso("2026-10") === "2026-11-10", "due date");
check(rentInterestDueDateIso("01-10-2026") === "2026-11-10", "due from dmy");
check(/^\d{4}-\d{2}-\d{2}$/.test(todayIsoLocal()), "today local");

const R = 10150;
const period = "2026-10";
const cases: Array<[string, number, number, number]> = [
  ["2026-11-10", 0, 0, 10150], // on due date — no interest
  ["2026-11-15", 0.5, 63, 10213],
  ["2026-11-20", 1, 127, 10277],
  ["2026-12-08", 1.5, 190, 10340],
  ["2026-12-25", 2, 254, 10404],
  ["2027-10-31", 12, 1523, 11673],
  ["2027-11-01", 12.5, 1586, 11736],
];

for (const [asOf, n, interest, total] of cases) {
  const gotN = computeDelayedRentInterestMonthsN(period, asOf);
  const r = computeDelayedRentInterest({
    rentAmount: R,
    periodMonth: period,
    asOfDateIso: asOf,
    percentPerAnnum: 15,
  });
  check(
    gotN === n && r.interestRounded === interest && r.totalPayable === total,
    `${asOf}: N=${gotN}/${n} I=${r.interestRounded}/${interest} T=${r.totalPayable}/${total}`,
  );
}

// Datetime as-of
check(
  computeDelayedRentInterestMonthsN(period, "2026-11-15T14:30:00.000Z") === 0.5,
  "datetime as-of",
);

// Receipt helpers
check(formatReceiptAmountCell(6490).includes("₹"), "rupee cell");
check(appendBranchWord("Bank of Maharashtra - Bicholim").toLowerCase().endsWith("branch"), "branch");
check(MAX_TALLY_LINES_PER_A5 === 10, "max tally 10");
const chunks = chunkParticularsForA5(
  Array.from({ length: 22 }, (_, i) => ({ sn: i + 1, label: `H${i + 1}`, amount: 1000 })),
);
check(chunks.length === 3 && chunks.map((c) => c.length).join(",") === "10,10,2", "chunk 22");

if (fails.length) {
  console.error("FAIL:\n" + fails.map((f) => ` - ${f}`).join("\n"));
  process.exit(1);
}
console.log("OK verify-delayed-rent-interest + receipt helpers");
