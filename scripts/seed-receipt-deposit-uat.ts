/**
 * Seed bank account + undeposited receipts for M-05 §8.4 deposit UAT (Step 6).
 * Idempotent — safe to re-run. Use --reset to force all seed receipts back to Undeposited.
 *
 * Usage: npm run db:seed-receipt-deposit-uat
 *        npm run db:seed-receipt-deposit-uat -- --reset
 */
import "dotenv/config";
import { and, eq, like } from "drizzle-orm";
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
const SEED_PREFIX = "UAT deposit seed |";

type SeedReceipt = {
  tag: string;
  paymentMode: "Cash" | "Cheque" | "DD";
  amount: number;
  payerName: string;
  chequeNo?: string;
  /** YYYY-MM-DD — backdate for overdue testing */
  paymentDateYmd?: string;
  /** YYYY-MM-DD — defer from cash-in-hand until this date */
  deferUntilYmd?: string;
};

const SEED_RECEIPTS: SeedReceipt[] = [
  { tag: "cash-standard", paymentMode: "Cash", amount: 2500, payerName: "UAT Cash Payer" },
  {
    tag: "cheque-standard",
    paymentMode: "Cheque",
    amount: 7500,
    payerName: "UAT Cheque Payer",
    chequeNo: "UAT-CHQ-0001",
  },
  { tag: "dd-standard", paymentMode: "DD", amount: 3000, payerName: "UAT DD Payer", chequeNo: "UAT-DD-0001" },
  {
    tag: "cash-overdue",
    paymentMode: "Cash",
    amount: 1200,
    payerName: "UAT Overdue Cash",
    paymentDateYmd: daysAgoYmd(5),
  },
  {
    tag: "cheque-deferred",
    paymentMode: "Cheque",
    amount: 4000,
    payerName: "UAT Deferred Cheque",
    chequeNo: "UAT-CHQ-DEFER",
    deferUntilYmd: daysAheadYmd(1),
  },
];

function nowIso(): string {
  return new Date().toISOString();
}

function daysAgoYmd(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function daysAheadYmd(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function narrationFor(tag: string): string {
  return `${SEED_PREFIX}${tag}`;
}

async function ensureBankAccount(yardId: string, yardCode: string): Promise<void> {
  const [existing] = await db
    .select()
    .from(gaplmbBankAccounts)
    .where(eq(gaplmbBankAccounts.id, BANK_ID))
    .limit(1);
  if (existing) {
    console.log(`Bank account: ${existing.bankName} (${existing.accountNumber})`);
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

async function ensureSeedReceipt(
  yardId: string,
  spec: SeedReceipt,
  forceReset: boolean,
): Promise<{ id: string; receiptNo: string; note: string }> {
  const narration = narrationFor(spec.tag);
  const [existing] = await db
    .select()
    .from(iomsReceipts)
    .where(and(eq(iomsReceipts.narration, narration), eq(iomsReceipts.yardId, yardId)))
    .limit(1);

  const paidAt =
    spec.paymentDateYmd && /^\d{4}-\d{2}-\d{2}$/.test(spec.paymentDateYmd)
      ? `${spec.paymentDateYmd}T10:00:00.000Z`
      : new Date().toISOString();

  if (existing) {
    const needsReset =
      forceReset ||
      existing.depositStatus !== "Undeposited" ||
      existing.status !== "Paid" ||
      (spec.deferUntilYmd && existing.depositDeferredUntil !== spec.deferUntilYmd) ||
      (!spec.deferUntilYmd && existing.depositDeferredUntil);
    if (needsReset) {
      await db
        .update(iomsReceipts)
        .set({
          status: "Paid",
          depositStatus: "Undeposited",
          depositId: null,
          depositDeferredUntil: spec.deferUntilYmd ?? null,
          createdAt: paidAt,
        })
        .where(eq(iomsReceipts.id, existing.id));
      console.log(`Reset ${existing.receiptNo} (${spec.tag})`);
      return { id: existing.id, receiptNo: existing.receiptNo, note: "reset" };
    }
    console.log(`OK ${existing.receiptNo} (${spec.tag})`);
    return { id: existing.id, receiptNo: existing.receiptNo, note: "exists" };
  }

  const { id, receiptNo } = await createIomsReceipt({
    yardId,
    revenueHead: "Rent",
    payerName: spec.payerName,
    amount: spec.amount,
    cgst: 0,
    sgst: 0,
    paymentMode: spec.paymentMode,
    sourceModule: "M-05-UAT",
    narration,
    createdBy: "system",
    paymentDateYmd: spec.paymentDateYmd ?? new Date().toISOString().slice(0, 10),
    chequeNo: spec.chequeNo ?? null,
    bankName: spec.paymentMode !== "Cash" ? "UAT Test Bank" : null,
    chequeDate:
      spec.paymentMode !== "Cash"
        ? (spec.paymentDateYmd ?? new Date().toISOString().slice(0, 10))
        : null,
  });

  await db
    .update(iomsReceipts)
    .set({
      status: "Paid",
      depositStatus: initialDepositStatusForPaymentMode(spec.paymentMode),
      depositDeferredUntil: spec.deferUntilYmd ?? null,
      createdAt: paidAt,
    })
    .where(eq(iomsReceipts.id, id));

  console.log(`Created ${receiptNo} (${spec.tag}) ₹${spec.amount}`);
  return { id, receiptNo, note: "created" };
}

async function main(): Promise<void> {
  const forceReset = process.argv.includes("--reset");
  const yardRows = await db.select().from(yards);
  const yard =
    yardRows.find((y) => String(y.code ?? "").toUpperCase() === "VAL") ??
    yardRows.find((y) => String(y.type ?? "").toLowerCase() === "yard") ??
    yardRows[0];
  if (!yard) {
    console.error("No yards found. Run: npm run db:seed-ioms-m10");
    process.exit(1);
  }

  console.log(`Yard: ${yard.name} (${yard.code})${forceReset ? " [--reset]" : ""}\n`);
  await ensureBankAccount(yard.id, String(yard.code ?? yard.id));

  const created: Array<{ id: string; receiptNo: string; tag: string }> = [];
  for (const spec of SEED_RECEIPTS) {
    const r = await ensureSeedReceipt(yard.id, spec, forceReset);
    created.push({ id: r.id, receiptNo: r.receiptNo, tag: spec.tag });
  }

  const seedRows = await db
    .select({
      receiptNo: iomsReceipts.receiptNo,
      paymentMode: iomsReceipts.paymentMode,
      totalAmount: iomsReceipts.totalAmount,
      depositStatus: iomsReceipts.depositStatus,
      depositDeferredUntil: iomsReceipts.depositDeferredUntil,
      createdAt: iomsReceipts.createdAt,
    })
    .from(iomsReceipts)
    .where(like(iomsReceipts.narration, `${SEED_PREFIX}%`));

  const due = seedRows.filter(
    (r) =>
      r.depositStatus === "Undeposited" &&
      (!r.depositDeferredUntil || r.depositDeferredUntil <= new Date().toISOString().slice(0, 10)),
  );
  const deferred = seedRows.filter(
    (r) => r.depositDeferredUntil && r.depositDeferredUntil > new Date().toISOString().slice(0, 10),
  );
  const dueTotal = due.reduce((s, r) => s + Number(r.totalAmount ?? 0), 0);

  console.log("\n--- Seed summary ---");
  console.log(`  Seed receipts: ${seedRows.length}`);
  console.log(`  Due for deposit: ${due.length} (₹${dueTotal.toFixed(2)})`);
  console.log(`  Deferred: ${deferred.length}`);

  console.log("\n--- Step 6 UAT (TP-M05-007–011) ---");
  console.log("1. /admin/bank-accounts — UAT GAPLMB Collection Account (UAT-DEPOSIT-001)");
  console.log(`2. /receipts/ioms/cash-in-hand?yardId=${yard.id} — overdue + defer sections`);
  console.log(`3. /receipts/ioms/deposit-entry — yard ${yard.code}: batch cash + cheque + DD (not deferred)`);
  console.log("4. /receipts/ioms/deposits — DV verify → DA approve");
  console.log("5. After approve: mark cheque Reversed on receipt detail (dishonour-after-deposit)");
  console.log("\nReceipt links:");
  for (const r of created) {
    console.log(`  ${r.tag}: /receipts/ioms/${r.id} (${r.receiptNo})`);
  }
  console.log("\nnpm run sit:receipt-deposit-workflow");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
