import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ClientDataGrid } from "@/components/reports/ClientDataGrid";
import type { ReportTableColumn } from "@/components/reports/ReportDataTable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { useAuth } from "@/context/AuthContext";
import { HardHat, AlertCircle, PlusCircle } from "lucide-react";

interface Work {
  id: string;
  workNo?: string | null;
  workOrderNo?: string | null;
  workOrderDate?: string | null;
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
  const [woFrom, setWoFrom] = useState("");
  const [woTo, setWoTo] = useState("");

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (woFrom) p.set("woDateFrom", woFrom);
    if (woTo) p.set("woDateTo", woTo);
    const s = p.toString();
    return s ? `?${s}` : "";
  }, [woFrom, woTo]);

  const { data: list, isLoading, isError } = useQuery<Work[]>({
    queryKey: ["/api/ioms/works", qs],
    queryFn: async () => {
      const res = await fetch(`/api/ioms/works${qs}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load works");
      return res.json();
    },
  });
  const { data: yards = [] } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ["/api/yards"],
  });
  const yardById = Object.fromEntries(yards.map((y) => [y.id, y.name]));

  const columns = useMemo(
    (): ReportTableColumn[] => [
      { key: "_workNo", header: "WO No", sortField: "workNoSort" },
      { key: "workOrderDate", header: "WO date" },
      { key: "yardName", header: "Yard" },
      { key: "workType", header: "Type" },
      { key: "contractorName", header: "Vendor" },
      { key: "startDate", header: "Start" },
      { key: "endDate", header: "End" },
      { key: "_status", header: "Status", sortField: "status" },
    ],
    [],
  );

  const sourceRows = useMemo((): Record<string, unknown>[] => {
    const today = new Date().toISOString().slice(0, 10);
    return (list ?? []).map((w) => {
      const overdue = w.status === "Approved" && w.endDate && w.endDate < today;
      return {
        id: w.id,
        workNoSort: w.workOrderNo ?? w.workNo ?? w.id,
        _workNo: (
          <Link href={`/construction/works/${w.id}`} className="text-primary hover:underline font-mono text-sm">
            {w.workOrderNo ?? w.workNo ?? w.id}
          </Link>
        ),
        workOrderDate: w.workOrderDate ?? "—",
        yardName: yardById[w.yardId] ?? w.yardId,
        workType: w.workType,
        contractorName: w.contractorName ?? "—",
        startDate: w.startDate ?? "—",
        endDate: w.endDate ?? "—",
        status: w.status,
        _status: (
          <div className="flex flex-wrap gap-1">
            <Badge variant="secondary">{w.status}</Badge>
            {overdue ? <Badge variant="destructive">Overdue</Badge> : null}
          </div>
        ),
      };
    });
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
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              <HardHat className="h-5 w-5" />
              Works (IOMS M-08)
            </CardTitle>
            <p className="text-sm text-muted-foreground">Work Orders · DO→DV→DA · bills / advance / SD-PBG</p>
          </div>
          {canCreate && (
            <Button asChild>
              <Link href="/construction/works/new">
                <PlusCircle className="h-4 w-4 mr-2" />
                Add Work Order
              </Link>
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label>WO date from</Label>
              <Input type="date" value={woFrom} onChange={(e) => setWoFrom(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>WO date to</Label>
              <Input type="date" value={woTo} onChange={(e) => setWoTo(e.target.value)} />
            </div>
            {(woFrom || woTo) && (
              <Button type="button" variant="outline" size="sm" onClick={() => { setWoFrom(""); setWoTo(""); }}>
                Clear dates
              </Button>
            )}
          </div>
          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <ClientDataGrid
              columns={columns}
              sourceRows={sourceRows}
              searchKeys={["workNoSort", "workOrderDate", "yardName", "workType", "contractorName", "startDate", "endDate", "status"]}
              defaultSortKey="workOrderDate"
              defaultSortDir="desc"
              emptyMessage="No works."
            />
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
