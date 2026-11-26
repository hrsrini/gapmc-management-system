import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { useYardLabels } from "@/hooks/useYardLabels";
import { useScopedActiveYards } from "@/hooks/useScopedActiveYards";
import { formatInr } from "@/lib/formatInr";
import { AlertCircle, Plus, Wallet } from "lucide-react";
import { PaymentPreferenceForm } from "@/components/payments/PaymentPreferenceForm";
import {
  buildCounterDuesPaymentApiBody,
  defaultPaymentPreferenceValue,
  validatePaymentPreference,
  type PaymentPreferenceValue,
} from "@/lib/duesCounterPayment";

type DepositRow = {
  id: string;
  depositReceiptNo: string;
  depositDate: string;
  traderName?: string | null;
  premisesCode?: string | null;
  depositAmount: number;
  adjustedAmount: number;
  balanceAmount: number;
  status: string;
  yardId: string;
  traderLicenceId: string;
  assetId: string;
  receiptId?: string | null;
  lastAdjustment?: {
    invoiceNo?: string | null;
    amount: number;
    adjustmentRef?: string | null;
  } | null;
};

type PremisesOpt = { id: string; assetId: string; yardId: string; label: string };

export default function AdvanceRentDeposits() {
  const { can, user } = useAuth();
  const canCreate = can("M-03", "Create");
  const { toast } = useToast();
  const qc = useQueryClient();
  const [searchParams] = useSearchParams();
  const traderFromUrl = searchParams.get("traderLicenceId")?.trim() ?? "";

  const [q, setQ] = useState("");
  const [yardFilter, setYardFilter] = useState("all");
  const [statusTab, setStatusTab] = useState<"All" | "Active" | "FullyAdjusted">("All");
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [traderLicenceId, setTraderLicenceId] = useState(traderFromUrl);
  const [assetId, setAssetId] = useState("");
  const [amount, setAmount] = useState("");
  const [paymentPref, setPaymentPref] = useState<PaymentPreferenceValue>(() => defaultPaymentPreferenceValue());

  const listUrl = useMemo(() => {
    const u = new URL("/api/ioms/rent/advance-deposits", window.location.origin);
    if (q.trim()) u.searchParams.set("q", q.trim());
    if (yardFilter !== "all") u.searchParams.set("yardId", yardFilter);
    if (statusTab !== "All") u.searchParams.set("status", statusTab);
    if (traderFromUrl) u.searchParams.set("traderLicenceId", traderFromUrl);
    return u.pathname + u.search;
  }, [q, yardFilter, statusTab, traderFromUrl]);

  const { data, isLoading, isError } = useQuery<{
    rows: DepositRow[];
    summary: {
      balanceHeld: number;
      totalReceived: number;
      adjustedToDate: number;
      activeCount: number;
      totalCount: number;
    };
  }>({ queryKey: [listUrl] });

  const { getYardName } = useYardLabels();
  const { data: yards = [] } = useScopedActiveYards();
  const allotmentsUrl = traderLicenceId
    ? `/api/ioms/asset-allotments?traderLicenceId=${encodeURIComponent(traderLicenceId)}`
    : null;
  const { data: allotments = [] } = useQuery<Array<{ id: string; assetId: string; traderLicenceId: string; status: string }>>({
    queryKey: [allotmentsUrl ?? "no-allotments"],
    enabled: open && Boolean(allotmentsUrl),
  });
  const { data: assets = [] } = useQuery<Array<{ id: string; assetId: string; yardId: string }>>({
    queryKey: ["/api/ioms/assets"],
    enabled: open,
  });
  const assetById = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets]);

  const premisesOpts: PremisesOpt[] = useMemo(() => {
    return allotments
      .filter((a) => a.status === "Active")
      .map((a) => {
        const asset = assetById.get(a.assetId);
        const code = asset?.assetId ?? a.assetId;
        const yardName = getYardName(asset?.yardId, "");
        return {
          id: a.assetId,
          assetId: code,
          yardId: asset?.yardId ?? "",
          label: yardName ? `${code} · ${yardName}` : code,
        };
      })
      .filter((p, i, arr) => p.id && arr.findIndex((x) => x.id === p.id) === i);
  }, [allotments, assetById, getYardName]);

  const selectedPremises = premisesOpts.find((p) => p.id === assetId);

  const collect = useMutation({
    mutationFn: async () => {
      const pref = { ...paymentPref, paidAmount: String(amount) };
      const err = validatePaymentPreference(pref);
      if (err) throw new Error(err);
      if (!traderLicenceId) throw new Error("Select a trader");
      if (!assetId) throw new Error("Select premises");
      const amt = Number(amount);
      if (!Number.isFinite(amt) || amt <= 0) throw new Error("Enter a valid deposit amount");
      const yardId = selectedPremises?.yardId || yards[0]?.id;
      if (!yardId) throw new Error("Yard required");
      const payBody = buildCounterDuesPaymentApiBody(pref, amt);
      const res = await fetch("/api/ioms/rent/advance-deposits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          yardId,
          traderLicenceId,
          assetId,
          amountInr: amt,
          paymentMode: payBody.paymentMode,
          chequeNo: payBody.chequeNo,
          bankName: payBody.bankName,
          paymentRef: payBody.gatewayRef,
          depositDate: payBody.paymentDate ?? undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error ?? res.statusText);
      return body as DepositRow;
    },
    onSuccess: (row) => {
      toast({ title: "Deposit recorded", description: row.depositReceiptNo });
      setOpen(false);
      setStep(1);
      setAmount("");
      setAssetId("");
      void qc.invalidateQueries({ queryKey: [listUrl] });
      window.location.href = `/rent/ioms/advance-deposits/${row.id}`;
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const columns: ReportTableColumn[] = [
    { key: "_receipt", header: "Deposit receipt" },
    { key: "depositDate", header: "Date" },
    { key: "traderName", header: "Trader" },
    { key: "premisesCode", header: "Premises" },
    { key: "_deposit", header: "Deposit (₹)" },
    { key: "_adjusted", header: "Adjusted (₹)" },
    { key: "_balance", header: "Balance (₹)" },
    { key: "_last", header: "Last adjustment" },
    { key: "_status", header: "Status" },
    { key: "_actions", header: "Actions" },
  ];

  const rows = (data?.rows ?? []).map((d) => ({
    id: d.id,
    depositDate: d.depositDate,
    traderName: d.traderName ?? "—",
    premisesCode: d.premisesCode ?? "—",
    _receipt: (
      <Link href={`/rent/ioms/advance-deposits/${d.id}`} className="text-primary hover:underline font-mono text-sm">
        {d.depositReceiptNo}
      </Link>
    ),
    _deposit: formatInr(d.depositAmount),
    _adjusted: formatInr(d.adjustedAmount),
    _balance: formatInr(d.balanceAmount),
    _last: d.lastAdjustment
      ? `${d.lastAdjustment.invoiceNo ?? "—"} · ${formatInr(d.lastAdjustment.amount)}`
      : "—",
    _status: (
      <Badge variant={d.status === "Active" ? "default" : "secondary"}>
        {d.status === "FullyAdjusted" ? "Fully adjusted" : d.status}
      </Badge>
    ),
    _actions: (
      <div className="flex gap-2">
        <Button asChild size="sm" variant="outline">
          <Link href={`/rent/ioms/advance-deposits/${d.id}`}>Ledger</Link>
        </Button>
        {d.receiptId && (
          <Button asChild size="sm" variant="ghost">
            <Link href={`/receipts/ioms/${d.receiptId}`}>Receipt</Link>
          </Button>
        )}
      </div>
    ),
  }));

  const summary = data?.summary;

  return (
    <AppShell breadcrumbs={[{ label: "Rent (IOMS)", href: "/rent/ioms" }, { label: "Advance rent deposits" }]}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold flex items-center gap-2">
              <Wallet className="h-6 w-6" /> Advance rent deposits
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Deposits are adjusted automatically against rent, GST and interest when each invoice for the premises is
              approved.
            </p>
          </div>
          {canCreate && (
            <Button
              onClick={() => {
                setOpen(true);
                setStep(1);
              }}
            >
              <Plus className="h-4 w-4 mr-1" /> Collect advance deposit
            </Button>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="bg-primary/5 border-primary/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Balance held</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold">{formatInr(summary?.balanceHeld ?? 0)}</CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total deposits received</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold">{formatInr(summary?.totalReceived ?? 0)}</CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Adjusted to date</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold">{formatInr(summary?.adjustedToDate ?? 0)}</CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Deposits still active</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold">
              {summary?.activeCount ?? 0}
              <span className="text-sm font-normal text-muted-foreground"> of {summary?.totalCount ?? 0}</span>
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <Input
            className="max-w-xs"
            placeholder="Receipt no., trader or premises"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <Select value={yardFilter} onValueChange={setYardFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Yard" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Yard: All</SelectItem>
              {yards.map((y) => (
                <SelectItem key={y.id} value={y.id}>
                  {y.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex gap-1">
            {(["All", "Active", "FullyAdjusted"] as const).map((t) => (
              <Button key={t} size="sm" variant={statusTab === t ? "default" : "outline"} onClick={() => setStatusTab(t)}>
                {t === "FullyAdjusted" ? "Fully adjusted" : t}
                {t === "All" && summary ? ` (${summary.totalCount})` : ""}
                {t === "Active" && summary ? ` (${summary.activeCount})` : ""}
              </Button>
            ))}
          </div>
        </div>

        {isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : isError ? (
          <div className="flex items-center gap-2 text-destructive">
            <AlertCircle className="h-4 w-4" /> Failed to load deposits
          </div>
        ) : (
          <ClientDataGrid
            columns={columns}
            sourceRows={rows as Record<string, unknown>[]}
            searchKeys={["traderName", "premisesCode", "depositDate"]}
            searchPlaceholder="Filter deposits…"
            defaultSortKey="depositDate"
          />
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Collect advance deposit</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            Step {step} of 3 — {step === 1 ? "Deposit" : step === 2 ? "Mode and details" : "Review"}
          </p>
          {step === 1 && (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label>Trader</Label>
                <TraderLicenceSearchSelect value={traderLicenceId} onValueChange={setTraderLicenceId} />
              </div>
              <div className="space-y-1">
                <Label>Premises</Label>
                <Select value={assetId} onValueChange={setAssetId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select allotted premises" />
                  </SelectTrigger>
                  <SelectContent>
                    {premisesOpts.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Only premises with a current allotment are listed.</p>
              </div>
              <div className="space-y-1">
                <Label>Deposit amount (₹)</Label>
                <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
              </div>
              <div className="rounded-md border bg-muted/40 p-3 text-sm space-y-1">
                <p className="font-medium">How the deposit is adjusted</p>
                <p className="text-muted-foreground text-xs">
                  When a rent invoice for this premises is approved, the full invoice (rent, GST, interest) is adjusted
                  against the deposit up to the available balance. Any remainder is collected in Outstanding dues.
                </p>
              </div>
            </div>
          )}
          {step === 2 && (
            <PaymentPreferenceForm
              value={paymentPref}
              onChange={setPaymentPref}
              summaryAmount={String(Number(amount) || 0)}
              receivedByLabel={user?.name ?? "Counter"}
              receivedAtLabel={getYardName(selectedPremises?.yardId, "Yard")}
            />
          )}
          {step === 3 && (
            <div className="space-y-2 text-sm">
              <p>
                <span className="text-muted-foreground">Amount: </span>
                {formatInr(Number(amount) || 0)}
              </p>
              <p>
                <span className="text-muted-foreground">Premises: </span>
                {selectedPremises?.label ?? assetId}
              </p>
              <p>
                <span className="text-muted-foreground">Mode: </span>
                {paymentPref.paymentType}
              </p>
              <p className="text-muted-foreground text-xs">
                Confirming creates an Advance Rent Deposit Receipt and makes the balance available for automatic
                adjustment.
              </p>
            </div>
          )}
          <DialogFooter className="gap-2">
            {step > 1 ? (
              <Button variant="outline" onClick={() => setStep((s) => (s - 1) as 1 | 2 | 3)}>
                Back
              </Button>
            ) : (
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            )}
            {step < 3 ? (
              <Button
                onClick={() => {
                  if (step === 1 && (!traderLicenceId || !assetId || !(Number(amount) > 0))) {
                    toast({ title: "Complete deposit details", variant: "destructive" });
                    return;
                  }
                  if (step === 2) {
                    const err = validatePaymentPreference({ ...paymentPref, paidAmount: String(amount) });
                    if (err) {
                      toast({ title: err, variant: "destructive" });
                      return;
                    }
                  }
                  setStep((s) => (s + 1) as 1 | 2 | 3);
                }}
              >
                Continue
              </Button>
            ) : (
              <Button onClick={() => collect.mutate()} disabled={collect.isPending}>
                {collect.isPending ? "Saving…" : "Confirm and generate receipt"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
