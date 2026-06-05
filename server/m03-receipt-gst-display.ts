import { eq } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import { db } from "./db";
import { iomsReceipts, rentInvoices } from "@shared/db-schema";
import {
  type M03InvoiceGstSnapshot,
  resolveM03ReceiptGstAmounts,
} from "@shared/m03-receipt-breakdown";

type ReceiptRow = InferSelectModel<typeof iomsReceipts>;

export function invoiceGstSnapshot(inv: {
  rentAmount: number | null;
  cgst: number | null;
  sgst: number | null;
  totalAmount: number | null;
}): M03InvoiceGstSnapshot {
  return {
    rentAmount: Number(inv.rentAmount ?? 0),
    cgst: Number(inv.cgst ?? 0),
    sgst: Number(inv.sgst ?? 0),
    totalAmount: Number(inv.totalAmount ?? 0),
  };
}

/** Apply resolved rent / CGST / SGST on M-03 receipts when stored tax columns are zero. */
export function withResolvedM03ReceiptGst<T extends ReceiptRow>(
  receipt: T,
  invoice?: M03InvoiceGstSnapshot | null,
): T {
  const storedCgst = Number(receipt.cgst ?? 0);
  const storedSgst = Number(receipt.sgst ?? 0);
  if (storedCgst >= 0.005 || storedSgst >= 0.005) return receipt;
  const resolved = resolveM03ReceiptGstAmounts(receipt, invoice ?? null);
  if (resolved.cgst < 0.005 && resolved.sgst < 0.005) return receipt;
  return {
    ...receipt,
    amount: resolved.amount,
    cgst: resolved.cgst,
    sgst: resolved.sgst,
  };
}

export type M03ReceiptGstInput = {
  revenueHead: string;
  amount: number;
  cgst?: number | null;
  sgst?: number | null;
  sourceModule?: string | null;
  sourceRecordId?: string | null;
  m03BreakdownJson?: string | null;
};

/** Load linked invoice GST snapshot for an M-03 receipt (if any). */
export async function fetchM03InvoiceGstSnapshot(
  sourceRecordId: string | null | undefined,
): Promise<M03InvoiceGstSnapshot | null> {
  const id = String(sourceRecordId ?? "").trim();
  if (!id) return null;
  const [inv] = await db
    .select({
      rentAmount: rentInvoices.rentAmount,
      cgst: rentInvoices.cgst,
      sgst: rentInvoices.sgst,
      totalAmount: rentInvoices.totalAmount,
    })
    .from(rentInvoices)
    .where(eq(rentInvoices.id, id))
    .limit(1);
  return inv ? invoiceGstSnapshot(inv) : null;
}

/** Split taxable rent + CGST + SGST before persisting M-03 rent receipts. */
export async function normalizeM03ReceiptGstFields(
  input: M03ReceiptGstInput,
  invoice?: M03InvoiceGstSnapshot | null,
): Promise<{ amount: number; cgst: number; sgst: number }> {
  const inv =
    invoice !== undefined
      ? invoice
      : String(input.sourceModule ?? "") === "M-03" && input.sourceRecordId
        ? await fetchM03InvoiceGstSnapshot(input.sourceRecordId)
        : null;
  return resolveM03ReceiptGstAmounts(input, inv);
}

export function buildInvoiceGstMap(
  invRows: Array<{
    id: string;
    rentAmount: number | null;
    cgst: number | null;
    sgst: number | null;
    totalAmount: number | null;
  }>,
): Map<string, M03InvoiceGstSnapshot> {
  return new Map(invRows.map((inv) => [inv.id, invoiceGstSnapshot(inv)]));
}
