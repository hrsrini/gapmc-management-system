import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Building2, AlertCircle } from "lucide-react";
import { ClientDataGrid } from "@/components/reports/ClientDataGrid";
import type { ReportTableColumn } from "@/components/reports/ReportDataTable";

interface Asset {
  id: string;
  assetId: string;
  yardId: string;
  assetType: string;
  complexName?: string | null;
  plinthAreaSqft?: number | null;
  value?: number | null;
  isActive?: boolean;
}

const columns: ReportTableColumn[] = [
  { key: "assetId", header: "Asset ID" },
  { key: "yardName", header: "Yard" },
  { key: "assetType", header: "Type" },
  { key: "complexName", header: "Complex" },
  { key: "plinthAreaSqft", header: "Plinth (sqft)" },
  { key: "value", header: "Value" },
  { key: "_status", header: "Status", sortField: "statusSort" },
];

export default function AssetList() {
  const { data: assets, isLoading, isError } = useQuery<Asset[]>({
    queryKey: ["/api/ioms/assets"],
  });
  const { data: yards = [] } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ["/api/yards"],
  });
  const yardById = Object.fromEntries(yards.map((y) => [y.id, y.name]));

  const sourceRows = useMemo((): Record<string, unknown>[] => {
    return (assets ?? []).map((a) => {
      const active = a.isActive !== false;
      return {
        id: a.id,
        assetId: a.assetId,
        yardName: yardById[a.yardId] ?? a.yardId,
        assetType: a.assetType,
        complexName: a.complexName ?? "—",
        plinthAreaSqft: a.plinthAreaSqft != null ? a.plinthAreaSqft : "—",
        value: a.value != null ? a.value : "—",
        statusSort: active ? "Active" : "Inactive",
        _status: <Badge variant={active ? "default" : "secondary"}>{active ? "Active" : "Inactive"}</Badge>,
      };
    });
  }, [assets, yardById]);

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "Traders & Assets", href: "/assets" }, { label: "Assets" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Failed to load assets.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Traders & Assets", href: "/assets" }, { label: "Assets" }]}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Asset Register (M-02)
          </CardTitle>
          <p className="text-sm text-muted-foreground">Shops, godowns, offices — [LOC]/[TYPE]-[NNN].</p>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <ClientDataGrid
              columns={columns}
              sourceRows={sourceRows}
              searchKeys={["assetId", "yardName", "assetType", "complexName", "plinthAreaSqft", "value", "statusSort"]}
              searchPlaceholder="Search by asset ID, yard, type, complex…"
              defaultSortKey="assetId"
              defaultSortDir="asc"
              emptyMessage="No assets in register."
            />
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
