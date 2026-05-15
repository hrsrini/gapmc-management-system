import { useMemo, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { SIDEBAR_MENU_GROUPS } from "@/config/sidebar-menu";
import { parseSidebarHiddenHrefsJson, SIDEBAR_MENU_VISIBILITY_PAGE_HREF } from "@shared/nav-sidebar-hidden";

function uniqueItemsByHref<T extends { href: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of items) {
    if (seen.has(it.href)) continue;
    seen.add(it.href);
    out.push(it);
  }
  return out;
}

export function AdminSidebarMenuVisibility({
  value,
  onChange,
}: {
  value: string;
  onChange: (json: string) => void;
}) {
  const hidden = useMemo(() => parseSidebarHiddenHrefsJson(value ?? "[]"), [value]);

  const setHiddenSet = useCallback(
    (next: Set<string>) => {
      next.delete(SIDEBAR_MENU_VISIBILITY_PAGE_HREF);
      onChange(JSON.stringify(Array.from(next).sort()));
    },
    [onChange],
  );

  const toggleHref = useCallback(
    (href: string, visible: boolean) => {
      const next = new Set(hidden);
      if (visible) next.delete(href);
      else next.add(href);
      setHiddenSet(next);
    },
    [hidden, setHiddenSet],
  );

  const showAll = useCallback(() => {
    setHiddenSet(new Set());
  }, [setHiddenSet]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground max-w-2xl">
          Turn off a switch to hide that sidebar link for everyone (RBAC still applies first — hidden links only affect users who would
          otherwise see them). The <span className="font-medium text-foreground">Sidebar menu visibility</span> entry is not listed here and is always shown.
          Save using <span className="font-medium text-foreground">Save changes</span> on this page.
        </p>
        <Button type="button" variant="outline" size="sm" onClick={showAll}>
          Show all links
        </Button>
      </div>

      <div className="space-y-6">
        {SIDEBAR_MENU_GROUPS.map((group) => {
          const items = uniqueItemsByHref(group.items).filter((item) => item.href !== SIDEBAR_MENU_VISIBILITY_PAGE_HREF);
          if (items.length === 0) return null;
          return (
            <div key={group.group} className="rounded-lg border bg-muted/30 p-4 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-medium text-sm">{group.group}</h3>
                {group.adminOnly ? (
                  <Badge variant="secondary" className="text-xs">
                    Admin-only section
                  </Badge>
                ) : null}
              </div>
              <div className="grid gap-3 sm:grid-cols-1 md:grid-cols-2">
                {items.map((item) => {
                  const visible = !hidden.has(item.href);
                  return (
                    <div
                      key={`${group.group}:${item.href}`}
                      className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2"
                    >
                      <div className="min-w-0 space-y-0.5">
                        <Label className="text-sm font-medium leading-tight">{item.title}</Label>
                        <div className="font-mono text-[11px] text-muted-foreground truncate">{item.href}</div>
                      </div>
                      <Switch checked={visible} onCheckedChange={(c) => toggleHref(item.href, Boolean(c))} aria-label={`Show ${item.title}`} />
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
