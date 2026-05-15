import { useLayoutEffect, useEffect, useMemo } from "react";
import { useLocation, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
} from "@/components/ui/sidebar";
import { Leaf } from "lucide-react";
import { SIDEBAR_MENU_GROUPS } from "@/config/sidebar-menu";
import { parseSidebarHiddenHrefsJson, SIDEBAR_MENU_VISIBILITY_PAGE_HREF } from "@shared/nav-sidebar-hidden";

/** True if this menu href is a prefix of the current location (exact or child path). */
function menuHrefMatchesLocation(location: string, href: string): boolean {
  if (location === href) return true;
  if (href === "/dashboard") return false;
  return location.startsWith(`${href}/`);
}

/** Among visible sidebar links, the most specific href that matches wins (e.g. /bugs/dashboard over /bugs). */
function pickActiveMenuHref(location: string, hrefs: string[]): string | null {
  const matches = hrefs.filter((h) => menuHrefMatchesLocation(location, h));
  if (matches.length === 0) return null;
  return matches.reduce((a, b) => (a.length >= b.length ? a : b));
}

const SIDEBAR_CONTENT_SELECTOR = '[data-sidebar="content"]';
const SIDEBAR_SCROLL_KEY = "gapmc_sidebar_scroll";

/** Show Admin section if user has ADMIN role or any M-10 permission (from permission matrix). */
function hasAdminAccess(roles: { tier: string }[] | undefined, permissions: { module: string; action: string }[] | undefined): boolean {
  if (roles?.some((r) => r.tier === "ADMIN")) return true;
  return Boolean(permissions?.some((p) => p.module === "M-10"));
}

export function AppSidebar() {
  const [location] = useLocation();
  const { user, can } = useAuth();
  const isAdmin = hasAdminAccess(user?.roles, user?.permissions);

  const { data: systemConfig } = useQuery<Record<string, string>>({
    queryKey: ["/api/system/config"],
  });

  const hiddenHrefs = useMemo(
    () => parseSidebarHiddenHrefsJson(systemConfig?.ui_sidebar_hidden_hrefs_json),
    [systemConfig?.ui_sidebar_hidden_hrefs_json],
  );

  const visibleGroups = useMemo(() => {
    return SIDEBAR_MENU_GROUPS.filter((g) => !("adminOnly" in g && g.adminOnly) || isAdmin)
      .map((g) => ({
        ...g,
        items: g.items.filter(
          (item) =>
            (item.href === SIDEBAR_MENU_VISIBILITY_PAGE_HREF || !hiddenHrefs.has(item.href)) &&
            (!item.requirePermission || can(item.requirePermission.module, item.requirePermission.action)),
        ),
      }))
      .filter((g) => g.items.length > 0);
  }, [isAdmin, can, hiddenHrefs]);

  const visibleMenuHrefs = useMemo(() => visibleGroups.flatMap((g) => g.items.map((i) => i.href)), [visibleGroups]);
  const activeMenuHref = useMemo(() => pickActiveMenuHref(location, visibleMenuHrefs), [location, visibleMenuHrefs]);

  useEffect(() => {
    const el = document.querySelector(SIDEBAR_CONTENT_SELECTOR);
    if (!el) return;
    const onScroll = () => {
      try {
        sessionStorage.setItem(SIDEBAR_SCROLL_KEY, String(el.scrollTop));
      } catch (_) {}
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useLayoutEffect(() => {
    const saved = (() => {
      try {
        return sessionStorage.getItem(SIDEBAR_SCROLL_KEY);
      } catch {
        return null;
      }
    })();
    if (saved === null) return;
    const top = parseInt(saved, 10);
    if (!Number.isFinite(top) || top <= 0) return;

    const el = document.querySelector(SIDEBAR_CONTENT_SELECTOR);
    if (el) {
      el.scrollTop = top;
    } else {
      const id = requestAnimationFrame(() => {
        const el2 = document.querySelector(SIDEBAR_CONTENT_SELECTOR);
        if (el2) el2.scrollTop = top;
      });
      return () => cancelAnimationFrame(id);
    }
  }, [location]);

  return (
    <Sidebar className="border-r border-sidebar-border">
      <SidebarHeader className="p-4 border-b border-sidebar-border">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-white/10 text-white">
            <span className="text-xl font-bold">G</span>
          </div>
          <div className="flex flex-col">
            <span className="font-semibold text-sidebar-foreground flex items-center gap-1">
              <Leaf className="h-4 w-4" />
              Goa APMC
            </span>
            <span className="text-xs text-sidebar-foreground/70">Management System</span>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="px-2">
        {visibleGroups.map((group) => (
          <SidebarGroup key={group.group}>
            <SidebarGroupLabel className="text-sidebar-foreground/60 text-xs uppercase tracking-wider px-3">
              {group.group}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const isActive = item.href === activeMenuHref;
                  return (
                    <SidebarMenuItem key={`${group.group}-${item.href}-${item.title}`}>
                      <SidebarMenuButton
                        asChild
                        isActive={isActive}
                        className="data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground"
                      >
                        <Link href={item.href} data-testid={`nav-${item.title.toLowerCase().replace(/\s+/g, "-")}`}>
                          <item.icon className="h-4 w-4" />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
    </Sidebar>
  );
}
