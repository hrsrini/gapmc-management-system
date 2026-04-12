import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ClientDataGrid } from "@/components/reports/ClientDataGrid";
import type { ReportTableColumn } from "@/components/reports/ReportDataTable";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { MapPin, AlertCircle } from "lucide-react";
import { formatYmdToDisplay } from "@/lib/dateFormat";

interface LandRecord {
  id: string;
  yardId: string;
  surveyNo: string;
  village?: string | null;
  taluk?: string | null;
  district?: string | null;
  areaSqm?: number | null;
  saleDeedNo?: string | null;
  saleDeedDate?: string | null;
  encumbrance?: string | null;
  remarks?: string | null;
  createdBy: string;
  createdAt: string;
}
interface Yard {
  id: string;
  code?: string | null;
  name?: string | null;
}

export default function ConstructionLandRecords() {
  const [yardId, setYardId] = useState("all");

  const params = new URLSearchParams();
  if (yardId && yardId !== "all") params.set("yardId", yardId);
  const url = params.toString() ? `/api/ioms/land-records?${params.toString()}` : "/api/ioms/land-records";

  const { data: list = [], isLoading, isError } = useQuery<LandRecord[]>({ queryKey: [url] });
  const { data: yards = [] } = useQuery<Yard[]>({ queryKey: ["/api/yards"] });
  const yardById = useMemo(() => new Map(yards.map((y) => [y.id, y.name ?? y.code ?? y.id])), [yards]);

  const columns = useMemo(
    (): ReportTableColumn[] => [
      { key: "surveyNo", header: "Survey no" },
      { key: "yardName", header: "Yard" },
      { key: "village", header: "Village" },
      { key: "taluk", header: "Taluk" },
      { key: "_areaSqm", header: "Area (sqm)", sortField: "areaSqm" },
      { key: "saleDeedSummary", header: "Sale deed" },
      { key: "createdAt", header: "Created" },
    ],
    [],
  );

  const sourceRows = useMemo((): Record<string, unknown>[] => {
    return list.map((r) => {
      const saleDeedSummary = [r.saleDeedNo ?? "", r.saleDeedDate ? formatYmdToDisplay(r.saleDeedDate) : ""]
        .filter(Boolean)
        .join(" ")
        .trim() || "—";
      return {
        id: r.id,
        surveyNo: r.surveyNo,
        yardName: yardById.get(r.yardId) ?? r.yardId,
        village: r.village ?? "—",
        taluk: r.taluk ?? "—",
        areaSqm: r.areaSqm ?? null,
        _areaSqm: r.areaSqm != null ? r.areaSqm.toLocaleString() : "—",
        saleDeedSummary,
        createdAt: r.createdAt,
      };
    });
  }, [list, yardById]);

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "Construction (M-08)", href: "/construction" }, { label: "Land records" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Failed to load land records.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Construction (M-08)", href: "/construction" }, { label: "Land records" }]}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5" />
            Land records
          </CardTitle>
          <p className="text-sm text-muted-foreground">Land register by yard — survey no, village, area, deed details.</p>
          <div className="pt-2">
            <Label>Yard</Label>
            <Select value={yardId} onValueChange={setYardId}>
              <SelectTrigger className="w-[200px] mt-1">
                <SelectValue placeholder="All yards" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All yards</SelectItem>
                {yards.map((y) => (
                  <SelectItem key={y.id} value={y.id}>{y.name ?? y.code ?? y.id}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <ClientDataGrid
              columns={columns}
              sourceRows={sourceRows}
              searchKeys={["surveyNo", "yardName", "village", "taluk", "saleDeedSummary"]}
              defaultSortKey="createdAt"
              defaultSortDir="desc"
              emptyMessage="No land records."
              resetPageDependency={url}
            />
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
