import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileCheck, AlertCircle, UserPlus } from "lucide-react";
import { ReportDataTable, type ReportPagedParams } from "@/components/reports/ReportDataTable";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/AuthContext";

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
}

interface PagedResponse {
  total: number;
  page: number;
  pageSize: number | "all";
  rows: Licence[];
}

const FUNCTIONARY_TYPES = ["Functionary", "Hamali", "Weighman", "AssistantTrader"] as const;

export default function FunctionaryRegistrations() {
  const { can } = useAuth();
  const canCreate = can("M-02", "Create");
  const [tableParams, setTableParams] = useState<ReportPagedParams>({
    page: 1,
    pageSize: 25,
    q: "",
    sortKey: "createdAt",
    sortDir: "desc",
  });

  const mergeParams = useCallback((next: Partial<ReportPagedParams>) => {
    setTableParams((s) => ({ ...s, ...next }));
  }, []);

  const listUrl = useMemo(() => {
    const sp = new URLSearchParams({
      paged: "1",
      page: String(tableParams.page),
      pageSize: String(tableParams.pageSize),
      q: tableParams.q,
      sort: tableParams.sortKey,
      sortDir: tableParams.sortDir,
      licenceTypes: FUNCTIONARY_TYPES.join(","),
    });
    return `/api/ioms/traders/licences?${sp}`;
  }, [tableParams]);

  const { data: yards = [] } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ["/api/yards"],
  });
  const yardById = useMemo(() => Object.fromEntries(yards.map((y) => [y.id, y.name])), [yards]);

  const { data, isLoading, isError } = useQuery<PagedResponse>({
    queryKey: [listUrl],
    queryFn: async () => {
      const res = await fetch(listUrl, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load");
      return res.json() as Promise<PagedResponse>;
    },
  });

  const columns = useMemo(
    () => [
      { key: "_licenceLink", header: "Licence no.", sortField: "licenceNo" },
      { key: "_firmLink", header: "Name", sortField: "firmName" },
      { key: "licenceType", header: "Type" },
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
      return {
        id,
        _licenceLink: (
          <Link href={`/traders/licences/${id}`} className="text-primary hover:underline font-mono text-sm">
            {l.licenceNo ?? id}
          </Link>
        ),
        _firmLink: (
          <Link href={`/traders/licences/${id}`} className="text-primary hover:underline">
            {l.firmName}
          </Link>
        ),
        licenceType: l.licenceType,
        yardDisplay: yardById[l.yardId] ?? l.yardId,
        mobile: l.mobile,
        validTo: l.validTo ?? "—",
        _status: (
          <Badge
            variant={
              l.isBlocked ? "destructive" : l.status === "Active" ? "default" : l.status === "Query" ? "outline" : "secondary"
            }
            className={l.status === "Query" ? "border-amber-600 text-amber-900 dark:text-amber-100" : undefined}
          >
            {l.isBlocked ? "Blocked" : l.status}
          </Badge>
        ),
      };
    });
  }, [data?.rows, yardById]);

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "Traders", href: "/traders/licences" }, { label: "Functionary registrations (BM)" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Failed to load registrations.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Traders", href: "/traders/licences" }, { label: "Functionary registrations (Form BM)" }]}>
      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FileCheck className="h-5 w-5" />
              Market functionary registrations (BM)
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Filtered view of Track A licence applications for functionary roles: {FUNCTIONARY_TYPES.join(", ")}.
            </p>
          </div>
          {canCreate && (
            <Button asChild size="sm">
              <Link href={`/traders/licences/new?licenceType=${encodeURIComponent("Functionary")}`}>
                <UserPlus className="h-4 w-4 mr-1" />
                New registration
              </Link>
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <ReportDataTable
            columns={columns}
            rows={rowsForTable}
            isLoading={isLoading}
            params={tableParams}
            onParamsChange={mergeParams}
            total={data?.total ?? 0}
            emptyMessage="No registrations."
          />
        </CardContent>
      </Card>
    </AppShell>
  );
}

