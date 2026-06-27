/**
 * Merge IOMS M-05 receipts (`ioms_receipts`) into the legacy `/api/receipts` shape for the "All Receipts" UI.
 */
import type { InferSelectModel } from "drizzle-orm";
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "./db";
import { iomsReceipts, manualReceiptTypes, yards } from "@shared/db-schema";
import type { Receipt } from "@shared/schema";
import { receiptRevenueHeadDisplayLabel } from "@shared/receipt-revenue-head-options";
import { attachCreatedByDisplayNames, type WithCreatedByDisplayName } from "./ioms-receipt-created-by-display";
import { attachPayerDisplayNames, type WithPayerDisplayName } from "./ioms-receipt-payer-display";

type IomsReceiptRow = InferSelectModel<typeof iomsReceipts>;
type IomsReceiptEnriched = IomsReceiptRow & WithPayerDisplayName & WithCreatedByDisplayName;

/** Map IOMS yard `code` (uppercase) to legacy `gapmc.receipts.yard_id` integer where codes align. */
const YARD_CODE_TO_LEGACY_INT: Record<string, number> = {
  MARG: 1,
  POND: 2,
  SANQ: 3,
  MAPU: 4,
  CURC: 5,
  CANC: 6,
  VALP: 7,
  PERM: 8,
  POLM: 9,
  MOLM: 10,
  PATR: 11,
  KERI: 12,
  DODA: 13,
};

/** Govt pre-receipt settlement receipts were stored as M-02-PRE-RECEIPT; treat as rent income. */
function normalizeLegacyRevenueHead(head: string): string {
  const h = String(head ?? "").trim();
  if (h === "M-02-PRE-RECEIPT") return "Rent";
  return h;
}

function revenueHeadToLegacyType(head: string): Receipt["type"] {
  const h = normalizeLegacyRevenueHead(head);
  if (h === "Rent" || h === "GSTInvoice" || h === "RentArrearsInterest") return "Rent";
  if (h === "MarketFee") return "Market Fee";
  if (h === "LicenceFee") return "License Fee";
  if (h === "SecurityDeposit") return "Other";
  return "Other";
}

function resolveTallyHeadLabel(
  r: IomsReceiptRow,
  manualLedgerByTypeId: Map<string, string>,
): string {
  if (String(r.sourceModule ?? "").trim() === "M-05-MANUAL" && r.manualReceiptTypeId) {
    const ledger = manualLedgerByTypeId.get(String(r.manualReceiptTypeId));
    if (ledger?.trim()) return receiptRevenueHeadDisplayLabel(ledger.trim());
  }
  return receiptRevenueHeadDisplayLabel(normalizeLegacyRevenueHead(r.revenueHead));
}

function iomsStatusToLegacy(status: string): Receipt["status"] {
  if (status === "Reversed" || status === "Failed") return "Voided";
  return "Active";
}

function iomsPaymentToLegacy(mode: string): Receipt["paymentMode"] {
  const m = String(mode ?? "").trim();
  if (m === "DD") return "Cheque";
  if (m === "Cash" || m === "Cheque" || m === "Online" || m === "Adjustment") {
    return m as Receipt["paymentMode"];
  }
  return "Cash";
}

function mapEnrichedIomsRow(
  r: IomsReceiptEnriched,
  yardById: Map<string, { code: string | null; name: string | null }>,
  manualLedgerByTypeId: Map<string, string>,
): Receipt {
  const y = yardById.get(r.yardId);
  const code = String(y?.code ?? "")
    .trim()
    .toUpperCase();
  const legacyYardId = YARD_CODE_TO_LEGACY_INT[code] ?? 0;
  const yardName = String(y?.name ?? "").trim() || "—";

  const payerLabel =
    String((r as { payerDisplayName?: string | null }).payerDisplayName ?? "").trim() ||
    String(r.payerName ?? "").trim() ||
    "—";

  const cgst = Number(r.cgst ?? 0);
  const sgst = Number(r.sgst ?? 0);
  const tds = Number(r.tdsAmount ?? 0);

  const tallyHeadLabel = resolveTallyHeadLabel(r, manualLedgerByTypeId);

  return {
    id: r.id,
    receiptNo: r.receiptNo,
    receiptDate: String(r.createdAt ?? "").slice(0, 10),
    type: revenueHeadToLegacyType(r.revenueHead),
    traderId: String(r.payerRefId ?? r.unifiedEntityId ?? r.createdBy ?? ""),
    traderName: payerLabel,
    head: tallyHeadLabel,
    /** IOMS yard UUID — used by All Receipts location filter (Yard / HO / Check-post). */
    iomsYardId: r.yardId,
    amount: Number(r.amount ?? 0),
    ...(cgst > 0 ? { cgst } : {}),
    ...(sgst > 0 ? { sgst } : {}),
    ...(tds > 0 ? { tdsAmount: tds } : {}),
    total: Number(r.totalAmount ?? 0),
    paymentMode: iomsPaymentToLegacy(r.paymentMode),
    ...(r.chequeNo ? { chequeNo: r.chequeNo } : {}),
    ...(r.bankName ? { chequeBank: r.bankName } : {}),
    ...(r.chequeDate ? { chequeDate: r.chequeDate } : {}),
    ...(r.gatewayRef ? { transactionRef: r.gatewayRef } : {}),
    yardId: legacyYardId,
    yardName,
    issuedBy: r.createdByDisplayName,
    status: iomsStatusToLegacy(r.status),
    createdAt: r.createdAt,
  } as Receipt;
}

async function loadManualReceiptLedgerNames(rows: IomsReceiptRow[]): Promise<Map<string, string>> {
  const typeIds = [
    ...new Set(
      rows
        .filter((r) => String(r.sourceModule ?? "").trim() === "M-05-MANUAL" && r.manualReceiptTypeId)
        .map((r) => String(r.manualReceiptTypeId)),
    ),
  ];
  const map = new Map<string, string>();
  if (typeIds.length === 0) return map;
  const types = await db
    .select({ id: manualReceiptTypes.id, ledgerName: manualReceiptTypes.ledgerName })
    .from(manualReceiptTypes)
    .where(inArray(manualReceiptTypes.id, typeIds));
  for (const t of types) {
    if (t.ledgerName?.trim()) map.set(t.id, t.ledgerName.trim());
  }
  return map;
}

export async function fetchIomsReceiptsMappedToLegacy(scopedLocationIds: string[] | undefined): Promise<Receipt[]> {
  const scoped = scopedLocationIds ?? [];
  const rows =
    scoped.length > 0
      ? await db
          .select()
          .from(iomsReceipts)
          .where(inArray(iomsReceipts.yardId, scoped))
          .orderBy(desc(iomsReceipts.createdAt))
      : await db.select().from(iomsReceipts).orderBy(desc(iomsReceipts.createdAt));

  if (rows.length === 0) return [];

  const yardList = await db.select({ id: yards.id, code: yards.code, name: yards.name }).from(yards);
  const yardById = new Map(yardList.map((y) => [y.id, { code: y.code, name: y.name }]));

  const withPayer = await attachPayerDisplayNames(rows);
  const enriched = await attachCreatedByDisplayNames(withPayer);
  const manualLedgerByTypeId = await loadManualReceiptLedgerNames(rows);
  return (enriched as IomsReceiptEnriched[]).map((r) =>
    mapEnrichedIomsRow(r, yardById, manualLedgerByTypeId),
  );
}

export async function fetchSingleIomsReceiptAsLegacy(id: string): Promise<Receipt | null> {
  const [row] = await db.select().from(iomsReceipts).where(eq(iomsReceipts.id, id)).limit(1);
  if (!row) return null;
  const yardList = await db.select({ id: yards.id, code: yards.code, name: yards.name }).from(yards);
  const yardById = new Map(yardList.map((y) => [y.id, { code: y.code, name: y.name }]));
  const [withPayer] = await attachPayerDisplayNames([row]);
  const [enriched] = await attachCreatedByDisplayNames([withPayer]);
  const manualLedgerByTypeId = await loadManualReceiptLedgerNames([row]);
  return mapEnrichedIomsRow(enriched as IomsReceiptEnriched, yardById, manualLedgerByTypeId);
}

export async function isIomsReceiptId(id: string): Promise<boolean> {
  const [r] = await db.select({ id: iomsReceipts.id }).from(iomsReceipts).where(eq(iomsReceipts.id, id)).limit(1);
  return Boolean(r);
}
