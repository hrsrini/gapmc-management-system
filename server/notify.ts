/**
 * Notifications: console + optional NOTIFY_WEBHOOK_URL + optional SMTP (NOTIFY_EMAIL_TO, SMTP_*)
 * + optional NOTIFY_SMS_WEBHOOK_URL (client/NIC SMS gateway — POST JSON same shape as generic webhook).
 * Failures are logged; never throw to callers of sendNotificationStub.
 */
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

export type NotificationPayload = SlaReminderPayload | RetirementReminderPayload | OperationalDigestPayload;

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
  const op = payload;
  const maint = op.maintenanceDueCount ?? 0;
  return {
    subject: "[GAPMC Ops] Fleet / AMC digest",
    text: `Fleet renewal alerts: ${op.fleetAlertCount}\nAMC renewal alerts: ${op.amcAlertCount}\nFleet maintenance due (60d): ${maint}`,
  };
}

export async function dispatchNotification(payload: NotificationPayload): Promise<void> {
  const { subject, text } = payloadSummary(payload);
  console.log(`[NOTIFY] ${subject} — ${text.split("\n")[0]}`);

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
    } catch (e) {
      console.error("[NOTIFY] webhook failed:", e);
    }
  }

  const host = process.env.SMTP_HOST?.trim();
  const from = process.env.SMTP_FROM?.trim();
  const to = process.env.NOTIFY_EMAIL_TO?.trim();
  if (host && from && to) {
    try {
      const nodemailer = await import("nodemailer");
      const transporter = nodemailer.createTransport({
        host,
        port: Number(process.env.SMTP_PORT || "587"),
        secure: process.env.SMTP_SECURE === "true",
        auth:
          process.env.SMTP_USER?.trim() != null && process.env.SMTP_USER !== ""
            ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? "" }
            : undefined,
      });
      await transporter.sendMail({ from, to, subject, text });
    } catch (e) {
      console.error("[NOTIFY] SMTP failed:", e);
    }
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
    } catch (e) {
      console.error("[NOTIFY] SMS webhook failed:", e);
    }
  }
}

/** Fire-and-forget wrapper for cron / SLA loops. */
export function sendNotificationStub(payload: NotificationPayload): void {
  void dispatchNotification(payload).catch((e) => console.error("[NOTIFY] dispatch failed:", e));
}
