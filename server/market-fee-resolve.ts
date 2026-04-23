/**
 * M-04: resolve market fee % from commodity + effective date + optional yard-specific matrix row.
 */
import { and, desc, eq, gte, isNull, lte } from "drizzle-orm";
import { db } from "./db";
import { marketFeeRates } from "@shared/db-schema";
import { getMergedSystemConfig, parseSystemConfigNumber } from "./system-config";

export type MarketFeeResolveSource = "matrix_yard" | "matrix_global" | "system_default";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function assertIsoTransactionDate(transactionDate: string): string {
  const td = String(transactionDate ?? "").trim();
  if (!ISO_DATE_RE.test(td)) {
    throw new Error("INVALID_TRANSACTION_DATE");
  }
  return td;
}

export async function resolveMarketFeePercentForPurchase(opts: {
  yardId: string;
  commodityId: string;
  transactionDate: string;
}): Promise<{ feePercent: number; source: MarketFeeResolveSource; rateId: string | null }> {
  const yardId = String(opts.yardId ?? "").trim();
  const commodityId = String(opts.commodityId ?? "").trim();
  const td = assertIsoTransactionDate(opts.transactionDate);

  const [yardRow] = await db
    .select()
    .from(marketFeeRates)
    .where(
      and(
        eq(marketFeeRates.commodityId, commodityId),
        eq(marketFeeRates.yardId, yardId),
        lte(marketFeeRates.validFrom, td),
        gte(marketFeeRates.validTo, td),
      ),
    )
    .orderBy(desc(marketFeeRates.validFrom))
    .limit(1);

  if (yardRow) {
    const pct = Number(yardRow.feePercent ?? 0);
    return { feePercent: Number.isFinite(pct) ? pct : 0, source: "matrix_yard", rateId: yardRow.id };
  }

  const [globalRow] = await db
    .select()
    .from(marketFeeRates)
    .where(
      and(
        eq(marketFeeRates.commodityId, commodityId),
        isNull(marketFeeRates.yardId),
        lte(marketFeeRates.validFrom, td),
        gte(marketFeeRates.validTo, td),
      ),
    )
    .orderBy(desc(marketFeeRates.validFrom))
    .limit(1);

  if (globalRow) {
    const pct = Number(globalRow.feePercent ?? 0);
    return { feePercent: Number.isFinite(pct) ? pct : 0, source: "matrix_global", rateId: globalRow.id };
  }

  const cfg = await getMergedSystemConfig();
  const fallback = parseSystemConfigNumber(cfg, "market_fee_percent");
  return { feePercent: fallback, source: "system_default", rateId: null };
}

/** Allow tiny float drift between client preview and server rounding. */
export function marketFeePercentMatchesResolved(clientPercent: number, resolved: number, epsilon = 0.005): boolean {
  return Math.abs(Number(clientPercent) - Number(resolved)) <= epsilon;
}
