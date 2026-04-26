import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ClientDataGrid } from "@/components/reports/ClientDataGrid";
import type { ReportTableColumn } from "@/components/reports/ReportDataTable";
import { AlertCircle, CalendarDays, FileDown } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";

interface YardRef {
  id: string;
  name: string;
  code: string;
  type?: string;
}

interface Row {
  yardId: string;
  commodityId: string;
  totalQty: number;
  totalValueInr: number;
  arrivalSamples: number;
  priceDays: number;
  minPrice: number | null;
  maxPrice: number | null;
  modalPriceAvg: number | null;
}

interface ReportResponse {
  from: string;
  to: string;
  yardId: string | null;
  rows: Row[];
}

const cols: ReportTableColumn[] = [
  { key: "yardName", header: "Yard" },
  { key: "commodityName", header: "Commodity" },
  { key: "_qty", header: "Qty" },
  { key: "_value", header: "Value" },
  { key: "arrivalSamples", header: "Arrivals" },
  { key: "_min", header: "Min" },
  { key: "_max", header: "Max" },
  { key: "_modal", header: "Modal (avg)" },
  { key: "priceDays", header: "Price days" },
];

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function startOfWeekMonday(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = x.getUTCDay(); // 0=Sun..6=Sat
  const delta = (day + 6) % 7; // days since Monday
  x.setUTCDate(x.getUTCDate() - delta);
  return x;
}

export default function MarketCommodityReports() {
  const { can } = useAuth();
  const canRead = can("M-04", "Read");
  const canUpdate = can("M-04", "Update");
  const qc = useQueryClient();
  const { toast } = useToast();

  const [yardId, setYardId] = useState<string>("all");
  const [from, setFrom] = useState(() => {
    const now = new Date();
    const s = startOfWeekMonday(now);
    return iso(s);
  });
  const [to, setTo] = useState(() => iso(new Date()));

  const { data: yards = [] } = useQuery<YardRef[]>({ queryKey: ["/api/yards"], enabled: canRead });
  const { data: commodities = [] } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ["/api/ioms/commodities"],
    enabled: canRead,
  });

  const yardOptions = yards.filter((y) => String(y.type ?? "") === "Yard");
  const yardById = useMemo(() => new Map(yards.map((y) => [y.id, `${y.name} (${y.code})`] as const)), [yards]);
  const commodityById = useMemo(() => new Map(commodities.map((c) => [c.id, c.name] as const)), [commodities]);

  const url = useMemo(() => {
    const u = new URL("/api/ioms/market/reports/commodity-summary", window.location.origin);
    u.searchParams.set("from", from);
    u.searchParams.set("to", to);
    if (yardId !== "all") u.searchParams.set("yardId", yardId);
    return u.pathname + u.search;
  }, [from, to, yardId]);

  const { data, isLoading, isError } = useQuery<ReportResponse>({
    queryKey: [url],
    enabled: canRead && Boolean(from && to),
  });

  const snapListUrl = useMemo(() => {
    const u = new URL("/api/ioms/market/reports/commodity-summary/snapshots", window.location.origin);
    if (yardId !== "all") u.searchParams.set("yardId", yardId);
    return u.pathname + u.search;
  }, [yardId]);

  const { data: snapshots = [] } = useQuery<
    Array<{ id: string; reportKind: string; yardId: string | null; from: string; to: string; generatedAt: string }>
  >({
    queryKey: [snapListUrl],
    enabled: canRead,
  });

  const generateSnapMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/ioms/market/reports/commodity-summary/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          reportKind: "Custom",
          yardId: yardId === "all" ? null : yardId,
          from,
          to,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error ?? res.statusText);
      return body;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [snapListUrl] });
      toast({ title: "Snapshot saved" });
    },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const rows = useMemo(() => {
    return (data?.rows ?? []).map((r) => ({
      id: `${r.yardId}:${r.commodityId}`,
      yardName: yardById.get(r.yardId) ?? r.yardId,
      commodityName: commodityById.get(r.commodityId) ?? r.commodityId,
      totalQty: r.totalQty,
      _qty: Number(r.totalQty ?? 0).toLocaleString("en-IN"),
      totalValueInr: r.totalValueInr,
      _value: `₹${Number(r.totalValueInr ?? 0).toLocaleString("en-IN")}`,
      arrivalSamples: r.arrivalSamples ?? 0,
      priceDays: r.priceDays ?? 0,
      _min: r.minPrice == null ? "—" : `₹${Number(r.minPrice).toLocaleString("en-IN")}`,
      _max: r.maxPrice == null ? "—" : `₹${Number(r.maxPrice).toLocaleString("en-IN")}`,
      _modal: r.modalPriceAvg == null ? "—" : `₹${Number(r.modalPriceAvg).toLocaleString("en-IN")}`,
    }));
  }, [data?.rows, yardById, commodityById]);

  const setPresetWeekly = () => {
    const now = new Date();
    const start = startOfWeekMonday(now);
    setFrom(iso(start));
    setTo(iso(now));
  };
  const setPresetFortnight = () => {
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth();
    const d = now.getUTCDate();
    const startDay = d <= 15 ? 1 : 16;
    const start = new Date(Date.UTC(y, m, startDay));
    setFrom(iso(start));
    setTo(iso(now));
  };
  const setPresetMonthly = () => {
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    setFrom(iso(start));
    setTo(iso(now));
  };

  const exportCsv = () => {
    const header = ["Yard", "Commodity", "Qty", "Value", "Arrivals", "Min", "Max", "ModalAvg", "PriceDays"];
    const lines = [header.join(",")].concat(
      rows.map((r) =>
        [
          String(r.yardName).replaceAll(",", " "),
          String(r.commodityName).replaceAll(",", " "),
          String(r._qty),
          String(r._value).replaceAll(",", ""),
          String(r.arrivalSamples),
          String(r._min).replaceAll(",", ""),
          String(r._max).replaceAll(",", ""),
          String(r._modal).replaceAll(",", ""),
          String(r.priceDays),
        ].join(","),
      ),
    );
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `commodity-report_${from}_to_${to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (!canRead) {
    return (
      <AppShell breadcrumbs={[{ label: "Market (M-04)", href: "/market/transactions" }, { label: "Commodity reports" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">M-04 Read permission required.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Market (M-04)", href: "/market/transactions" }, { label: "Commodity reports" }]}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5" />
            Weekly / fortnightly / monthly commodity report
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Arrivals are from Approved yard transactions; price trends use generated daily prices when available.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
            <div className="space-y-1 md:col-span-2">
              <Label>Yard</Label>
              <Select value={yardId} onValueChange={setYardId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All yards (scoped)</SelectItem>
                  {yardOptions.map((y) => (
                    <SelectItem key={y.id} value={y.id}>
                      {y.name} ({y.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>From</Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>To</Label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <div className="md:col-span-2 flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={setPresetWeekly}>Weekly</Button>
              <Button type="button" variant="outline" onClick={setPresetFortnight}>Fortnight</Button>
              <Button type="button" variant="outline" onClick={setPresetMonthly}>Monthly</Button>
              <Button
                type="button"
                variant="outline"
                disabled={!canUpdate || generateSnapMutation.isPending}
                onClick={() => generateSnapMutation.mutate()}
              >
                {generateSnapMutation.isPending ? "Saving..." : "Save snapshot"}
              </Button>
              <Button type="button" variant="secondary" onClick={exportCsv} disabled={rows.length === 0}>
                <FileDown className="h-4 w-4 mr-1" /> Export CSV
              </Button>
            </div>
          </div>

          {snapshots.length > 0 ? (
            <div className="text-sm text-muted-foreground">
              Recent snapshots:{" "}
              {snapshots.slice(0, 5).map((s, idx) => (
                <span key={s.id}>
                  <a
                    className="text-primary underline"
                    href={`/api/ioms/market/reports/commodity-summary/snapshots/${encodeURIComponent(s.id)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {s.from}→{s.to}
                  </a>
                  {idx < Math.min(4, snapshots.length - 1) ? " · " : ""}
                </span>
              ))}
            </div>
          ) : null}

          {isError ? (
            <Card className="bg-destructive/10 border-destructive/20">
              <CardContent className="p-6 flex items-center gap-3">
                <AlertCircle className="h-5 w-5 text-destructive" />
                <span className="text-destructive">Failed to load report.</span>
              </CardContent>
            </Card>
          ) : isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <ClientDataGrid
              columns={cols}
              sourceRows={rows}
              searchKeys={["yardName", "commodityName"]}
              defaultSortKey="yardName"
              defaultSortDir="asc"
              emptyMessage="No rows for this range."
            />
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}

