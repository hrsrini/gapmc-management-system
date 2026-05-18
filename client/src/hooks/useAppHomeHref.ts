import { useQuery } from "@tanstack/react-query";
import { resolveAppHomeHref } from "@shared/nav-sidebar-hidden";

/** Authenticated app home: `/welcome` when Dashboard is hidden in sidebar visibility, else `/dashboard`. */
export function useAppHomeHref(fallback = "/dashboard"): string {
  const { data: systemConfig } = useQuery<Record<string, string>>({
    queryKey: ["/api/system/config"],
  });
  if (systemConfig == null) return fallback;
  return resolveAppHomeHref(systemConfig.ui_sidebar_hidden_hrefs_json);
}
