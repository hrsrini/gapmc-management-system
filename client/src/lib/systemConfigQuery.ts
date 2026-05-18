import type { QueryClient } from "@tanstack/react-query";
import { SYSTEM_CONFIG_KEYS_SENSITIVE } from "@shared/system-config-defaults";
import { fetchApiGet } from "@/lib/queryClient";

/** Single query key for GET /api/system/config (must match queryFn URL join). */
export const SYSTEM_CONFIG_QUERY_KEY = ["/api/system/config"] as const;

export function toPublicSystemConfig(merged: Record<string, string>): Record<string, string> {
  const out = { ...merged };
  for (const k of SYSTEM_CONFIG_KEYS_SENSITIVE) {
    delete out[k];
  }
  return out;
}

/** After PUT /api/admin/config, keep admin + public system_config caches in sync. */
export function applyAdminConfigPutToQueryCache(
  queryClient: QueryClient,
  merged: Record<string, string>,
): void {
  queryClient.setQueryData(["/api/admin/config"], merged);
  queryClient.setQueryData(SYSTEM_CONFIG_QUERY_KEY, toPublicSystemConfig(merged));
}

export async function refreshSystemConfigQueryCache(queryClient: QueryClient): Promise<void> {
  const cfg = await fetchApiGet<Record<string, string>>("/api/system/config");
  queryClient.setQueryData(SYSTEM_CONFIG_QUERY_KEY, cfg);
}
