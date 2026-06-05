/**
 * Seed bank account + undeposited cash/cheque receipts for M-05 §8.4 deposit UAT.
 * Idempotent — safe to re-run.
 *
 * Usage: npm run db:seed-receipt-deposit-uat
 */
import "dotenv/config";
import { and, eq } from "drizzle-orm";
import { db, pool } from "../server/db";
import { createIomsReceipt } from "../server/routes-receipts-ioms";
import {
  gaplmbBankAccountRoles,
  gaplmbBankAccounts,
  gaplmbBankAccountYards,
  iomsReceipts,
  yards,
} from "../shared/db-schema";
import { initialDepositStatusForPaymentMode } from "../shared/receipt-deposit";

const BANK_ID = "uat-bank-deposit-001";
const BANK_ACCOUNT_NO = "UAT-DEPOSIT-001";
const SEED_NARRATION = "UAT deposit workflow seed (safe to delete)";

function nowIso(): string {
  return new Date().toISOString();
}

async function ensureBankAccount(yardId: string, yardCode: string): Promise<void> {
  const [existing] = await db
    .select()
    .from(gaplmbBankAccounts)
    .where(eq(gaplmbBankAccounts.id, BANK_ID))
    .limit(1);
  if (existing) {
    console.log(`Bank account already exists: ${existing.bankName} (${existing.accountNumber})`);
    return;
  }

  const ts = nowIso();
  await db.insert(gaplmbBankAccounts).values({
    id: BANK_ID,
    bankName: "UAT GAPLMB Collection Account",
    accountNumber: BANK_ACCOUNT_NO,
    ifscCode: "UTIB000UAT1",
    branch: "Margao UAT",
    isActive: true,
    createdBy: "system",
    createdAt: ts,
    updatedAt: ts,
  });
  await db.insert(gaplmbBankAccountYards).values({ bankAccountId: BANK_ID, yardId });
  for (const tier of ["DO", "DV", "DA", "ADMIN"]) {
    await db.insert(gaplmbBankAccountRoles).values({ bankAccountId: BANK_ID, roleTier: tier });
  }
  console.log(`Created bank account ${BANK_ACCOUNT_NO} for yard ${yardCode}`);
}

async function ensureUndepositedReceipt(args: {
  yardId: string;
  paymentMode: "Cash" | "Cheque";
  amount: number;
  payerName: string;
  chequeNo?: string;
}): Promise<{ id: string; receiptNo: string }> {
  const [existing] = await db
    .select()
    .from(iomsReceipts)
    .where(
      and(
        eq(iomsReceipts.narration, SEED_NARRATION),
        eq(iomsReceipts.paymentMode, args.paymentMode),
        eq(iomsReceipts.yardId, args.yardId),
      ),
    )
    .limit(1);

  if (existing) {
    if (existing.depositStatus !== "Undeposited" || existing.status !== "Paid") {
      await db
        .update(iomsReceipts)
        .set({
          status: "Paid",
          depositStatus: "Undeposited",
          depositId: null,
          depositDeferredUntil: null,
        })
        .where(eq(iomsReceipts.id, existing.id));
      console.log(`Reset ${existing.receiptNo} to Paid / Undeposited`);
    } else {
      console.log(`Receipt already undeposited: ${existing.receiptNo} (${args.paymentMode})`);
    }
    return { id: existing.id, receiptNo: existing.receiptNo };
  }

  const { id, receiptNo } = await createIomsReceipt({
    yardId: args.yardId,
    revenueHead: "Rent",
    payerName: args.payerName,
    amount: args.amount,
    cgst: 0,
    sgst: 0,
    paymentMode: args.paymentMode,
    sourceModule: "M-05-UAT",
    narration: SEED_NARRATION,
    createdBy: "system",
    paymentDateYmd: new Date().toISOString().slice(0, 10),
    chequeNo: args.chequeNo ?? null,
    bankName: args.paymentMode === "Cheque" ? "UAT Test Bank" : null,
    chequeDate: args.paymentMode === "Cheque" ? new Date().toISOString().slice(0, 10) : null,
  });

  await db
    .update(iomsReceipts)
    .set({
      status: "Paid",
      depositStatus: initialDepositStatusForPaymentMode(args.paymentMode),
    })
    .where(eq(iomsReceipts.id, id));

  console.log(`Created undeposited ${args.paymentMode} receipt: ${receiptNo} (₹${args.amount})`);
  return { id, receiptNo };
}

async function main(): Promise<void> {
  const yardRows = await db.select().from(yards);
  const yard =
    yardRows.find((y) => String(y.code ?? "").toUpperCase() === "VAL") ??
    yardRows.find((y) => String(y.type ?? "").toLowerCase() === "yard") ??
    yardRows[0];
  if (!yard) {
    console.error("No yards found. Run: npm run db:seed-ioms-m10");
    process.exit(1);
  }

  console.log(`Using yard: ${yard.name} (${yard.code})`);
  await ensureBankAccount(yard.id, String(yard.code ?? yard.id));

  const cash = await ensureUndepositedReceipt({
    yardId: yard.id,
    paymentMode: "Cash",
    amount: 2500,
    payerName: "UAT Cash Payer",
  });
  const cheque = await ensureUndepositedReceipt({
    yardId: yard.id,
    paymentMode: "Cheque",
    amount: 7500,
    payerName: "UAT Cheque Payer",
    chequeNo: "UAT-CHQ-0001",
  });

  console.log("\n--- UAT walkthrough (TP-M05-007–011) ---");
  console.log("1. /admin/bank-accounts — confirm UAT GAPLMB Collection Account");
  console.log("2. /receipts/ioms/cash-in-hand — see ₹10,000 undeposited");
  console.log(`3. /receipts/ioms/deposit-entry — select yard ${yard.code}, batch both receipts`);
  console.log("4. /receipts/ioms/deposits — DV verify → DA approve");
  console.log(`5. Receipt detail: /receipts/ioms/${cash.id} and /receipts/ioms/${cheque.id}`);
  console.log("\nRe-run: npm run sit:receipt-deposit-workflow");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
