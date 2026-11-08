import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { formatInr } from "@/lib/formatInr";
import { ApiUserError, fetchApiGet, readApiErrorEnvelope } from "@/lib/queryClient";
import { localCalendarYmd } from "@shared/premises-allocation";
import { AlertCircle, FileBarChart, RefreshCw, Search, Undo2 } from "lucide-react";

interface EligibleRow {
  id: string;
  transactionNo: string | null;
  receiptId: string | null;
  receiptNo: string | null;
  transactionDate: string;
  transactionTime: string | null;
  entryLocationId: string;
  entryLocationName: string;
  vehicleNumber: string | null;
  vehicleMake: string | null;
  traderName: string;
  traderContact: string | null;
  licenceNo: string | null;
  originatingState: string | null;
  destinationState: string | null;
  securityDepositAmount: number;
  adminChargesAmount: number;
  totalCommodityValue: number;
  totalMarketFee: number;
  totalPayable: number;
  paymentMode: string | null;
  generatedAt: string | null;
  elapsedHours: number;
  remainingMs: number;
  timeLeft: string;
  expiringWithinOneHour: boolean;
  refundWindowHours: number;
}

interface AuditDetail {
  id: string;
  caseLabel: string;
  transactionNo: string | null;
  vehicleNumber: string | null;
  vehicleMake: string | null;
  traderName: string;
  traderContact: string | null;
  licenceNo: string | null;
  originatingState: string | null;
  destinationState: string | null;
  paymentMode: string | null;
  totalCommodityValue: number;
  totalMarketFee: number;
  securityDepositAmount: number;
  adminChargesAmount: number;
  totalPayable: number;
  lines: Array<{
    commodityName: string | null;
    quantity: number;
    unit: string;
    ratePerUnit: number;
    commodityValue: number;
    marketFeeAmount: number;
  }>;
  originalReceipt: {
    receiptNo: string | null;
    generatedAt: string | null;
    collectedAt: string;
    collectedBy: string | null;
    paymentMode: string | null;
    amount: number;
  };
}

interface Dashboard {
  eligibleCount: number;
  expiringWithinOneHour: number;
  refundsTodayCount: number;
  amountRefundedToday: number;
  refundWindowHours: number;
}

interface TodayRefundRow {
  id: string;
  refundReceiptNo: string | null;
  originalReceiptNo: string | null;
  vehicleNumber: string | null;
  securityDepositAmount: number;
  refundAmount: number;
  processedByName: string;
  recordedAt: string | null;
}

function formatGenerated(iso: string | null, date: string, time: string | null): string {
  if (iso) {
    try {
      return new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
    } catch {
      /* fall through */
    }
  }
  return `${date}${time ? ` ${time}` : ""}`;
}

export default function CheckPostCaseESdRefund() {
  const { can } = useAuth();
  const canRead = can("M-04", "Read");
  const canCreate = can("M-04", "Create");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [q, setQ] = useState("");
  const [vehicleNumber, setVehicleNumber] = useState("");
  const [paymentModeFilter, setPaymentModeFilter] = useState("all");
  const [applied, setApplied] = useState({ q: "", vehicleNumber: "", paymentMode: "all" });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [exitCheckPostId, setExitCheckPostId] = useState("");
  const [refundDate, setRefundDate] = useState(() => localCalendarYmd());
  const [refundAmount, setRefundAmount] = useState("");
  const [paymentMode, setPaymentMode] = useState("Cash");

  const { data: yards = [] } = useQuery<Array<{ id: string; name: string; code: string; type?: string }>>({
    queryKey: ["/api/yards"],
    enabled: canRead,
  });
  const exitOptions = useMemo(
    () => yards.filter((y) => !y.type || y.type === "CheckPost" || y.type === "Yard"),
    [yards],
  );
  const singleBound = exitOptions.length === 1 ? exitOptions[0]! : null;
  useEffect(() => {
    if (singleBound && !exitCheckPostId) setExitCheckPostId(singleBound.id);
  }, [singleBound, exitCheckPostId]);

  const { data: dashboard, refetch: refetchDash } = useQuery<Dashboard>({
    queryKey: ["/api/ioms/market/transaction-wizard/case-e/dashboard", exitCheckPostId],
    enabled: canRead,
    queryFn: async () => {
      const u = new URL("/api/ioms/market/transaction-wizard/case-e/dashboard", window.location.origin);
      if (exitCheckPostId) u.searchParams.set("checkPostId", exitCheckPostId);
      return fetchApiGet(u.pathname + u.search);
    },
    refetchInterval: 60_000,
  });

  const {
    data: eligibleData,
    isLoading: eligibleLoading,
    isFetching: eligibleFetching,
    refetch: refetchEligible,
  } = useQuery<{ count: number; rows: EligibleRow[] }>({
    queryKey: ["/api/ioms/market/transaction-wizard/case-e/refundable", applied],
    enabled: canRead,
    queryFn: async () => {
      const u = new URL("/api/ioms/market/transaction-wizard/case-e/refundable", window.location.origin);
      if (applied.q) u.searchParams.set("q", applied.q);
      if (applied.vehicleNumber) u.searchParams.set("vehicleNumber", applied.vehicleNumber);
      if (applied.paymentMode && applied.paymentMode !== "all") u.searchParams.set("paymentMode", applied.paymentMode);
      return fetchApiGet(u.pathname + u.search);
    },
    refetchInterval: 60_000,
  });

  const today = localCalendarYmd();
  const { data: todayRefunds } = useQuery<{ rows: TodayRefundRow[] }>({
    queryKey: ["/api/ioms/market/transaction-wizard/case-e/refunds", "today", exitCheckPostId, today],
    enabled: canRead,
    queryFn: async () => {
      const u = new URL("/api/ioms/market/transaction-wizard/case-e/refunds", window.location.origin);
      u.searchParams.set("from", today);
      u.searchParams.set("to", today);
      if (exitCheckPostId) u.searchParams.set("checkPostId", exitCheckPostId);
      return fetchApiGet(u.pathname + u.search);
    },
  });

  const { data: audit, isFetching: auditLoading } = useQuery<AuditDetail>({
    queryKey: ["/api/ioms/market/transaction-wizard/case-e/refunds", selectedId, "audit"],
    enabled: canRead && Boolean(selectedId),
    queryFn: () =>
      fetchApiGet(`/api/ioms/market/transaction-wizard/case-e/refunds/${selectedId}/audit`),
  });

  const selectedEligible = useMemo(
    () => (eligibleData?.rows ?? []).find((r) => r.id === selectedId) ?? null,
    [eligibleData?.rows, selectedId],
  );

  useEffect(() => {
    if (selectedEligible) {
      setRefundAmount(String(selectedEligible.securityDepositAmount));
      if (selectedEligible.paymentMode) setPaymentMode(selectedEligible.paymentMode);
    }
  }, [selectedEligible]);

  const processMutation = useMutation({
    mutationFn: async () => {
      if (!selectedId || !selectedEligible) throw new Error("Select an eligible receipt");
      if (!exitCheckPostId.trim()) throw new Error("Select the exiting check post");
      if (exitCheckPostId === selectedEligible.entryLocationId) {
        throw new Error("Exit check post must differ from the entry check post");
      }
      const res = await fetch(`/api/ioms/market/transaction-wizard/${selectedId}/security-deposit-refund`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          checkPostId: exitCheckPostId.trim(),
          refundDate,
          refundAmount: refundAmount.trim() === "" ? undefined : Number(refundAmount),
          paymentMode,
        }),
      });
      if (!res.ok) {
        const { message, code } = await readApiErrorEnvelope(res);
        throw new ApiUserError(message, code);
      }
      return res.json() as Promise<{
        sdRefundReceiptNo: string;
        sdRefundAmount: number;
        originalReceiptNo: string | null;
        routeText: string;
        processedByName: string;
      }>;
    },
    onSuccess: (result) => {
      toast({
        title: "Security deposit refunded",
        description: `${result.sdRefundReceiptNo} · ${formatInr(result.sdRefundAmount)} · ${result.routeText} · by ${result.processedByName}`,
      });
      setSelectedId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/market/transaction-wizard/case-e/refundable"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/market/transaction-wizard/case-e/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/market/transaction-wizard/case-e/refunds"] });
    },
    onError: (e: unknown) => {
      toast({
        title: "Refund failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    },
  });

  if (!canRead) {
    return (
      <AppShell breadcrumbs={[{ label: "Check Post", href: "/checkpost/inward" }, { label: "Security Deposit Refund" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3 text-destructive">
            <AlertCircle className="h-5 w-5" />
            M-04 Read permission required.
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell
      breadcrumbs={[
        { label: "Check Post", href: "/checkpost/inward" },
        { label: "Security Deposit Refund" },
      ]}
    >
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Undo2 className="h-5 w-5" />
              Security Deposit Refund
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Case E – Transit through Goa only. Receipts stay selectable for{" "}
              {dashboard?.refundWindowHours ?? 8} hours from generation. Already refunded or expired receipts are not
              listed.
            </p>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link href="/checkpost/case-e-sd-refund-report">
              <FileBarChart className="h-4 w-4 mr-2" />
              Refund report
            </Link>
          </Button>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-md border p-3">
              <p className="text-xs text-muted-foreground">Eligible receipts</p>
              <p className="text-2xl font-semibold">{dashboard?.eligibleCount ?? eligibleData?.count ?? "—"}</p>
              <p className="text-xs text-muted-foreground">Case E, within 8 hours</p>
            </div>
            <div className="rounded-md border p-3">
              <p className="text-xs text-muted-foreground">Expiring within 1 hour</p>
              <p className="text-2xl font-semibold text-amber-700 dark:text-amber-400">
                {dashboard?.expiringWithinOneHour ?? "—"}
              </p>
              <p className="text-xs text-muted-foreground">Process these first</p>
            </div>
            <div className="rounded-md border p-3">
              <p className="text-xs text-muted-foreground">Refunds today</p>
              <p className="text-2xl font-semibold">{dashboard?.refundsTodayCount ?? "—"}</p>
              <p className="text-xs text-muted-foreground">At this check post</p>
            </div>
            <div className="rounded-md border p-3">
              <p className="text-xs text-muted-foreground">Amount refunded today</p>
              <p className="text-2xl font-semibold">{formatInr(dashboard?.amountRefundedToday ?? 0)}</p>
              <p className="text-xs text-muted-foreground">At this check post</p>
            </div>
          </div>

          <div className="rounded-md border p-4 space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h3 className="font-medium">1. Search &amp; select receipt</h3>
                <p className="text-xs text-muted-foreground">Sorted by time remaining (least first).</p>
              </div>
              <div className="space-y-1 min-w-[220px]">
                <Label>Working exit check post</Label>
                {singleBound ? (
                  <Input readOnly className="bg-muted" value={`${singleBound.name} (${singleBound.code})`} />
                ) : (
                  <Select value={exitCheckPostId || undefined} onValueChange={setExitCheckPostId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select check post" />
                    </SelectTrigger>
                    <SelectContent>
                      {exitOptions.map((y) => (
                        <SelectItem key={y.id} value={y.id}>
                          {y.name} ({y.code})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1">
                <Label>Receipt / trader / txn</Label>
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Receipt number…" />
              </div>
              <div className="space-y-1">
                <Label>Vehicle number</Label>
                <Input value={vehicleNumber} onChange={(e) => setVehicleNumber(e.target.value)} placeholder="KA…" />
              </div>
              <div className="space-y-1">
                <Label>Payment mode</Label>
                <Select value={paymentModeFilter} onValueChange={setPaymentModeFilter}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="Cash">Cash</SelectItem>
                    <SelectItem value="Cheque">Cheque</SelectItem>
                    <SelectItem value="Online">Online / UPI</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <Button
                  onClick={() =>
                    setApplied({
                      q: q.trim(),
                      vehicleNumber: vehicleNumber.trim(),
                      paymentMode: paymentModeFilter,
                    })
                  }
                >
                  <Search className="h-4 w-4 mr-2" />
                  Search
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setQ("");
                    setVehicleNumber("");
                    setPaymentModeFilter("all");
                    setApplied({ q: "", vehicleNumber: "", paymentMode: "all" });
                  }}
                >
                  Reset
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    refetchEligible();
                    refetchDash();
                  }}
                  disabled={eligibleFetching}
                >
                  <RefreshCw className={`h-4 w-4 ${eligibleFetching ? "animate-spin" : ""}`} />
                </Button>
              </div>
            </div>

            {eligibleLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left">
                    <tr>
                      <th className="p-2 font-medium">Receipt</th>
                      <th className="p-2 font-medium">Vehicle</th>
                      <th className="p-2 font-medium">Generated at</th>
                      <th className="p-2 font-medium">Payment</th>
                      <th className="p-2 font-medium">Deposit</th>
                      <th className="p-2 font-medium">Time left</th>
                      <th className="p-2 font-medium" />
                    </tr>
                  </thead>
                  <tbody>
                    {(eligibleData?.rows ?? []).length === 0 ? (
                      <tr>
                        <td colSpan={7} className="p-4 text-muted-foreground">
                          No eligible Case E receipts within the 8-hour window.
                        </td>
                      </tr>
                    ) : (
                      (eligibleData?.rows ?? []).map((r) => (
                        <tr key={r.id} className="border-t">
                          <td className="p-2 font-mono">{r.receiptNo ?? r.transactionNo ?? r.id}</td>
                          <td className="p-2">
                            {r.vehicleNumber ?? "—"}
                            {r.vehicleMake ? (
                              <span className="block text-xs text-muted-foreground">{r.vehicleMake}</span>
                            ) : null}
                          </td>
                          <td className="p-2">
                            {formatGenerated(r.generatedAt, r.transactionDate, r.transactionTime)}
                            <span className="block text-xs text-muted-foreground">{r.entryLocationName}</span>
                          </td>
                          <td className="p-2">{r.paymentMode ?? "—"}</td>
                          <td className="p-2">{formatInr(r.securityDepositAmount)}</td>
                          <td className="p-2">
                            <Badge variant={r.expiringWithinOneHour ? "destructive" : "secondary"}>{r.timeLeft}</Badge>
                          </td>
                          <td className="p-2 text-right">
                            {canCreate && (
                              <Button
                                size="sm"
                                variant={selectedId === r.id ? "default" : "secondary"}
                                onClick={() => setSelectedId(r.id)}
                              >
                                {selectedId === r.id ? "Selected" : "Select"}
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="rounded-md border p-4 space-y-4">
            <h3 className="font-medium">2. Transaction details</h3>
            {!selectedId ? (
              <p className="text-sm text-muted-foreground">
                Select a receipt from the list to load its transaction details and process the Security Deposit refund.
              </p>
            ) : auditLoading || !audit ? (
              <Skeleton className="h-32 w-full" />
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 text-sm">
                  <div>
                    <p className="text-muted-foreground">Original receipt</p>
                    <p className="font-mono font-medium">{audit.originalReceipt.receiptNo ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Transaction</p>
                    <p className="font-mono">{audit.transactionNo ?? audit.id}</p>
                    <p className="text-xs text-muted-foreground">{audit.caseLabel}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Vehicle</p>
                    <p>
                      {audit.vehicleNumber ?? "—"}
                      {audit.vehicleMake ? ` · ${audit.vehicleMake}` : ""}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Trader / paid to</p>
                    <p>{audit.traderName}</p>
                    {audit.traderContact ? <p className="text-xs text-muted-foreground">{audit.traderContact}</p> : null}
                  </div>
                  <div>
                    <p className="text-muted-foreground">Collected at</p>
                    <p>{audit.originalReceipt.collectedAt}</p>
                    <p className="text-xs text-muted-foreground">
                      By {audit.originalReceipt.collectedBy ?? "—"} · {audit.originalReceipt.paymentMode ?? "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Route</p>
                    <p>
                      {(audit.originatingState ?? "—") + " → " + (audit.destinationState ?? "—")}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Security Deposit collected</p>
                    <p className="text-lg font-semibold">{formatInr(audit.securityDepositAmount)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Admin charges (retained)</p>
                    <p>{formatInr(audit.adminChargesAmount)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Commodity value / market fee equiv.</p>
                    <p>
                      {formatInr(audit.totalCommodityValue)} / {formatInr(audit.totalMarketFee)}
                    </p>
                  </div>
                </div>
                {audit.lines.length > 0 && (
                  <div className="overflow-x-auto rounded-md border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/40 text-left">
                        <tr>
                          <th className="p-2">Commodity</th>
                          <th className="p-2">Qty</th>
                          <th className="p-2">Rate</th>
                          <th className="p-2">Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {audit.lines.map((l, i) => (
                          <tr key={i} className="border-t">
                            <td className="p-2">{l.commodityName ?? "—"}</td>
                            <td className="p-2">
                              {l.quantity} {l.unit}
                            </td>
                            <td className="p-2">{formatInr(l.ratePerUnit)}</td>
                            <td className="p-2">{formatInr(l.commodityValue)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {canCreate && (
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 border-t pt-4">
                    <div className="space-y-1">
                      <Label>Refund amount (₹)</Label>
                      <Input type="number" value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label>Refund date</Label>
                      <Input type="date" value={refundDate} onChange={(e) => setRefundDate(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label>Payment mode</Label>
                      <Select value={paymentMode} onValueChange={setPaymentMode}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Cash">Cash</SelectItem>
                          <SelectItem value="Cheque">Cheque</SelectItem>
                          <SelectItem value="Online">Online / UPI</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-end gap-2">
                      <Button onClick={() => processMutation.mutate()} disabled={processMutation.isPending}>
                        {processMutation.isPending ? "Processing…" : "Process refund"}
                      </Button>
                      <Button variant="outline" onClick={() => setSelectedId(null)} disabled={processMutation.isPending}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="rounded-md border p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-medium">Refunds processed today at this check post</h3>
              <Link href="/checkpost/case-e-sd-refund-report" className="text-sm text-primary underline">
                View full report →
              </Link>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th className="p-2">Refund ref.</th>
                    <th className="p-2">Original receipt</th>
                    <th className="p-2">Vehicle</th>
                    <th className="p-2">Collected</th>
                    <th className="p-2">Refunded</th>
                    <th className="p-2">Processed by</th>
                    <th className="p-2">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {(todayRefunds?.rows ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-3 text-muted-foreground">
                        No refunds yet today at this check post.
                      </td>
                    </tr>
                  ) : (
                    (todayRefunds?.rows ?? []).slice(0, 10).map((r) => (
                      <tr key={r.id} className="border-t">
                        <td className="p-2 font-mono">{r.refundReceiptNo ?? "—"}</td>
                        <td className="p-2 font-mono">{r.originalReceiptNo ?? "—"}</td>
                        <td className="p-2">{r.vehicleNumber ?? "—"}</td>
                        <td className="p-2">{formatInr(r.securityDepositAmount)}</td>
                        <td className="p-2">{formatInr(r.refundAmount)}</td>
                        <td className="p-2">{r.processedByName}</td>
                        <td className="p-2">
                          {r.recordedAt
                            ? new Date(r.recordedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
                            : "—"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">
              Financial audit trail is recorded automatically for every refund: original receipt reference, SD collected,
              amount refunded, date/time, check post, and processing official.
            </p>
          </div>
        </CardContent>
      </Card>
    </AppShell>
  );
}
