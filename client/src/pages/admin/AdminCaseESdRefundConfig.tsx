import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { SYSTEM_CONFIG_DEFAULTS } from "@shared/system-config-defaults";
import { formatCaseEValidityLabel, parseCaseESdConfig } from "@shared/case-e-security-deposit";
import { ArrowLeft, Info, Loader2 } from "lucide-react";

type ConfigMap = Record<string, string>;
type HistoryRow = {
  key: string;
  value: string;
  updatedAt?: string | null;
  updatedByName?: string | null;
  updatedBy?: string | null;
};

const KEYS = [
  "case_e_sd_refund_validity_hours",
  "case_e_sd_refund_validity_minutes",
  "case_e_sd_ceiling",
  "case_e_admin_charges",
] as const;

export default function AdminCaseESdRefundConfig() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { can } = useAuth();
  const canUpdate = can("M-10", "Update");

  const { data: config, isLoading, isError } = useQuery<ConfigMap>({
    queryKey: ["/api/admin/config"],
  });
  const { data: history = [] } = useQuery<HistoryRow[]>({
    queryKey: ["/api/admin/config/history?limit=50"],
  });

  const [hours, setHours] = useState<string>(SYSTEM_CONFIG_DEFAULTS.case_e_sd_refund_validity_hours);
  const [minutes, setMinutes] = useState<string>(SYSTEM_CONFIG_DEFAULTS.case_e_sd_refund_validity_minutes);
  const [ceiling, setCeiling] = useState<string>(SYSTEM_CONFIG_DEFAULTS.case_e_sd_ceiling);
  const [adminCharges, setAdminCharges] = useState<string>(SYSTEM_CONFIG_DEFAULTS.case_e_admin_charges);

  useEffect(() => {
    if (!config) return;
    setHours(config.case_e_sd_refund_validity_hours ?? SYSTEM_CONFIG_DEFAULTS.case_e_sd_refund_validity_hours);
    setMinutes(
      config.case_e_sd_refund_validity_minutes ?? SYSTEM_CONFIG_DEFAULTS.case_e_sd_refund_validity_minutes,
    );
    setCeiling(config.case_e_sd_ceiling ?? SYSTEM_CONFIG_DEFAULTS.case_e_sd_ceiling);
    setAdminCharges(config.case_e_admin_charges ?? SYSTEM_CONFIG_DEFAULTS.case_e_admin_charges);
  }, [config]);

  const draftLabel = useMemo(() => {
    const h = Number.parseInt(hours, 10);
    const m = Number.parseInt(minutes, 10);
    return formatCaseEValidityLabel(
      Number.isFinite(h) ? h : 6,
      Number.isFinite(m) ? Math.min(59, Math.max(0, m)) : 0,
    );
  }, [hours, minutes]);

  const lastUpdated = useMemo(() => {
    const rows = history.filter((h) => KEYS.includes(h.key as (typeof KEYS)[number]));
    if (!rows.length) return null;
    rows.sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));
    const top = rows[0]!;
    const when = top.updatedAt ? new Date(top.updatedAt) : null;
    const whenLabel =
      when && !Number.isNaN(when.getTime())
        ? when.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
        : "—";
    return `${top.updatedByName || top.updatedBy || "System"}, ${whenLabel}`;
  }, [history]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const h = Number.parseInt(hours, 10);
      const m = Number.parseInt(minutes, 10);
      if (!Number.isFinite(h) || h < 0 || h > 168) throw new Error("Hours must be between 0 and 168.");
      if (!Number.isFinite(m) || m < 0 || m > 59) throw new Error("Minutes must be between 0 and 59.");
      const ceil = Number.parseFloat(ceiling);
      const adm = Number.parseFloat(adminCharges);
      if (!Number.isFinite(ceil) || ceil < 0) throw new Error("SD ceiling must be a non-negative amount.");
      if (!Number.isFinite(adm) || adm < 0) throw new Error("Admin charges must be a non-negative amount.");
      const body: Record<string, string> = {
        case_e_sd_refund_validity_hours: String(h),
        case_e_sd_refund_validity_minutes: String(m),
        case_e_sd_ceiling: String(Math.round(ceil * 100) / 100),
        case_e_admin_charges: String(Math.round(adm * 100) / 100),
      };
      const res = await fetch("/api/admin/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/config"] });
      qc.invalidateQueries({ queryKey: ["/api/system/config"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/config/history?limit=50"] });
      toast({ title: "Security Deposit Refund settings saved" });
    },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const resetDraft = () => {
    if (!config) return;
    setHours(config.case_e_sd_refund_validity_hours ?? SYSTEM_CONFIG_DEFAULTS.case_e_sd_refund_validity_hours);
    setMinutes(
      config.case_e_sd_refund_validity_minutes ?? SYSTEM_CONFIG_DEFAULTS.case_e_sd_refund_validity_minutes,
    );
    setCeiling(config.case_e_sd_ceiling ?? SYSTEM_CONFIG_DEFAULTS.case_e_sd_ceiling);
    setAdminCharges(config.case_e_admin_charges ?? SYSTEM_CONFIG_DEFAULTS.case_e_admin_charges);
  };

  const savedCfg = parseCaseESdConfig(config ?? {});

  return (
    <AppShell
      breadcrumbs={[
        { label: "System Config", href: "/admin/config" },
        { label: "Check Post" },
        { label: "Security Deposit Refund" },
      ]}
    >
      <div className="space-y-4 max-w-3xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
              <Link href="/admin/config">
                <ArrowLeft className="h-4 w-4 mr-1" /> Back
              </Link>
            </Button>
            <h1 className="text-2xl font-semibold">Security Deposit Refund settings</h1>
            <p className="text-sm text-muted-foreground">Values here apply to all check posts.</p>
          </div>
        </div>

        {isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : isError ? (
          <Alert variant="destructive">
            <AlertDescription>Failed to load system config.</AlertDescription>
          </Alert>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Refund validity period</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="case-e-hours">Hours</Label>
                  <Input
                    id="case-e-hours"
                    type="number"
                    min={0}
                    max={168}
                    value={hours}
                    disabled={!canUpdate}
                    onChange={(e) => setHours(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="case-e-mins">Minutes (0–59)</Label>
                  <Input
                    id="case-e-mins"
                    type="number"
                    min={0}
                    max={59}
                    value={minutes}
                    disabled={!canUpdate}
                    onChange={(e) => setMinutes(e.target.value)}
                  />
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                Current setting: <strong>{savedCfg.validityLabel}</strong>
                {draftLabel !== savedCfg.validityLabel ? (
                  <>
                    {" "}
                    · Draft: <strong>{draftLabel}</strong>
                  </>
                ) : null}{" "}
                · e.g. 6 hours 30 minutes
              </p>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="case-e-ceiling">SD upper cut-off (₹)</Label>
                  <Input
                    id="case-e-ceiling"
                    type="number"
                    min={0}
                    step="0.01"
                    value={ceiling}
                    disabled={!canUpdate}
                    onChange={(e) => setCeiling(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Refundable SD = min(commodity market fee, this ceiling).
                  </p>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="case-e-admin">Administrative charges (₹)</Label>
                  <Input
                    id="case-e-admin"
                    type="number"
                    min={0}
                    step="0.01"
                    value={adminCharges}
                    disabled={!canUpdate}
                    onChange={(e) => setAdminCharges(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">Non-refundable; retained at exit.</p>
                </div>
              </div>

              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription>
                  A receipt can be refunded in full only if the vehicle exits within this many hours and minutes of entry
                  receipt generation. Late exit forfeits the Security Deposit (Market Fee); Administrative Charges are
                  never refunded. Forfeited / unrefunded deposits remain recorded under accounting head{" "}
                  <strong>Security Deposit (Market Fee)</strong> for reconciliation and audit. These values also drive
                  the eligible list, time-left indicator, and the Entry Receipt condition strip.
                </AlertDescription>
              </Alert>

              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={!canUpdate || saveMutation.isPending}
                  onClick={() => saveMutation.mutate()}
                >
                  {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                  Save
                </Button>
                <Button type="button" variant="outline" disabled={!canUpdate} onClick={resetDraft}>
                  Reset
                </Button>
              </div>
            </CardContent>
            <div className="border-t bg-muted/40 px-6 py-2 text-xs text-muted-foreground">
              Last updated by {lastUpdated ?? "—"}
            </div>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
