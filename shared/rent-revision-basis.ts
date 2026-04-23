/** M-03 Sr.17: how the DO classifies a rent revision row (billing still uses `rent_amount` as INR/month until automated rules exist). */
export const RENT_REVISION_BASES = ["FixedMonthlyRent", "OtherDocumented"] as const;
export type RentRevisionBasis = (typeof RENT_REVISION_BASES)[number];

export const DEFAULT_RENT_REVISION_BASIS: RentRevisionBasis = "FixedMonthlyRent";

export function normalizeRentRevisionBasis(v: unknown): RentRevisionBasis {
  const s = String(v ?? "").trim();
  if (s === "OtherDocumented") return "OtherDocumented";
  return "FixedMonthlyRent";
}

/** Calendar month immediately before `YYYY-MM` (for “rent in force before revision starts”). */
export function yearMonthMinusOne(ym: string): string | null {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym ?? "").trim());
  if (!m) return null;
  let y = parseInt(m[1]!, 10);
  let mo = parseInt(m[2]!, 10) - 1;
  if (mo < 1) {
    y -= 1;
    mo = 12;
  }
  return `${y}-${String(mo).padStart(2, "0")}`;
}
