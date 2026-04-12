import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ClientDataGrid } from "@/components/reports/ClientDataGrid";
import type { ReportTableColumn } from "@/components/reports/ReportDataTable";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Briefcase, AlertCircle } from "lucide-react";

interface RecruitmentRow {
  id: string;
  position: string;
  applicantName: string;
  qualification?: string | null;
  appliedDate: string;
  status: string;
  decision?: string | null;
}

const columns: ReportTableColumn[] = [
  { key: "position", header: "Position" },
  { key: "applicantName", header: "Applicant" },
  { key: "qualification", header: "Qualification" },
  { key: "appliedDate", header: "Applied" },
  { key: "_status", header: "Status", sortField: "status" },
  { key: "decision", header: "Decision" },
];

export default function HrRecruitment() {
  const { data: list, isLoading, isError } = useQuery<RecruitmentRow[]>({
    queryKey: ["/api/hr/recruitment"],
  });

  const sourceRows = useMemo((): Record<string, unknown>[] => {
    return (list ?? []).map((r) => ({
      id: r.id,
      position: r.position,
      applicantName: r.applicantName,
      qualification: r.qualification ?? "—",
      appliedDate: r.appliedDate.slice(0, 10),
      status: r.status,
      _status: <Badge variant="secondary">{r.status}</Badge>,
      decision: r.decision ?? "—",
    }));
  }, [list]);

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "HR", href: "/hr/recruitment" }, { label: "Recruitment" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Failed to load recruitment.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "HR", href: "/hr/recruitment" }, { label: "Recruitment" }]}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Briefcase className="h-5 w-5" />
            Recruitment (M-01 HRMS)
          </CardTitle>
          <p className="text-sm text-muted-foreground">Job applications and interview outcomes.</p>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <ClientDataGrid
              columns={columns}
              sourceRows={sourceRows}
              searchKeys={["position", "applicantName", "qualification", "appliedDate", "status", "decision"]}
              defaultSortKey="appliedDate"
              defaultSortDir="desc"
              emptyMessage="No recruitment entries."
            />
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
