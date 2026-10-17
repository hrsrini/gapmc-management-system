import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileCheck, AlertCircle, UserPlus } from "lucide-react";
import { ReportDataTable, type ReportPagedParams } from "@/components/reports/ReportDataTable";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useAuth } from "@/context/AuthContext";
import { TRADER_LICENCE_CRUD_DISABLED } from "@shared/trader-licence-crud";

type LicenceSearchBy = "licenceNo" | "name" | "mobile";

const LICENCE_SEARCH_BY_OPTIONS: { value: LicenceSearchBy; label: string; placeholder: string }[] = [
  { value: "licenceNo", label: "License number", placeholder: "Search by license number…" },
  { value: "name", label: "Name", placeholder: "Search by trader / firm name…" },
  { value: "mobile", label: "Mobile number", placeholder: "Search by mobile number…" },
];

interface Licence {
  id: string;
  licenceNo?: string | null;
  firmName: string;
  yardId: string;
  licenceType: string;
  mobile: string;
  validFrom?: string | null;
  validTo?: string | null;
  status: string;
  isBlocked?: boolean;
  commodities?: string[] | null;
  lmStatus?: string | null;
  lmIsActive?: boolean | null;
  lmLicenseClass?: string | null;
  lmSyncedAt?: string | null;
}

interface PagedResponse {
  total: number;
  page: number;
  pageSize: number | "all";
  rows: Licence[];
}

export default function TraderLicences() {
  const { can, user } = useAuth();
  const canCreate = !TRADER_LICENCE_CRUD_DISABLED && can("M-02", "Create");
  const isAdmin = Boolean(user?.roles?.some((r) => r.tier === "ADMIN"));
  const [allYards, setAllYards] = useState(false);
  const [searchBy, setSearchBy] = useState<LicenceSearchBy>("licenceNo");
  const [tableParams, setTableParams] = useState<ReportPagedParams>({
    page: 1,
    pageSize: 25,
    q: "",
    sortKey: "licenceNo",
    sortDir: "desc",
  });

  const mergeParams = useCallback((next: Partial<ReportPagedParams>) => {
    setTableParams((s) => ({ ...s, ...next }));
  }, []);

  const searchPlaceholder =
    LICENCE_SEARCH_BY_OPTIONS.find((o) => o.value === searchBy)?.placeholder ??
    "Search trader licences…";

  const listUrl = useMemo(() => {
    const sp = new URLSearchParams({
      paged: "1",
      page: String(tableParams.page),
      pageSize: String(tableParams.pageSize),
      q: tableParams.q,
      sort: tableParams.sortKey,
      sortDir: tableParams.sortDir,
      searchBy,
    });
    if (isAdmin && allYards) sp.set("allYards", "1");
    return `/api/ioms/traders/licences?${sp}`;
  }, [tableParams, isAdmin, allYards, searchBy]);

  const { data: yards = [] } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ["/api/yards"],
  });
  const yardById = useMemo(() => Object.fromEntries(yards.map((y) => [y.id, y.name])), [yards]);

  const { data, isLoading, isError } = useQuery<PagedResponse>({
    queryKey: [listUrl],
    queryFn: async () => {
      const res = await fetch(listUrl, { credentials: "include", cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load");
      return res.json() as Promise<PagedResponse>;
    },
  });

  const columns = useMemo(
    () => [
      { key: "licenceNo", header: "License No", sortField: "licenceNo" },
      { key: "_firmLink", header: "Firm", sortField: "firmName" },
      { key: "licenceType", header: "Type" },
      { key: "_lm", header: "LM" },
      { key: "yardDisplay", header: "Yard", sortField: "yardId" },
      { key: "mobile", header: "Mobile" },
      { key: "validTo", header: "Valid To" },
      { key: "_status", header: "Status", sortField: "status" },
    ],
    [],
  );

  const rowsForTable = useMemo(() => {
    return (data?.rows ?? []).map((l) => {
      const id = l.id;
      const lmLinked = Boolean(l.lmSyncedAt);
      return {
        id,
        licenceNo: l.licenceNo?.trim() ? (
          <span className="font-mono tabular-nums text-right block">{l.licenceNo.trim()}</span>
        ) : (
          <span className="text-muted-foreground text-right block">—</span>
        ),
        _firmLink: (
          <Link href={`/traders/licences/${id}`} className="text-primary hover:underline">
            {l.firmName}
          </Link>
        ),
        licenceType: l.licenceType,
        _lm: lmLinked ? (
          <Badge variant={l.lmIsActive ? "default" : "secondary"} title={l.lmStatus ?? undefined}>
            {l.lmLicenseClass ? `LM ${l.lmLicenseClass}` : "LM linked"}
          </Badge>
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
        ),
        yardDisplay: yardById[l.yardId] ?? l.yardId,
        mobile: l.mobile?.trim() ? l.mobile : "—",
        validTo: l.validTo ?? "—",
        _status: (
          <Badge
            variant={
              l.isBlocked
                ? "destructive"
                : l.status === "Active"
                  ? "default"
                  : l.status === "Query"
                    ? "outline"
                    : "secondary"
            }
            className={l.status === "Query" ? "border-amber-600 text-amber-900 dark:text-amber-100" : undefined}
          >
            {l.isBlocked ? "Blocked" : l.status}
          </Badge>
        ),
      } as Record<string, unknown>;
    });
  }, [data?.rows, yardById]);

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "Traders & Assets", href: "/traders/licences" }, { label: "Licences" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Failed to load licences.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Traders & Assets", href: "/traders/licences" }, { label: "Licences" }]}>
      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <FileCheck className="h-5 w-5" />
              Trader Licences (M-02)
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              {TRADER_LICENCE_CRUD_DISABLED
                ? "Licences are synced from License Manager. Create, edit, and delete are disabled here — view-only."
                : "IOMS licence lifecycle — Associated, Functionary, Hamali, Weighman, Assistant. Choose how to search, then open a licence for details."}
            </p>
          </div>
          {canCreate ? (
            <Button asChild className="shrink-0">
              <Link href="/traders/licences/new">
                <UserPlus className="h-4 w-4 mr-2" />
                Apply for new licence
              </Link>
            </Button>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-4">
          {isAdmin ? (
            <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2">
              <Checkbox id="all-yards-licences" checked={allYards} onCheckedChange={(c) => setAllYards(c === true)} />
              <Label htmlFor="all-yards-licences" className="text-sm font-normal cursor-pointer">
                Show licences from all yards (admin)
              </Label>
            </div>
          ) : null}
          <div className="space-y-2 rounded-md border bg-muted/20 px-3 py-3">
            <Label className="text-sm">Search by</Label>
            <RadioGroup
              value={searchBy}
              onValueChange={(v) => {
                setSearchBy(v as LicenceSearchBy);
                setTableParams((s) => ({ ...s, page: 1 }));
              }}
              className="flex flex-wrap gap-4"
            >
              {LICENCE_SEARCH_BY_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  htmlFor={`licence-search-by-${opt.value}`}
                  className="flex items-center gap-2 text-sm font-normal cursor-pointer"
                >
                  <RadioGroupItem value={opt.value} id={`licence-search-by-${opt.value}`} />
                  {opt.label}
                </label>
              ))}
            </RadioGroup>
          </div>
          <ReportDataTable
            columns={columns}
            rows={rowsForTable}
            total={data?.total ?? 0}
            params={tableParams}
            onParamsChange={mergeParams}
            isLoading={isLoading}
            searchPlaceholder={searchPlaceholder}
          />
        </CardContent>
      </Card>
    </AppShell>
  );
}
