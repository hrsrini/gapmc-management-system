/**
 * M-03 rent deposit ledger: post **Collection** when an M-03 rent/GST receipt becomes Paid/Reconciled;
 * post **InterestCollection** when arrears interest is paid (alone or with rent);
 * post **ChequeDishonour** reversal when such a receipt is reversed after payment.
 *
 * Running balance rule: `balance = previousBalance + debit - credit`.
 */
import { and, eq, inArray } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./db";
import { writeAuditLogSystem } from "./audit";
import { iomsReceipts, rentDepositLedger, rentInvoices } from "@shared/db-schema";
import { latestRentDepositLedgerRowForInvoice, rentInvoiceLedgerScope } from "./rent-ledger-scope";
import { parseM03ReceiptBreakdown } from "@shared/m03-receipt-breakdown";

type ReceiptRow = InferSelectModel<typeof iomsReceipts>;

function isM03RentPrincipalReceipt(r: ReceiptRow): boolean {
  return (
    String(r.sourceModule ?? "") === "M-03" &&
    !!r.sourceRecordId &&
    (r.revenueHead === "Rent" || r.revenueHead === "GSTInvoice")
  );
}

function isM03RentArrearsInterestReceipt(r: ReceiptRow): boolean {
  return (
    String(r.sourceModule ?? "") === "M-03" &&
    !!r.sourceRecordId &&
    r.revenueHead === "RentArrearsInterest"
  );
}

function collectionCreditInr(r: ReceiptRow): number {
  const br = parseM03ReceiptBreakdown(r.m03BreakdownJson);
  if (br && typeof br.rentAmount === "number" && Number.isFinite(br.rentAmount) && br.rentAmount >= 0) {
    return Math.round(br.rentAmount * 100) / 100;
  }
  return Math.round(Number(r.totalAmount ?? 0) * 100) / 100;
}

/** Idempotent: one Collection row per receipt id (rent / GST principal). */
export async function recordRentCollectionForM03Receipt(r: ReceiptRow): Promise<{
  ledgerId?: string;
  message?: string;
}> {
  if (!isM03RentPrincipalReceipt(r)) return {};
  if (r.status !== "Paid" && r.status !== "Reconciled") return {};

  const [dup] = await db
    .select({ id: rentDepositLedger.id })
    .from(rentDepositLedger)
    .where(and(eq(rentDepositLedger.receiptId, r.id), eq(rentDepositLedger.entryType, "Collection")))
    .limit(1);
  if (dup) return { ledgerId: dup.id, message: "Rent deposit ledger: Collection already recorded for this receipt." };

  const [inv] = await db.select().from(rentInvoices).where(eq(rentInvoices.id, r.sourceRecordId!)).limit(1);
  if (!inv) return { message: "Rent deposit ledger: linked invoice not found; no Collection row posted." };

  const prev = await latestRentDepositLedgerRowForInvoice(inv);
  const prevBal = prev != null ? Number(prev.balance ?? 0) : 0;
  const credit = collectionCreditInr(r);
  const balance = prevBal - credit;
  const id = nanoid();
  const entryDate = new Date().toISOString().slice(0, 10);

  const collectionScope = rentInvoiceLedgerScope(inv);
  await db.insert(rentDepositLedger).values({
    id,
    tenantLicenceId: collectionScope.ledgerTenantLicenceId,
    unifiedEntityId: collectionScope.unifiedEntityId,
    assetId: inv.assetId,
    entryDate,
    entryType: "Collection",
    debit: 0,
    credit,
    balance,
    invoiceId: inv.id,
    receiptId: r.id,
  });

  writeAuditLogSystem({
    module: "Rent/Tax",
    action: "RentDepositCollection",
    recordId: id,
    afterValue: {
      tenantLicenceId: inv.tenantLicenceId,
      assetId: inv.assetId,
      credit,
      balance,
      receiptId: r.id,
      invoiceId: inv.id,
    },
  }).catch((e) => console.error("Audit log failed:", e));

  return {
    ledgerId: id,
    message: `Rent deposit ledger: Collection ₹${credit.toFixed(2)} posted (balance ₹${balance.toFixed(2)}).`,
  };
}

async function recordInterestSettlementForM03Receipt(
  r: ReceiptRow,
  interestLedgerEntryIds: string[],
  interestAmountIn: number,
): Promise<string | undefined> {
  const [dupIc] = await db
    .select({ id: rentDepositLedger.id })
    .from(rentDepositLedger)
    .where(and(eq(rentDepositLedger.receiptId, r.id), eq(rentDepositLedger.entryType, "InterestCollection")))
    .limit(1);
  if (dupIc) return "Rent deposit ledger: InterestCollection already recorded for this receipt.";

  const [inv] = await db.select().from(rentInvoices).where(eq(rentInvoices.id, r.sourceRecordId!)).limit(1);
  if (!inv) return "Rent deposit ledger: invoice not found; interest not settled.";

  const ids = interestLedgerEntryIds.map((x) => String(x).trim()).filter(Boolean);
  if (ids.length === 0) return "Rent deposit ledger: no interest ledger ids.";

  const rows = await db.select().from(rentDepositLedger).where(inArray(rentDepositLedger.id, ids));
  if (rows.length !== ids.length) return "Rent deposit ledger: one or more interest ledger rows not found.";
  let sumDebit = 0;
  for (const row of rows) {
    if (String(row.entryType) !== "Interest") return `Rent deposit ledger: row ${row.id} is not an Interest accrual.`;
    if (String(row.invoiceId ?? "") !== String(inv.id)) return "Rent deposit ledger: interest row does not match invoice.";
    const st = String(row.interestPaymentStatus ?? "").trim();
    if (st === "Paid") return "Rent deposit ledger: interest row already paid.";
    sumDebit += Number(row.debit ?? 0);
  }
  sumDebit = Math.round(sumDebit * 100) / 100;
  const interestAmount = Math.round(interestAmountIn * 100) / 100;
  if (interestAmount <= 0.01) return "Rent deposit ledger: interest amount invalid.";
  if (Math.abs(sumDebit - interestAmount) > 0.02) {
    return `Rent deposit ledger: interest total ₹${interestAmount.toFixed(2)} does not match ledger debits ₹${sumDebit.toFixed(2)}.`;
  }

  const prev = await latestRentDepositLedgerRowForInvoice(inv);
  const prevBal = prev != null ? Number(prev.balance ?? 0) : 0;
  const balance = prevBal - interestAmount;
  const id = nanoid();
  const entryDate = new Date().toISOString().slice(0, 10);
  const scope = rentInvoiceLedgerScope(inv);

  await db.insert(rentDepositLedger).values({
    id,
    tenantLicenceId: scope.ledgerTenantLicenceId,
    unifiedEntityId: scope.unifiedEntityId,
    assetId: inv.assetId,
    entryDate,
    entryType: "InterestCollection",
    debit: 0,
    credit: interestAmount,
    balance,
    invoiceId: inv.id,
    receiptId: r.id,
  });

  await db
    .update(rentDepositLedger)
    .set({ interestPaymentStatus: "Paid", settledReceiptId: r.id })
    .where(inArray(rentDepositLedger.id, ids));

  writeAuditLogSystem({
    module: "Rent/Tax",
    action: "RentDepositInterestSettled",
    recordId: id,
    afterValue: {
      receiptId: r.id,
      invoiceId: inv.id,
      interestAmount,
      balance,
      interestLedgerEntryIds: ids,
    },
  }).catch((e) => console.error("Audit log failed:", e));

  return `Rent deposit ledger: Interest settled ₹${interestAmount.toFixed(2)} (${ids.length} line(s)); balance ₹${balance.toFixed(2)}.`;
}

async function recordInterestOnlySettlementForM03Receipt(r: ReceiptRow): Promise<string | undefined> {
  if (!isM03RentArrearsInterestReceipt(r)) return undefined;
  if (r.status !== "Paid" && r.status !== "Reconciled") return undefined;

  const br = parseM03ReceiptBreakdown(r.m03BreakdownJson);
  const ids = br?.interestLedgerEntryIds ?? [];
  const interestAmt =
    typeof br?.interestAmount === "number" && Number.isFinite(br.interestAmount) && br.interestAmount > 0
      ? br.interestAmount
      : Number(r.totalAmount ?? 0);
  return recordInterestSettlementForM03Receipt(r, ids, interestAmt);
}

/**
 * Apply all M-03 rent-deposit ledger effects for a Paid/Reconciled IOMS receipt (principal collection + optional interest).
 * Call after the receipt row is persisted with status Paid/Reconciled.
 */
export async function applyM03ReceiptToRentDepositLedger(r: ReceiptRow): Promise<{ messages: string[] }> {
  const messages: string[] = [];
  if (r.status !== "Paid" && r.status !== "Reconciled") return { messages };
  if (String(r.sourceModule ?? "") !== "M-03" || !r.sourceRecordId) return { messages };

  if (isM03RentArrearsInterestReceipt(r)) {
    const msg = await recordInterestOnlySettlementForM03Receipt(r);
    if (msg) messages.push(msg);
    return { messages };
  }

  if (isM03RentPrincipalReceipt(r)) {
    const coll = await recordRentCollectionForM03Receipt(r);
    if (coll.message) messages.push(coll.message);
    const br = parseM03ReceiptBreakdown(r.m03BreakdownJson);
    const ids = br?.interestLedgerEntryIds ?? [];
    const ia =
      typeof br?.interestAmount === "number" && Number.isFinite(br.interestAmount) ? br.interestAmount : undefined;
    if (ids.length > 0 && ia != null && ia > 0.01) {
      const msg = await recordInterestSettlementForM03Receipt(r, ids, ia);
      if (msg) messages.push(msg);
    }
    return { messages };
  }

  return { messages };
}

/** Reversal when cheque/DD dishonoured; M-03 rent/GST (Collection) or interest-only (InterestCollection). */
export async function recordChequeDishonourLedgerForM03Receipt(r: ReceiptRow): Promise<{
  ledgerId?: string;
  message?: string;
}> {
  if (String(r.sourceModule ?? "") !== "M-03" || !r.sourceRecordId) return {};

  if (r.revenueHead === "RentArrearsInterest") {
    const [ic] = await db
      .select()
      .from(rentDepositLedger)
      .where(and(eq(rentDepositLedger.receiptId, r.id), eq(rentDepositLedger.entryType, "InterestCollection")))
      .limit(1);
    if (!ic) {
      return {
        message:
          "Rent deposit ledger: no InterestCollection for this interest receipt — dishonour not auto-posted.",
      };
    }
    const [dup] = await db
      .select({ id: rentDepositLedger.id })
      .from(rentDepositLedger)
      .where(and(eq(rentDepositLedger.receiptId, r.id), eq(rentDepositLedger.entryType, "ChequeDishonour")))
      .limit(1);
    if (dup) return { ledgerId: dup.id, message: "Rent deposit ledger: ChequeDishonour already recorded for this receipt." };

    const [inv] = await db.select().from(rentInvoices).where(eq(rentInvoices.id, r.sourceRecordId!)).limit(1);
    if (!inv) return { message: "Rent deposit ledger: invoice missing; dishonour not posted." };

    const prev = await latestRentDepositLedgerRowForInvoice(inv);
    const prevBal = prev != null ? Number(prev.balance ?? 0) : 0;
    const debit = Number(r.totalAmount ?? 0);
    const balance = prevBal + debit;
    const id = nanoid();
    const entryDate = new Date().toISOString().slice(0, 10);
    const dishonourScope = rentInvoiceLedgerScope(inv);
    await db.insert(rentDepositLedger).values({
      id,
      tenantLicenceId: dishonourScope.ledgerTenantLicenceId,
      unifiedEntityId: dishonourScope.unifiedEntityId,
      assetId: inv.assetId,
      entryDate,
      entryType: "ChequeDishonour",
      debit,
      credit: 0,
      balance,
      invoiceId: inv.id,
      receiptId: r.id,
    });

    await db
      .update(rentDepositLedger)
      .set({ interestPaymentStatus: "Unpaid", settledReceiptId: null })
      .where(eq(rentDepositLedger.settledReceiptId, r.id));

    writeAuditLogSystem({
      module: "Rent/Tax",
      action: "RentDepositChequeDishonour",
      recordId: id,
      afterValue: {
        tenantLicenceId: inv.tenantLicenceId,
        assetId: inv.assetId,
        debit,
        balance,
        receiptId: r.id,
        invoiceId: inv.id,
        kind: "RentArrearsInterest",
      },
    }).catch((e) => console.error("Audit log failed:", e));

    return {
      ledgerId: id,
      message: `Rent deposit ledger: ChequeDishonour debit ₹${debit.toFixed(2)} posted (interest receipt; balance ₹${balance.toFixed(2)}).`,
    };
  }

  if (!isM03RentPrincipalReceipt(r)) return {};

  const [collection] = await db
    .select()
    .from(rentDepositLedger)
    .where(and(eq(rentDepositLedger.receiptId, r.id), eq(rentDepositLedger.entryType, "Collection")))
    .limit(1);
  if (!collection) {
    return {
      message:
        "Rent deposit ledger: no Collection row for this receipt — dishonour not auto-posted (add manual ledger entry if needed).",
    };
  }

  const [dup] = await db
    .select({ id: rentDepositLedger.id })
    .from(rentDepositLedger)
    .where(and(eq(rentDepositLedger.receiptId, r.id), eq(rentDepositLedger.entryType, "ChequeDishonour")))
    .limit(1);
  if (dup) return { ledgerId: dup.id, message: "Rent deposit ledger: ChequeDishonour already recorded for this receipt." };

  const [inv] = await db.select().from(rentInvoices).where(eq(rentInvoices.id, r.sourceRecordId!)).limit(1);
  if (!inv) return { message: "Rent deposit ledger: invoice missing; dishonour not posted." };

  const prev = await latestRentDepositLedgerRowForInvoice(inv);
  const prevBal = prev != null ? Number(prev.balance ?? 0) : 0;
  const debit = Number(r.totalAmount ?? 0);
  const balance = prevBal + debit;
  const id = nanoid();
  const entryDate = new Date().toISOString().slice(0, 10);

  const dishonourScope = rentInvoiceLedgerScope(inv);
  await db.insert(rentDepositLedger).values({
    id,
    tenantLicenceId: dishonourScope.ledgerTenantLicenceId,
    unifiedEntityId: dishonourScope.unifiedEntityId,
    assetId: inv.assetId,
    entryDate,
    entryType: "ChequeDishonour",
    debit,
    credit: 0,
    balance,
    invoiceId: inv.id,
    receiptId: r.id,
  });

  await db
    .update(rentDepositLedger)
    .set({ interestPaymentStatus: "Unpaid", settledReceiptId: null })
    .where(eq(rentDepositLedger.settledReceiptId, r.id));

  writeAuditLogSystem({
    module: "Rent/Tax",
    action: "RentDepositChequeDishonour",
    recordId: id,
    afterValue: {
      tenantLicenceId: inv.tenantLicenceId,
      assetId: inv.assetId,
      debit,
      balance,
      receiptId: r.id,
      invoiceId: inv.id,
    },
  }).catch((e) => console.error("Audit log failed:", e));

  return {
    ledgerId: id,
    message: `Rent deposit ledger: ChequeDishonour debit ₹${debit.toFixed(2)} posted (balance ₹${balance.toFixed(2)}).`,
  };
}
