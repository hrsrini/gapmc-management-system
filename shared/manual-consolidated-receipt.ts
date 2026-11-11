/**
 * M-05 consolidated manual receipt (multiple Tally heads on one IOMS receipt).
 * Stored in `ioms_receipts.m03_breakdown_json` with kind M05_CONSOLIDATED.
 * Only Rent lines attract CGST/SGST (system rent GST %).
 */

import { computeRentInvoiceGstInr } from "./rent-invoice-gst";
import { normalizeLedgerName } from "./manual-receipt-types";

export const M05_CONSOLIDATED_KIND = "M05_CONSOLIDATED" as const;

export type M05ConsolidatedLine = {
  manualReceiptTypeId: string;
  ledgerName: string;
  /** Asset row ids (gapmc.assets.id); empty when premises not required. */
  premisesAssetIds: string[];
  /** Premises display labels for PDF / audit. */
  premisesLabels?: string[];
  /** Taxable / line amount (excl. GST). */
  amount: number;
  cgst: number;
  sgst: number;
  remarks?: string;
};

export type M05ConsolidatedBreakdown = {
  kind: typeof M05_CONSOLIDATED_KIND;
  lines: M05ConsolidatedLine[];
};

export function isRentLedgerName(ledgerName: string): boolean {
  return normalizeLedgerName(ledgerName).toLowerCase() === "rent";
}

export function gstForManualLine(args: {
  ledgerName: string;
  amount: number;
  gstExempt: boolean;
  cgstPercent: number;
  sgstPercent: number;
}): { cgst: number; sgst: number } {
  if (!isRentLedgerName(args.ledgerName)) return { cgst: 0, sgst: 0 };
  return computeRentInvoiceGstInr(args.amount, args.gstExempt, args.cgstPercent, args.sgstPercent);
}

export function parseM05ConsolidatedBreakdown(json: string | null | undefined): M05ConsolidatedBreakdown | null {
  if (json == null || String(json).trim() === "") return null;
  try {
    const o = JSON.parse(String(json)) as unknown;
    if (!o || typeof o !== "object") return null;
    const x = o as Record<string, unknown>;
    if (x.kind !== M05_CONSOLIDATED_KIND) return null;
    const rawLines = Array.isArray(x.lines) ? x.lines : [];
    const lines: M05ConsolidatedLine[] = [];
    for (const row of rawLines) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const amount = Number(r.amount ?? 0);
      if (!Number.isFinite(amount) || amount <= 0) continue;
      const premisesAssetIds = Array.isArray(r.premisesAssetIds)
        ? r.premisesAssetIds.map((id) => String(id ?? "").trim()).filter(Boolean)
        : [];
      const premisesLabels = Array.isArray(r.premisesLabels)
        ? r.premisesLabels.map((l) => String(l ?? "").trim()).filter(Boolean)
        : undefined;
      lines.push({
        manualReceiptTypeId: String(r.manualReceiptTypeId ?? "").trim(),
        ledgerName: normalizeLedgerName(String(r.ledgerName ?? "")),
        premisesAssetIds,
        premisesLabels,
        amount: Math.round(amount * 100) / 100,
        cgst: Math.round((Number(r.cgst ?? 0) || 0) * 100) / 100,
        sgst: Math.round((Number(r.sgst ?? 0) || 0) * 100) / 100,
        remarks: r.remarks != null ? String(r.remarks).trim() || undefined : undefined,
      });
    }
    if (!lines.length) return null;
    return { kind: M05_CONSOLIDATED_KIND, lines };
  } catch {
    return null;
  }
}

export function stringifyM05ConsolidatedBreakdown(b: M05ConsolidatedBreakdown): string {
  return JSON.stringify(b);
}

export function sumConsolidatedTotals(lines: M05ConsolidatedLine[]): {
  amount: number;
  cgst: number;
  sgst: number;
  totalAmount: number;
} {
  let amount = 0;
  let cgst = 0;
  let sgst = 0;
  for (const l of lines) {
    amount += Number(l.amount) || 0;
    cgst += Number(l.cgst) || 0;
    sgst += Number(l.sgst) || 0;
  }
  amount = Math.round(amount * 100) / 100;
  cgst = Math.round(cgst * 100) / 100;
  sgst = Math.round(sgst * 100) / 100;
  return {
    amount,
    cgst,
    sgst,
    totalAmount: Math.round((amount + cgst + sgst) * 100) / 100,
  };
}
