import { useQuery, useMutation } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Settings, AlertCircle } from "lucide-react";
import { useState, useEffect } from "react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  SYSTEM_CONFIG_KEYS,
  SYSTEM_CONFIG_LABELS,
  type SystemConfigKey,
} from "@shared/system-config-defaults";

const CONFIG_FIELDS: { key: SystemConfigKey; label: string }[] = SYSTEM_CONFIG_KEYS.map((key) => ({
  key,
  label: SYSTEM_CONFIG_LABELS[key],
}));

export default function AdminConfig() {
  const { toast } = useToast();
  const { data: config, isLoading, isError } = useQuery<Record<string, string>>({
    queryKey: ["/api/admin/config"],
  });
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (config) setValues({ ...config });
  }, [config]);

  const updateMutation = useMutation({
    mutationFn: (body: Record<string, string>) => apiRequest("PUT", "/api/admin/config", body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/config"] });
      queryClient.invalidateQueries({ queryKey: ["/api/system/config"] });
      toast({ title: "Config updated", description: "System configuration saved." });
    },
    onError: (e: Error) => {
      toast({
        title: "Failed to update config",
        description: e.message,
        variant: "destructive",
      });
    },
  });

  const handleSave = () => {
    updateMutation.mutate(values);
  };

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "Admin", href: "/admin/locations" }, { label: "Config" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Failed to load config.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Admin", href: "/admin/locations" }, { label: "Default Values" }]}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            System Config
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Default values used across the app (market fee %, MSP rate, admin charges, licence fee). Changes apply to new
            fee rates, MSP rows, and licences when amounts are omitted. Authenticated users can read merged values via{" "}
            <code className="text-xs bg-muted px-1 rounded">GET /api/system/config</code>.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <>
              {CONFIG_FIELDS.map(({ key, label }) => (
                <div key={key} className="grid grid-cols-1 md:grid-cols-3 gap-2 items-center">
                  <Label className="md:col-span-1" htmlFor={`cfg-${key}`}>
                    {label}
                  </Label>
                  <Input
                    id={`cfg-${key}`}
                    className="md:col-span-2"
                    inputMode="decimal"
                    value={values[key] ?? ""}
                    onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
                  />
                </div>
              ))}
              <Button onClick={handleSave} disabled={updateMutation.isPending}>
                Save
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
