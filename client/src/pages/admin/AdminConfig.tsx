import { useQuery, useMutation } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Settings, AlertCircle, ImageIcon, Trash2, Upload } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { apiRequest, fetchApiGet, queryClient, readApiErrorMessage } from "@/lib/queryClient";
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
  const logoFileRef = useRef<HTMLInputElement>(null);
  const [logoPreviewNonce, setLogoPreviewNonce] = useState(0);
  const { data: config, isLoading, isError } = useQuery<Record<string, string>>({
    queryKey: ["/api/admin/config"],
  });
  const { data: logoStatus, isLoading: logoStatusLoading } = useQuery<{ hasLogo: boolean }>({
    queryKey: ["/api/admin/branding/receipt-logo/status"],
    queryFn: () => fetchApiGet("/api/admin/branding/receipt-logo/status"),
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

  const uploadLogoMutation = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("logo", file);
      const res = await fetch("/api/admin/branding/receipt-logo", {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      if (!res.ok) throw new Error(await readApiErrorMessage(res));
      return res.json() as Promise<{ ok: boolean }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/branding/receipt-logo/status"] });
      setLogoPreviewNonce((n) => n + 1);
      if (logoFileRef.current) logoFileRef.current.value = "";
      toast({ title: "Logo saved", description: "Receipt PDFs will use this image (PNG or JPEG, max 2 MB)." });
    },
    onError: (e: Error) => {
      toast({ title: "Upload failed", description: e.message, variant: "destructive" });
    },
  });

  const retentionSnapshotMutation = useMutation({
    mutationFn: () =>
      fetchApiGet<{
        countsPastRetention: Record<string, number>;
      }>("/api/admin/data-retention-summary"),
    onSuccess: (s) => {
      const c = s.countsPastRetention;
      const desc = Object.entries(c)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ");
      toast({
        title: "Retention snapshot (read-only)",
        description: `Past policy ages (counts): ${desc}`,
      });
    },
    onError: (e: Error) => {
      toast({ title: "Snapshot failed", description: e.message, variant: "destructive" });
    },
  });

  const deleteLogoMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/branding/receipt-logo", { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error(await readApiErrorMessage(res));
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/branding/receipt-logo/status"] });
      setLogoPreviewNonce((n) => n + 1);
      toast({ title: "Logo removed", description: "PDFs will fall back to env logo or text-only header." });
    },
    onError: (e: Error) => {
      toast({ title: "Remove failed", description: e.message, variant: "destructive" });
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
            Default values used across the app (market fee %, MSP rate, admin charges, licence fee, rent interest %, dak
            diary scope, data retention policy years). Changes apply to new fee rates, MSP rows, and licences when amounts
            are omitted. Authenticated users can read merged values via{" "}
            <code className="text-xs bg-muted px-1 rounded">GET /api/system/config</code>. Admins can run a read-only
            retention count snapshot via{" "}
            <code className="text-xs bg-muted px-1 rounded">GET /api/admin/data-retention-summary</code> (no deletes).
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
              <div className="flex flex-wrap gap-2">
                <Button onClick={handleSave} disabled={updateMutation.isPending}>
                  Save
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={retentionSnapshotMutation.isPending}
                  onClick={() => retentionSnapshotMutation.mutate()}
                >
                  Retention snapshot
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ImageIcon className="h-5 w-5" />
            Receipt PDF logo
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Upload a PNG or JPEG (max 2 MB) for the header on server-generated receipt PDFs (
            <code className="text-xs bg-muted px-1 rounded">GET /api/ioms/receipts/:id/pdf</code>). This replaces any{" "}
            <code className="text-xs bg-muted px-1 rounded">RECEIPT_PDF_LOGO_PATH</code> /{" "}
            <code className="text-xs bg-muted px-1 rounded">RECEIPT_PDF_LOGO_URL</code> environment settings until you
            remove it.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <input
            ref={logoFileRef}
            type="file"
            accept="image/png,image/jpeg"
            className="sr-only"
            aria-hidden
            tabIndex={-1}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) uploadLogoMutation.mutate(f);
            }}
          />
          {logoStatusLoading ? (
            <Skeleton className="h-32 w-full max-w-md" />
          ) : (
            <div className="flex flex-col sm:flex-row gap-4 items-start">
              {logoStatus?.hasLogo ? (
                <img
                  src={`/api/admin/branding/receipt-logo/image?x=${logoPreviewNonce}`}
                  alt="Current receipt PDF logo"
                  className="max-h-28 max-w-[200px] object-contain border rounded-md bg-muted/30 p-2"
                />
              ) : (
                <p className="text-sm text-muted-foreground">No logo uploaded yet.</p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant={logoStatus?.hasLogo ? "outline" : "default"}
                  size="sm"
                  onClick={() => logoFileRef.current?.click()}
                  disabled={uploadLogoMutation.isPending}
                >
                  <Upload className="h-4 w-4 mr-1" />
                  {logoStatus?.hasLogo ? "Replace logo" : "Upload logo"}
                </Button>
                {logoStatus?.hasLogo ? (
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={() => deleteLogoMutation.mutate()}
                    disabled={deleteLogoMutation.isPending}
                  >
                    <Trash2 className="h-4 w-4 mr-1" />
                    Remove logo
                  </Button>
                ) : null}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
