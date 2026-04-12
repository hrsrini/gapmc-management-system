import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Percent, AlertCircle } from "lucide-react";
import { ClientDataGrid } from "@/components/reports/ClientDataGrid";
import type { ReportTableColumn } from "@/components/reports/ReportDataTable";

interface MspSetting {
  id: string;
  commodity: string;
  mspRate: number;
  validFrom: string;
  validTo?: string | null;
  updatedBy?: string | null;
}

const columns: ReportTableColumn[] = [
  { key: "commodity", header: "Commodity" },
  { key: "validFrom", header: "Valid from" },
  { key: "validTo", header: "Valid to" },
  { key: "_msp", header: "MSP rate (₹)", sortField: "mspRate" },
  { key: "updatedBy", header: "Updated by" },
];

export default function MspSettingsList() {
  const { data: list = [], isLoading, isError } = useQuery<MspSetting[]>({
    queryKey: ["/api/ioms/msp-settings"],
  });

  const sourceRows = useMemo((): Record<string, unknown>[] => {
    return list.map((m) => ({
      id: m.id,
      commodity: m.commodity,
      validFrom: m.validFrom.slice(0, 10),
      validTo: m.validTo ? m.validTo.slice(0, 10) : null,
      mspRate: m.mspRate,
      _msp: `₹${m.mspRate.toLocaleString()}`,
      updatedBy: m.updatedBy ?? "—",
    }));
  }, [list]);

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "Market (IOMS)", href: "/market/commodities" }, { label: "MSP settings" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Failed to load MSP settings.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Market (IOMS)", href: "/market/commodities" }, { label: "MSP settings" }]}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Percent className="h-5 w-5" />
            MSP settings (M-02)
          </CardTitle>
          <p className="text-sm text-muted-foreground">Minimum support price by commodity and validity period.</p>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <ClientDataGrid
              columns={columns}
              sourceRows={sourceRows}
              searchKeys={["commodity", "validFrom", "validTo", "mspRate", "updatedBy"]}
              searchPlaceholder="Search commodity, dates, rate, updated by…"
              defaultSortKey="validFrom"
              defaultSortDir="desc"
              emptyMessage="No MSP settings."
            />
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
