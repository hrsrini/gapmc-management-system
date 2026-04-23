/**
 * M-03 rent deposit ledger: post **Collection** when an M-03 rent/GST receipt becomes Paid/Reconciled;
 * post **ChequeDishonour** reversal when such a receipt is reversed after payment.
 *
 * Running balance rule (same as seed samples): `balance = previousBalance + debit - credit`.
 */
import { and, desc, eq } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./db";
import { writeAuditLogSystem } from "./audit";
import { iomsReceipts, rentDepositLedger, rentInvoices } from "@shared/db-schema";
import { unifiedEntityIdFromTrackA } from "@shared/unified-entity-id";

type ReceiptRow = InferSelectModel<typeof iomsReceipts>;
type LedgerRow = InferSelectModel<typeof rentDepositLedger>;

async function latestLedgerRow(tenantLicenceId: string, assetId: string): Promise<LedgerRow | undefined> {
  const rows = await db
    .select()
    .from(rentDepositLedger)
    .where(and(eq(rentDepositLedger.tenantLicenceId, tenantLicenceId), eq(rentDepositLedger.assetId, assetId)))
    .orderBy(desc(rentDepositLedger.entryDate), desc(rentDepositLedger.id))
    .limit(1);
  return rows[0];
}

function isM03RentReceipt(r: ReceiptRow): boolean {
  return (
    r.sourceModule === "M-03" &&
    !!r.sourceRecordId &&
    (r.revenueHead === "Rent" || r.revenueHead === "GSTInvoice")
  );
}

/** Idempotent: one Collection row per receipt id. */
export async function recordRentCollectionForM03Receipt(r: ReceiptRow): Promise<{
  ledgerId?: string;
  message?: string;
}> {
  if (!isM03RentReceipt(r)) return {};
  if (r.status !== "Paid" && r.status !== "Reconciled") return {};

  const [dup] = await db
    .select({ id: rentDepositLedger.id })
    .from(rentDepositLedger)
    .where(and(eq(rentDepositLedger.receiptId, r.id), eq(rentDepositLedger.entryType, "Collection")))
    .limit(1);
  if (dup) return { ledgerId: dup.id, message: "Rent deposit ledger: Collection already recorded for this receipt." };

  const [inv] = await db.select().from(rentInvoices).where(eq(rentInvoices.id, r.sourceRecordId!)).limit(1);
  if (!inv) return { message: "Rent deposit ledger: linked invoice not found; no Collection row posted." };

  const prev = await latestLedgerRow(inv.tenantLicenceId, inv.assetId);
  const prevBal = prev != null ? Number(prev.balance ?? 0) : 0;
  const credit = Number(r.totalAmount ?? 0);
  const balance = prevBal - credit;
  const id = nanoid();
  const entryDate = new Date().toISOString().slice(0, 10);

  await db.insert(rentDepositLedger).values({
    id,
    tenantLicenceId: inv.tenantLicenceId,
    unifiedEntityId: unifiedEntityIdFromTrackA(inv.tenantLicenceId),
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

/** Reversal when cheque/DD dishonoured; requires a prior Collection for this receipt. */
export async function recordChequeDishonourLedgerForM03Receipt(r: ReceiptRow): Promise<{
  ledgerId?: string;
  message?: string;
}> {
  if (!isM03RentReceipt(r)) return {};

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

  const prev = await latestLedgerRow(inv.tenantLicenceId, inv.assetId);
  const prevBal = prev != null ? Number(prev.balance ?? 0) : 0;
  const debit = Number(r.totalAmount ?? 0);
  const balance = prevBal + debit;
  const id = nanoid();
  const entryDate = new Date().toISOString().slice(0, 10);

  await db.insert(rentDepositLedger).values({
    id,
    tenantLicenceId: inv.tenantLicenceId,
    unifiedEntityId: unifiedEntityIdFromTrackA(inv.tenantLicenceId),
    assetId: inv.assetId,
    entryDate,
    entryType: "ChequeDishonour",
    debit,
    credit: 0,
    balance,
    invoiceId: inv.id,
    receiptId: r.id,
  });

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
