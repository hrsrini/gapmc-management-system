/**
 * M-05 §8.4 — EOD cash-in-hand summary (BR-RCP-55) and overdue deposit alerts (BR-RCP-56 / E-RCP-005).
 */
import { getMergedSystemConfig, parseSystemConfigNumber } from "./system-config";
import { buildCashInHandEodDigest, buildDepositOverdueAlert } from "./receipt-deposit-service";
import { sendNotificationStub } from "./notify";

export async function runReceiptDepositEodSummary(): Promise<void> {
  const cfg = await getMergedSystemConfig();
  const maxDays = parseSystemConfigNumber(cfg, "receipt_deposit_carry_forward_days") || 2;
  const digest = await buildCashInHandEodDigest(maxDays);

  const lines = digest.locations
    .filter((l) => l.totalUndeposited > 0)
    .map(
      (l) =>
        `${l.yardName}: cash ₹${l.hardCashBalance.toFixed(2)}, cheques ₹${l.chequesPendingDeposit.toFixed(2)}, overdue ${l.overdueCount}`,
    );

  sendNotificationStub({
    kind: "receipt_deposit_eod",
    asOfDate: digest.asOfDate,
    totalUndeposited: digest.totals.total,
    hardCash: digest.totals.hardCash,
    cheques: digest.totals.cheques,
    overdueCount: digest.totals.overdueCount,
    locationLines: lines,
  });
}

export async function runReceiptDepositOverdueAlerts(): Promise<void> {
  const cfg = await getMergedSystemConfig();
  const maxDays = parseSystemConfigNumber(cfg, "receipt_deposit_carry_forward_days") || 2;
  const alert = await buildDepositOverdueAlert(maxDays);
  if (alert.overdueReceiptCount <= 0) return;

  sendNotificationStub({
    kind: "receipt_deposit_overdue",
    maxCarryForwardDays: maxDays,
    overdueReceiptCount: alert.overdueReceiptCount,
    sampleReceipts: alert.receipts.slice(0, 20),
  });
}

export async function runReceiptDepositDailyJobs(): Promise<void> {
  await runReceiptDepositEodSummary();
  await runReceiptDepositOverdueAlerts();
}
