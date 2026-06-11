/**
 * Smoke-test M-05 §8.4 EOD + overdue notifications (console + optional SMTP/webhook).
 * Usage: npm run smoke:receipt-deposit-notify
 */
import { runReceiptDepositDailyJobs } from "../server/cron-receipt-deposit";
import { getEmailConfigStatus } from "../server/smtp-config";

async function main() {
  const email = await getEmailConfigStatus();
  const hasWebhook = Boolean(process.env.NOTIFY_WEBHOOK_URL?.trim());
  console.log("Notify channels:");
  console.log("  console: always");
  if (email.notifyDigestsReady) {
    console.log(`  SMTP email: ready (${email.notifyEmailTo}, source: ${email.source})`);
  } else if (email.smtpReady) {
    console.log(
      "  SMTP email: SMTP ready but default notify inbox empty — set Admin → Config → Gmail SMTP → Default notify inbox",
    );
  } else {
    console.log(
      "  SMTP email: not configured — enable Gmail SMTP in Admin → Config (or legacy SMTP_* / NOTIFY_EMAIL_TO env)",
    );
  }
  console.log(`  webhook: ${hasWebhook ? "configured" : "not set"}`);
  console.log("\nRunning receipt deposit daily jobs…");
  const dispatch = await runReceiptDepositDailyJobs();
  console.log("\nDone. Check console output above for [NOTIFY] lines.");
  console.log(`  emailSent: ${dispatch.emailSent}, webhookSent: ${dispatch.webhookSent}`);
  if (!email.notifyDigestsReady && !hasWebhook) {
    console.warn("\nWARN: No external notify channel configured — only console stub fired.");
    process.exit(0);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
