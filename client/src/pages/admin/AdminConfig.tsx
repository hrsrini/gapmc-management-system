import { useQuery, useMutation } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Settings, AlertCircle, ImageIcon, Trash2, Upload, Calculator, Mail } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Link } from "wouter";
import { useState, useEffect, useRef } from "react";
import { apiRequest, fetchApiGet, queryClient, readApiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import {
  SYSTEM_CONFIG_KEYS,
  SYSTEM_CONFIG_LABELS,
  type SystemConfigKey,
} from "@shared/system-config-defaults";
import { randomHexSecret } from "@/lib/randomHexSecret";
import { useUploadFilePreview } from "@/hooks/useUploadFilePreview";

/** Module scope (not inside the component) avoids production TDZ from useMemo + .map over shared config maps. */
const ADMIN_CONFIG_FIELDS: { key: SystemConfigKey; label: string }[] = SYSTEM_CONFIG_KEYS.filter(
  (key) => key !== "ui_sidebar_hidden_hrefs_json" && key !== "ui_dashboard_show_kpi_cards",
).map(
  (key) => ({
    key,
    label: SYSTEM_CONFIG_LABELS[key],
  }),
);

export default function AdminConfig() {
  const { toast } = useToast();
  const logoFileRef = useRef<HTMLInputElement>(null);
  const [logoPreviewNonce, setLogoPreviewNonce] = useState(0);
  const [pendingLogo, setPendingLogo] = useState<File | null>(null);
  const pendingLogoPreviewUrl = useUploadFilePreview(pendingLogo);
  const { data: config, isLoading, isError } = useQuery<Record<string, string>>({
    queryKey: ["/api/admin/config"],
  });
  const { data: history } = useQuery<{
    rows: { id: string; actorUserId: string; createdAt: string; ip: string | null; changeCount: number; changes: { key: string; before: string | null; after: string | null }[] }[];
  }>({
    queryKey: ["/api/admin/config/history?limit=25"],
  });
  const { data: logoStatus, isLoading: logoStatusLoading } = useQuery<{
    hasLogo: boolean;
    storage?: { driver: string; bucket?: string; prefix?: string };
  }>({
    queryKey: ["/api/admin/branding/receipt-logo/status"],
    queryFn: () => fetchApiGet("/api/admin/branding/receipt-logo/status"),
  });
  const { data: emailConfig, isLoading: emailConfigLoading } = useQuery<{
    smtp_enabled: string;
    smtp_provider: string;
    smtp_host: string;
    smtp_port: string;
    smtp_secure: string;
    smtp_user: string;
    smtp_from: string;
    smtp_from_display_name: string;
    notify_email_to: string;
    smtp_pass_configured: boolean;
    env_fallback_configured: boolean;
    smtp_ready: boolean;
    notify_digests_ready: boolean;
    config_source: "database" | "environment" | "none";
  }>({
    queryKey: ["/api/admin/email-config"],
    queryFn: () => fetchApiGet("/api/admin/email-config"),
  });
  const [values, setValues] = useState<Record<string, string>>({});
  const [emailValues, setEmailValues] = useState({
    smtp_enabled: "false",
    smtp_provider: "gmail",
    smtp_host: "smtp.gmail.com",
    smtp_port: "587",
    smtp_secure: "false",
    smtp_user: "",
    smtp_from: "",
    smtp_from_display_name: "GAPLMB IOMS",
    notify_email_to: "",
  });
  const [smtpPassDraft, setSmtpPassDraft] = useState("");

  useEffect(() => {
    if (config) setValues({ ...config });
  }, [config]);

  useEffect(() => {
    if (!emailConfig) return;
    setEmailValues({
      smtp_enabled: emailConfig.smtp_enabled ?? "false",
      smtp_provider: emailConfig.smtp_provider ?? "gmail",
      smtp_host: emailConfig.smtp_host ?? "smtp.gmail.com",
      smtp_port: emailConfig.smtp_port ?? "587",
      smtp_secure: emailConfig.smtp_secure ?? "false",
      smtp_user: emailConfig.smtp_user ?? "",
      smtp_from: emailConfig.smtp_from ?? "",
      smtp_from_display_name: emailConfig.smtp_from_display_name ?? "GAPLMB IOMS",
      notify_email_to: emailConfig.notify_email_to ?? "",
    });
    setSmtpPassDraft("");
  }, [emailConfig]);

  const updateMutation = useMutation({
    mutationFn: (body: Record<string, string>) => apiRequest("PUT", "/api/admin/config", body),
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/config"] });
      try {
        const cfg = await fetchApiGet<Record<string, string>>("/api/system/config");
        queryClient.setQueryData(["/api/system/config"], cfg);
      } catch {
        await queryClient.invalidateQueries({ queryKey: ["/api/system/config"] });
      }
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
      setPendingLogo(null);
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
        loginSessionTablePresent?: boolean;
        countsPastRetention: Record<string, number>;
      }>("/api/admin/data-retention-summary"),
    onSuccess: (s) => {
      const c = s.countsPastRetention;
      const desc = Object.entries(c)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ");
      const sess =
        s.loginSessionTablePresent === true
          ? " Postgres session store."
          : s.loginSessionTablePresent === false
            ? " No public.session (memory store / dev)."
            : "";
      toast({
        title: "Retention snapshot (read-only)",
        description: `Past policy ages (counts): ${desc}.${sess}`,
      });
    },
    onError: (e: Error) => {
      toast({ title: "Snapshot failed", description: e.message, variant: "destructive" });
    },
  });

  const saveEmailMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, string> = { ...emailValues };
      if (smtpPassDraft.trim()) body.smtp_pass = smtpPassDraft.trim();
      const res = await fetch("/api/admin/email-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await readApiErrorMessage(res));
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/email-config"] });
      setSmtpPassDraft("");
      toast({ title: "Email settings saved", description: "Gmail SMTP configuration updated." });
    },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const testEmailMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/email-config/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ to: emailValues.notify_email_to.trim() || undefined }),
      });
      if (!res.ok) throw new Error(await readApiErrorMessage(res));
      return res.json() as Promise<{ ok: boolean; to: string }>;
    },
    onSuccess: (data) => {
      toast({
        title: "Test email sent",
        description: `Check the inbox for ${data.to}.`,
      });
    },
    onError: (e: Error) => toast({ title: "Test email failed", description: e.message, variant: "destructive" }),
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
      setPendingLogo(null);
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
        <CardHeader className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            System Config
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Default values used across the app (market fee %, MSP rate, admin charges, licence fee, rent interest %, M-03
            rent invoice CGST/SGST %, dak diary scope, data retention policy years). Changes apply to new fee rates, MSP
            rows, licences when amounts are omitted, and rent GST calculations on legacy and IOMS rent flows.             Authenticated users can read merged values via{" "}
            <code className="text-xs bg-muted px-1 rounded">GET /api/system/config</code> (sensitive keys such as Aadhaar
            HMAC are omitted). Admins can run a read-only
            retention count snapshot via{" "}
            <code className="text-xs bg-muted px-1 rounded">GET /api/admin/data-retention-summary</code> (no deletes).
          </p>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link href="/admin/rent-billing-config">
              <Calculator className="h-4 w-4 mr-1" />
              M-03 rent billing (prorata / overstay)
            </Link>
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <>
              {ADMIN_CONFIG_FIELDS.map(({ key, label }) => (
                <div key={key} className="grid grid-cols-1 md:grid-cols-3 gap-2 items-start">
                  <Label className="md:col-span-1 pt-2" htmlFor={`cfg-${key}`}>
                    {label}
                  </Label>
                  {key === "ta_da_entitlement_json" ? (
                    <Textarea
                      id={`cfg-${key}`}
                      className="md:col-span-2 font-mono text-sm min-h-[140px]"
                      value={values[key] ?? ""}
                      onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
                      spellCheck={false}
                    />
                  ) : key === "aadhaar_hmac_secret" ? (
                    <div className="md:col-span-2 flex flex-col sm:flex-row gap-2">
                      <Input
                        id={`cfg-${key}`}
                        type="password"
                        autoComplete="new-password"
                        className="font-mono text-sm flex-1 min-w-0"
                        value={values[key] ?? ""}
                        onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="shrink-0 self-start sm:self-auto"
                        onClick={() => setValues((v) => ({ ...v, [key]: randomHexSecret() }))}
                      >
                        Random secret
                      </Button>
                    </div>
                  ) : (
                    <Input
                      id={`cfg-${key}`}
                      className="md:col-span-2"
                      inputMode="decimal"
                      value={values[key] ?? ""}
                      onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
                    />
                  )}
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
          <CardTitle>Config history (latest 25)</CardTitle>
          <p className="text-sm text-muted-foreground">
            Shows per-key diffs captured in <code className="text-xs bg-muted px-1 rounded">audit_log</code> when admins save config.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {!history?.rows?.length ? (
            <p className="text-sm text-muted-foreground">No history yet.</p>
          ) : (
            history.rows.map((h) => (
              <div key={h.id} className="rounded-md border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{h.changeCount} change(s)</Badge>
                    <span className="text-sm text-muted-foreground">{new Date(h.createdAt).toLocaleString()}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">actor: {h.actorUserId}{h.ip ? ` • ${h.ip}` : ""}</span>
                </div>
                <div className="mt-2 space-y-1">
                  {h.changes.slice(0, 8).map((c) => (
                    <div key={c.key} className="text-xs">
                      <span className="font-medium">{SYSTEM_CONFIG_LABELS[c.key as SystemConfigKey] ?? c.key}</span>
                      <span className="text-muted-foreground"> ({c.key})</span>
                      <div className="text-muted-foreground break-all">
                        {String(c.before ?? "")} {"→"} {String(c.after ?? "")}
                      </div>
                    </div>
                  ))}
                  {h.changes.length > 8 ? (
                    <div className="text-xs text-muted-foreground">…and {h.changes.length - 8} more</div>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Gmail SMTP (outbound email)
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Sends system notifications (cash-in-hand digests, HR alerts, SLA reminders, employee login notices).
            Use a Google Workspace or Gmail account with a 16-character{" "}
            <a
              href="https://myaccount.google.com/apppasswords"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline"
            >
              App Password
            </a>{" "}
            (2-Step Verification required). Settings are stored in the database and apply on every app instance.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {emailConfigLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <>
              {emailConfig?.smtp_ready ? (
                <p className="text-xs text-green-800 dark:text-green-300 rounded-md border border-green-200 dark:border-green-900 bg-green-50 dark:bg-green-950/40 px-3 py-2">
                  SMTP active ({emailConfig.config_source === "database" ? "Admin config" : "legacy env fallback"}
                  ).{" "}
                  {emailConfig.notify_digests_ready
                    ? "System digests will email the default notify inbox."
                    : "Set default notify inbox below for cash-in-hand and alert digests."}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground rounded-md border border-dashed px-3 py-2">
                  SMTP not configured — enable below or set legacy <code className="text-xs">SMTP_*</code> env on the
                  server.
                </p>
              )}
              {emailConfig?.env_fallback_configured && emailValues.smtp_enabled !== "true" ? (
                <p className="text-xs text-amber-700 dark:text-amber-400 rounded-md border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 px-3 py-2">
                  Legacy server <code className="text-xs">SMTP_*</code> environment variables are set. Enable Gmail
                  here to use Admin-managed SMTP instead.
                </p>
              ) : null}
              <div className="flex items-start gap-3 rounded-md border p-3">
                <Checkbox
                  id="smtp-enabled"
                  checked={emailValues.smtp_enabled === "true"}
                  onCheckedChange={(c) =>
                    setEmailValues((v) => ({ ...v, smtp_enabled: c === true ? "true" : "false" }))
                  }
                />
                <div className="space-y-1">
                  <Label htmlFor="smtp-enabled" className="cursor-pointer">
                    Enable Gmail SMTP
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    When off, optional legacy <code className="text-xs">SMTP_*</code> env vars may still be used.
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Provider</Label>
                  <Select
                    value={emailValues.smtp_provider}
                    onValueChange={(v) =>
                      setEmailValues((prev) => ({
                        ...prev,
                        smtp_provider: v,
                        ...(v === "gmail"
                          ? { smtp_host: "smtp.gmail.com", smtp_port: "587", smtp_secure: "false" }
                          : {}),
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="gmail">Gmail (smtp.gmail.com)</SelectItem>
                      <SelectItem value="custom">Custom SMTP</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="smtp-user">Gmail address</Label>
                  <Input
                    id="smtp-user"
                    type="email"
                    autoComplete="off"
                    value={emailValues.smtp_user}
                    onChange={(e) => setEmailValues((v) => ({ ...v, smtp_user: e.target.value }))}
                    placeholder="your-org@gmail.com"
                  />
                </div>
                <div className="space-y-1 md:col-span-2">
                  <Label htmlFor="smtp-pass">App Password</Label>
                  <Input
                    id="smtp-pass"
                    type="password"
                    autoComplete="new-password"
                    value={smtpPassDraft}
                    onChange={(e) => setSmtpPassDraft(e.target.value)}
                    placeholder={
                      emailConfig?.smtp_pass_configured
                        ? "Leave blank to keep existing App Password"
                        : "16-character App Password"
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="smtp-from">From email (optional)</Label>
                  <Input
                    id="smtp-from"
                    type="email"
                    value={emailValues.smtp_from}
                    onChange={(e) => setEmailValues((v) => ({ ...v, smtp_from: e.target.value }))}
                    placeholder="Defaults to Gmail address"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="smtp-from-name">From display name</Label>
                  <Input
                    id="smtp-from-name"
                    value={emailValues.smtp_from_display_name}
                    onChange={(e) => setEmailValues((v) => ({ ...v, smtp_from_display_name: e.target.value }))}
                  />
                </div>
                <div className="space-y-1 md:col-span-2">
                  <Label htmlFor="notify-email-to">Default notify inbox</Label>
                  <Input
                    id="notify-email-to"
                    type="email"
                    value={emailValues.notify_email_to}
                    onChange={(e) => setEmailValues((v) => ({ ...v, notify_email_to: e.target.value }))}
                    placeholder="ops@example.com"
                  />
                </div>
                {emailValues.smtp_provider === "custom" ? (
                  <>
                    <div className="space-y-1">
                      <Label htmlFor="smtp-host">SMTP host</Label>
                      <Input
                        id="smtp-host"
                        value={emailValues.smtp_host}
                        onChange={(e) => setEmailValues((v) => ({ ...v, smtp_host: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="smtp-port">SMTP port</Label>
                      <Input
                        id="smtp-port"
                        inputMode="numeric"
                        value={emailValues.smtp_port}
                        onChange={(e) => setEmailValues((v) => ({ ...v, smtp_port: e.target.value }))}
                      />
                    </div>
                    <div className="flex items-center gap-2 md:col-span-2">
                      <Checkbox
                        id="smtp-secure"
                        checked={emailValues.smtp_secure === "true"}
                        onCheckedChange={(c) =>
                          setEmailValues((v) => ({ ...v, smtp_secure: c === true ? "true" : "false" }))
                        }
                      />
                      <Label htmlFor="smtp-secure" className="cursor-pointer text-sm">
                        Use implicit TLS (port 465)
                      </Label>
                    </div>
                  </>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={() => saveEmailMutation.mutate()} disabled={saveEmailMutation.isPending}>
                  Save email settings
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={testEmailMutation.isPending}
                  onClick={() => testEmailMutation.mutate()}
                >
                  Send test email
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
            <code className="text-xs bg-muted px-1 rounded">GET /api/ioms/receipts/:id/pdf</code>). Logos are stored in
            Supabase Storage (same bucket as other uploads). This overrides legacy{" "}
            <code className="text-xs bg-muted px-1 rounded">RECEIPT_PDF_LOGO_PATH</code> /{" "}
            <code className="text-xs bg-muted px-1 rounded">RECEIPT_PDF_LOGO_URL</code> until you remove it.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {logoStatus?.storage?.driver === "supabase" ? (
            <p className="text-xs text-muted-foreground rounded-md border border-dashed px-3 py-2">
              Storage: Supabase bucket <code className="text-xs">{logoStatus.storage.bucket}</code>
              {logoStatus.storage.prefix ? ` / ${logoStatus.storage.prefix}` : ""}
            </p>
          ) : logoStatus?.storage?.driver === "local" ? (
            <p className="text-xs text-amber-700 dark:text-amber-400 rounded-md border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 px-3 py-2">
              Storage driver is <code className="text-xs">local</code> — uploads may not persist on ECS. Set{" "}
              <code className="text-xs">OBJECT_STORAGE_DRIVER=supabase</code> and Supabase env vars on the server.
            </p>
          ) : null}
          <input
            ref={logoFileRef}
            type="file"
            accept="image/png,image/jpeg,image/jpg"
            className="sr-only"
            aria-hidden
            tabIndex={-1}
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              e.target.value = "";
              if (f && f.size > 2 * 1024 * 1024) {
                toast({ title: "File too large", description: "Logo must be 2 MB or smaller.", variant: "destructive" });
                return;
              }
              setPendingLogo(f);
            }}
          />
          {logoStatusLoading ? (
            <Skeleton className="h-32 w-full max-w-md" />
          ) : (
            <div className="flex flex-col sm:flex-row gap-4 items-start">
              {pendingLogoPreviewUrl ? (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Selected (not saved yet)</p>
                  <img
                    src={pendingLogoPreviewUrl}
                    alt="Selected logo preview"
                    className="max-h-28 max-w-[200px] object-contain border rounded-md bg-muted/30 p-2"
                  />
                </div>
              ) : logoStatus?.hasLogo ? (
                <img
                  src={`/api/admin/branding/receipt-logo/image?x=${logoPreviewNonce}`}
                  alt="Current receipt PDF logo"
                  className="max-h-28 max-w-[200px] object-contain border rounded-md bg-muted/30 p-2"
                />
              ) : (
                <p className="text-sm text-muted-foreground">No logo uploaded yet.</p>
              )}
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant={logoStatus?.hasLogo ? "outline" : "default"}
                    size="sm"
                    onClick={() => logoFileRef.current?.click()}
                    disabled={uploadLogoMutation.isPending}
                  >
                    <Upload className="h-4 w-4 mr-1" />
                    {logoStatus?.hasLogo ? "Choose replacement" : "Choose logo file"}
                  </Button>
                  {pendingLogo ? (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        disabled={uploadLogoMutation.isPending}
                        onClick={() => uploadLogoMutation.mutate(pendingLogo)}
                      >
                        Save logo
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={uploadLogoMutation.isPending}
                        onClick={() => setPendingLogo(null)}
                      >
                        Clear selection
                      </Button>
                    </>
                  ) : null}
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
            </div>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
