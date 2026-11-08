import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ClientDataGrid } from "@/components/reports/ClientDataGrid";
import type { ReportTableColumn } from "@/components/reports/ReportDataTable";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { formatInr } from "@/lib/formatInr";
import { ApiUserError, fetchApiGet, readApiErrorEnvelope } from "@/lib/queryClient";
import { localCalendarYmd } from "@shared/premises-allocation";
import { MARKET_TRANSACTION_CASES } from "@shared/market-transaction-cases";
import { AlertCircle, Download, FileBarChart, RefreshCw } from "lucide-react";

interface ReportRow {
  sNo: number;
  id: string;
  lineId: string | null;
  transactionNo: string;
  caseType: string;
  caseLabel: string;
  transactionDate: string;
  transactionTime: string | null;
  entryLocationName: string;
  status: string;
  vehicleNumber: string | null;
  traderName: string;
  licenceNo: string;
  sellerType: string | null;
  farmerName: string | null;
  commoditySource: string | null;
  placeOfOrigin: string | null;
  originatingState: string | null;
  destinationState: string | null;
  exitCheckposts: string;
  commodityName: string;
  quantity: number | null;
  unit: string | null;
  ratePerUnit: number | null;
  commodityValue: number | null;
  totalCommodityValue: number;
  totalMarketFee: number;
  fineAmount: number;
  securityDepositAmount: number;
  adminChargesAmount: number;
  totalPayable: number;
  paymentMode: string | null;
  sdRefundCheckPostId: string | null;
  sdRefundCheckPostName: string | null;
  sdRefundTxnRef: string | null;
  sdRefundDate: string | null;
  sdRefundAmount: number | null;
}

interface ReportResponse {
  from: string;
  to: string;
  count: number;
  rows: ReportRow[];
}

function monthRange(d = new Date()): { from: string; to: string } {
  const y = d.getFullYear();
  const m = d.getMonth();
  const from = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  const to = new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
  return { from, to };
}

export default function MarketWizardTransactionReport() {
  const { can } = useAuth();
  const canRead = can("M-04", "Read");
  const canCreate = can("M-04", "Create");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const initial = monthRange();

  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [caseType, setCaseType] = useState("all");
  const [status, setStatus] = useState("all");
  const [commodityId, setCommodityId] = useState("all");
  const [applied, setApplied] = useState({
    from: initial.from,
    to: initial.to,
    caseType: "all",
    status: "all",
    commodityId: "",
  });

  const [refundOpen, setRefundOpen] = useState(false);
  const [refundTxn, setRefundTxn] = useState<ReportRow | null>(null);
  const [refundCheckPostId, setRefundCheckPostId] = useState("");
  const [refundTxnRef, setRefundTxnRef] = useState("");
  const [refundDate, setRefundDate] = useState(() => localCalendarYmd());
  const [refundAmount, setRefundAmount] = useState("");

  const { data: commodities = [] } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ["/api/ioms/commodities"],
    enabled: canRead,
  });

  const { data: yards = [] } = useQuery<Array<{ id: string; name: string; code: string; type?: string }>>({
    queryKey: ["/api/yards"],
    enabled: canRead,
  });

  const checkPosts = useMemo(
    () => yards.filter((y) => !y.type || y.type === "CheckPost" || y.type === "Yard"),
    [yards],
  );

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<ReportResponse>({
    queryKey: ["/api/ioms/market/transaction-wizard/report", applied],
    enabled: canRead,
    queryFn: async () => {
      const u = new URL("/api/ioms/market/transaction-wizard/report", window.location.origin);
      u.searchParams.set("from", applied.from);
      u.searchParams.set("to", applied.to);
      if (applied.caseType && applied.caseType !== "all") u.searchParams.set("caseType", applied.caseType);
      if (applied.status && applied.status !== "all") u.searchParams.set("status", applied.status);
      if (applied.commodityId) u.searchParams.set("commodityId", applied.commodityId);
      return fetchApiGet<ReportResponse>(u.pathname + u.search);
    },
  });

  const exportUrl = useMemo(() => {
    const u = new URL("/api/ioms/market/transaction-wizard/report", window.location.origin);
    u.searchParams.set("from", applied.from);
    u.searchParams.set("to", applied.to);
    if (applied.caseType && applied.caseType !== "all") u.searchParams.set("caseType", applied.caseType);
    if (applied.status && applied.status !== "all") u.searchParams.set("status", applied.status);
    if (applied.commodityId) u.searchParams.set("commodityId", applied.commodityId);
    u.searchParams.set("format", "csv");
    return u.pathname + u.search;
  }, [applied]);

  const refundMutation = useMutation({
    mutationFn: async () => {
      if (!refundTxn) throw new Error("No transaction selected");
      if (!refundCheckPostId.trim()) throw new Error("Select the check post where the refund was processed");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(refundDate)) throw new Error("Refund date is required");
      const res = await fetch(`/api/ioms/market/transaction-wizard/${refundTxn.id}/security-deposit-refund`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          checkPostId: refundCheckPostId.trim(),
          refundTxnRef: refundTxnRef.trim() || undefined,
          refundDate,
          refundAmount: refundAmount.trim() === "" ? undefined : Number(refundAmount),
          paymentMode: "Cash",
        }),
      });
      if (!res.ok) {
        const { message, code } = await readApiErrorEnvelope(res);
        throw new ApiUserError(message, code);
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Security deposit refund recorded", description: "Linked to the original Case E transaction." });
      setRefundOpen(false);
      setRefundTxn(null);
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/market/transaction-wizard/report"] });
    },
    onError: (e: unknown) => {
      toast({
        title: "Could not record refund",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    },
  });

  const totals = useMemo(() => {
    const seen = new Set<string>();
    let marketFee = 0;
    let fine = 0;
    let sd = 0;
    let admin = 0;
    let payable = 0;
    let value = 0;
    let sdRefunded = 0;
    for (const r of data?.rows ?? []) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      marketFee += Number(r.totalMarketFee ?? 0);
      fine += Number(r.fineAmount ?? 0);
      sd += Number(r.securityDepositAmount ?? 0);
      admin += Number(r.adminChargesAmount ?? 0);
      payable += Number(r.totalPayable ?? 0);
      value += Number(r.totalCommodityValue ?? 0);
      if (r.sdRefundAmount != null) sdRefunded += Number(r.sdRefundAmount);
    }
    return { marketFee, fine, sd, admin, payable, value, sdRefunded, txnCount: seen.size };
  }, [data?.rows]);

  const columns = useMemo((): ReportTableColumn[] => {
    const cols: ReportTableColumn[] = [
      { key: "sNo", header: "S.No." },
      { key: "transactionNo", header: "Txn No" },
      { key: "caseType", header: "Case" },
      { key: "transactionDate", header: "Date" },
      { key: "entryLocationName", header: "Location" },
      { key: "traderName", header: "Trader" },
      { key: "licenceNo", header: "Licence" },
      { key: "commodityName", header: "Commodity" },
      { key: "qtyLabel", header: "Qty" },
      { key: "_value", header: "Value (₹)", sortField: "commodityValue" },
      { key: "_fee", header: "Market Fee (₹)", sortField: "totalMarketFee" },
      { key: "_fine", header: "Fine (₹)", sortField: "fineAmount" },
      { key: "_sd", header: "Security Deposit (₹)", sortField: "securityDepositAmount" },
      { key: "_admin", header: "Admin Charges (₹)", sortField: "adminChargesAmount" },
      { key: "_payable", header: "Total Payable (₹)", sortField: "totalPayable" },
      { key: "sdRefundCheckPostName", header: "SD Refund Check Post" },
      { key: "sdRefundTxnRef", header: "SD Refund Ref" },
      { key: "sdRefundDate", header: "SD Refund Date" },
      { key: "_status", header: "Status", sortField: "status" },
    ];
    if (canCreate) cols.push({ key: "_actions", header: "Actions" });
    return cols;
  }, [canCreate]);

  const gridRows = useMemo((): Record<string, unknown>[] => {
    return (data?.rows ?? []).map((r) => {
      const canRecordRefund =
        canCreate && r.caseType === "E" && r.status === "Finalized" && !r.sdRefundTxnRef;
      return {
        id: `${r.id}:${r.lineId ?? "tx"}`,
        sNo: r.sNo,
        transactionNo: r.transactionNo,
        caseType: r.caseType,
        transactionDate: r.transactionDate,
        entryLocationName: r.entryLocationName,
        traderName: r.traderName,
        licenceNo: r.licenceNo,
        commodityName: r.commodityName,
        qtyLabel: r.quantity != null ? `${r.quantity} ${r.unit ?? ""}`.trim() : "—",
        commodityValue: r.commodityValue ?? r.totalCommodityValue,
        totalMarketFee: r.totalMarketFee,
        fineAmount: r.fineAmount,
        securityDepositAmount: r.securityDepositAmount,
        adminChargesAmount: r.adminChargesAmount,
        totalPayable: r.totalPayable,
        status: r.status,
        sdRefundCheckPostName: r.sdRefundCheckPostName ?? "—",
        sdRefundTxnRef: r.sdRefundTxnRef ?? "—",
        sdRefundDate: r.sdRefundDate ?? "—",
        _value: formatInr(r.commodityValue ?? r.totalCommodityValue ?? 0),
        _fee: formatInr(r.totalMarketFee),
        _fine: formatInr(r.fineAmount),
        _sd: formatInr(r.securityDepositAmount),
        _admin: formatInr(r.adminChargesAmount),
        _payable: formatInr(r.totalPayable),
        _status: <Badge variant={r.status === "Finalized" ? "default" : "secondary"}>{r.status}</Badge>,
        _actions: canRecordRefund ? (
          <Button size="sm" variant="secondary" asChild>
            <a href="/checkpost/case-e-sd-refund">Process at Check Post</a>
          </Button>
        ) : null,
      };
    });
  }, [data?.rows, canCreate]);

  function applyFilters() {
    if (!from || !to) {
      toast({ title: "Date range required", description: "Select From and To dates.", variant: "destructive" });
      return;
    }
    if (from > to) {
      toast({ title: "Invalid range", description: "From must be on or before To.", variant: "destructive" });
      return;
    }
    setApplied({
      from,
      to,
      caseType,
      status,
      commodityId: commodityId === "all" ? "" : commodityId,
    });
  }

  function resetFilters() {
    const r = monthRange();
    setFrom(r.from);
    setTo(r.to);
    setCaseType("all");
    setStatus("all");
    setCommodityId("all");
    setApplied({ from: r.from, to: r.to, caseType: "all", status: "all", commodityId: "" });
  }

  async function exportCsv() {
    try {
      const res = await fetch(exportUrl, { credentials: "include" });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `wizard-transactions-${applied.from}_${applied.to}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      toast({
        title: "Export failed",
        description: e instanceof Error ? e.message : "Could not download CSV",
        variant: "destructive",
      });
    }
  }

  if (!canRead) {
    return (
      <AppShell breadcrumbs={[{ label: "Market (M-04)", href: "/market/transactions" }, { label: "Transaction Reports" }]}>
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
    <AppShell breadcrumbs={[{ label: "Market (M-04)", href: "/market/transactions" }, { label: "Transaction Reports" }]}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileBarChart className="h-5 w-5" />
            Transaction Reports (Cases A–G)
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Consolidated view of Transaction Wizard entries — commodities, value, market fee, fine, security deposit,
            administrative charges, and Case E security-deposit refunds linked to the original transit transaction.
            Exit check posts process refunds under{" "}
            <a href="/checkpost/case-e-sd-refund" className="text-primary underline">
              Check Post → Case E SD refund
            </a>
            .
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border p-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1">
              <Label>From</Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>To</Label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Case</Label>
              <Select value={caseType} onValueChange={setCaseType}>
                <SelectTrigger>
                  <SelectValue placeholder="All cases" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All cases</SelectItem>
                  {Object.values(MARKET_TRANSACTION_CASES).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      Case {c.id} — {c.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger>
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="Draft">Draft</SelectItem>
                  <SelectItem value="Finalized">Finalized</SelectItem>
                  <SelectItem value="Voided">Voided</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label>Commodity</Label>
              <Select value={commodityId} onValueChange={setCommodityId}>
                <SelectTrigger>
                  <SelectValue placeholder="All commodities" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All commodities</SelectItem>
                  {commodities.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-wrap items-end gap-2 sm:col-span-2 lg:col-span-2">
              <Button onClick={applyFilters}>Apply</Button>
              <Button variant="outline" onClick={resetFilters}>
                Reset
              </Button>
              <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
                <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
                Refresh
              </Button>
              <Button variant="secondary" onClick={exportCsv}>
                <Download className="h-4 w-4 mr-2" />
                Export CSV
              </Button>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
            <div className="rounded-md border p-3">
              <p className="text-muted-foreground">Transactions</p>
              <p className="text-lg font-semibold">{totals.txnCount}</p>
            </div>
            <div className="rounded-md border p-3">
              <p className="text-muted-foreground">Commodity value</p>
              <p className="text-lg font-semibold">{formatInr(totals.value)}</p>
            </div>
            <div className="rounded-md border p-3">
              <p className="text-muted-foreground">Market fee</p>
              <p className="text-lg font-semibold">{formatInr(totals.marketFee)}</p>
            </div>
            <div className="rounded-md border p-3">
              <p className="text-muted-foreground">Fine / SD / Admin</p>
              <p className="text-lg font-semibold">
                {formatInr(totals.fine)} / {formatInr(totals.sd)} / {formatInr(totals.admin)}
              </p>
            </div>
          </div>

          {isError ? (
            <Card className="bg-destructive/10 border-destructive/20">
              <CardContent className="p-4 flex items-center gap-3 text-destructive">
                <AlertCircle className="h-5 w-5" />
                {error instanceof Error ? error.message : "Failed to load report"}
              </CardContent>
            </Card>
          ) : isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <ClientDataGrid
              columns={columns}
              sourceRows={gridRows}
              searchKeys={[
                "transactionNo",
                "caseType",
                "entryLocationName",
                "traderName",
                "licenceNo",
                "commodityName",
                "sdRefundTxnRef",
                "sdRefundCheckPostName",
                "status",
              ]}
              searchPlaceholder="Search report…"
              defaultSortKey="transactionDate"
              defaultSortDir="desc"
              emptyMessage="No wizard transactions in this range."
            />
          )}
        </CardContent>
      </Card>

      <Dialog open={refundOpen} onOpenChange={(o) => !o && setRefundOpen(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Record Case E security deposit refund</DialogTitle>
          </DialogHeader>
          {refundTxn && (
            <p className="text-sm text-muted-foreground">
              Original txn <span className="font-mono">{refundTxn.transactionNo}</span> — collected SD{" "}
              {formatInr(refundTxn.securityDepositAmount)}.
            </p>
          )}
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Refund check post</Label>
              <Select value={refundCheckPostId || undefined} onValueChange={setRefundCheckPostId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select check post" />
                </SelectTrigger>
                <SelectContent>
                  {checkPosts.map((y) => (
                    <SelectItem key={y.id} value={y.id}>
                      {y.name} ({y.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Refund transaction reference</Label>
              <Input value={refundTxnRef} onChange={(e) => setRefundTxnRef(e.target.value)} placeholder="Exit / refund txn no." />
            </div>
            <div className="space-y-1">
              <Label>Refund date</Label>
              <Input type="date" value={refundDate} onChange={(e) => setRefundDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Refund amount (₹)</Label>
              <Input type="number" value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRefundOpen(false)} disabled={refundMutation.isPending}>
              Cancel
            </Button>
            <Button onClick={() => refundMutation.mutate()} disabled={refundMutation.isPending}>
              {refundMutation.isPending ? "Saving…" : "Save refund link"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
