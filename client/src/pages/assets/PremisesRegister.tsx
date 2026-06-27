import { useCallback, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ClientDataGrid } from "@/components/reports/ClientDataGrid";
import type { ReportTableColumn } from "@/components/reports/ReportDataTable";
import { useAuth } from "@/context/AuthContext";
import { useScopedActiveYards } from "@/hooks/useScopedActiveYards";
import { filterYardTypeLocations } from "@/lib/legacyYardMatch";
import { formatInr } from "@/lib/formatInr";
import { formatYmdToDisplay } from "@/lib/dateFormat";
import { PREMISES_TYPE_VALUES } from "@shared/premises-master";
import { PREMISES_STATUS_VALUES, premisesStatusLabel } from "@shared/premises-allocation";
import type { PremisesRegisterResponse } from "@shared/premises-register";
import {
  AlertCircle,
  Building2,
  Eye,
  Info,
  MoreVertical,
  Pencil,
  Plus,
  RefreshCcw,
  Search,
} from "lucide-react";

const STATUS_BADGE_CLASS: Record<string, string> = {
  Allocated: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30",
  Vacant: "bg-red-500/15 text-red-700 border-red-500/30",
  Vacating: "bg-orange-500/15 text-orange-700 border-orange-500/30",
  UnsafeForOccupation: "bg-violet-500/15 text-violet-700 border-violet-500/30",
  Demolished: "bg-muted text-muted-foreground border-muted",
};

type RegisterFilters = {
  yardId: string;
  premisesType: string;
  premisesStatus: string;
  allottee: string;
  assetId: string;
  agreementExpiry: string;
};

const DEFAULT_FILTERS: RegisterFilters = {
  yardId: "all",
  premisesType: "all",
  premisesStatus: "all",
  allottee: "all",
  assetId: "",
  agreementExpiry: "all",
};

function filtersFromSearch(search: string): RegisterFilters {
  const params = new URLSearchParams(search);
  return {
    yardId: params.get("yardId") ?? "all",
    premisesType: params.get("premisesType") ?? "all",
    premisesStatus: params.get("status") ?? params.get("premisesStatus") ?? "all",
    allottee: params.get("allottee") ?? "all",
    assetId: params.get("assetId") ?? "",
    agreementExpiry: params.get("agreementExpiry") ?? "all",
  };
}

function buildRegisterQuery(filters: RegisterFilters): string {
  const params = new URLSearchParams();
  if (filters.yardId && filters.yardId !== "all") params.set("yardId", filters.yardId);
  if (filters.premisesType && filters.premisesType !== "all") params.set("premisesType", filters.premisesType);
  if (filters.premisesStatus && filters.premisesStatus !== "all") params.set("premisesStatus", filters.premisesStatus);
  if (filters.allottee && filters.allottee !== "all") params.set("allottee", filters.allottee);
  if (filters.assetId.trim()) params.set("assetId", filters.assetId.trim());
  if (filters.agreementExpiry && filters.agreementExpiry !== "all") {
    params.set("agreementExpiry", filters.agreementExpiry);
  }
  const qs = params.toString();
  return qs ? `/api/ioms/premises-register?${qs}` : "/api/ioms/premises-register";
}

const registerColumns: ReportTableColumn[] = [
  { key: "_assetId", header: "Premises ID", sortField: "assetId" },
  { key: "yardName", header: "Yard" },
  { key: "assetType", header: "Type" },
  { key: "area", header: "Area (Sq.M.)" },
  { key: "_status", header: "Status", sortField: "statusSort" },
  { key: "currentAllottee", header: "Current Allottee" },
  { key: "agreementFromDisplay", header: "Agreement From", sortField: "agreementFromSort" },
  { key: "agreementToDisplay", header: "Agreement To", sortField: "agreementToSort" },
  { key: "_rent", header: "Rent (₹)", sortField: "rentSort" },
  { key: "renewalCount", header: "Renewal Count", sortField: "renewalSort" },
  { key: "_actions", header: "Actions" },
];

const alertColumns: ReportTableColumn[] = [
  { key: "_assetId", header: "Premises ID", sortField: "assetId" },
  { key: "yardName", header: "Yard" },
  { key: "assetType", header: "Type" },
  { key: "currentAllottee", header: "Allottee" },
  { key: "agreementToDisplay", header: "Agreement To", sortField: "agreementToSort" },
  { key: "_daysLeft", header: "Days Left", sortField: "daysLeft" },
  { key: "_rent", header: "Rent (₹)", sortField: "rentSort" },
];

export default function PremisesRegister() {
  const { can } = useAuth();
  const canCreate = can("M-02", "Create");
  const canUpdate = can("M-02", "Update");
  const [, setLocation] = useLocation();
  const initialFilters = filtersFromSearch(typeof window !== "undefined" ? window.location.search : "");
  const [draft, setDraft] = useState<RegisterFilters>(initialFilters);
  const [applied, setApplied] = useState<RegisterFilters>(initialFilters);

  const { data: yards = [] } = useScopedActiveYards();
  const premiseYardOptions = useMemo(() => filterYardTypeLocations(yards), [yards]);

  const registerUrl = useMemo(() => buildRegisterQuery(applied), [applied]);
  const filterKey = JSON.stringify(applied);

  const { data, isLoading, isError, refetch } = useQuery<PremisesRegisterResponse>({
    queryKey: [registerUrl],
    queryFn: async () => {
      const res = await fetch(registerUrl, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch premises register");
      return res.json();
    },
  });

  const applyFilters = useCallback(() => {
    setApplied({ ...draft });
    const params = new URLSearchParams();
    if (draft.yardId !== "all") params.set("yardId", draft.yardId);
    if (draft.premisesType !== "all") params.set("premisesType", draft.premisesType);
    if (draft.premisesStatus !== "all") params.set("status", draft.premisesStatus);
    if (draft.allottee !== "all") params.set("allottee", draft.allottee);
    if (draft.assetId.trim()) params.set("assetId", draft.assetId.trim());
    if (draft.agreementExpiry !== "all") params.set("agreementExpiry", draft.agreementExpiry);
    const qs = params.toString();
    setLocation(qs ? `/assets?${qs}` : "/assets");
  }, [draft, setLocation]);

  const resetFilters = useCallback(() => {
    setDraft(DEFAULT_FILTERS);
    setApplied(DEFAULT_FILTERS);
    setLocation("/assets");
  }, [setLocation]);

  const allotteeOptions = useMemo(() => {
    const fromApi = data?.allotteeOptions ?? [];
    const merged = new Set(fromApi);
    if (draft.allottee !== "all" && draft.allottee) merged.add(draft.allottee);
    return Array.from(merged).sort((a, b) => a.localeCompare(b));
  }, [data?.allotteeOptions, draft.allottee]);

  const registerRows = useMemo((): Record<string, unknown>[] => {
    return (data?.rows ?? []).map((row) => {
      const statusLabel = premisesStatusLabel(row.premisesStatus);
      const agreementFrom = row.agreementFrom;
      const agreementTo = row.agreementTo;
      return {
        id: row.id,
        assetId: row.assetId,
        _assetId: canUpdate ? (
          <Link href={`/assets/${row.id}/edit`} className="text-primary hover:underline font-mono text-sm">
            {row.assetId}
          </Link>
        ) : (
          <span className="font-mono text-sm">{row.assetId}</span>
        ),
        yardName: row.yardName,
        assetType: row.assetType,
        area: row.area ?? "—",
        statusSort: statusLabel,
        _status: (
          <Badge variant="outline" className={STATUS_BADGE_CLASS[row.premisesStatus] ?? ""}>
            {statusLabel}
          </Badge>
        ),
        currentAllottee: row.currentAllottee ?? "—",
        agreementFromSort: agreementFrom ?? "",
        agreementFromDisplay: agreementFrom ? formatYmdToDisplay(agreementFrom) : "—",
        agreementToSort: agreementTo ?? "",
        agreementToDisplay: agreementTo ? formatYmdToDisplay(agreementTo) : "—",
        rentSort: row.monthlyRent ?? null,
        _rent: row.monthlyRent != null ? formatInr(row.monthlyRent) : "—",
        renewalSort: row.renewalCount ?? null,
        renewalCount: row.renewalCount != null ? String(row.renewalCount) : "—",
        _actions: (
          <div className="flex items-center justify-end gap-1">
            <Button
              variant="ghost"
              size="icon"
              asChild
              aria-label="View premises"
              title="View"
            >
              <Link href={`/assets/${row.id}/edit`}>
                <Eye className="h-4 w-4" />
              </Link>
            </Button>
            {canUpdate && (
              <Button variant="ghost" size="icon" asChild aria-label="Edit premises" title="Edit">
                <Link href={`/assets/${row.id}/edit`}>
                  <Pencil className="h-4 w-4" />
                </Link>
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="More actions">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {row.allotmentId ? (
                  <DropdownMenuItem asChild>
                    <Link href="/assets/allotments">View allotment</Link>
                  </DropdownMenuItem>
                ) : null}
                {canUpdate ? (
                  <DropdownMenuItem asChild>
                    <Link href={`/assets/${row.id}/edit`}>Edit premises</Link>
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
      };
    });
  }, [data?.rows, canUpdate]);

  const alertRows = useMemo((): Record<string, unknown>[] => {
    return (data?.alerts ?? []).map((row) => {
      const daysClass =
        row.daysLeft <= 30
          ? "text-orange-600 font-medium"
          : row.daysLeft <= 60
            ? "text-amber-600 font-medium"
            : "text-emerald-600 font-medium";
      return {
        id: row.id,
        assetId: row.assetId,
        _assetId: (
          <Link href={`/assets/${row.id}/edit`} className="text-primary hover:underline font-mono text-sm">
            {row.assetId}
          </Link>
        ),
        yardName: row.yardName,
        assetType: row.assetType,
        currentAllottee: row.currentAllottee,
        agreementToSort: row.agreementTo,
        agreementToDisplay: formatYmdToDisplay(row.agreementTo),
        daysLeft: row.daysLeft,
        _daysLeft: <span className={daysClass}>{row.daysLeft}</span>,
        rentSort: row.monthlyRent ?? null,
        _rent: row.monthlyRent != null ? formatInr(row.monthlyRent) : "—",
      };
    });
  }, [data?.alerts]);

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "Traders & Assets", href: "/assets" }, { label: "Premises Register" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-destructive" />
              <span className="text-destructive">Failed to load premises register.</span>
            </div>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCcw className="h-4 w-4 mr-2" />
              Retry
            </Button>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Traders & Assets", href: "/assets" }, { label: "Premises Register" }]}>
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Building2 className="h-5 w-5" />
                  Premises Register (M-02)
                  <span title="Single view of all premises with status, allottee, agreement and rent information.">
                    <Info className="h-4 w-4 text-muted-foreground" />
                  </span>
                </CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  View, search, and manage all premises — status, allottee, agreement and rent in one place.
                </p>
              </div>
              {canCreate && (
                <Button asChild>
                  <Link href="/assets/new">
                    <Plus className="h-4 w-4 mr-1" />
                    Register New Premises
                  </Link>
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
              <div className="space-y-1">
                <Label>Yard</Label>
                <Select value={draft.yardId} onValueChange={(v) => setDraft((s) => ({ ...s, yardId: v }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="All Yards" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Yards</SelectItem>
                    {premiseYardOptions.map((y) => (
                      <SelectItem key={y.id} value={y.id}>
                        {y.name ?? y.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Premises Type</Label>
                <Select
                  value={draft.premisesType}
                  onValueChange={(v) => setDraft((s) => ({ ...s, premisesType: v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="All Types" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    <SelectItem value="all">All Types</SelectItem>
                    {PREMISES_TYPE_VALUES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Premises Status</Label>
                <Select
                  value={draft.premisesStatus}
                  onValueChange={(v) => setDraft((s) => ({ ...s, premisesStatus: v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="All Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    {PREMISES_STATUS_VALUES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {premisesStatusLabel(s)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Current Allottee</Label>
                <Select value={draft.allottee} onValueChange={(v) => setDraft((s) => ({ ...s, allottee: v }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select Allottee" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    <SelectItem value="all">All allottees</SelectItem>
                    {allotteeOptions.map((name) => (
                      <SelectItem key={name} value={name}>
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Asset / Premises ID</Label>
                <Input
                  placeholder="Search ID"
                  value={draft.assetId}
                  onChange={(e) => setDraft((s) => ({ ...s, assetId: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label>Agreement Expiry</Label>
                <Select
                  value={draft.agreementExpiry}
                  onValueChange={(v) => setDraft((s) => ({ ...s, agreementExpiry: v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="All" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All agreements</SelectItem>
                    <SelectItem value="next60">Next 60 Days</SelectItem>
                    <SelectItem value="next30">Next 30 Days</SelectItem>
                    <SelectItem value="expired">Expired</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end gap-2 md:col-span-2 xl:col-span-2">
                <Button onClick={applyFilters}>
                  <Search className="h-4 w-4 mr-1" />
                  Search
                </Button>
                <Button variant="outline" onClick={resetFilters}>
                  <RefreshCcw className="h-4 w-4 mr-1" />
                  Reset
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Premises Register ({isLoading ? "…" : (data?.rows.length ?? 0).toLocaleString()})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-64 w-full" />
            ) : (
              <ClientDataGrid
                columns={registerColumns}
                sourceRows={registerRows}
                searchKeys={[
                  "assetId",
                  "yardName",
                  "assetType",
                  "area",
                  "statusSort",
                  "currentAllottee",
                  "agreementFromDisplay",
                  "agreementToDisplay",
                ]}
                searchPlaceholder="Search register…"
                defaultSortKey="assetId"
                defaultSortDir="asc"
                emptyMessage="No premises match the selected filters."
                resetPageDependency={filterKey}
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4">
            <CardTitle className="text-base">
              Alerts: Agreements Expiring in Next 60 Days ({isLoading ? "…" : (data?.alerts.length ?? 0)})
            </CardTitle>
            {applied.agreementExpiry !== "next60" && (
              <Button
                variant="ghost"
                className="px-0 text-primary hover:text-primary"
                onClick={() => {
                  const next = { ...applied, agreementExpiry: "next60" };
                  setDraft(next);
                  setApplied(next);
                  setLocation("/assets?agreementExpiry=next60");
                }}
              >
                View all expiring
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : (
              <ClientDataGrid
                columns={alertColumns}
                sourceRows={alertRows}
                searchKeys={["assetId", "yardName", "assetType", "currentAllottee", "agreementToDisplay"]}
                defaultSortKey="daysLeft"
                defaultSortDir="asc"
                emptyMessage="No agreements expiring in the next 60 days."
                resetPageDependency={filterKey}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
