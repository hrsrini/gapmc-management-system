/**
 * M-10: Admin-config JSON array of sidebar `href` paths to hide app-wide (`ui_sidebar_hidden_hrefs_json`).
 */

/** This route is never hideable — admins must always reach menu visibility settings from the sidebar. */
export const SIDEBAR_MENU_VISIBILITY_PAGE_HREF = "/admin/sidebar-menu";

/** Sidebar Dashboard link (Admin → Sidebar menu visibility can hide this). */
export const DASHBOARD_SIDEBAR_HREF = "/dashboard";

/** Landing page when Dashboard is hidden from the sidebar. */
export const WELCOME_PAGE_HREF = "/welcome";

export function isDashboardHiddenInSidebar(raw: string | undefined): boolean {
  return parseSidebarHiddenHrefsJson(raw).has(DASHBOARD_SIDEBAR_HREF);
}

/** Post-login / “home” route: welcome when dashboard is hidden, otherwise dashboard. */
export function resolveAppHomeHref(raw: string | undefined): string {
  return isDashboardHiddenInSidebar(raw) ? WELCOME_PAGE_HREF : DASHBOARD_SIDEBAR_HREF;
}

export function parseSidebarHiddenHrefsJson(raw: string | undefined): Set<string> {
  try {
    const j = JSON.parse(raw == null || String(raw).trim() === "" ? "[]" : String(raw).trim());
    if (!Array.isArray(j)) return new Set();
    return new Set(j.filter((x): x is string => typeof x === "string" && x.startsWith("/")));
  } catch {
    return new Set();
  }
}

/** Persisted JSON must not include the visibility settings path (ignored by the sidebar anyway). */
export function stripSidebarMenuVisibilityPageFromHiddenJson(raw: string): string {
  const s = parseSidebarHiddenHrefsJson(raw);
  s.delete(SIDEBAR_MENU_VISIBILITY_PAGE_HREF);
  return JSON.stringify(Array.from(s).sort());
}
