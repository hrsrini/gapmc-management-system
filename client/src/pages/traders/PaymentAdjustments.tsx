import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ClientDataGrid } from "@/components/reports/ClientDataGrid";
import type { ReportTableColumn } from "@/components/reports/ReportDataTable";
import { TraderLicenceSearchSelect } from "@/components/selects/trader-licence-search-select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { useScopedActiveYards } from "@/hooks/useScopedActiveYards";
import { formatInr } from "@/lib/formatInr";
import { AlertCircle } from "lucide-react";

type AdjRow = {
  id: string;
  adjustmentNo: string;
  traderName?: string | null;
  againstInvoiceNo?: string | null;
  againstInvoiceId?: string | null;
  adjustmentType: string;
  amountInr: number;
  status: string;
  dueBefore?: number | null;
  dueAfter?: number | null;
  yardId: string;
  traderLicenceId?: string | null;
};

const TYPE_LABELS: Record<string, string> = {
  AdvanceDepositAutomatic: "Advance deposit (automatic)",
  AdvanceDepositRefund: "Advance deposit refund or forfeiture",
  AdvanceDepositForfeiture: "Advance deposit refund or forfeiture",
  ExcessPaymentCarryForward: "Excess payment carried forward",
  InterestWaiver: "Interest waiver",
  GstRateRevision: "GST rate revision",
  Correction: "Correction of an entry",
};

export default function PaymentAdjustments() {
  const { can, user } = useAuth();
  const canCreate = can("M-03", "Create") || can("M-02", "Create");
  const isDa = Boolean(user?.roles?.some((r) => r.tier === "DA" || r.tier === "ADMIN"));
  const { toast } = useToast();
  const qc = useQueryClient();
  const [searchParams] = useSearchParams();
  const traderFromUrl = searchParams.get("traderLicenceId")?.trim() ?? "";

  const [tab, setTab] = useState<"All" | "PendingApproval" | "Applied">("All");
  const [traderLicenceId, setTraderLicenceId] = useState(traderFromUrl);
  const [againstInvoiceId, setAgainstInvoiceId] = useState("");
  const [adjustmentType, setAdjustmentType] = useState("InterestWaiver");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [yardId, setYardId] = useState("");

  const listUrl = useMemo(() => {
    const u = new URL("/api/ioms/payment-adjustments", window.location.origin);
    if (tab !== "All") u.searchParams.set("status", tab);
    if (traderFromUrl) u.searchParams.set("traderLicenceId", traderFromUrl);
    return u.pathname + u.search;
  }, [tab, traderFromUrl]);

  const { data: rows = [], isLoading, isError } = useQuery<AdjRow[]>({ queryKey: [listUrl] });
  const { data: yards = [] } = useScopedActiveYards();
  const { data: dues } = useQuery<{
    dues: Array<{
      kind: string;
      invoiceId?: string;
      invoiceNo?: string | null;
      outstandingAmount: number;
      yardId: string;
    }>;
  }>({
    queryKey: [
      traderLicenceId
        ? `/api/ioms/dues?unifiedId=${encodeURIComponent(`TA:${traderLicenceId}`)}`
        : "no-dues",
    ],
    enabled: Boolean(traderLicenceId),
  });

  const invoiceOptions = (dues?.dues ?? []).filter((d) => d.kind === "RentInvoice");
  const selectedDue = invoiceOptions.find((d) => d.invoiceId === againstInvoiceId);
  const dueBefore = selectedDue?.outstandingAmount ?? 0;
  const dueAfter = Math.max(0, dueBefore - (Number(amount) || 0));

  const create = useMutation({
    mutationFn: async () => {
      if (!traderLicenceId) throw new Error("Select a trader");
      const yid = yardId || selectedDue?.yardId || yards[0]?.id;
      if (!yid) throw new Error("Yard required");
      const res = await fetch("/api/ioms/payment-adjustments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          yardId: yid,
          traderLicenceId,
          againstInvoiceId: againstInvoiceId || null,
          adjustmentType,
          amountInr: Number(amount),
          reason,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error ?? res.statusText);
      return body;
    },
    onSuccess: () => {
      toast({ title: "Submitted for approval" });
      setAmount("");
      setReason("");
      void qc.invalidateQueries({ queryKey: [listUrl] });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const approve = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/ioms/payment-adjustments/${id}/approve`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ apply: true }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error ?? res.statusText);
      return body;
    },
    onSuccess: () => {
      toast({ title: "Adjustment applied" });
      void qc.invalidateQueries({ queryKey: [listUrl] });
    },
    onError: (e: Error) => toast({ title: "Approve failed", description: e.message, variant: "destructive" }),
  });

  const columns: ReportTableColumn[] = [
    { key: "adjustmentNo", header: "Ref." },
    { key: "traderName", header: "Trader" },
    { key: "_against", header: "Against" },
    { key: "_type", header: "Type" },
    { key: "_amount", header: "Amount (₹)" },
    { key: "_status", header: "Status" },
    { key: "_actions", header: "Actions" },
  ];

  const gridRows = rows.map((r) => ({
    id: r.id,
    adjustmentNo: r.adjustmentNo,
    traderName: r.traderName ?? "—",
    _against: r.againstInvoiceNo ?? "—",
    _type: TYPE_LABELS[r.adjustmentType] ?? r.adjustmentType,
    _amount: formatInr(r.amountInr),
    _status: <Badge variant={r.status === "Applied" ? "secondary" : "default"}>{r.status}</Badge>,
    _actions:
      isDa && r.status === "PendingApproval" ? (
        <Button size="sm" onClick={() => approve.mutate(r.id)} disabled={approve.isPending}>
          Approve
        </Button>
      ) : (
        "—"
      ),
  }));

  return (
    <AppShell
      breadcrumbs={[
        { label: "Traders", href: "/traders/licences" },
        { label: "Payment adjustments" },
      ]}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h1 className="text-2xl font-semibold">Payment adjustments</h1>
            <p className="text-sm text-muted-foreground">
              Raise interest waivers, GST rate revisions, deposit refunds and corrections here so the counter Pay panel
              stays short.
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/traders/dues">Back to outstanding dues</Link>
          </Button>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Adjustment history</CardTitle>
              <div className="flex gap-1 pt-2">
                {(["All", "PendingApproval", "Applied"] as const).map((t) => (
                  <Button key={t} size="sm" variant={tab === t ? "default" : "outline"} onClick={() => setTab(t)}>
                    {t === "PendingApproval" ? "Pending approval" : t}
                  </Button>
                ))}
              </div>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-40 w-full" />
              ) : isError ? (
                <div className="flex items-center gap-2 text-destructive text-sm">
                  <AlertCircle className="h-4 w-4" /> Failed to load
                </div>
              ) : (
                <ClientDataGrid
                  columns={columns}
                  sourceRows={gridRows as Record<string, unknown>[]}
                  searchKeys={["adjustmentNo", "traderName"]}
                  searchPlaceholder="Filter adjustments…"
                  defaultSortKey="adjustmentNo"
                />
              )}
              <p className="text-xs text-muted-foreground mt-3 rounded-md border bg-sky-500/10 border-sky-500/30 p-2">
                Adjustments require a Data Approver. Advance deposits are adjusted automatically on invoice approval.
              </p>
            </CardContent>
          </Card>

          {canCreate && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">New adjustment</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1">
                  <Label>Trader</Label>
                  <TraderLicenceSearchSelect value={traderLicenceId} onValueChange={setTraderLicenceId} />
                </div>
                <div className="space-y-1">
                  <Label>Against invoice</Label>
                  <Select value={againstInvoiceId} onValueChange={setAgainstInvoiceId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select invoice" />
                    </SelectTrigger>
                    <SelectContent>
                      {invoiceOptions.map((d) => (
                        <SelectItem key={d.invoiceId!} value={d.invoiceId!}>
                          {d.invoiceNo ?? d.invoiceId} · {formatInr(d.outstandingAmount)} due
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Yard</Label>
                  <Select value={yardId || selectedDue?.yardId || ""} onValueChange={setYardId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Yard" />
                    </SelectTrigger>
                    <SelectContent>
                      {yards.map((y) => (
                        <SelectItem key={y.id} value={y.id}>
                          {y.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Adjustment type</Label>
                  <RadioGroup value={adjustmentType} onValueChange={setAdjustmentType} className="space-y-2">
                    {[
                      "AdvanceDepositRefund",
                      "ExcessPaymentCarryForward",
                      "InterestWaiver",
                      "GstRateRevision",
                      "Correction",
                    ].map((t) => (
                      <label key={t} className="flex items-center gap-2 text-sm">
                        <RadioGroupItem value={t} />
                        {TYPE_LABELS[t] ?? t}
                      </label>
                    ))}
                  </RadioGroup>
                </div>
                <div className="space-y-1">
                  <Label>Amount (₹)</Label>
                  <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
                </div>
                <div className="space-y-1">
                  <Label>Reason</Label>
                  <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Short reason for the record" />
                </div>
                {selectedDue && (
                  <div className="rounded-md border p-3 text-sm grid grid-cols-2 gap-2">
                    <div>
                      <p className="text-muted-foreground text-xs">Due before</p>
                      <p className="font-medium">{formatInr(dueBefore)}</p>
                    </div>
                    <div className="rounded bg-emerald-500/10 p-2">
                      <p className="text-muted-foreground text-xs">Due after</p>
                      <p className="font-medium">{formatInr(dueAfter)}</p>
                    </div>
                  </div>
                )}
                <div className="flex justify-end gap-2">
                  <Button
                    onClick={() => create.mutate()}
                    disabled={create.isPending || !(Number(amount) > 0) || !traderLicenceId}
                  >
                    {create.isPending ? "Submitting…" : "Submit for approval"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </AppShell>
  );
}
