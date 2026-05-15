/**
 * M-10: Admin-config JSON array of sidebar `href` paths to hide app-wide (`ui_sidebar_hidden_hrefs_json`).
 */

/** This route is never hideable — admins must always reach menu visibility settings from the sidebar. */
export const SIDEBAR_MENU_VISIBILITY_PAGE_HREF = "/admin/sidebar-menu";

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
