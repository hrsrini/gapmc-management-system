import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
                <SelectItem key={y.id} value={y.id}>{y.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Asset ID</TableHead>
                  <TableHead>Yard</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Complex</TableHead>
                  <TableHead>Previous allottee</TableHead>
                  <TableHead>Vacated on</TableHead>
                  <TableHead>Officer (DA)</TableHead>
                  <TableHead>Last rent</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(vacant ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-muted-foreground text-center py-8">
                      No vacant assets.
                    </TableCell>
                  </TableRow>
                ) : (
                  (vacant ?? []).map((row) => (
                    <TableRow key={row.asset.id}>
                      <TableCell className="font-mono text-sm">
                        <Link href={`/assets`} className="text-primary hover:underline">{row.asset.assetId}</Link>
                      </TableCell>
                      <TableCell>{yardById[row.asset.yardId] ?? row.asset.yardId}</TableCell>
                      <TableCell>{row.asset.assetType}</TableCell>
                      <TableCell>{row.asset.complexName ?? "—"}</TableCell>
                      <TableCell>{row.lastAllotment?.allotteeName ?? "—"}</TableCell>
                      <TableCell>{row.lastAllotment?.toDate ?? "—"}</TableCell>
                      <TableCell>{row.lastAllotment?.daUser ?? "—"}</TableCell>
                      <TableCell>
                        {row.lastRentAmount != null ? `₹${row.lastRentAmount.toLocaleString()}` : "—"}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
