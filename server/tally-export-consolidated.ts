/**
 * Expand one M-05 consolidated IOMS receipt into one Tally export row per Head of Account.
 * All rows share the same receipt number (CONS) for audit traceability.
 */
import { eq, inArray } from "drizzle-orm";
import { db } from "./db";
import { manualReceiptTypes, tallyLedgers } from "@shared/db-schema";
import {
  isM05ConsolidatedReceipt,
  parseM05ConsolidatedBreakdown,
  type M05ConsolidatedLine,
} from "@shared/manual-consolidated-receipt";

export type TallyExportReceiptBase = {
  receiptId: string;
  kind: string;
  docNo: string;
  date: string;
  yardId: string;
  revenueHead: string | null;
  payerName?: string | null;
  unifiedEntityId?: string | null;
  amount: number | null;
  cgst: number | null;
  sgst: number | null;
  totalAmount: number | null;
  tallyLedgerName: string | null;
  tallyLedgerId: string | null;
  tallyGroup: string | null;
  m03BreakdownJson?: string | null;
  sourceRecordId?: string | null;
  sourceModule?: string | null;
};

export type TallyExportExpandedRow = TallyExportReceiptBase & {
  /** Line ledger name when expanded from consolidated breakdown. */
  consolidatedLedgerName?: string;
};

async function loadTallyByManualTypeIds(
  typeIds: string[],
): Promise<
  Map<
    string,
    {
      ledgerName: string;
      tallyLedgerId: string | null;
      tallyLedgerName: string | null;
      tallyGroup: string | null;
    }
  >
> {
  const map = new Map<
    string,
    {
      ledgerName: string;
      tallyLedgerId: string | null;
      tallyLedgerName: string | null;
      tallyGroup: string | null;
    }
  >();
  const ids = [...new Set(typeIds.map((id) => String(id ?? "").trim()).filter(Boolean))];
  if (!ids.length) return map;
  const rows = await db
    .select({
      id: manualReceiptTypes.id,
      ledgerName: manualReceiptTypes.ledgerName,
      tallyLedgerId: tallyLedgers.id,
      tallyLedgerName: tallyLedgers.ledgerName,
      tallyGroup: tallyLedgers.primaryGroup,
    })
    .from(manualReceiptTypes)
    .leftJoin(tallyLedgers, eq(manualReceiptTypes.tallyLedgerId, tallyLedgers.id))
    .where(inArray(manualReceiptTypes.id, ids));
  for (const r of rows) {
    map.set(r.id, {
      ledgerName: String(r.ledgerName ?? "").trim(),
      tallyLedgerId: r.tallyLedgerId ?? null,
      tallyLedgerName: r.tallyLedgerName ?? null,
      tallyGroup: r.tallyGroup ?? null,
    });
  }
  return map;
}

function lineTotal(line: M05ConsolidatedLine): number {
  return Math.round((Number(line.amount) + Number(line.cgst) + Number(line.sgst)) * 100) / 100;
}

/**
 * Replace consolidated receipt rows with one export row per breakdown line.
 * Non-consolidated receipts pass through unchanged.
 */
export async function expandReceiptRowsForTallyExport<T extends TallyExportReceiptBase>(
  receiptRows: T[],
): Promise<Array<T | TallyExportExpandedRow>> {
  const out: Array<T | TallyExportExpandedRow> = [];
  const consolidated = receiptRows.filter((r) => isM05ConsolidatedReceipt(r));
  const typeIds = consolidated.flatMap((r) => {
    const b = parseM05ConsolidatedBreakdown(r.m03BreakdownJson);
    return (b?.lines ?? []).map((l) => l.manualReceiptTypeId);
  });
  const tallyByType = await loadTallyByManualTypeIds(typeIds);

  for (const row of receiptRows) {
    if (!isM05ConsolidatedReceipt(row)) {
      out.push(row);
      continue;
    }
    const breakdown = parseM05ConsolidatedBreakdown(row.m03BreakdownJson);
    if (!breakdown?.lines?.length) {
      out.push({
        ...row,
        revenueHead: "Consolidated",
        tallyLedgerName: row.tallyLedgerName ?? "Consolidated",
      });
      continue;
    }
    for (const line of breakdown.lines) {
      const meta = tallyByType.get(line.manualReceiptTypeId);
      const ledgerName = meta?.tallyLedgerName?.trim() || meta?.ledgerName || line.ledgerName;
      out.push({
        ...row,
        revenueHead: line.ledgerName || "Consolidated",
        amount: Number(line.amount) || 0,
        cgst: Number(line.cgst) || 0,
        sgst: Number(line.sgst) || 0,
        totalAmount: lineTotal(line),
        tallyLedgerId: meta?.tallyLedgerId ?? null,
        tallyLedgerName: ledgerName || null,
        tallyGroup: meta?.tallyGroup ?? null,
        consolidatedLedgerName: line.ledgerName,
      });
    }
  }
  return out;
}
