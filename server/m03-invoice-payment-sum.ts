/**
 * M-03 rent invoice payment totals (direct receipts + combined-bundle allocations).
 */
import { and, eq, inArray, not } from "drizzle-orm";
import { db } from "./db";
import { iomsReceipts, rentInvoicePaymentAllocations } from "@shared/db-schema";
import { m03ReceiptPrincipalTowardInvoice } from "@shared/m03-receipt-breakdown";
import { depositStatusAllowsLedgerPosting } from "@shared/receipt-deposit";

export async function sumPaidByInvoiceIdsViaAllocations(
  invoiceIds: string[],
  opts?: { excludeReceiptId?: string },
): Promise<Map<string, number>> {
  const m = new Map<string, number>();
  if (invoiceIds.length === 0) return m;
  const conditions = [inArray(rentInvoicePaymentAllocations.invoiceId, invoiceIds)];
  if (opts?.excludeReceiptId) {
    conditions.push(not(eq(rentInvoicePaymentAllocations.receiptId, opts.excludeReceiptId)));
  }
  const rows = await db
    .select({
      invoiceId: rentInvoicePaymentAllocations.invoiceId,
      amountInr: rentInvoicePaymentAllocations.amountInr,
      status: iomsReceipts.status,
      depositStatus: iomsReceipts.depositStatus,
    })
    .from(rentInvoicePaymentAllocations)
    .innerJoin(iomsReceipts, eq(rentInvoicePaymentAllocations.receiptId, iomsReceipts.id))
    .where(and(...conditions));
  for (const r of rows) {
    const st = String(r.status ?? "");
    if (st !== "Paid" && st !== "Reconciled") continue;
    if (st === "Reversed") continue;
    if (!depositStatusAllowsLedgerPosting(r.depositStatus)) continue;
    const id = String(r.invoiceId ?? "");
    if (!id) continue;
    m.set(id, (m.get(id) ?? 0) + Number(r.amountInr ?? 0));
  }
  return m;
}

export async function sumAllPaidForInvoiceIds(
  invoiceIds: string[],
  opts?: { excludeReceiptId?: string },
): Promise<Map<string, number>> {
  const m = new Map<string, number>();
  if (invoiceIds.length === 0) return m;
  const recs = await db
    .select({
      id: iomsReceipts.id,
      sourceRecordId: iomsReceipts.sourceRecordId,
      totalAmount: iomsReceipts.totalAmount,
      status: iomsReceipts.status,
      revenueHead: iomsReceipts.revenueHead,
      sourceModule: iomsReceipts.sourceModule,
      m03BreakdownJson: iomsReceipts.m03BreakdownJson,
      depositStatus: iomsReceipts.depositStatus,
    })
    .from(iomsReceipts)
    .where(and(eq(iomsReceipts.sourceModule, "M-03"), inArray(iomsReceipts.sourceRecordId, invoiceIds)));
  for (const r of recs) {
    if (opts?.excludeReceiptId && r.id === opts.excludeReceiptId) continue;
    const st = String(r.status ?? "");
    if (st !== "Paid" && st !== "Reconciled") continue;
    if (st === "Reversed") continue;
    if (!depositStatusAllowsLedgerPosting(r.depositStatus)) continue;
    const id = String(r.sourceRecordId ?? "");
    const principal = m03ReceiptPrincipalTowardInvoice(r);
    if (principal > 0 && id) m.set(id, (m.get(id) ?? 0) + principal);
  }
  const allocPaid = await sumPaidByInvoiceIdsViaAllocations(invoiceIds, opts);
  for (const [id, amt] of Array.from(allocPaid.entries())) {
    m.set(id, (m.get(id) ?? 0) + amt);
  }
  return m;
}

export async function settledPrincipalPaidForInvoice(
  invoiceId: string,
  opts?: { excludeReceiptId?: string },
): Promise<number> {
  const m = await sumAllPaidForInvoiceIds([invoiceId], opts);
  return Math.round((m.get(invoiceId) ?? 0) * 100) / 100;
}
