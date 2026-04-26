import { db } from "./db";
import { systemConfig } from "@shared/db-schema";
import {
  SYSTEM_CONFIG_DEFAULTS,
  SYSTEM_CONFIG_KEYS,
  SYSTEM_CONFIG_KEYS_SENSITIVE,
  type SystemConfigKey,
} from "@shared/system-config-defaults";

const keySet = new Set<string>(SYSTEM_CONFIG_KEYS);

/** DB values merged over code defaults (only known keys). */
export async function getMergedSystemConfig(): Promise<Record<SystemConfigKey, string>> {
  const rows = await db.select().from(systemConfig);
  const out: Record<SystemConfigKey, string> = { ...SYSTEM_CONFIG_DEFAULTS };
  for (const r of rows) {
    if (keySet.has(r.key)) {
      out[r.key as SystemConfigKey] = r.value;
    }
  }
  return out;
}

/** M-01: DB system_config first; optional env AADHAAR_HMAC_SECRET when unset in DB (legacy). */
export async function resolveAadhaarHmacSecret(): Promise<string | null> {
  const merged = await getMergedSystemConfig();
  const fromDb = merged.aadhaar_hmac_secret?.trim();
  if (fromDb) return fromDb;
  const fromEnv = process.env.AADHAAR_HMAC_SECRET?.trim();
  if (fromEnv) return fromEnv;
  return null;
}

/** Strip keys that must not appear on GET /api/system/config. */
export function omitSensitiveSystemConfigKeys(merged: Record<SystemConfigKey, string>): Record<string, string> {
  const out: Record<string, string> = { ...merged };
  for (const k of SYSTEM_CONFIG_KEYS_SENSITIVE) {
    delete out[k];
  }
  return out;
}

export function parseSystemConfigNumber(
  map: Record<SystemConfigKey, string>,
  key: SystemConfigKey,
): number {
  const n = parseFloat(map[key]);
  const fb = parseFloat(SYSTEM_CONFIG_DEFAULTS[key]);
  if (Number.isFinite(n)) return n;
  if (Number.isFinite(fb)) return fb;
  return 0;
}
