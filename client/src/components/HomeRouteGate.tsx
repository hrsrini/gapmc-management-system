import { Redirect } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DASHBOARD_SIDEBAR_HREF,
  isDashboardHiddenInSidebar,
  WELCOME_PAGE_HREF,
} from "@shared/nav-sidebar-hidden";
import Dashboard from "@/pages/Dashboard";
import Welcome from "@/pages/Welcome";

function ConfigLoading() {
  return (
    <div className="min-h-[40vh] flex items-center justify-center p-8">
      <Skeleton className="h-8 w-48" />
    </div>
  );
}

/** Renders Dashboard, or redirects to Welcome when Dashboard is hidden in sidebar visibility. */
export function DashboardRouteGate() {
  const { data: systemConfig, isLoading } = useQuery<Record<string, string>>({
    queryKey: ["/api/system/config"],
  });

  if (isLoading) return <ConfigLoading />;
  if (isDashboardHiddenInSidebar(systemConfig?.ui_sidebar_hidden_hrefs_json)) {
    return <Redirect to={WELCOME_PAGE_HREF} />;
  }
  return <Dashboard />;
}

/** Renders Welcome, or redirects to Dashboard when Dashboard is visible in the sidebar. */
export function WelcomeRouteGate() {
  const { data: systemConfig, isLoading } = useQuery<Record<string, string>>({
    queryKey: ["/api/system/config"],
  });

  if (isLoading) return <ConfigLoading />;
  if (!isDashboardHiddenInSidebar(systemConfig?.ui_sidebar_hidden_hrefs_json)) {
    return <Redirect to={DASHBOARD_SIDEBAR_HREF} />;
  }
  return <Welcome />;
}
