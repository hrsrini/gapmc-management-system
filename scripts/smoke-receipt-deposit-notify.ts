/**
 * Smoke-test M-05 §8.4 EOD + overdue notifications (console + optional SMTP/webhook).
 * Usage: npm run smoke:receipt-deposit-notify
 */
import { runReceiptDepositDailyJobs } from "../server/cron-receipt-deposit";

async function main() {
  const hasEmail = Boolean(process.env.NOTIFY_EMAIL_TO?.trim() && process.env.SMTP_HOST?.trim());
  const hasWebhook = Boolean(process.env.NOTIFY_WEBHOOK_URL?.trim());
  console.log("Notify channels:");
  console.log(`  console: always`);
  console.log(`  SMTP email: ${hasEmail ? "configured" : "NOT configured (set NOTIFY_EMAIL_TO + SMTP_*)"}`);
  console.log(`  webhook: ${hasWebhook ? "configured" : "not set"}`);
  console.log("\nRunning receipt deposit daily jobs…");
  await runReceiptDepositDailyJobs();
  console.log("\nDone. Check console output above for [NOTIFY] lines.");
  if (!hasEmail && !hasWebhook) {
    console.warn("\nWARN: No external notify channel configured — only console stub fired.");
    process.exit(0);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
