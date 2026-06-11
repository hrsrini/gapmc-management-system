/**
 * Admin API helpers for Gmail / SMTP email configuration (system_config).
 */
import { eq } from "drizzle-orm";
import { db } from "./db";
import { systemConfig } from "@shared/db-schema";
import {
  GMAIL_SMTP_HOST,
  GMAIL_SMTP_PORT,
  GMAIL_SMTP_SECURE,
  SMTP_EMAIL_CONFIG_KEYS,
  type SmtpEmailConfigKey,
} from "@shared/smtp-email-config";
import { parseSystemConfigBoolean } from "@shared/system-config-defaults";
import { getMergedSystemConfig } from "./system-config";
import { getEmailConfigStatus, pickEmailConfigValues } from "./smtp-config";

const EMAIL_KEY_SET = new Set<string>(SMTP_EMAIL_CONFIG_KEYS);

export interface AdminEmailConfigDto {
  smtp_enabled: string;
  smtp_provider: string;
  smtp_host: string;
  smtp_port: string;
  smtp_secure: string;
  smtp_user: string;
  smtp_from: string;
  smtp_from_display_name: string;
  notify_email_to: string;
  smtp_pass_configured: boolean;
  env_fallback_configured: boolean;
  smtp_ready: boolean;
  notify_digests_ready: boolean;
  config_source: "database" | "environment" | "none";
}

export async function adminEmailConfigDtoAsync(merged: Record<string, string>): Promise<AdminEmailConfigDto> {
  const base = adminEmailConfigDto(merged);
  const status = await getEmailConfigStatus();
  return {
    ...base,
    smtp_ready: status.smtpReady,
    notify_digests_ready: status.notifyDigestsReady,
    config_source: status.source,
  };
}

export function adminEmailConfigDto(merged: Record<string, string>): AdminEmailConfigDto {
  const values = pickEmailConfigValues(merged as Record<import("@shared/system-config-defaults").SystemConfigKey, string>);
  const envFallback = Boolean(process.env.SMTP_HOST?.trim() && process.env.SMTP_FROM?.trim());
  return {
    smtp_enabled: values.smtp_enabled,
    smtp_provider: values.smtp_provider || "gmail",
    smtp_host: values.smtp_host,
    smtp_port: values.smtp_port,
    smtp_secure: values.smtp_secure,
    smtp_user: values.smtp_user,
    smtp_from: values.smtp_from,
    smtp_from_display_name: values.smtp_from_display_name,
    notify_email_to: values.notify_email_to,
    smtp_pass_configured: Boolean(values.smtp_pass?.trim()),
    env_fallback_configured: envFallback,
    smtp_ready: false,
    notify_digests_ready: false,
    config_source: "none",
  };
}

function isEmailLike(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export async function validateAndNormalizeEmailConfigPut(
  body: Record<string, unknown>,
  existing: Record<SmtpEmailConfigKey, string>,
): Promise<{ values: Record<SmtpEmailConfigKey, string>; error?: { code: string; message: string } }> {
  const out = { ...existing };

  for (const key of SMTP_EMAIL_CONFIG_KEYS) {
    if (!(key in body)) continue;
    if (key === "smtp_pass") {
      const pass = String(body.smtp_pass ?? "").trim();
      if (pass) out.smtp_pass = pass;
      continue;
    }
    out[key] = String(body[key] ?? "").trim();
  }

  if ("smtp_enabled" in body) {
    const enabled = parseSystemConfigBoolean(String(body.smtp_enabled), false);
    out.smtp_enabled = enabled ? "true" : "false";
  }

  const provider = (out.smtp_provider || "gmail").trim().toLowerCase();
  if (provider !== "gmail" && provider !== "custom") {
    return { values: out, error: { code: "SMTP_PROVIDER", message: "smtp_provider must be gmail or custom." } };
  }
  out.smtp_provider = provider;

  if (provider === "gmail") {
    out.smtp_host = GMAIL_SMTP_HOST;
    out.smtp_port = GMAIL_SMTP_PORT;
    out.smtp_secure = GMAIL_SMTP_SECURE;
  } else {
    if (!out.smtp_host.trim()) {
      return { values: out, error: { code: "SMTP_HOST", message: "SMTP host is required for custom provider." } };
    }
    const port = Number(out.smtp_port);
    if (!Number.isFinite(port) || port < 1 || port > 65535) {
      return { values: out, error: { code: "SMTP_PORT", message: "SMTP port must be between 1 and 65535." } };
    }
    const secure = out.smtp_secure.trim().toLowerCase();
    if (secure !== "true" && secure !== "false") {
      return { values: out, error: { code: "SMTP_SECURE", message: "smtp_secure must be true or false." } };
    }
    out.smtp_secure = secure;
  }

  const enabled = parseSystemConfigBoolean(out.smtp_enabled, false);
  if (enabled) {
    if (!isEmailLike(out.smtp_user)) {
      return { values: out, error: { code: "SMTP_USER", message: "Enter a valid Gmail / SMTP username (email)." } };
    }
    const passInBody = "smtp_pass" in body ? String(body.smtp_pass ?? "").trim() : "";
    const passExisting = existing.smtp_pass?.trim() ?? "";
    if (!passInBody && !passExisting) {
      return {
        values: out,
        error: {
          code: "SMTP_PASS",
          message: "Gmail App Password is required when enabling SMTP.",
        },
      };
    }
    if (passInBody) {
      out.smtp_pass = passInBody;
    } else {
      out.smtp_pass = existing.smtp_pass;
    }
    if (out.smtp_from.trim() && !isEmailLike(out.smtp_from)) {
      return { values: out, error: { code: "SMTP_FROM", message: "From email must be a valid address." } };
    }
    if (out.notify_email_to.trim() && !isEmailLike(out.notify_email_to)) {
      return {
        values: out,
        error: { code: "NOTIFY_EMAIL_TO", message: "Default notify inbox must be a valid email." },
      };
    }
  } else if ("smtp_pass" in body) {
    const passInBody = String(body.smtp_pass ?? "").trim();
    if (passInBody) out.smtp_pass = passInBody;
  }

  return { values: out };
}

export async function saveEmailConfigValues(
  userId: string,
  values: Record<SmtpEmailConfigKey, string>,
  keysToSave: readonly SmtpEmailConfigKey[],
): Promise<void> {
  const ts = new Date().toISOString();
  for (const key of keysToSave) {
    if (!EMAIL_KEY_SET.has(key)) continue;
    const value = values[key] ?? "";
    await db
      .insert(systemConfig)
      .values({ key, value, updatedBy: userId, updatedAt: ts })
      .onConflictDoUpdate({
        target: systemConfig.key,
        set: { value, updatedBy: userId, updatedAt: ts },
      });
  }
}
