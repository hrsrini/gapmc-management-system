import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ClientDataGrid } from "@/components/reports/ClientDataGrid";
import type { ReportTableColumn } from "@/components/reports/ReportDataTable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { FileText, AlertCircle, CheckCircle, ShieldCheck, Plus, Download, CalendarClock, Percent } from "lucide-react";
interface RentInvoice {
  id: string;
  invoiceNo?: string | null;
  periodMonth: string;
  assetId: string;
  yardId: string;
  rentAmount: number;
  totalAmount: number;
  status: string;
  isGovtEntity?: boolean;
}
interface AssetRef {
  id: string;
  assetId: string;
}

export default function IomsRentInvoices() {
  const { user, can } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [gstr1From, setGstr1From] = useState("");
  const [gstr1To, setGstr1To] = useState("");
  const [gstr1Loading, setGstr1Loading] = useState(false);
  const roles = user?.roles?.map((r) => r.tier) ?? [];
  const canVerify = roles.includes("DV") || roles.includes("ADMIN");
  const canApprove = roles.includes("DA") || roles.includes("ADMIN");
  const canCreate = can("M-03", "Create");
  const canRunArrearsInterest =
    (roles.includes("ADMIN") || roles.includes("DO") || roles.includes("DA")) &&
    (can("M-03", "Create") || can("M-03", "Update") || can("M-03", "Approve"));
  const { data: list, isLoading, isError } = useQuery<RentInvoice[]>({
    queryKey: ["/api/ioms/rent/invoices"],
  });
  const { data: assets = [] } = useQuery<AssetRef[]>({
    queryKey: ["/api/ioms/assets"],
  });
  const { data: yards = [] } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ["/api/yards"],
  });
  const yardById = Object.fromEntries(yards.map((y) => [y.id, y.name]));
  const assetLabelById = Object.fromEntries(assets.map((a) => [a.id, a.assetId]));
  const statusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const res = await fetch(`/api/ioms/rent/invoices/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? res.statusText);
      }
      return res.json();
    },
    onSuccess: (_, { status }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/rent/invoices"] });
      toast({ title: "Status updated", description: `Invoice set to ${status}.` });
    },
    onError: (e: Error) => {
      toast({ title: "Update failed", description: e.message, variant: "destructive" });
    },
  });

  const generateDraftsMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/ioms/rent/invoices/generate-monthly-drafts", {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? res.statusText);
      }
      return res.json() as Promise<{ ok: boolean; created: number; skipped: number; periodMonth: string }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/rent/invoices"] });
      toast({
        title: "Monthly draft generation",
        description: `Period ${data.periodMonth}: ${data.created} created, ${data.skipped} skipped (allotment already has an invoice).`,
      });
    },
    onError: (e: Error) => {
      toast({ title: "Generation failed", description: e.message, variant: "destructive" });
    },
  });

  const runArrearsInterestMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/ioms/rent/run-arrears-interest", {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? res.statusText);
      }
      return res.json() as Promise<{
        ok: boolean;
        asOfDate: string;
        markedOverdue: number;
        interestPosted: number;
        interestRows: number;
        skipped: number;
      }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/rent/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/rent/ledger"] });
      toast({
        title: "M-03 arrears & interest",
        description: `As of ${data.asOfDate}: ${data.markedOverdue} marked overdue, ${data.interestRows} interest line(s) posted (₹${data.interestPosted.toFixed(2)}), ${data.skipped} skipped.`,
      });
    },
    onError: (e: Error) => {
      toast({ title: "Run failed", description: e.message, variant: "destructive" });
    },
  });

  const invoiceColumns = useMemo((): ReportTableColumn[] => {
    const base: ReportTableColumn[] = [
      { key: "_invoiceNo", header: "Invoice No", sortField: "invoiceNoSort" },
      { key: "periodMonth", header: "Period" },
      { key: "assetLabel", header: "Asset" },
      { key: "yardName", header: "Yard" },
      { key: "rentAmount", header: "Rent" },
      { key: "totalAmount", header: "Total" },
      { key: "_status", header: "Status", sortField: "status" },
    ];
    if (canVerify || canApprove) base.push({ key: "_actions", header: "Actions" });
    return base;
  }, [canVerify, canApprove]);

  const invoiceRows = useMemo((): Record<string, unknown>[] => {
    return (list ?? []).map((r) => ({
      id: r.id,
      invoiceNoSort: r.invoiceNo ?? r.id,
      _invoiceNo: (
        <Link href={`/rent/ioms/invoices/${r.id}`} className="text-primary hover:underline font-mono text-sm">
          {r.invoiceNo ?? r.id}
        </Link>
      ),
      periodMonth: r.periodMonth,
      assetLabel: assetLabelById[r.assetId] ?? r.assetId,
      yardName: yardById[r.yardId] ?? r.yardId,
      rentAmount: r.rentAmount,
      totalAmount: r.totalAmount,
      status: r.status,
      _status: <Badge variant="secondary">{r.status}</Badge>,
      _actions: (canVerify || canApprove) ? (
        <div className="flex flex-wrap gap-2">
          {canVerify && r.status === "Draft" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => statusMutation.mutate({ id: r.id, status: "Verified" })}
              disabled={statusMutation.isPending}
            >
              <ShieldCheck className="h-3.5 w-3.5 mr-1" />
              Verify
            </Button>
          )}
          {canApprove && r.status === "Verified" && (
            <Button
              size="sm"
              variant="default"
              onClick={() => statusMutation.mutate({ id: r.id, status: "Approved" })}
              disabled={statusMutation.isPending}
            >
              <CheckCircle className="h-3.5 w-3.5 mr-1" />
              Approve
            </Button>
          )}
        </div>
      ) : null,
    }));
  }, [list, assetLabelById, yardById, canVerify, canApprove, statusMutation]);

  const handleExportGstr1 = async () => {
    const from = gstr1From.trim();
    const to = gstr1To.trim();
    if (!from || !to) {
      toast({ title: "Period required", description: "Enter From month and To month (YYYY-MM).", variant: "destructive" });
      return;
    }
    setGstr1Loading(true);
    try {
      const res = await fetch(`/api/ioms/rent/gstr1?fromMonth=${encodeURIComponent(from)}&toMonth=${encodeURIComponent(to)}`, { credentials: "include" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? res.statusText);
      }
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `GSTR1-${from}-${to}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "GSTR-1 exported", description: `${data.supplies?.length ?? 0} supplies.` });
    } catch (e: unknown) {
      toast({ title: "Export failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setGstr1Loading(false);
    }
  };

  const handleExportGstr1Csv = async () => {
    const from = gstr1From.trim();
    const to = gstr1To.trim();
    if (!from || !to) {
      toast({ title: "Period required", description: "Enter From month and To month (YYYY-MM).", variant: "destructive" });
      return;
    }
    setGstr1Loading(true);
    try {
      const params = new URLSearchParams({ fromMonth: from, toMonth: to, format: "csv" });
      const res = await fetch(`/api/ioms/rent/gstr1?${params}`, { credentials: "include" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? res.statusText);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `gstr1-rent-outward-${from}-${to}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "GSTR-1 CSV exported", description: "Supply lines + warnings at end; use JSON for full GSTN draft mapping." });
    } catch (e: unknown) {
      toast({ title: "Export failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setGstr1Loading(false);
    }
  };

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "Rent (IOMS)", href: "/rent/ioms" }, { label: "Invoices" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Failed to load rent invoices.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Rent (IOMS)", href: "/rent/ioms" }, { label: "Invoices" }]}>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Rent Invoices (IOMS M-03)
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
            Rent/GST invoices from allotments; distinct from existing Rent & Tax invoices.
            {canVerify && <span className="block mt-1">You can verify Draft → Verified.</span>}
            {canApprove && <span className="block mt-1">You can approve Verified → Approved.</span>}
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            {canCreate && (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => generateDraftsMutation.mutate()}
                  disabled={generateDraftsMutation.isPending}
                  title="Same as month-start cron: Draft invoices for the current month per active allotment (skips if already present)."
                >
                  <CalendarClock className="h-4 w-4 mr-2" />
                  Generate monthly drafts
                </Button>
                <Button asChild size="sm">
                  <Link href="/rent/ioms/invoices/new">
                    <Plus className="h-4 w-4 mr-2" /> Create invoice
                </Link>
                </Button>
              </>
            )}
            {canRunArrearsInterest && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => runArrearsInterestMutation.mutate()}
                disabled={runArrearsInterestMutation.isPending}
                title="Same as daily cron: mark past-due Approved as Overdue and post simple interest to rent deposit ledger (rate in Admin → system config)."
              >
                <Percent className="h-4 w-4 mr-2" />
                Run arrears & interest
              </Button>
            )}
            <div className="flex items-end gap-2 border-l pl-3">
              <div className="space-y-1">
                <Label className="text-xs">GSTR-1 From (YYYY-MM)</Label>
                <Input className="w-28 h-8" placeholder="2025-01" value={gstr1From} onChange={(e) => setGstr1From(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">To (YYYY-MM)</Label>
                <Input className="w-28 h-8" placeholder="2025-03" value={gstr1To} onChange={(e) => setGstr1To(e.target.value)} />
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={handleExportGstr1}
                disabled={gstr1Loading}
                title="JSON: supplies, warnings, gstnDraftMapping (GSTN alignment aid)."
              >
                <Download className="h-4 w-4 mr-1" /> GSTR-1 JSON
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleExportGstr1Csv}
                disabled={gstr1Loading}
                title="CSV: one row per outward supply; # rows for meta and warnings."
              >
                <Download className="h-4 w-4 mr-1" /> GSTR-1 CSV
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <ClientDataGrid
              columns={invoiceColumns}
              sourceRows={invoiceRows}
              searchKeys={["invoiceNoSort", "periodMonth", "assetLabel", "yardName", "status"]}
              defaultSortKey="periodMonth"
              defaultSortDir="desc"
              emptyMessage="No IOMS rent invoices. Existing invoices are under Rent & Tax."
            />
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
