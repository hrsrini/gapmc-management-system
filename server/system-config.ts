import { db } from "./db";
import { systemConfig } from "@shared/db-schema";
import {
  SYSTEM_CONFIG_DEFAULTS,
  SYSTEM_CONFIG_KEYS,
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
