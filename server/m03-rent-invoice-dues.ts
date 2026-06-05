/**
 * M-03 rent invoice outstanding lines for Outstanding dues (Track A / Track B / AH).
 */
import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "./db";
import { iomsReceipts, rentInvoices } from "@shared/db-schema";
import { m03ReceiptPrincipalTowardInvoice } from "@shared/m03-receipt-breakdown";
import { unifiedEntityIdFromTrackB } from "@shared/unified-entity-id";

export type M03RentInvoiceDueRow = {
  kind: "RentInvoice";
  invoiceId: string;
  invoiceNo: string | null;
  periodMonth: string;
  assetId: string;
  yardId: string;
  totalAmount: number;
  paidAmount: number;
  outstandingAmount: number;
  status: string;
};

const OPEN_INVOICE_STATUSES = ["Approved", "Overdue", "Paid"] as const;

function paidPrincipalByInvoice(
  recs: Array<{
    sourceRecordId: string | null;
    status: string | null;
    sourceModule: string | null;
    revenueHead: string;
    totalAmount: number | null;
    m03BreakdownJson?: string | null;
  }>,
): Record<string, number> {
  const paidByInvoice: Record<string, number> = {};
  for (const r of recs) {
    const invId = String(r.sourceRecordId ?? "");
    if (!invId) continue;
    const isPaid = String(r.status ?? "") === "Paid" || String(r.status ?? "") === "Reconciled";
    if (!isPaid) continue;
    paidByInvoice[invId] =
      (paidByInvoice[invId] ?? 0) + m03ReceiptPrincipalTowardInvoice(r);
  }
  return paidByInvoice;
}

function invoiceRowsToDues(
  invs: Array<{
    id: string;
    invoiceNo: string | null;
    periodMonth: string;
    assetId: string;
    yardId: string;
    totalAmount: number | null;
    status: string | null;
  }>,
  paidByInvoice: Record<string, number>,
): M03RentInvoiceDueRow[] {
  const dues: M03RentInvoiceDueRow[] = [];
  for (const i of invs) {
    const total = Number(i.totalAmount ?? 0);
    const paid = Number(paidByInvoice[i.id] ?? 0);
    const outstanding = Math.max(0, Math.round((total - paid) * 100) / 100);
    if (outstanding <= 0.005) continue;
    dues.push({
      kind: "RentInvoice",
      invoiceId: i.id,
      invoiceNo: i.invoiceNo,
      periodMonth: i.periodMonth,
      assetId: i.assetId,
      yardId: i.yardId,
      totalAmount: total,
      paidAmount: paid,
      outstandingAmount: outstanding,
      status: String(i.status ?? ""),
    });
  }
  return dues;
}

/** Track A: trader licence id on `rent_invoices.tenant_licence_id`. */
export async function listM03RentInvoiceDuesForTraderLicence(
  tenantLicenceId: string,
): Promise<M03RentInvoiceDueRow[]> {
  const invs = await db
    .select()
    .from(rentInvoices)
    .where(
      and(
        eq(rentInvoices.tenantLicenceId, tenantLicenceId),
        inArray(rentInvoices.status, [...OPEN_INVOICE_STATUSES]),
      ),
    );

  const invoiceIds = invs.map((i) => i.id);
  const recs =
    invoiceIds.length === 0
      ? []
      : await db
          .select()
          .from(iomsReceipts)
          .where(and(eq(iomsReceipts.sourceModule, "M-03"), inArray(iomsReceipts.sourceRecordId, invoiceIds)));

  return invoiceRowsToDues(invs, paidPrincipalByInvoice(recs));
}

/** Track B (non-Govt): entity id on `entity_id` and/or unified `TB:<entity_id>` tenant key. */
export async function listM03RentInvoiceDuesForTrackBEntity(
  entityId: string,
): Promise<M03RentInvoiceDueRow[]> {
  const eid = String(entityId ?? "").trim();
  if (!eid) return [];
  const tbUnified = unifiedEntityIdFromTrackB(eid);
  const invs = await db
    .select()
    .from(rentInvoices)
    .where(
      and(
        or(eq(rentInvoices.entityId, eid), eq(rentInvoices.tenantLicenceId, tbUnified)),
        inArray(rentInvoices.status, [...OPEN_INVOICE_STATUSES]),
      ),
    );

  const invoiceIds = invs.map((i) => i.id);
  const recs =
    invoiceIds.length === 0
      ? []
      : await db
          .select()
          .from(iomsReceipts)
          .where(and(eq(iomsReceipts.sourceModule, "M-03"), inArray(iomsReceipts.sourceRecordId, invoiceIds)));

  return invoiceRowsToDues(invs, paidPrincipalByInvoice(recs));
}
