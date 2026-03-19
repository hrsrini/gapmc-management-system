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

const CONFIG_KEYS = [
  { key: "market_fee_percent", label: "Market Fee %" },
  { key: "msp_rate", label: "MSP Rate" },
  { key: "admin_charges", label: "Admin Charges" },
  { key: "licence_fee", label: "Licence Fee" },
];

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
      toast({ title: "Config updated", description: "System configuration saved." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update config", variant: "destructive" });
    },
  });

  const handleSave = () => {
    updateMutation.mutate(values);
  };

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "Admin", href: "/admin/users" }, { label: "Config" }]}>
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
    <AppShell breadcrumbs={[{ label: "Admin", href: "/admin/users" }, { label: "Default Values" }]}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            System Config
          </CardTitle>
          <p className="text-sm text-muted-foreground">Default values: Market Fee %, MSP Rate, Admin Charges, Licence Fee.</p>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <>
              {CONFIG_KEYS.map(({ key, label }) => (
                <div key={key} className="grid grid-cols-1 md:grid-cols-3 gap-2 items-center">
                  <Label className="md:col-span-1">{label}</Label>
                  <Input
                    className="md:col-span-2"
                    value={values[key] ?? ""}
                    onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
                  />
                </div>
              ))}
              <Button onClick={handleSave} disabled={updateMutation.isPending}>Save</Button>
            </>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
