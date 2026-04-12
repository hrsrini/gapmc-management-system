import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ClientDataGrid } from "@/components/reports/ClientDataGrid";
import type { ReportTableColumn } from "@/components/reports/ReportDataTable";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertCircle, Store } from "lucide-react";

interface Asset {
  id: string;
  assetId: string;
  yardId: string;
  assetType: string;
  complexName?: string | null;
  plinthAreaSqft?: number | null;
}
interface VacantRow {
  asset: Asset;
  lastAllotment: { allotteeName: string; toDate: string; daUser: string | null; id: string } | null;
  lastRentAmount: number | null;
}

interface Yard {
  id: string;
  name: string;
}

const columns: ReportTableColumn[] = [
  { key: "_assetId", header: "Asset ID", sortField: "assetIdSort" },
  { key: "yardName", header: "Yard" },
  { key: "assetType", header: "Type" },
  { key: "complexName", header: "Complex" },
  { key: "previousAllottee", header: "Previous allottee" },
  { key: "vacatedOn", header: "Vacated on" },
  { key: "daUser", header: "Officer (DA)" },
  { key: "_lastRent", header: "Last rent", sortField: "lastRentSort" },
];

export default function AssetsVacant() {
  const yardId = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "").get("yardId") ?? "";

  const { data: vacant, isLoading, isError } = useQuery<VacantRow[]>({
    queryKey: ["/api/ioms/assets/vacant", yardId],
    queryFn: async () => {
      const url = yardId ? `/api/ioms/assets/vacant?yardId=${encodeURIComponent(yardId)}` : "/api/ioms/assets/vacant";
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch vacant assets");
      return res.json();
    },
  });
  const { data: yards = [] } = useQuery<Yard[]>({
    queryKey: ["/api/yards"],
  });
  const yardById = Object.fromEntries(yards.map((y) => [y.id, y.name]));

  const handleYardChange = (value: string) => {
    const url = new URL(window.location.href);
    if (value) url.searchParams.set("yardId", value);
    else url.searchParams.delete("yardId");
    window.location.href = url.pathname + url.search;
  };

  const sourceRows = useMemo((): Record<string, unknown>[] => {
    return (vacant ?? []).map((row) => {
      const toDate = row.lastAllotment?.toDate;
      return {
        id: row.asset.id,
        assetIdSort: row.asset.assetId,
        _assetId: (
          <Link href={`/assets`} className="text-primary hover:underline font-mono text-sm">
            {row.asset.assetId}
          </Link>
        ),
        yardName: yardById[row.asset.yardId] ?? row.asset.yardId,
        assetType: row.asset.assetType,
        complexName: row.asset.complexName ?? "—",
        previousAllottee: row.lastAllotment?.allotteeName ?? "—",
        vacatedOn: toDate ? toDate.slice(0, 10) : "—",
        daUser: row.lastAllotment?.daUser ?? "—",
        lastRentSort: row.lastRentAmount ?? null,
        _lastRent:
          row.lastRentAmount != null ? `₹${row.lastRentAmount.toLocaleString()}` : "—",
      };
    });
  }, [vacant, yardById]);

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "Assets", href: "/assets" }, { label: "Shop Vacant" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Failed to load vacant assets.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Assets", href: "/assets" }, { label: "Shop Vacant" }]}>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Store className="h-5 w-5" />
              Shop Vacant (M-02)
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Vacated assets: previous allottee, officer, last rent.
            </p>
          </div>
          <Select value={yardId || "all"} onValueChange={(v) => handleYardChange(v === "all" ? "" : v)}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="All yards" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All yards</SelectItem>
              {(yards ?? []).map((y) => (
                <SelectItem key={y.id} value={y.id}>
                  {y.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <ClientDataGrid
              columns={columns}
              sourceRows={sourceRows}
              searchKeys={["assetIdSort", "yardName", "assetType", "complexName", "previousAllottee", "vacatedOn", "daUser"]}
              defaultSortKey="vacatedOn"
              defaultSortDir="desc"
              emptyMessage="No vacant assets."
              resetPageDependency={yardId}
            />
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
