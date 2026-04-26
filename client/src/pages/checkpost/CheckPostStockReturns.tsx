import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ClientDataGrid } from "@/components/reports/ClientDataGrid";
import type { ReportTableColumn } from "@/components/reports/ReportDataTable";
import { useAuth } from "@/context/AuthContext";
import { AlertCircle, ArrowLeftRight } from "lucide-react";

interface YardRef {
  id: string;
  name: string;
  code: string;
  type?: string;
}

interface AggRow {
  checkPostId: string;
  commodityId: string;
  quantity: number;
  value: number;
}

interface StockReturnsReport {
  from: string | null;
  to: string | null;
  checkPostId: string | null;
  imports: AggRow[];
  exports: AggRow[];
  totals: { importQty: number; importValue: number; exportQty: number; exportValue: number };
}

const cols: ReportTableColumn[] = [
  { key: "checkPostName", header: "Check post" },
  { key: "commodityName", header: "Commodity" },
  { key: "_qty", header: "Qty" },
  { key: "_value", header: "Value" },
];

export default function CheckPostStockReturns() {
  const { can } = useAuth();
  const canRead = can("M-04", "Read");

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [checkPostId, setCheckPostId] = useState<string>("all");

  const { data: yards = [] } = useQuery<YardRef[]>({ queryKey: ["/api/yards"] });
  const { data: commodities = [] } = useQuery<Array<{ id: string; name: string }>>({ queryKey: ["/api/ioms/commodities"] });

  const yardById = useMemo(() => new Map(yards.map((y) => [y.id, `${y.name} (${y.code})`] as const)), [yards]);
  const commodityById = useMemo(() => new Map(commodities.map((c) => [c.id, c.name] as const)), [commodities]);
  const checkPosts = yards.filter((y) => String(y.type ?? "") === "CheckPost");

  const url = useMemo(() => {
    const u = new URL("/api/ioms/checkpost/stock-returns", window.location.origin);
    if (from) u.searchParams.set("from", from);
    if (to) u.searchParams.set("to", to);
    if (checkPostId && checkPostId !== "all") u.searchParams.set("checkPostId", checkPostId);
    return u.pathname + (u.search ? u.search : "");
  }, [from, to, checkPostId]);

  const { data, isLoading, isError } = useQuery<StockReturnsReport>({
    queryKey: [url],
    enabled: canRead,
  });

  const importRows = useMemo((): Record<string, unknown>[] => {
    return (data?.imports ?? []).map((r) => ({
      id: `I:${r.checkPostId}:${r.commodityId}`,
      checkPostName: yardById.get(r.checkPostId) ?? r.checkPostId,
      commodityName: commodityById.get(r.commodityId) ?? r.commodityId,
      quantity: r.quantity,
      value: r.value,
      _qty: Number(r.quantity ?? 0).toLocaleString("en-IN"),
      _value: `₹${Number(r.value ?? 0).toLocaleString("en-IN")}`,
    }));
  }, [data?.imports, yardById, commodityById]);

  const exportRows = useMemo((): Record<string, unknown>[] => {
    return (data?.exports ?? []).map((r) => ({
      id: `E:${r.checkPostId}:${r.commodityId}`,
      checkPostName: yardById.get(r.checkPostId) ?? r.checkPostId,
      commodityName: commodityById.get(r.commodityId) ?? r.commodityId,
      quantity: r.quantity,
      value: r.value,
      _qty: Number(r.quantity ?? 0).toLocaleString("en-IN"),
      _value: `₹${Number(r.value ?? 0).toLocaleString("en-IN")}`,
    }));
  }, [data?.exports, yardById, commodityById]);

  if (!canRead) {
    return (
      <AppShell breadcrumbs={[{ label: "Check post (M-04)", href: "/checkpost/inward" }, { label: "Stock returns" }]}>
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
    <AppShell breadcrumbs={[{ label: "Check post (M-04)", href: "/checkpost/inward" }, { label: "Stock returns" }]}>
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ArrowLeftRight className="h-5 w-5" />
              Stock returns (Import / Export)
            </CardTitle>
            <p className="text-sm text-muted-foreground">Aggregated commodity flows by check post for the selected period.</p>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
            <div className="space-y-1">
              <Label>From</Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>To</Label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label>Check post</Label>
              <Select value={checkPostId} onValueChange={setCheckPostId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All check posts (scoped)</SelectItem>
                  {checkPosts.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name} ({c.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {isError ? (
          <Card className="bg-destructive/10 border-destructive/20">
            <CardContent className="p-6 flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-destructive" />
              <span className="text-destructive">Failed to load stock returns report.</span>
            </CardContent>
          </Card>
        ) : isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Imports</CardTitle>
                <div className="flex flex-wrap gap-2 pt-1 text-sm text-muted-foreground">
                  <Badge variant="outline">Qty: {Number(data?.totals.importQty ?? 0).toLocaleString("en-IN")}</Badge>
                  <Badge variant="outline">Value: ₹{Number(data?.totals.importValue ?? 0).toLocaleString("en-IN")}</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <ClientDataGrid
                  columns={cols}
                  sourceRows={importRows}
                  searchKeys={["checkPostName", "commodityName"]}
                  defaultSortKey="checkPostName"
                  defaultSortDir="asc"
                  emptyMessage="No import rows for this filter."
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Exports</CardTitle>
                <div className="flex flex-wrap gap-2 pt-1 text-sm text-muted-foreground">
                  <Badge variant="outline">Qty: {Number(data?.totals.exportQty ?? 0).toLocaleString("en-IN")}</Badge>
                  <Badge variant="outline">Value: ₹{Number(data?.totals.exportValue ?? 0).toLocaleString("en-IN")}</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <ClientDataGrid
                  columns={cols}
                  sourceRows={exportRows}
                  searchKeys={["checkPostName", "commodityName"]}
                  defaultSortKey="checkPostName"
                  defaultSortDir="asc"
                  emptyMessage="No export rows for this filter."
                />
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppShell>
  );
}

