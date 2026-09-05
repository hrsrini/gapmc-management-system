import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ClientDataGrid } from "@/components/reports/ClientDataGrid";
import type { ReportTableColumn } from "@/components/reports/ReportDataTable";
import { LocalSearchSelect } from "@/components/ui/local-search-select";
import { useToast } from "@/hooks/use-toast";
import { useScopedActiveYards } from "@/hooks/useScopedActiveYards";
import { filterYardTypeLocations } from "@/lib/legacyYardMatch";
import { PREMISES_TYPE_VALUES } from "@shared/premises-master";
import { PREMISES_STATUS_VALUES, premisesStatusLabel } from "@shared/premises-allocation";
import { AlertCircle, Download, FileSpreadsheet, RefreshCcw, Search } from "lucide-react";

type PremisesMasterRow = {
  srNo: number;
  premisesId: string;
  yard: string;
  premisesType: string;
  premisesLocation: string;
  premisesStatus: string;
  propertyTaxAuthority: string;
  houseNo: string;
  areaSqm: string;
  rentValuation: number | string;
  electricityConnectionType: string;
  contractAccountNo: string;
  waterConnectionType: string;
  consumerId: string;
  adminFileNumber: string;
};

type PremisesMasterResponse = {
  total: number;
  rows: PremisesMasterRow[];
  headers: string[];
};

const columns: ReportTableColumn[] = [
  { key: "srNo", header: "Sr. No." },
  { key: "premisesId", header: "Premises ID" },
  { key: "yard", header: "Yard" },
  { key: "premisesType", header: "Premises type" },
  { key: "premisesLocation", header: "Premises location" },
  { key: "premisesStatusLabel", header: "Premises status", sortField: "premisesStatus" },
  { key: "propertyTaxAuthority", header: "Property Tax Authority" },
  { key: "houseNo", header: "House No." },
  { key: "areaSqm", header: "Area (sq. meters)" },
  { key: "rentValuation", header: "Rent as Per Valuation Report (Rs.)" },
  { key: "electricityConnectionType", header: "Electricity Connection Type" },
  { key: "contractAccountNo", header: "Contract Account No." },
  { key: "waterConnectionType", header: "Water Connection Type" },
  { key: "consumerId", header: "Consumer ID" },
  { key: "adminFileNumber", header: "Admin. File Number" },
];

function buildQuery(params: {
  yardId: string;
  premisesType: string;
  premisesStatus: string;
  assetId: string;
  format?: "json" | "xlsx";
}): string {
  const sp = new URLSearchParams();
  if (params.yardId && params.yardId !== "all") sp.set("yardId", params.yardId);
  if (params.premisesType && params.premisesType !== "all") sp.set("premisesType", params.premisesType);
  if (params.premisesStatus && params.premisesStatus !== "all") sp.set("premisesStatus", params.premisesStatus);
  if (params.assetId.trim()) sp.set("assetId", params.assetId.trim());
  if (params.format) sp.set("format", params.format);
  const qs = sp.toString();
  return qs ? `/api/ioms/reports/premises-master?${qs}` : "/api/ioms/reports/premises-master";
}

export default function PremisesMasterReport() {
  const { toast } = useToast();
  const { data: yardsRaw = [] } = useScopedActiveYards();
  const yards = useMemo(() => filterYardTypeLocations(yardsRaw), [yardsRaw]);

  const [yardId, setYardId] = useState("all");
  const [premisesType, setPremisesType] = useState("all");
  const [premisesStatus, setPremisesStatus] = useState("all");
  const [assetId, setAssetId] = useState("");
  const [applied, setApplied] = useState({
    yardId: "all",
    premisesType: "all",
    premisesStatus: "all",
    assetId: "",
  });
  const [exporting, setExporting] = useState(false);

  const yardOptions = useMemo(
    () => [
      { value: "all", label: "All yards" },
      ...yards.map((y) => ({
        value: y.id,
        label: [y.code, y.name].filter(Boolean).join(" — ") || y.id,
      })),
    ],
    [yards],
  );

  const reportUrl = useMemo(() => buildQuery({ ...applied, format: "json" }), [applied]);

  const { data, isLoading, isError, isFetching, refetch } = useQuery<PremisesMasterResponse>({
    queryKey: [reportUrl],
    queryFn: async () => {
      const res = await fetch(reportUrl, { credentials: "include" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? res.statusText);
      }
      return res.json();
    },
  });

  const sourceRows = useMemo((): Record<string, unknown>[] => {
    return (data?.rows ?? []).map((r) => ({
      ...r,
      premisesStatusLabel: premisesStatusLabel(r.premisesStatus),
    }));
  }, [data?.rows]);

  const applyFilters = () => {
    setApplied({
      yardId,
      premisesType,
      premisesStatus,
      assetId: assetId.trim(),
    });
  };

  const resetFilters = () => {
    setYardId("all");
    setPremisesType("all");
    setPremisesStatus("all");
    setAssetId("");
    setApplied({ yardId: "all", premisesType: "all", premisesStatus: "all", assetId: "" });
  };

  const exportExcel = async () => {
    try {
      setExporting(true);
      const url = buildQuery({ ...applied, format: "xlsx" });
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? res.statusText);
      }
      const blob = await res.blob();
      const stamp = new Date().toISOString().slice(0, 10);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `Premises_Master_Report_${stamp}.xlsx`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast({ title: "Excel downloaded", description: "Premises Master report exported." });
    } catch (e) {
      toast({
        title: "Export failed",
        description: e instanceof Error ? e.message : "Could not download Excel",
        variant: "destructive",
      });
    } finally {
      setExporting(false);
    }
  };

  return (
    <AppShell breadcrumbs={[{ label: "Assets (M-02)", href: "/assets" }, { label: "Premises Master Report" }]}>
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5" />
              Premises Master Report
            </CardTitle>
            <CardDescription>
              Filter premises master data and export to Excel in the prescribed Premises Master format.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="space-y-1">
                <Label>Yard</Label>
                <LocalSearchSelect
                  value={yardId}
                  onValueChange={setYardId}
                  options={yardOptions}
                  placeholder="All yards"
                  searchPlaceholder="Type yard name or code…"
                  emptyMessage="No matching yards."
                />
              </div>
              <div className="space-y-1">
                <Label>Premises type</Label>
                <Select value={premisesType} onValueChange={setPremisesType}>
                  <SelectTrigger>
                    <SelectValue placeholder="All" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All types</SelectItem>
                    {PREMISES_TYPE_VALUES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Premises status</Label>
                <Select value={premisesStatus} onValueChange={setPremisesStatus}>
                  <SelectTrigger>
                    <SelectValue placeholder="All" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    {PREMISES_STATUS_VALUES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {premisesStatusLabel(s)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Premises ID</Label>
                <Input
                  value={assetId}
                  onChange={(e) => setAssetId(e.target.value)}
                  placeholder="Type Premises ID (partial OK)"
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={applyFilters}>
                <Search className="h-4 w-4 mr-1" />
                Generate report
              </Button>
              <Button type="button" variant="outline" onClick={resetFilters}>
                <RefreshCcw className="h-4 w-4 mr-1" />
                Reset
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={exporting || isLoading}
                onClick={() => void exportExcel()}
              >
                <Download className="h-4 w-4 mr-1" />
                {exporting ? "Exporting…" : "Export Excel"}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => void refetch()} disabled={isFetching}>
                Refresh
              </Button>
            </div>
          </CardContent>
        </Card>

        {isError ? (
          <Card className="bg-destructive/10 border-destructive/20">
            <CardContent className="p-6 flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-destructive" />
              <span className="text-destructive">Failed to load premises master report.</span>
            </CardContent>
          </Card>
        ) : isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                Results{data?.total != null ? ` (${data.total})` : ""}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ClientDataGrid
                columns={columns}
                sourceRows={sourceRows}
                searchKeys={[
                  "premisesId",
                  "yard",
                  "premisesType",
                  "premisesLocation",
                  "premisesStatus",
                  "houseNo",
                  "adminFileNumber",
                  "consumerId",
                  "contractAccountNo",
                ]}
                searchPlaceholder="Search within results…"
                defaultSortKey="premisesId"
                defaultSortDir="asc"
                emptyMessage="No premises match the selected filters."
              />
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
