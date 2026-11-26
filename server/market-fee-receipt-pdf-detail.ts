/**
 * Load Market Fee receipt PDF source detail from M-04 wizard / purchase / checkpost inward.
 */
import { asc, eq, inArray } from "drizzle-orm";
import {
  checkPostInward,
  checkPostInwardCommodities,
  commodities,
  marketTransactionCommodities,
  marketTransactions,
  purchaseTransactions,
} from "@shared/db-schema";
import {
  buildMarketFeeReceiptDetailFromParts,
  type MarketFeeCommodityPdfRow,
  type MarketFeeReceiptPdfDetail,
} from "@shared/market-fee-receipt-pdf";
import { roundInr2 } from "@shared/invoice-rounding";
import { db } from "./db";

async function commodityNameMap(ids: string[]): Promise<Record<string, string>> {
  const uniq = [...new Set(ids.map((x) => String(x).trim()).filter(Boolean))];
  if (uniq.length === 0) return {};
  const all = await db
    .select({ id: commodities.id, name: commodities.name })
    .from(commodities)
    .where(inArray(commodities.id, uniq));
  const map: Record<string, string> = {};
  for (const r of all) map[r.id] = String(r.name ?? "").trim() || r.id;
  return map;
}

async function loadFromMarketTransaction(txId: string): Promise<MarketFeeReceiptPdfDetail | null> {
  const [tx] = await db.select().from(marketTransactions).where(eq(marketTransactions.id, txId)).limit(1);
  if (!tx) return null;
  const lines = await db
    .select()
    .from(marketTransactionCommodities)
    .where(eq(marketTransactionCommodities.transactionId, txId))
    .orderBy(asc(marketTransactionCommodities.sortOrder));
  const names = await commodityNameMap(lines.map((l) => l.commodityId));
  const commoditiesRows: MarketFeeCommodityPdfRow[] = lines.map((l) => ({
    name: names[l.commodityId] ?? l.commodityId,
    unit: String(l.unit ?? ""),
    quantity: Number(l.quantity) || 0,
    ratePerUnit: Number(l.ratePerUnit) || 0,
    commodityValue: Number(l.commodityValue) || 0,
    marketFee: Number(l.marketFeeAmount) || 0,
  }));
  // Prefer stored totals when lines empty but fee exists
  if (commoditiesRows.length === 0 && Number(tx.totalMarketFee) > 0) {
    commoditiesRows.push({
      name: "Market fee",
      unit: "—",
      quantity: 0,
      ratePerUnit: 0,
      commodityValue: Number(tx.totalCommodityValue) || 0,
      marketFee: Number(tx.totalMarketFee) || 0,
    });
  }
  return buildMarketFeeReceiptDetailFromParts({
    vehicleNo: tx.vehicleNumber,
    commodities: commoditiesRows,
    fineAmount: Number(tx.fineAmount) || 0,
  });
}

async function loadFromPurchase(purchaseId: string): Promise<MarketFeeReceiptPdfDetail | null> {
  const [p] = await db.select().from(purchaseTransactions).where(eq(purchaseTransactions.id, purchaseId)).limit(1);
  if (!p) return null;
  const names = await commodityNameMap([p.commodityId]);
  const qty = Number(p.quantity) || 0;
  const value = Number(p.declaredValue) || 0;
  const rate =
    p.ratePerUnit != null && Number.isFinite(Number(p.ratePerUnit))
      ? Number(p.ratePerUnit)
      : qty > 0
        ? roundInr2(value / qty)
        : 0;
  return buildMarketFeeReceiptDetailFromParts({
    vehicleNo: null,
    commodities: [
      {
        name: names[p.commodityId] ?? p.commodityId,
        unit: String(p.unit ?? ""),
        quantity: qty,
        ratePerUnit: rate,
        commodityValue: value,
        marketFee: Number(p.marketFeeAmount) || 0,
      },
    ],
    fineAmount: 0,
  });
}

async function loadFromCheckPostInward(inwardId: string): Promise<MarketFeeReceiptPdfDetail | null> {
  const [row] = await db.select().from(checkPostInward).where(eq(checkPostInward.id, inwardId)).limit(1);
  if (!row) return null;
  const lines = await db
    .select()
    .from(checkPostInwardCommodities)
    .where(eq(checkPostInwardCommodities.inwardId, inwardId));
  const names = await commodityNameMap(lines.map((l) => l.commodityId));
  const commoditiesRows: MarketFeeCommodityPdfRow[] = lines.map((l) => {
    const value = Number(l.value) || 0;
    const qty = Number(l.quantity) || 0;
    const fee = Number(l.marketFeeAmount) || 0;
    const rate = qty > 0 ? roundInr2(value / qty) : 0;
    return {
      name: names[l.commodityId] ?? l.commodityId,
      unit: String(l.unit ?? ""),
      quantity: qty,
      ratePerUnit: rate,
      commodityValue: value,
      marketFee: fee,
    };
  });
  if (commoditiesRows.length === 0 && Number(row.totalCharges) > 0) {
    commoditiesRows.push({
      name: "Market fee",
      unit: "—",
      quantity: 0,
      ratePerUnit: 0,
      commodityValue: 0,
      marketFee: Number(row.totalCharges) || 0,
    });
  }
  return buildMarketFeeReceiptDetailFromParts({
    vehicleNo: row.vehicleNumber,
    commodities: commoditiesRows,
    fineAmount: 0,
  });
}

/**
 * Resolve Market Fee PDF breakdown for an IOMS receipt.
 * Wizard txns are preferred when receiptId is linked on market_transactions.
 */
export async function loadMarketFeeReceiptPdfDetail(receipt: {
  id: string;
  revenueHead?: string | null;
  sourceModule?: string | null;
  sourceRecordId?: string | null;
  amount?: number | null;
  totalAmount?: number | null;
}): Promise<MarketFeeReceiptPdfDetail | null> {
  if (String(receipt.revenueHead ?? "").trim() !== "MarketFee") return null;

  // Prefer txn linked by receiptId (wizard may finalize before sourceRecordId is set consistently)
  const [byReceipt] = await db
    .select({ id: marketTransactions.id })
    .from(marketTransactions)
    .where(eq(marketTransactions.receiptId, receipt.id))
    .limit(1);
  if (byReceipt?.id) {
    const d = await loadFromMarketTransaction(byReceipt.id);
    if (d) return d;
  }

  const sourceId = String(receipt.sourceRecordId ?? "").trim();
  const mod = String(receipt.sourceModule ?? "").trim();
  if (sourceId) {
    if (mod === "M-04" || mod.startsWith("M-04")) {
      const fromTx = await loadFromMarketTransaction(sourceId);
      if (fromTx) return fromTx;
      const fromPurchase = await loadFromPurchase(sourceId);
      if (fromPurchase) return fromPurchase;
      const fromInward = await loadFromCheckPostInward(sourceId);
      if (fromInward) return fromInward;
    }
  }

  // Fallback: single line from receipt amount (no grid detail)
  const amt = roundInr2(Number(receipt.amount ?? receipt.totalAmount ?? 0));
  if (amt <= 0) return null;
  return buildMarketFeeReceiptDetailFromParts({
    vehicleNo: null,
    commodities: [
      {
        name: "Market fee",
        unit: "—",
        quantity: 0,
        ratePerUnit: 0,
        commodityValue: 0,
        marketFee: amt,
      },
    ],
    fineAmount: 0,
  });
}
