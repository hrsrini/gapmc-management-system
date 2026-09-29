import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ClientDataGrid } from "@/components/reports/ClientDataGrid";
import type { ReportTableColumn } from "@/components/reports/ReportDataTable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { useScopedActiveYards } from "@/hooks/useScopedActiveYards";
import { filterYardTypeLocations } from "@/lib/legacyYardMatch";
import { LocalSearchSelect } from "@/components/ui/local-search-select";
import { formatInr } from "@/lib/formatInr";
import { PREMISES_TYPE_VALUES } from "@shared/premises-master";
import { PREMISES_STATUS_VALUES, premisesStatusLabel } from "@shared/premises-allocation";
import {
  AssetAllotmentManageDialog,
  type ManagedAssetAllotment,
} from "@/components/assets/AssetAllotmentManageDialog";
import { AlertCircle, Download, FileSpreadsheet, KeyRound, Pencil, RefreshCcw, Search } from "lucide-react";

type PremisesAllotmentRow = {
  id: string;
  source: "trader" | "entity";
  traderLicenceId?: string | null;
  assetPk: string;
  srNo: number;
  premisesId: string;
  yard: string;
  allotteeName: string;
  licenceOrEntityId: string;
  agreementFrom: string;
  agreementTo: string;
  rentRs: number | "";
  securityDepositRs: number | "";
  allotmentDate: string;
  renewalCount: number;
  approval: string;
  tenancy: string;
  premisesRefNo?: string | null;
  rentRevisionMode?: string | null;
  agreementDocFile?: string | null;
};

type PremisesAllotmentResponse = {
  total: number;
  rows: PremisesAllotmentRow[];
  headers: string[];
};

const columns: ReportTableColumn[] = [
  { key: "srNo", header: "Sr. No." },
  { key: "premisesId", header: "Premises ID" },
  { key: "yard", header: "Yard" },
  { key: "allotteeName", header: "Allottee Name (Trader / Entity)" },
  { key: "licenceOrEntityId", header: "License No. / Entity ID" },
  { key: "agreementFrom", header: "Agreement From" },
  { key: "agreementTo", header: "Agreement To Date" },
  { key: "rentDisplay", header: "Rent (Rs.)", sortField: "rentSort" },
  { key: "depositDisplay", header: "Security Deposit (Rs.)", sortField: "depositSort" },
  { key: "allotmentDate", header: "Allotment Date" },
  { key: "renewalCount", header: "Renewal Count" },
  { key: "_approval", header: "Approval", sortField: "approval" },
  { key: "_tenancy", header: "Tenancy", sortField: "tenancy" },
  { key: "_actions", header: "" },
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
  return qs ? `/api/ioms/reports/premises-allotment?${qs}` : "/api/ioms/reports/premises-allotment";
}

export default function AssetAllotments() {
  const { toast } = useToast();
  const { can } = useAuth();
  const canUpdate = can("M-02", "Update");
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
  const [manageRow, setManageRow] = useState<ManagedAssetAllotment | null>(null);

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

  const { data, isLoading, isError, isFetching, refetch } = useQuery<PremisesAllotmentResponse>({
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
    return (data?.rows ?? []).map((r) => {
      const appr = String(r.approval ?? "Draft");
      return {
        ...r,
        rentSort: r.rentRs === "" ? null : Number(r.rentRs),
        depositSort: r.securityDepositRs === "" ? null : Number(r.securityDepositRs),
        rentDisplay: r.rentRs === "" ? "—" : formatInr(Number(r.rentRs)),
        depositDisplay: r.securityDepositRs === "" ? "—" : formatInr(Number(r.securityDepositRs)),
        _approval: (
          <Badge variant={appr === "Approved" ? "default" : appr === "Rejected" ? "destructive" : "secondary"}>
            {appr}
          </Badge>
        ),
        _tenancy: (
          <Badge variant={r.tenancy === "Active" ? "default" : "secondary"}>{r.tenancy || "—"}</Badge>
        ),
        _actions:
          canUpdate && r.source === "trader" ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 px-2"
              onClick={() =>
                setManageRow({
                  id: r.id,
                  assetId: r.assetPk,
                  traderLicenceId: r.traderLicenceId ?? "",
                  allotteeName: r.allotteeName,
                  fromDate: r.agreementFrom,
                  toDate: r.agreementTo,
                  status: r.tenancy,
                  securityDeposit: r.securityDepositRs === "" ? null : Number(r.securityDepositRs),
                  approvalStatus: r.approval,
                  monthlyRent: r.rentRs === "" ? null : Number(r.rentRs),
                  allotmentDate: r.allotmentDate || null,
                  premisesRefNo: r.premisesRefNo,
                  rentRevisionMode: r.rentRevisionMode,
                  agreementDocFile: r.agreementDocFile,
                })
              }
            >
              <Pencil className="h-4 w-4" />
              <span className="sr-only">Manage</span>
            </Button>
          ) : null,
      };
    });
  }, [data?.rows, canUpdate]);

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
      a.download = `Premises_Allotment_Report_${stamp}.xlsx`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast({ title: "Excel downloaded", description: "Premises Allotment report exported." });
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

  /** Resolve asset PK for manage dialog after report returns public premises ID. */
  const assetDisplayMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const r of data?.rows ?? []) {
      m[r.assetPk] = r.premisesId;
      m[r.premisesId] = r.premisesId;
    }
    if (manageRow) {
      m[manageRow.assetId] = m[manageRow.assetId] ?? manageRow.assetId;
    }
    return m;
  }, [data?.rows, manageRow]);

  return (
    <AppShell breadcrumbs={[{ label: "Assets", href: "/assets" }, { label: "Shop Allotments" }]}>
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5" />
              Premises Allotment Report (M-02)
            </CardTitle>
            <CardDescription>
              Filter trader and entity premises allotments, then export to Excel. Use Manage on a trader row to edit
              or run the approval workflow.
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

        <AssetAllotmentManageDialog
          row={manageRow}
          onClose={() => setManageRow(null)}
          onRowUpdated={(fresh) => {
            setManageRow(fresh);
            void refetch();
          }}
          assetDisplayMap={assetDisplayMap}
        />

        {isError ? (
          <Card className="bg-destructive/10 border-destructive/20">
            <CardContent className="p-6 flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-destructive" />
              <span className="text-destructive">Failed to load premises allotment report.</span>
            </CardContent>
          </Card>
        ) : isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <FileSpreadsheet className="h-4 w-4" />
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
                  "allotteeName",
                  "licenceOrEntityId",
                  "agreementFrom",
                  "agreementTo",
                  "allotmentDate",
                  "approval",
                  "tenancy",
                ]}
                searchPlaceholder="Search Trader or Entity"
                defaultSortKey="agreementFrom"
                defaultSortDir="desc"
                resetPageDependency={reportUrl}
                emptyMessage="No allotments match the selected filters."
              />
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
