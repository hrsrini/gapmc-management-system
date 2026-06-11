/**
 * Resolve SMTP settings from system_config (Admin → Email) with legacy env fallback.
 */
import type nodemailer from "nodemailer";
import {
  GMAIL_SMTP_HOST,
  GMAIL_SMTP_PORT,
  GMAIL_SMTP_SECURE,
  type SmtpEmailConfigKey,
} from "@shared/smtp-email-config";
import { parseSystemConfigBoolean, type SystemConfigKey } from "@shared/system-config-defaults";
import { getMergedSystemConfig } from "./system-config";

export interface ResolvedSmtpSettings {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  notifyEmailTo: string;
  source: "database" | "environment";
}

function formatFromAddress(email: string, displayName: string | undefined): string {
  const e = email.trim();
  const n = displayName?.trim();
  if (!n) return e;
  const safe = n.replace(/"/g, "'");
  return `"${safe}" <${e}>`;
}

function envResolved(): ResolvedSmtpSettings | null {
  const host = process.env.SMTP_HOST?.trim();
  const from = process.env.SMTP_FROM?.trim();
  const user = process.env.SMTP_USER?.trim() ?? "";
  const pass = process.env.SMTP_PASS ?? "";
  const notifyEmailTo = process.env.NOTIFY_EMAIL_TO?.trim() ?? "";
  if (!host || !from) return null;
  return {
    host,
    port: Number(process.env.SMTP_PORT || "587"),
    secure: process.env.SMTP_SECURE === "true",
    user: user || from,
    pass,
    from,
    notifyEmailTo,
    source: "environment",
  };
}

export async function resolveSmtpSettings(): Promise<ResolvedSmtpSettings | null> {
  const cfg = await getMergedSystemConfig();
  const enabled = parseSystemConfigBoolean(cfg.smtp_enabled, false);

  if (!enabled) {
    return envResolved();
  }

  const user = cfg.smtp_user?.trim() ?? "";
  const pass = cfg.smtp_pass?.trim() ?? "";
  const fromEmail = (cfg.smtp_from?.trim() || user).trim();
  if (!user || !pass || !fromEmail) {
    return envResolved();
  }

  const provider = (cfg.smtp_provider?.trim() || "gmail").toLowerCase();
  const host =
    provider === "gmail" ? GMAIL_SMTP_HOST : (cfg.smtp_host?.trim() || GMAIL_SMTP_HOST);
  const port = Number(provider === "gmail" ? GMAIL_SMTP_PORT : cfg.smtp_port || GMAIL_SMTP_PORT);
  const secure = provider === "gmail" ? false : parseSystemConfigBoolean(cfg.smtp_secure, false);

  return {
    host,
    port: Number.isFinite(port) ? port : 587,
    secure,
    user,
    pass,
    from: formatFromAddress(fromEmail, cfg.smtp_from_display_name),
    notifyEmailTo: cfg.notify_email_to?.trim() ?? "",
    source: "database",
  };
}

export async function createSmtpTransporter(): Promise<nodemailer.Transporter | null> {
  const settings = await resolveSmtpSettings();
  if (!settings) return null;
  const nodemailerMod = await import("nodemailer");
  return nodemailerMod.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    auth: { user: settings.user, pass: settings.pass },
  });
}

export async function verifySmtpConnection(): Promise<void> {
  const transporter = await createSmtpTransporter();
  if (!transporter) {
    throw new Error("SMTP is not configured. Enable email in Admin → Config and save Gmail settings.");
  }
  await transporter.verify();
}

export async function sendSmtpMail(opts: {
  to: string;
  subject: string;
  text: string;
}): Promise<void> {
  const settings = await resolveSmtpSettings();
  const transporter = await createSmtpTransporter();
  const to = opts.to.trim();
  if (!settings || !transporter || !to) {
    throw new Error("SMTP is not configured or recipient is empty.");
  }
  await transporter.sendMail({
    from: settings.from,
    to,
    subject: opts.subject,
    text: opts.text,
  });
}

export interface EmailConfigStatus {
  /** SMTP credentials available (transactional + digest sends). */
  smtpReady: boolean;
  /** SMTP + default notify inbox (system digests / alerts). */
  notifyDigestsReady: boolean;
  source: ResolvedSmtpSettings["source"] | "none";
  notifyEmailTo: string;
}

export async function getEmailConfigStatus(): Promise<EmailConfigStatus> {
  const settings = await resolveSmtpSettings();
  if (!settings) {
    return { smtpReady: false, notifyDigestsReady: false, source: "none", notifyEmailTo: "" };
  }
  const notifyEmailTo = settings.notifyEmailTo.trim();
  return {
    smtpReady: true,
    notifyDigestsReady: notifyEmailTo.length > 0,
    source: settings.source,
    notifyEmailTo,
  };
}

export function pickEmailConfigValues(
  merged: Record<SystemConfigKey, string>,
): Record<SmtpEmailConfigKey, string> {
  return {
    smtp_enabled: merged.smtp_enabled ?? "",
    smtp_provider: merged.smtp_provider ?? "gmail",
    smtp_host: merged.smtp_host ?? GMAIL_SMTP_HOST,
    smtp_port: merged.smtp_port ?? GMAIL_SMTP_PORT,
    smtp_secure: merged.smtp_secure ?? GMAIL_SMTP_SECURE,
    smtp_user: merged.smtp_user ?? "",
    smtp_pass: merged.smtp_pass ?? "",
    smtp_from: merged.smtp_from ?? "",
    smtp_from_display_name: merged.smtp_from_display_name ?? "",
    notify_email_to: merged.notify_email_to ?? "",
  };
}
