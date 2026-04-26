import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ClientDataGrid } from "@/components/reports/ClientDataGrid";
import type { ReportTableColumn } from "@/components/reports/ReportDataTable";
import { FileDown, Gauge } from "lucide-react";

interface TripRow {
  vehicleId: string;
  registrationNo: string;
  yardId: string;
  tripDate: string;
  distanceKm?: number | null;
  fuelFilledLitres?: number | null;
  fuelCostInr?: number | null;
}

interface VehicleRow {
  vehicleId: string;
  registrationNo: string;
  yardId: string;
  tripCount: number;
  totalDistanceKm: number;
  totalFuelLitres: number;
  totalFuelCostInr: number;
  efficiencyKmPerLitre: number | null;
  highFuelTripCount: number;
}

function toCsv(rows: Record<string, unknown>[], columns: { key: string; header: string }[]): string {
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    if (/[\",\\n]/.test(s)) return `"${s.replace(/\"/g, '""')}"`;
    return s;
  };
  const header = columns.map((c) => esc(c.header)).join(",");
  const body = rows
    .map((r) => columns.map((c) => esc(r[c.key])).join(","))
    .join("\n");
  return `${header}\n${body}\n`;
}

export default function FleetReports() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const enabled = Boolean(from && to);
  const { data: vehicles = [], isLoading } = useQuery<VehicleRow[]>({
    queryKey: enabled ? [`/api/ioms/fleet/reports/summary?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`] : ["__skip__fleet_summary"],
    enabled,
  });

  const columns = useMemo(
    (): ReportTableColumn[] => [
      { key: "registrationNo", header: "Vehicle", sortField: "registrationNo" },
      { key: "tripCount", header: "Trips", sortField: "tripCount" },
      { key: "_dist", header: "Distance (km)", sortField: "totalDistanceKm" },
      { key: "_fuel", header: "Fuel (L)", sortField: "totalFuelLitres" },
      { key: "_cost", header: "Fuel cost", sortField: "totalFuelCostInr" },
      { key: "_eff", header: "Efficiency (km/L)", sortField: "efficiencyKmPerLitre" },
      { key: "highFuelTripCount", header: "High-fuel trips", sortField: "highFuelTripCount" },
    ],
    [],
  );

  const sourceRows = useMemo((): Record<string, unknown>[] => {
    return vehicles.map((v) => ({
      ...v,
      _dist: v.totalDistanceKm.toFixed(2),
      _fuel: v.totalFuelLitres.toFixed(2),
      _cost: `₹${Math.round(v.totalFuelCostInr).toLocaleString("en-IN")}`,
      _eff: v.efficiencyKmPerLitre == null ? "—" : v.efficiencyKmPerLitre.toFixed(2),
    }));
  }, [vehicles]);

  const exportCsv = () => {
    const cols = [
      { key: "registrationNo", header: "Vehicle" },
      { key: "tripCount", header: "Trips" },
      { key: "totalDistanceKm", header: "TotalDistanceKm" },
      { key: "totalFuelLitres", header: "TotalFuelLitres" },
      { key: "totalFuelCostInr", header: "TotalFuelCostInr" },
      { key: "efficiencyKmPerLitre", header: "EfficiencyKmPerLitre" },
      { key: "highFuelTripCount", header: "HighFuelTripCount" },
    ];
    const csv = toCsv(vehicles as unknown as Record<string, unknown>[], cols);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `fleet_report_${from}_${to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <AppShell breadcrumbs={[{ label: "Fleet (M-07)", href: "/fleet" }, { label: "Reports" }]}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gauge className="h-5 w-5" />
            Fuel & utilisation reports (IOMS M-07)
          </CardTitle>
          <p className="text-sm text-muted-foreground">Vehicle-wise totals, fuel cost, and efficiency for the selected period.</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
            <div className="space-y-1 md:col-span-2">
              <Label>From</Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label>To</Label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <div className="md:col-span-2 flex gap-2">
              <Button type="button" variant="secondary" disabled={!enabled || vehicles.length === 0} onClick={exportCsv}>
                <FileDown className="h-4 w-4 mr-1" /> Export CSV
              </Button>
            </div>
          </div>

          <ClientDataGrid
            columns={columns}
            sourceRows={sourceRows}
            searchKeys={["registrationNo"]}
            defaultSortKey="totalFuelCostInr"
            defaultSortDir="desc"
            resetPageDependency={`${from}|${to}`}
            emptyMessage={enabled ? "No trips/fuel recorded for this period." : "Select a date range to generate the report."}
            isLoading={isLoading}
          />
        </CardContent>
      </Card>
    </AppShell>
  );
}

