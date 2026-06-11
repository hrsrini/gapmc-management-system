/**
 * M-10 Admin → Email (Gmail SMTP). Stored in gapmc.system_config; env SMTP_* is legacy fallback.
 */
export const GMAIL_SMTP_HOST = "smtp.gmail.com";
export const GMAIL_SMTP_PORT = "587";
export const GMAIL_SMTP_SECURE = "false";

export const SMTP_EMAIL_CONFIG_KEYS = [
  "smtp_enabled",
  "smtp_provider",
  "smtp_host",
  "smtp_port",
  "smtp_secure",
  "smtp_user",
  "smtp_pass",
  "smtp_from",
  "smtp_from_display_name",
  "notify_email_to",
] as const;

export type SmtpEmailConfigKey = (typeof SMTP_EMAIL_CONFIG_KEYS)[number];

export const SMTP_EMAIL_CONFIG_DEFAULTS: Record<SmtpEmailConfigKey, string> = {
  smtp_enabled: "false",
  smtp_provider: "gmail",
  smtp_host: GMAIL_SMTP_HOST,
  smtp_port: GMAIL_SMTP_PORT,
  smtp_secure: GMAIL_SMTP_SECURE,
  smtp_user: "",
  smtp_pass: "",
  smtp_from: "",
  smtp_from_display_name: "GAPLMB IOMS",
  notify_email_to: "",
};

export const SMTP_EMAIL_CONFIG_LABELS: Record<SmtpEmailConfigKey, string> = {
  smtp_enabled: "Enable outbound email (SMTP)",
  smtp_provider: "SMTP provider",
  smtp_host: "SMTP host",
  smtp_port: "SMTP port",
  smtp_secure: "Use TLS on port 465 (smtp_secure)",
  smtp_user: "Gmail address (SMTP username)",
  smtp_pass: "Gmail App Password",
  smtp_from: "From email (optional; defaults to Gmail address)",
  smtp_from_display_name: "From display name",
  notify_email_to: "Default notify inbox (digests & alerts)",
};
