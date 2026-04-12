import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ClientDataGrid } from "@/components/reports/ClientDataGrid";
import type { ReportTableColumn } from "@/components/reports/ReportDataTable";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FolderOpen, AlertCircle } from "lucide-react";

interface Yard {
  id: string;
  code?: string | null;
  name?: string | null;
}

interface GroupRow {
  sampleSubject: string;
  count: number;
}

export default function DakSubjectIndex() {
  const [yardId, setYardId] = useState("all");

  const summaryUrl = useMemo(() => {
    const p = new URLSearchParams();
    if (yardId && yardId !== "all") p.set("yardId", yardId);
    const qs = p.toString();
    return qs ? `/api/ioms/dak/inward/subject-summary?${qs}` : "/api/ioms/dak/inward/subject-summary";
  }, [yardId]);

  const { data, isLoading, isError } = useQuery<{ groups: GroupRow[] }>({
    queryKey: [summaryUrl],
  });
  const { data: yards = [] } = useQuery<Yard[]>({ queryKey: ["/api/yards"] });
  const groups = data?.groups ?? [];

  const subjectColumns = useMemo(
    (): ReportTableColumn[] => [
      { key: "sampleSubject", header: "Subject (sample text)" },
      { key: "count", header: "Inward count" },
      { key: "_register", header: "" },
    ],
    [],
  );

  const subjectRows = useMemo((): Record<string, unknown>[] => {
    return groups.map((g, idx) => ({
      id: `${g.sampleSubject}::${idx}`,
      sampleSubject: g.sampleSubject,
      count: g.count,
      _register: (
        <Link
          className="text-sm text-primary hover:underline"
          href={`/correspondence/inward?subject=${encodeURIComponent(g.sampleSubject)}`}
        >
          View register
        </Link>
      ),
    }));
  }, [groups]);

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "Correspondence (M-09)", href: "/correspondence/inward" }, { label: "By subject" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Failed to load subject summary.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Correspondence (M-09)", href: "/correspondence/inward" }, { label: "Inward by subject" }]}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FolderOpen className="h-5 w-5" />
            Inward dak by subject
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Rows grouped by normalised subject text (trim, case-insensitive). Open the register filtered to that subject.
          </p>
          <div className="pt-2">
            <Label>Yard</Label>
            <Select value={yardId} onValueChange={setYardId}>
              <SelectTrigger className="w-[220px] mt-1">
                <SelectValue placeholder="All scoped yards" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All my yards</SelectItem>
                {yards.map((y) => (
                  <SelectItem key={y.id} value={y.id}>
                    {y.name ?? y.code ?? y.id}
                  </SelectItem>
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
              columns={subjectColumns}
              sourceRows={subjectRows}
              searchKeys={["sampleSubject"]}
              defaultSortKey="count"
              defaultSortDir="desc"
              emptyMessage="No inward subjects in this scope."
              resetPageDependency={summaryUrl}
            />
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
