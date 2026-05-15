import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PanelLeft, ArrowLeft, Loader2, AlertCircle } from "lucide-react";
import { apiRequest, fetchApiGet, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { AdminSidebarMenuVisibility } from "@/pages/admin/AdminSidebarMenuVisibility";
import { stripSidebarMenuVisibilityPageFromHiddenJson } from "@shared/nav-sidebar-hidden";

export default function AdminSidebarMenuPage() {
  const { toast } = useToast();
  const { data: config, isLoading, isError } = useQuery<Record<string, string>>({
    queryKey: ["/api/admin/config"],
  });

  const [hiddenJson, setHiddenJson] = useState<string>("[]");

  useEffect(() => {
    if (config?.ui_sidebar_hidden_hrefs_json != null) {
      setHiddenJson(stripSidebarMenuVisibilityPageFromHiddenJson(config.ui_sidebar_hidden_hrefs_json));
    }
  }, [config]);

  const saveMutation = useMutation({
    mutationFn: () =>
      apiRequest("PUT", "/api/admin/config", {
        ui_sidebar_hidden_hrefs_json: stripSidebarMenuVisibilityPageFromHiddenJson(hiddenJson),
      }),
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/config"] });
      try {
        const cfg = await fetchApiGet<Record<string, string>>("/api/system/config");
        queryClient.setQueryData(["/api/system/config"], cfg);
      } catch {
        await queryClient.invalidateQueries({ queryKey: ["/api/system/config"] });
      }
      toast({ title: "Saved", description: "Sidebar menu visibility updated." });
    },
    onError: (e: Error) => {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    },
  });

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "Admin", href: "/admin/locations" }, { label: "Sidebar menu visibility" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Failed to load configuration.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Admin", href: "/admin/locations" }, { label: "Sidebar menu visibility" }]}>
      <div className="space-y-4 max-w-4xl">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/admin/config">
              <ArrowLeft className="h-4 w-4 mr-1" />
              System config
            </Link>
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PanelLeft className="h-5 w-5" />
              Sidebar menu visibility
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Hide sidebar entries globally without changing permissions. Routes stay reachable via bookmark or direct URL unless otherwise
              secured. Use <span className="font-medium text-foreground">Save changes</span> to apply.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {isLoading ? (
              <Skeleton className="h-80 w-full" />
            ) : (
              <>
                <AdminSidebarMenuVisibility value={hiddenJson} onChange={setHiddenJson} />
                <div className="flex gap-2 pt-2">
                  <Button type="button" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                    {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Save changes
                  </Button>
                  <Button type="button" variant="outline" asChild>
                    <Link href="/admin/config">Other defaults &amp; PDF logo</Link>
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
