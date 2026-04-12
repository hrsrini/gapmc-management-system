import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ClientDataGrid } from "@/components/reports/ClientDataGrid";
import type { ReportTableColumn } from "@/components/reports/ReportDataTable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { useAuth } from "@/context/AuthContext";
import { HardHat, AlertCircle, PlusCircle } from "lucide-react";

interface Work {
  id: string;
  workNo?: string | null;
  yardId: string;
  workType: string;
  description?: string | null;
  contractorName?: string | null;
  status: string;
  startDate?: string | null;
  endDate?: string | null;
}

export default function ConstructionWorks() {
  const { can } = useAuth();
  const canCreate = can("M-08", "Create");
  const { data: list, isLoading, isError } = useQuery<Work[]>({
    queryKey: ["/api/ioms/works"],
  });
  const { data: yards = [] } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ["/api/yards"],
  });
  const yardById = Object.fromEntries(yards.map((y) => [y.id, y.name]));

  const columns = useMemo(
    (): ReportTableColumn[] => [
      { key: "_workNo", header: "Work No", sortField: "workNoSort" },
      { key: "yardName", header: "Yard" },
      { key: "workType", header: "Type" },
      { key: "contractorName", header: "Contractor" },
      { key: "startDate", header: "Start" },
      { key: "endDate", header: "End" },
      { key: "_status", header: "Status", sortField: "status" },
    ],
    [],
  );

  const sourceRows = useMemo((): Record<string, unknown>[] => {
    return (list ?? []).map((w) => ({
      id: w.id,
      workNoSort: w.workNo ?? w.id,
      _workNo: (
        <Link href={`/construction/works/${w.id}`} className="text-primary hover:underline font-mono text-sm">
          {w.workNo ?? w.id}
        </Link>
      ),
      yardName: yardById[w.yardId] ?? w.yardId,
      workType: w.workType,
      contractorName: w.contractorName ?? "—",
      startDate: w.startDate ?? "—",
      endDate: w.endDate ?? "—",
      status: w.status,
      _status: <Badge variant="secondary">{w.status}</Badge>,
    }));
  }, [list, yardById]);

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "Construction (M-08)", href: "/construction" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Failed to load works.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Construction (M-08)", href: "/construction" }]}>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <HardHat className="h-5 w-5" />
              Works (IOMS M-08)
            </CardTitle>
            <p className="text-sm text-muted-foreground">Works register, bills, AMC, land, fixed assets.</p>
          </div>
          {canCreate && (
            <Button asChild>
              <Link href="/construction/works/new"><PlusCircle className="h-4 w-4 mr-2" />Add work</Link>
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <ClientDataGrid
              columns={columns}
              sourceRows={sourceRows}
              searchKeys={["workNoSort", "yardName", "workType", "contractorName", "startDate", "endDate", "status"]}
              defaultSortKey="workNoSort"
              defaultSortDir="desc"
              emptyMessage="No works."
            />
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
