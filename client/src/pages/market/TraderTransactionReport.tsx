import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { formatInr } from "@/lib/formatInr";
import { fetchApiGet } from "@/lib/queryClient";
import { AlertCircle, Download, FileBarChart, RefreshCw, Search } from "lucide-react";

interface CommodityRef {
  id: string;
  name: string;
}

interface LicenceRef {
  id: string;
  licenceNo?: string | null;
  firmName: string;
  mobile?: string | null;
}

interface ReportRow {
  sNo: number;
  id: string;
  transactionId: string;
  transactionDate: string;
  traderLicenceId: string;
  traderName: string;
  licenceNo: string;
  traderDisplay: string;
  commodity: string;
  quantity: number;
  unit: string;
  quantityDisplay: string;
  ratePerUnit: number;
  totalValue: number;
  marketFee: number;
  farmerName: string;
  placeOfPurchase: string;
  status: string;
  statusLabel: "Submitted" | "Pending";
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

export default function TraderTransactionReport() {
  const { can } = useAuth();
  const canRead = can("M-04", "Read");
  const { toast } = useToast();
  const initial = monthRange();

  const [scope, setScope] = useState<"all" | "single">("all");
  const [traderQ, setTraderQ] = useState("");
  const [selectedTraderId, setSelectedTraderId] = useState("");
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [commodityId, setCommodityId] = useState("all");
  const [status, setStatus] = useState("all");
  const [applied, setApplied] = useState({
    from: initial.from,
    to: initial.to,
    traderLicenceId: "",
    q: "",
    commodityId: "",
    status: "all",
  });

  const { data: commodities = [] } = useQuery<CommodityRef[]>({
    queryKey: ["/api/ioms/commodities"],
    enabled: canRead,
  });

  const traderSearchEnabled = canRead && scope === "single" && traderQ.trim().length >= 2;
  const { data: licenceHits = [], isFetching: searchingTraders } = useQuery<LicenceRef[]>({
    queryKey: ["/api/ioms/traders/licences", { q: traderQ.trim(), paged: "0" }],
    enabled: traderSearchEnabled,
    queryFn: async () => {
      const u = new URL("/api/ioms/traders/licences", window.location.origin);
      u.searchParams.set("q", traderQ.trim());
      u.searchParams.set("status", "Active");
      const res = await fetch(u.pathname + u.search, { credentials: "include" });
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : Array.isArray(data?.rows) ? data.rows : [];
    },
  });

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<ReportResponse>({
    queryKey: ["/api/ioms/market/reports/trader-transactions", applied],
    enabled: canRead,
    queryFn: async () => {
      const u = new URL("/api/ioms/market/reports/trader-transactions", window.location.origin);
      u.searchParams.set("from", applied.from);
      u.searchParams.set("to", applied.to);
      if (applied.traderLicenceId) u.searchParams.set("traderLicenceId", applied.traderLicenceId);
      if (applied.q) u.searchParams.set("q", applied.q);
      if (applied.commodityId) u.searchParams.set("commodityId", applied.commodityId);
      if (applied.status && applied.status !== "all") u.searchParams.set("status", applied.status);
      return fetchApiGet<ReportResponse>(u.pathname + u.search);
    },
  });

  const exportUrl = useMemo(() => {
    const u = new URL("/api/ioms/market/reports/trader-transactions", window.location.origin);
    u.searchParams.set("from", applied.from);
    u.searchParams.set("to", applied.to);
    if (applied.traderLicenceId) u.searchParams.set("traderLicenceId", applied.traderLicenceId);
    if (applied.q) u.searchParams.set("q", applied.q);
    if (applied.commodityId) u.searchParams.set("commodityId", applied.commodityId);
    if (applied.status && applied.status !== "all") u.searchParams.set("status", applied.status);
    u.searchParams.set("format", "csv");
    return u.pathname + u.search;
  }, [applied]);

  const columns = useMemo(
    (): ReportTableColumn[] => [
      { key: "sNo", header: "S.No." },
      { key: "transactionId", header: "Transaction ID" },
      { key: "transactionDate", header: "Transaction Date" },
      { key: "_trader", header: "Trader Name (License No.)" },
      { key: "commodity", header: "Commodity" },
      { key: "quantityDisplay", header: "Quantity (Unit)" },
      { key: "_rate", header: "Rate (Per Unit)" },
      { key: "_value", header: "Total Value (₹)" },
      { key: "_fee", header: "Market Fee (₹)" },
      { key: "farmerName", header: "Farmer Name" },
      { key: "placeOfPurchase", header: "Place of Purchase" },
      { key: "_status", header: "Status" },
    ],
    [],
  );

  const gridRows = useMemo((): Record<string, unknown>[] => {
    return (data?.rows ?? []).map((r) => ({
      id: r.id,
      sNo: r.sNo,
      transactionId: r.transactionId,
      transactionDate: r.transactionDate,
      commodity: r.commodity,
      quantityDisplay: r.quantityDisplay,
      farmerName: r.farmerName,
      placeOfPurchase: r.placeOfPurchase,
      _trader: (
        <span>
          {r.traderName}{" "}
          <Link href={`/traders/licences/${r.traderLicenceId}`} className="text-primary underline">
            ({r.licenceNo})
          </Link>
        </span>
      ),
      _rate: formatInr(r.ratePerUnit),
      _value: formatInr(r.totalValue),
      _fee: formatInr(r.marketFee),
      _status: (
        <Badge
          variant="outline"
          className={
            r.statusLabel === "Submitted"
              ? "border-emerald-600/40 bg-emerald-500/15 text-emerald-800 dark:text-emerald-200"
              : "border-amber-600/40 bg-amber-500/15 text-amber-900 dark:text-amber-100"
          }
        >
          {r.statusLabel}
        </Badge>
      ),
    }));
  }, [data?.rows]);

  function applyFilters() {
    if (!from || !to) {
      toast({ title: "Date range required", description: "Select From and To dates.", variant: "destructive" });
      return;
    }
    if (from > to) {
      toast({ title: "Invalid range", description: "From must be on or before To.", variant: "destructive" });
      return;
    }
    if (scope === "single" && !selectedTraderId && traderQ.trim().length < 2) {
      toast({
        title: "Select a trader",
        description: "Search and pick a trader, or type at least 2 characters to filter by name/licence.",
        variant: "destructive",
      });
      return;
    }
    setApplied({
      from,
      to,
      traderLicenceId: scope === "single" ? selectedTraderId : "",
      q: scope === "single" && !selectedTraderId ? traderQ.trim() : "",
      commodityId: commodityId === "all" ? "" : commodityId,
      status,
    });
  }

  function resetFilters() {
    const r = monthRange();
    setScope("all");
    setTraderQ("");
    setSelectedTraderId("");
    setFrom(r.from);
    setTo(r.to);
    setCommodityId("all");
    setStatus("all");
    setApplied({
      from: r.from,
      to: r.to,
      traderLicenceId: "",
      q: "",
      commodityId: "",
      status: "all",
    });
  }

  async function exportCsv() {
    try {
      const res = await fetch(exportUrl, { credentials: "include" });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `trader-transactions-${applied.from}_${applied.to}.csv`;
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
      <AppShell breadcrumbs={[{ label: "Market Fee", href: "/market/transactions" }, { label: "Trader Transaction Report" }]}>
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
    <AppShell breadcrumbs={[{ label: "Market Fee", href: "/market/transactions" }, { label: "Trader Transaction Report" }]}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileBarChart className="h-5 w-5" />
            Trader Transaction Report
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Purchase transactions by trader, date, commodity, and status. Status badges: Approved → Submitted; Draft/Verified →
            Pending.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border p-4 space-y-4">
            <div className="space-y-2">
              <Label>Report for</Label>
              <RadioGroup
                value={scope}
                onValueChange={(v) => {
                  setScope(v as "all" | "single");
                  if (v === "all") {
                    setSelectedTraderId("");
                    setTraderQ("");
                  }
                }}
                className="flex flex-wrap gap-4"
              >
                <label className="flex items-center gap-2 text-sm">
                  <RadioGroupItem value="all" id="scope-all" />
                  All Traders
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <RadioGroupItem value="single" id="scope-single" />
                  Single Trader
                </label>
              </RadioGroup>
            </div>

            {scope === "single" && (
              <div className="space-y-2">
                <Label htmlFor="trader-search">Search trader</Label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="trader-search"
                    className="pl-8"
                    placeholder="Type trader name or license no."
                    value={traderQ}
                    onChange={(e) => {
                      setTraderQ(e.target.value);
                      setSelectedTraderId("");
                    }}
                  />
                </div>
                <p className="text-xs text-muted-foreground">Start typing to search trader (min. 2 characters).</p>
                {traderSearchEnabled && (
                  <div className="max-h-40 overflow-y-auto rounded border text-sm">
                    {searchingTraders ? (
                      <div className="p-2 text-muted-foreground">Searching…</div>
                    ) : licenceHits.length === 0 ? (
                      <div className="p-2 text-muted-foreground">No matches.</div>
                    ) : (
                      licenceHits.slice(0, 20).map((l) => (
                        <button
                          key={l.id}
                          type="button"
                          className={`block w-full text-left px-3 py-2 hover:bg-muted ${selectedTraderId === l.id ? "bg-muted" : ""}`}
                          onClick={() => {
                            setSelectedTraderId(l.id);
                            setTraderQ(`${l.licenceNo ?? l.id} — ${l.firmName}`);
                          }}
                        >
                          {(l.licenceNo ?? l.id) + " — " + l.firmName}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1">
                <Label htmlFor="from">
                  From <span className="text-destructive">*</span>
                </Label>
                <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="to">
                  To <span className="text-destructive">*</span>
                </Label>
                <Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Commodity</Label>
                <Select value={commodityId} onValueChange={setCommodityId}>
                  <SelectTrigger>
                    <SelectValue placeholder="All" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    {commodities.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Status</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="Submitted">Submitted (Approved)</SelectItem>
                    <SelectItem value="Pending">Pending (Draft/Verified)</SelectItem>
                    <SelectItem value="Approved">Approved</SelectItem>
                    <SelectItem value="Draft">Draft</SelectItem>
                    <SelectItem value="Verified">Verified</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={applyFilters}>
                Apply filters
              </Button>
              <Button type="button" variant="outline" onClick={resetFilters}>
                <RefreshCw className="h-4 w-4 mr-1" />
                Reset
              </Button>
            </div>
          </div>

          <div className="flex justify-end">
            <Button type="button" variant="outline" size="sm" onClick={exportCsv} disabled={!data?.rows?.length}>
              <Download className="h-4 w-4 mr-1" />
              Export
            </Button>
          </div>

          {isLoading || isFetching ? (
            <Skeleton className="h-64 w-full" />
          ) : isError ? (
            <div className="flex flex-col gap-2 text-destructive text-sm">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>Failed to load report.</span>
                <Button variant="ghost" className="h-auto p-0 text-primary underline" onClick={() => refetch()}>
                  Retry
                </Button>
              </div>
              <p className="text-muted-foreground text-xs pl-6">
                {error instanceof Error ? error.message : "Unknown error"}
                {" — "}
                If this mentions HTML, restart the API server (`npm run dev`) so the report route is registered.
              </p>
            </div>
          ) : (
            <ClientDataGrid
              columns={columns}
              sourceRows={gridRows}
              searchKeys={["transactionId", "commodity", "farmerName", "placeOfPurchase", "quantityDisplay"]}
              defaultSortKey="transactionDate"
              emptyMessage="No transactions for the selected filters."
              resetPageDependency={applied}
            />
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
