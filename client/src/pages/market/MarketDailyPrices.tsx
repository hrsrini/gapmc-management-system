import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ClientDataGrid } from "@/components/reports/ClientDataGrid";
import type { ReportTableColumn } from "@/components/reports/ReportDataTable";
import { AlertCircle, Gauge, RefreshCw } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";

interface YardRef {
  id: string;
  name: string;
  code: string;
  type?: string;
}

interface DailyPriceRow {
  id: string;
  yardId: string;
  date: string;
  commodityId: string;
  minPriceInrPerUnit: number;
  maxPriceInrPerUnit: number;
  modalPriceInrPerUnit: number;
  sampleCount: number;
  totalQty: number;
  generatedAt?: string | null;
}

const cols: ReportTableColumn[] = [
  { key: "commodityName", header: "Commodity" },
  { key: "_min", header: "Min" },
  { key: "_max", header: "Max" },
  { key: "_modal", header: "Modal" },
  { key: "sampleCount", header: "Samples" },
  { key: "_qty", header: "Total qty" },
  { key: "generatedAt", header: "Generated" },
];

export default function MarketDailyPrices() {
  const { can } = useAuth();
  const canRead = can("M-04", "Read");
  const canUpdate = can("M-04", "Update");
  const { toast } = useToast();
  const qc = useQueryClient();

  const [yardId, setYardId] = useState<string>("all");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));

  const { data: yards = [] } = useQuery<YardRef[]>({ queryKey: ["/api/yards"] });
  const { data: commodities = [] } = useQuery<Array<{ id: string; name: string }>>({ queryKey: ["/api/ioms/commodities"] });
  const yardOptions = yards.filter((y) => String(y.type ?? "") === "Yard");
  const commodityById = useMemo(() => new Map(commodities.map((c) => [c.id, c.name] as const)), [commodities]);

  const url = useMemo(() => {
    if (!yardId || yardId === "all") return null;
    const u = new URL("/api/ioms/market/daily-prices", window.location.origin);
    u.searchParams.set("yardId", yardId);
    u.searchParams.set("date", date);
    return u.pathname + u.search;
  }, [yardId, date]);

  const { data, isLoading, isError } = useQuery<DailyPriceRow[]>({
    queryKey: [url ?? "no-yard-selected"],
    enabled: canRead && Boolean(url),
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      if (!yardId || yardId === "all") throw new Error("Select a yard first.");
      const res = await fetch("/api/ioms/market/daily-prices/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ yardId, date }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error ?? res.statusText);
      return body;
    },
    onSuccess: () => {
      if (url) qc.invalidateQueries({ queryKey: [url] });
      toast({ title: "Daily prices generated" });
    },
    onError: (e: Error) => toast({ title: "Generate failed", description: e.message, variant: "destructive" }),
  });

  const rows = useMemo((): Record<string, unknown>[] => {
    return (data ?? []).map((r) => ({
      id: r.id,
      commodityName: commodityById.get(r.commodityId) ?? r.commodityId,
      _min: `₹${Number(r.minPriceInrPerUnit ?? 0).toLocaleString("en-IN")}`,
      _max: `₹${Number(r.maxPriceInrPerUnit ?? 0).toLocaleString("en-IN")}`,
      _modal: `₹${Number(r.modalPriceInrPerUnit ?? 0).toLocaleString("en-IN")}`,
      sampleCount: r.sampleCount ?? 0,
      _qty: Number(r.totalQty ?? 0).toLocaleString("en-IN"),
      generatedAt: (r.generatedAt ?? "—").toString().slice(0, 19).replace("T", " "),
    }));
  }, [data, commodityById]);

  if (!canRead) {
    return (
      <AppShell breadcrumbs={[{ label: "Market (M-04)", href: "/market/transactions" }, { label: "Daily prices" }]}>
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
    <AppShell breadcrumbs={[{ label: "Market (M-04)", href: "/market/transactions" }, { label: "Daily prices" }]}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gauge className="h-5 w-5" />
            Daily official prices (Min / Max / Modal)
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Generated from Approved yard arrivals (purchase transactions) for the selected day.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
            <div className="space-y-1 md:col-span-2">
              <Label>Yard</Label>
              <Select value={yardId} onValueChange={setYardId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Select a yard…</SelectItem>
                  {yardOptions.map((y) => (
                    <SelectItem key={y.id} value={y.id}>
                      {y.name} ({y.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                disabled={!canUpdate || yardId === "all" || generateMutation.isPending}
                onClick={() => generateMutation.mutate()}
              >
                <RefreshCw className="h-4 w-4 mr-1" />
                {generateMutation.isPending ? "Generating..." : "Generate"}
              </Button>
            </div>
          </div>

          {yardId === "all" ? (
            <div className="text-sm text-muted-foreground">Select a yard to view prices.</div>
          ) : isError ? (
            <Card className="bg-destructive/10 border-destructive/20">
              <CardContent className="p-6 flex items-center gap-3">
                <AlertCircle className="h-5 w-5 text-destructive" />
                <span className="text-destructive">Failed to load daily prices.</span>
              </CardContent>
            </Card>
          ) : isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <ClientDataGrid
              columns={cols}
              sourceRows={rows}
              searchKeys={["commodityName"]}
              defaultSortKey="commodityName"
              defaultSortDir="asc"
              emptyMessage="No prices generated for this date (or no approved arrivals)."
            />
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}

