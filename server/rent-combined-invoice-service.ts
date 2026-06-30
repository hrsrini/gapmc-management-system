/**
 * M-03 combined rent tax invoice bundle (multiple premises, same billing month).
 */
import { and, eq, inArray, desc } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  rentInvoices,
  rentCombinedInvoices,
  rentInvoicePaymentAllocations,
  iomsReceipts,
  assets,
} from "@shared/db-schema";
import type { RentCombinedInvoiceAllocation } from "@shared/rent-combined-invoice";
import { stringifyM03CombinedBundleBreakdown } from "@shared/rent-combined-invoice";
import { splitM03RentPaymentGst } from "@shared/m03-receipt-breakdown";
import { db } from "./db";
import { allocateRentCombinedInvoiceNoInTx } from "./rent-invoice-number";
import { resolveRentInvoiceCounterparty } from "./rent-invoice-payer";
import { createIomsReceipt } from "./routes-receipts-ioms";
import { applyM03ReceiptToRentDepositLedgerWhenSettled, maybeMarkM03InvoicePaidFromSettledReceipts } from "./receipt-deposit-service";
import { counterPaymentCreateParams, counterPaymentPaidUpdate, type ParsedCounterDuesPayment } from "./dues-counter-payment";
import { initialDepositStatusForPaymentMode } from "@shared/receipt-deposit";
import { sumAllPaidForInvoiceIds } from "./m03-invoice-payment-sum";

export { sumAllPaidForInvoiceIds, sumPaidByInvoiceIdsViaAllocations } from "./m03-invoice-payment-sum";

export const RENT_INVOICE_BUNDLE_ONLY_PDF_MESSAGE =
  "This premises invoice is part of a combined tax invoice bundle. Download the combined bundle PDF instead.";

export type CombinedRentInvoiceChild = {
  id: string;
  invoiceNo: string | null;
  assetId: string;
  assetCode: string;
  rentAmount: number;
  cgst: number;
  sgst: number;
  tdsAmount: number;
  totalAmount: number;
  status: string;
  combinedBundleId: string | null;
  outstanding: number;
};

export type CombinedRentInvoiceDetail = {
  id: string;
  bundleInvoiceNo: string;
  yardId: string;
  tenantLicenceId: string;
  unifiedEntityId: string | null;
  periodMonth: string;
  invoiceDate: string;
  totalRentAmount: number;
  totalCgst: number;
  totalSgst: number;
  totalTdsAmount: number;
  totalAmount: number;
  status: string;
  createdAt: string | null;
  children: CombinedRentInvoiceChild[];
  outstandingTotal: number;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function createCombinedRentInvoice(args: {
  invoiceIds: string[];
  createdBy: string;
}): Promise<{ ok: true; bundle: CombinedRentInvoiceDetail } | { ok: false; code: string; message: string }> {
  const ids = Array.from(new Set(args.invoiceIds.map((x) => String(x ?? "").trim()).filter(Boolean)));
  if (ids.length < 2) {
    return { ok: false, code: "COMBINED_MIN_INVOICES", message: "Select at least two approved invoices for the same tenant, yard, and billing month." };
  }

  const rows = await db.select().from(rentInvoices).where(inArray(rentInvoices.id, ids));
  if (rows.length !== ids.length) {
    return { ok: false, code: "COMBINED_INVOICE_NOT_FOUND", message: "One or more rent invoices were not found." };
  }

  const tenant = String(rows[0]!.tenantLicenceId ?? "").trim();
  const yardId = String(rows[0]!.yardId ?? "").trim();
  const periodMonth = String(rows[0]!.periodMonth ?? "").trim();

  for (const inv of rows) {
    if (String(inv.status ?? "") !== "Approved" && String(inv.status ?? "") !== "Overdue") {
      return {
        ok: false,
        code: "COMBINED_INVOICE_STATUS",
        message: "All selected invoices must be Approved (or Overdue) before combining.",
      };
    }
    if (String(inv.tenantLicenceId ?? "") !== tenant) {
      return { ok: false, code: "COMBINED_TENANT_MISMATCH", message: "All invoices must belong to the same tenant." };
    }
    if (String(inv.yardId ?? "") !== yardId) {
      return { ok: false, code: "COMBINED_YARD_MISMATCH", message: "All invoices must belong to the same yard." };
    }
    if (String(inv.periodMonth ?? "") !== periodMonth) {
      return { ok: false, code: "COMBINED_MONTH_MISMATCH", message: "Combined invoices must be for the same billing month only." };
    }
    if (String(inv.combinedBundleId ?? "").trim()) {
      return { ok: false, code: "COMBINED_ALREADY_BUNDLED", message: "One or more invoices are already part of a combined bundle." };
    }
  }

  const cp = await resolveRentInvoiceCounterparty(rows[0]!);
  const totals = rows.reduce(
    (acc, inv) => {
      acc.rent += Number(inv.rentAmount ?? 0);
      acc.cgst += Number(inv.cgst ?? 0);
      acc.sgst += Number(inv.sgst ?? 0);
      acc.tds += Number(inv.tdsAmount ?? 0);
      acc.total += Number(inv.totalAmount ?? 0);
      return acc;
    },
    { rent: 0, cgst: 0, sgst: 0, tds: 0, total: 0 },
  );

  const bundleId = nanoid();
  const now = new Date().toISOString();
  const invoiceDate = rows[0]!.approvedAt?.trim() || rows[0]!.generatedAt?.trim() || now.slice(0, 10);

  await db.transaction(async (tx) => {
    const bundleInvoiceNo = await allocateRentCombinedInvoiceNoInTx(tx, { yardId, periodMonth });
    await tx.insert(rentCombinedInvoices).values({
      id: bundleId,
      bundleInvoiceNo,
      yardId,
      tenantLicenceId: tenant,
      unifiedEntityId: cp.unifiedEntityId ?? null,
      periodMonth,
      invoiceDate,
      totalRentAmount: round2(totals.rent),
      totalCgst: round2(totals.cgst),
      totalSgst: round2(totals.sgst),
      totalTdsAmount: round2(totals.tds),
      totalAmount: round2(totals.total),
      status: "Approved",
      createdBy: args.createdBy,
      createdAt: now,
    });
    await tx
      .update(rentInvoices)
      .set({ combinedBundleId: bundleId })
      .where(inArray(rentInvoices.id, ids));
  });

  const detail = await getCombinedRentInvoice(bundleId);
  if (!detail) {
    return { ok: false, code: "COMBINED_CREATE_FAILED", message: "Failed to load combined invoice after creation." };
  }
  return { ok: true, bundle: detail };
}

export async function getCombinedRentInvoice(id: string): Promise<CombinedRentInvoiceDetail | null> {
  const [bundle] = await db.select().from(rentCombinedInvoices).where(eq(rentCombinedInvoices.id, id)).limit(1);
  if (!bundle) return null;

  const childrenRows = await db.select().from(rentInvoices).where(eq(rentInvoices.combinedBundleId, id));
  const assetIds = Array.from(new Set(childrenRows.map((c) => c.assetId)));
  const assetRows =
    assetIds.length > 0
      ? await db.select({ id: assets.id, assetId: assets.assetId }).from(assets).where(inArray(assets.id, assetIds))
      : [];
  const assetCodeById = Object.fromEntries(assetRows.map((a) => [a.id, String(a.assetId ?? a.id)]));

  const paidMap = await sumAllPaidForInvoiceIds(childrenRows.map((c) => c.id));
  // direct single-invoice payments already included in sumAllPaidForInvoiceIds

  let outstandingTotal = 0;
  const children: CombinedRentInvoiceChild[] = childrenRows.map((inv) => {
    const out = Math.max(0, round2(Number(inv.totalAmount ?? 0) - (paidMap.get(inv.id) ?? 0)));
    outstandingTotal += out;
    return {
      id: inv.id,
      invoiceNo: inv.invoiceNo ?? null,
      assetId: inv.assetId,
      assetCode: assetCodeById[inv.assetId] ?? inv.assetId,
      rentAmount: Number(inv.rentAmount ?? 0),
      cgst: Number(inv.cgst ?? 0),
      sgst: Number(inv.sgst ?? 0),
      tdsAmount: Number(inv.tdsAmount ?? 0),
      totalAmount: Number(inv.totalAmount ?? 0),
      status: String(inv.status ?? ""),
      combinedBundleId: inv.combinedBundleId ?? null,
      outstanding: out,
    };
  });

  return {
    id: bundle.id,
    bundleInvoiceNo: bundle.bundleInvoiceNo,
    yardId: bundle.yardId,
    tenantLicenceId: bundle.tenantLicenceId,
    unifiedEntityId: bundle.unifiedEntityId ?? null,
    periodMonth: bundle.periodMonth,
    invoiceDate: bundle.invoiceDate,
    totalRentAmount: Number(bundle.totalRentAmount ?? 0),
    totalCgst: Number(bundle.totalCgst ?? 0),
    totalSgst: Number(bundle.totalSgst ?? 0),
    totalTdsAmount: Number(bundle.totalTdsAmount ?? 0),
    totalAmount: Number(bundle.totalAmount ?? 0),
    status: String(bundle.status ?? ""),
    createdAt: bundle.createdAt ?? null,
    children,
    outstandingTotal: round2(outstandingTotal),
  };
}

export async function listCombinedRentInvoices(filters?: {
  yardId?: string;
  tenantLicenceId?: string;
  periodMonth?: string;
  scopedYardIds?: string[] | null;
}): Promise<CombinedRentInvoiceDetail[]> {
  const conditions = [];
  if (filters?.scopedYardIds && filters.scopedYardIds.length > 0) {
    conditions.push(inArray(rentCombinedInvoices.yardId, filters.scopedYardIds));
  }
  if (filters?.yardId) conditions.push(eq(rentCombinedInvoices.yardId, filters.yardId));
  if (filters?.tenantLicenceId) conditions.push(eq(rentCombinedInvoices.tenantLicenceId, filters.tenantLicenceId));
  if (filters?.periodMonth) conditions.push(eq(rentCombinedInvoices.periodMonth, filters.periodMonth));

  const rows =
    conditions.length > 0
      ? await db
          .select()
          .from(rentCombinedInvoices)
          .where(and(...conditions))
          .orderBy(desc(rentCombinedInvoices.createdAt))
      : await db.select().from(rentCombinedInvoices).orderBy(desc(rentCombinedInvoices.createdAt));

  const out: CombinedRentInvoiceDetail[] = [];
  for (const row of rows) {
    const d = await getCombinedRentInvoice(row.id);
    if (d) out.push(d);
  }
  return out;
}

export async function recordCombinedBundlePayment(args: {
  bundleId: string;
  amount: number;
  allocations: RentCombinedInvoiceAllocation[];
  createdBy: string;
  counterPayment?: ParsedCounterDuesPayment | null;
}): Promise<
  | { ok: true; receiptId: string; receiptNo: string }
  | { ok: false; code: string; message: string; details?: Record<string, unknown> }
> {
  const bundle = await getCombinedRentInvoice(args.bundleId);
  if (!bundle) return { ok: false, code: "COMBINED_NOT_FOUND", message: "Combined invoice bundle not found." };

  const payAmount = round2(Number(args.amount));
  if (!Number.isFinite(payAmount) || payAmount <= 0) {
    return { ok: false, code: "COMBINED_PAY_AMOUNT", message: "Payment amount must be greater than zero." };
  }

  const allocations = (args.allocations ?? []).map((a) => ({
    invoiceId: String(a.invoiceId ?? "").trim(),
    amount: round2(Number(a.amount)),
  }));
  if (allocations.length === 0) {
    return { ok: false, code: "COMBINED_ALLOCATIONS", message: "Provide at least one invoice allocation." };
  }

  const allocSum = round2(allocations.reduce((s, a) => s + a.amount, 0));
  if (Math.abs(allocSum - payAmount) > 0.02) {
    return {
      ok: false,
      code: "COMBINED_ALLOC_SUM",
      message: "Allocation amounts must sum to the payment amount.",
      details: { payAmount, allocSum },
    };
  }

  const childById = Object.fromEntries(bundle.children.map((c) => [c.id, c]));
  const invRows = await db.select().from(rentInvoices).where(eq(rentInvoices.combinedBundleId, args.bundleId));
  const invById = Object.fromEntries(invRows.map((r) => [r.id, r]));
  const paidMap = await sumAllPaidForInvoiceIds(invRows.map((r) => r.id));

  for (const a of allocations) {
    if (!childById[a.invoiceId]) {
      return { ok: false, code: "COMBINED_ALLOC_INVOICE", message: "Allocation references an invoice outside this bundle." };
    }
    const inv = invById[a.invoiceId];
    if (!inv) continue;
    const outstanding = Math.max(0, round2(Number(inv.totalAmount ?? 0) - (paidMap.get(inv.id) ?? 0)));
    if (a.amount > outstanding + 0.02) {
      return {
        ok: false,
        code: "COMBINED_ALLOC_TOO_MUCH",
        message: `Allocation for invoice ${childById[a.invoiceId]!.invoiceNo ?? a.invoiceId} exceeds outstanding.`,
        details: { invoiceId: a.invoiceId, outstanding, requested: a.amount },
      };
    }
  }

  const cp = await resolveRentInvoiceCounterparty(invRows[0]!);
  const counterExtras = args.counterPayment ? counterPaymentCreateParams(args.counterPayment) : {};
  const paymentMode = args.counterPayment?.paymentMode ?? "Cash";

  let sumTaxable = 0;
  let sumCgst = 0;
  let sumSgst = 0;
  let sumTds = 0;
  for (const a of allocations) {
    const inv = invById[a.invoiceId]!;
    const parts = splitM03RentPaymentGst({
      rentPay: a.amount,
      invoiceRentAmount: Number(inv.rentAmount ?? 0),
      invoiceCgst: Number(inv.cgst ?? 0),
      invoiceSgst: Number(inv.sgst ?? 0),
      invoiceTotalAmount: Number(inv.totalAmount ?? 0),
    });
    sumTaxable += parts.amount;
    sumCgst += parts.cgst;
    sumSgst += parts.sgst;
    const invTotal = Number(inv.totalAmount ?? 0) || 1;
    const tdsFrac = a.amount / invTotal;
    sumTds += round2(Number(inv.tdsAmount ?? 0) * tdsFrac);
  }
  sumTaxable = round2(sumTaxable);
  sumCgst = round2(sumCgst);
  sumSgst = round2(sumSgst);
  sumTds = round2(sumTds);

  const isGovt = Boolean(invRows[0]?.isGovtEntity);
  const revenueHead = isGovt ? "GSTInvoice" : "Rent";
  const brJson = stringifyM03CombinedBundleBreakdown({
    combinedBundleId: args.bundleId,
    invoiceAllocations: allocations,
  });

  const created = await createIomsReceipt({
    yardId: bundle.yardId,
    revenueHead,
    payerName: cp.payerName,
    payerType: cp.payerType,
    payerRefId: cp.payerRefId,
    amount: sumTaxable,
    cgst: sumCgst,
    sgst: sumSgst,
    tdsAmount: sumTds,
    paymentMode,
    sourceModule: "M-03",
    sourceRecordId: args.bundleId,
    unifiedEntityId: cp.unifiedEntityId,
    m03BreakdownJson: brJson,
    createdBy: args.createdBy,
    ...counterExtras,
  });

  const now = new Date().toISOString();
  for (const a of allocations) {
    await db.insert(rentInvoicePaymentAllocations).values({
      id: nanoid(),
      receiptId: created.id,
      invoiceId: a.invoiceId,
      amountInr: a.amount,
      createdAt: now,
    });
  }

  if (args.counterPayment) {
    await db
      .update(iomsReceipts)
      .set({
        ...counterPaymentPaidUpdate(args.counterPayment),
        depositStatus: initialDepositStatusForPaymentMode(args.counterPayment.paymentMode),
      })
      .where(eq(iomsReceipts.id, created.id));
  } else {
    await db
      .update(iomsReceipts)
      .set({
        status: "Paid",
        depositStatus: initialDepositStatusForPaymentMode("Cash"),
      })
      .where(eq(iomsReceipts.id, created.id));
  }

  const [receiptRow] = await db.select().from(iomsReceipts).where(eq(iomsReceipts.id, created.id)).limit(1);
  if (receiptRow) {
    await applyM03ReceiptToRentDepositLedgerWhenSettled(receiptRow);
    for (const a of allocations) {
      await maybeMarkM03InvoicePaidFromSettledReceipts(a.invoiceId);
    }
  }

  return { ok: true, receiptId: created.id, receiptNo: created.receiptNo };
}
