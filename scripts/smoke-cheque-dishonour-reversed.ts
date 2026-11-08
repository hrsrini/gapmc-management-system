/**
 * Smoke: cheque/DD dishonour flips rent invoice Paid → Reversed and restores outstanding.
 * Usage: dotenv -e .env -- tsx scripts/smoke-cheque-dishonour-reversed.ts
 * Optional: SMOKE_URL + credentials to also exercise PATCH /api/ioms/receipts/:id
 */
import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "../server/db";
import { iomsReceipts, rentInvoices } from "@shared/db-schema";
import {
  collectedPrincipalPaidForInvoice,
} from "../server/m03-invoice-payment-sum";
import { revertM03InvoicesAfterChequeDishonour } from "../server/receipt-deposit-service";

async function main() {
  const candidates = await db
    .select({
      receiptId: iomsReceipts.id,
      receiptNo: iomsReceipts.receiptNo,
      paymentMode: iomsReceipts.paymentMode,
      receiptStatus: iomsReceipts.status,
      sourceRecordId: iomsReceipts.sourceRecordId,
      m03BreakdownJson: iomsReceipts.m03BreakdownJson,
      invoiceId: rentInvoices.id,
      invoiceNo: rentInvoices.invoiceNo,
      invoiceStatus: rentInvoices.status,
      totalAmount: rentInvoices.totalAmount,
    })
    .from(iomsReceipts)
    .innerJoin(rentInvoices, eq(iomsReceipts.sourceRecordId, rentInvoices.id))
    .where(
      and(
        eq(iomsReceipts.sourceModule, "M-03"),
        inArray(iomsReceipts.paymentMode, ["Cheque", "DD"]),
        or(eq(iomsReceipts.status, "Paid"), eq(iomsReceipts.status, "Reconciled")),
        eq(rentInvoices.status, "Paid"),
      ),
    )
    .limit(20);

  if (candidates.length === 0) {
    console.log(
      "No Paid Cheque/DD M-03 receipt linked to a Paid invoice found. " +
        "Pay a rent due by cheque first, then re-run this smoke.",
    );
    process.exit(0);
  }

  const row = candidates[0]!;
  const invoiceId = String(row.invoiceId);
  const receiptId = String(row.receiptId);
  const beforeStatus = String(row.invoiceStatus);
  const beforePaid = await collectedPrincipalPaidForInvoice(invoiceId);
  const total = Number(row.totalAmount ?? 0);

  console.log("Candidate:", {
    receiptNo: row.receiptNo,
    paymentMode: row.paymentMode,
    invoiceNo: row.invoiceNo,
    invoiceStatus: beforeStatus,
    total,
    paidBefore: beforePaid,
  });

  // Simulate receipt already marked Reversed (API does this before revert).
  await db.update(iomsReceipts).set({ status: "Reversed" }).where(eq(iomsReceipts.id, receiptId));

  await revertM03InvoicesAfterChequeDishonour({
    id: receiptId,
    sourceModule: "M-03",
    sourceRecordId: row.sourceRecordId,
    m03BreakdownJson: row.m03BreakdownJson,
  });

  const [invAfter] = await db.select().from(rentInvoices).where(eq(rentInvoices.id, invoiceId)).limit(1);
  const paidAfter = await collectedPrincipalPaidForInvoice(invoiceId);
  const afterStatus = String(invAfter?.status ?? "");

  console.log("After dishonour:", {
    invoiceStatus: afterStatus,
    paidAfter,
    outstanding: Math.max(0, Math.round((total - paidAfter) * 100) / 100),
  });

  const ok =
    afterStatus === "Reversed" &&
    paidAfter < total - 0.01 &&
    beforeStatus === "Paid";

  // Restore receipt + invoice so UAT data is not left reversed (unless KEEP=1).
  if (process.env.KEEP !== "1") {
    await db
      .update(iomsReceipts)
      .set({ status: String(row.receiptStatus ?? "Paid") })
      .where(eq(iomsReceipts.id, receiptId));
    await db.update(rentInvoices).set({ status: beforeStatus }).where(eq(rentInvoices.id, invoiceId));
    console.log("Restored receipt + invoice to prior statuses (set KEEP=1 to leave Reversed).");
  }

  if (!ok) {
    console.error("FAIL: expected invoice Paid → Reversed with restored outstanding.");
    process.exit(1);
  }
  console.log("PASS: cheque dishonour sets invoice status Reversed and restores outstanding.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
