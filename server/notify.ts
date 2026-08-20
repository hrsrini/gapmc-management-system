/**
 * Notifications: console + optional NOTIFY_WEBHOOK_URL + SMTP (Admin → Config → Gmail SMTP)
 * + optional NOTIFY_SMS_WEBHOOK_URL.
 *
 * Email entry points (all use resolveSmtpSettings / Admin Gmail config):
 * - dispatchNotification → default notify inbox (digests, SLA, HR alerts, M-02/M-05 crons)
 * - sendTransactionalEmailTo → employee login provision (M-01), portal access (M-10)
 *
 * Callers: sla-reminder, cron-receipt-deposit, cron-hr-retirement, cron-hr-leave-accrual,
 * cron-m02-entity-alerts, cron-operational-reminders, cron-amc-renewal-digest, routes-hr,
 * hr-employee-login, routes-portal.
 */
import { getEmailConfigStatus, resolveSmtpSettings, sendSmtpMail } from "./smtp-config";

export type { EmailConfigStatus } from "./smtp-config";
export { getEmailConfigStatus } from "./smtp-config";

export interface NotificationDispatchResult {
  consoleLogged: boolean;
  webhookSent: boolean;
  emailSent: boolean;
  smsSent: boolean;
}
export type SlaReminderPayload = {
  kind: "sla_reminder";
  workflow: string;
  hours: number;
  alertRole: string | null;
  message: string;
  overdueCount?: number;
};

export type RetirementReminderPayload = {
  kind: "retirement_reminder";
  employeeId: string;
  name: string;
  retirementDate: string;
  daysUntil: number;
  band: "180" | "90" | "60" | "30" | "due";
};

export type OperationalDigestPayload = {
  kind: "operational_digest";
  fleetAlertCount: number;
  amcAlertCount: number;
  /** M-07: vehicle rows with next_service_date within digest window (default 60 days). */
  maintenanceDueCount?: number;
};

export type LeaveElCapWarningPayload = {
  kind: "leave_el_cap_warning";
  employeeId: string;
  empId: string;
  name: string;
  leaveType: "EL";
  balanceDays: number;
  capDays: number;
  date: string;
};

export type EmployeeRegistrationPayload = {
  kind: "employee_registration";
  employeeId: string;
  status: "Submitted" | "Recommended" | "Approved";
  name: string;
  yardId?: string | null;
  empId?: string | null;
};

export type M02EntityAlertsPayload = {
  kind: "m02_entity_alerts";
  asOfDate: string; // YYYY-MM-DD
  expiringLicences60d: number;
  expiringLicences30d: number;
  expiredLicencesBlockedToday: number;
  overdueRentInvoices?: number;
  overduePreReceipts?: number;
};

export type ReceiptDepositEodPayload = {
  kind: "receipt_deposit_eod";
  asOfDate: string;
  totalUndeposited: number;
  hardCash: number;
  cheques: number;
  overdueCount: number;
  locationLines: string[];
};

export type ReceiptDepositOverduePayload = {
  kind: "receipt_deposit_overdue";
  maxCarryForwardDays: number;
  overdueReceiptCount: number;
  sampleReceipts: Array<{ receiptNo: string; yardId: string; daysSinceIssue: number; totalAmount: number }>;
};

export type LeaveWorkflowPayload = {
  kind: "leave_workflow";
  leaveRequestId: string;
  employeeId: string;
  empId: string;
  employeeName: string;
  leaveType: string;
  fromDate: string;
  toDate: string;
  status: string;
  actorLabel?: string;
};

export type NotificationPayload =
  | SlaReminderPayload
  | RetirementReminderPayload
  | OperationalDigestPayload
  | LeaveElCapWarningPayload
  | LeaveWorkflowPayload
  | EmployeeRegistrationPayload
  | M02EntityAlertsPayload
  | ReceiptDepositEodPayload
  | ReceiptDepositOverduePayload;

function payloadSummary(payload: NotificationPayload): { subject: string; text: string } {
  if (payload.kind === "sla_reminder") {
    return {
      subject: `[GAPMC SLA] ${payload.workflow}`,
      text: `${payload.message}\nWorkflow: ${payload.workflow}\nHours threshold: ${payload.hours}\nAlert role: ${payload.alertRole ?? "—"}\nCount: ${payload.overdueCount ?? "n/a"}`,
    };
  }
  if (payload.kind === "retirement_reminder") {
    return {
      subject: `[GAPMC HR] Retirement reminder: ${payload.name}`,
      text: `Employee ${payload.name} (${payload.employeeId}) retires on ${payload.retirementDate} (${payload.daysUntil} days, band ${payload.band}).`,
    };
  }
  if (payload.kind === "leave_el_cap_warning") {
    return {
      subject: `[GAPMC HR] EL cap warning: ${payload.name}`,
      text: `Employee ${payload.name} (${payload.empId}) has EL balance ${payload.balanceDays} days, above cap ${payload.capDays} (as of ${payload.date}).`,
    };
  }
  if (payload.kind === "leave_workflow") {
    const p = payload;
    return {
      subject: `[GAPMC HR] Leave ${p.status}: ${p.employeeName} (${p.leaveType})`,
      text:
        `Leave request ${p.leaveRequestId} for ${p.employeeName} (${p.empId})\n` +
        `Type: ${p.leaveType} | ${p.fromDate} to ${p.toDate}\n` +
        `Status: ${p.status}${p.actorLabel ? `\nActor: ${p.actorLabel}` : ""}`,
    };
  }
  if (payload.kind === "employee_registration") {
    const p = payload;
    return {
      subject: `[GAPMC HR] Employee registration ${p.status}: ${p.name}`,
      text: `Employee ${p.name} (${p.employeeId}) registration is ${p.status}${p.empId ? ` (EMP-ID ${p.empId})` : ""}. Yard: ${p.yardId ?? "—"}.`,
    };
  }
  if (payload.kind === "m02_entity_alerts") {
    const p = payload;
    return {
      subject: `[GAPMC M-02] Entity alerts (${p.asOfDate})`,
      text:
        `Licences expiring (<=60d): ${p.expiringLicences60d}\n` +
        `Licences expiring (<=30d): ${p.expiringLicences30d}\n` +
        `Expired licences auto-blocked today: ${p.expiredLicencesBlockedToday}\n` +
        `Overdue rent invoices: ${p.overdueRentInvoices ?? "n/a"}\n` +
        `Overdue pre-receipts: ${p.overduePreReceipts ?? "n/a"}`,
    };
  }
  if (payload.kind === "receipt_deposit_eod") {
    const p = payload;
    return {
      subject: `[GAPMC M-05] Cash-in-hand summary (${p.asOfDate})`,
      text:
        `Total undeposited: ₹${p.totalUndeposited.toFixed(2)}\n` +
        `Hard cash: ₹${p.hardCash.toFixed(2)}\n` +
        `Cheques pending: ₹${p.cheques.toFixed(2)}\n` +
        `Overdue for deposit: ${p.overdueCount} receipt(s)\n\n` +
        (p.locationLines.length ? p.locationLines.join("\n") : "No undeposited balances by location."),
    };
  }
  if (payload.kind === "receipt_deposit_overdue") {
    const p = payload;
    const sample = p.sampleReceipts
      .map((r) => `  ${r.receiptNo} (${r.daysSinceIssue}d, ₹${r.totalAmount.toFixed(2)})`)
      .join("\n");
    return {
      subject: `[GAPMC M-05] Deposit overdue alert`,
      text:
        `${p.overdueReceiptCount} receipt(s) undeposited beyond ${p.maxCarryForwardDays} working day(s).\n` +
        (sample ? `\n${sample}` : ""),
    };
  }
  const op = payload;
  const maint = op.maintenanceDueCount ?? 0;
  return {
    subject: "[GAPMC Ops] Fleet / AMC digest",
    text: `Fleet renewal alerts: ${op.fleetAlertCount}\nAMC renewal alerts: ${op.amcAlertCount}\nFleet maintenance due (60d): ${maint}`,
  };
}

export async function dispatchNotification(payload: NotificationPayload): Promise<NotificationDispatchResult> {
  const { subject, text } = payloadSummary(payload);
  console.log(`[NOTIFY] ${subject} — ${text.split("\n")[0]}`);

  const result: NotificationDispatchResult = {
    consoleLogged: true,
    webhookSent: false,
    emailSent: false,
    smsSent: false,
  };

  const webhook = process.env.NOTIFY_WEBHOOK_URL?.trim();
  if (webhook) {
    try {
      await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          subject,
          text,
          sentAt: new Date().toISOString(),
        }),
      });
      result.webhookSent = true;
    } catch (e) {
      console.error("[NOTIFY] webhook failed:", e);
    }
  }

  try {
    const emailStatus = await getEmailConfigStatus();
    if (emailStatus.notifyDigestsReady) {
      await sendSmtpMail({ to: emailStatus.notifyEmailTo, subject, text });
      result.emailSent = true;
    } else if (emailStatus.smtpReady) {
      console.warn(
        "[NOTIFY] SMTP is configured but default notify inbox is empty — set Admin → Config → Gmail SMTP → Default notify inbox.",
      );
    } else {
      console.log(
        "[NOTIFY] email skipped (Gmail SMTP not configured — enable in Admin → Config → Gmail SMTP).",
      );
    }
  } catch (e) {
    console.error("[NOTIFY] SMTP failed:", e);
  }

  const smsUrl = process.env.NOTIFY_SMS_WEBHOOK_URL?.trim();
  if (smsUrl) {
    try {
      await fetch(smsUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: "sms",
          ...payload,
          subject,
          text,
          sentAt: new Date().toISOString(),
        }),
      });
      result.smsSent = true;
    } catch (e) {
      console.error("[NOTIFY] SMS webhook failed:", e);
    }
  }

  return result;
}

/** Fire-and-forget wrapper for cron / SLA loops. */
export function sendNotificationStub(payload: NotificationPayload): void {
  void dispatchNotification(payload).catch((e) => console.error("[NOTIFY] dispatch failed:", e));
}

/**
 * Send one email to an arbitrary recipient (e.g. employee) when SMTP is configured.
 * US-M10-001: provisioning notice to the employee sign-in address. Failures are logged only.
 */
export async function sendTransactionalEmailTo(
  to: string,
  subject: string,
  text: string,
  attachments?: Array<{ filename: string; content: Buffer; contentType?: string }>,
): Promise<void> {
  const recipient = to.trim();
  if (!recipient) {
    console.log(`[NOTIFY] skip transactional email (empty to): ${subject}`);
    return;
  }
  try {
    const smtp = await resolveSmtpSettings();
    if (!smtp) {
      console.log(
        `[NOTIFY] skip transactional email (Gmail SMTP not configured — Admin → Config): ${subject}`,
      );
      return;
    }
    await sendSmtpMail({ to: recipient, subject, text, attachments });
    console.log(`[NOTIFY] transactional email sent to ${recipient}: ${subject}`);
  } catch (e) {
    console.error("[NOTIFY] transactional SMTP failed:", e);
  }
}
