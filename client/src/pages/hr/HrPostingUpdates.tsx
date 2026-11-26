import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ClientDataGrid } from "@/components/reports/ClientDataGrid";
import type { ReportTableColumn } from "@/components/reports/ReportDataTable";
import { useAuth } from "@/context/AuthContext";
import { formatApiDateOrDateTime, formatYmdToDisplay } from "@/lib/dateFormat";
import {
  isPostingChangeType,
  postingChangeTypeLabel,
  type PostingChangeType,
} from "@shared/hr-posting-update";
import { MapPin } from "lucide-react";

type EmpHeader = {
  id: string;
  empId: string | null;
  name: string;
  designation: string;
};

type PostingUpdateListRow = {
  id: string;
  requestNo: string;
  employeeId: string;
  changeType: string;
  effectiveFrom: string;
  status: string;
  submittedAt: string | null;
  employee: EmpHeader | null;
  awaitingMyAction?: boolean;
};

type ListFilter = "pending" | "mine" | "all";

function statusBadgeVariant(
  status: string,
): "default" | "secondary" | "outline" | "destructive" {
  if (status === "Approved") return "default";
  if (status === "Rejected") return "destructive";
  if (status === "ReturnedToDO") return "outline";
  return "secondary";
}

export default function HrPostingUpdates() {
  const { can } = useAuth();
  const canRead = can("M-01", "Read");
  const [filter, setFilter] = useState<ListFilter>("pending");

  const listUrl = useMemo(() => {
    if (filter === "pending") return "/api/hr/posting-updates?pendingMyAction=1";
    if (filter === "mine") return "/api/hr/posting-updates?mine=1";
    return "/api/hr/posting-updates";
  }, [filter]);

  const { data: list = [], isLoading } = useQuery<PostingUpdateListRow[]>({
    queryKey: [listUrl],
    enabled: canRead,
  });

  const columns: ReportTableColumn[] = useMemo(
    () => [
      { key: "requestNo", header: "Request no." },
      { key: "employeeLabel", header: "Employee" },
      { key: "changeLabel", header: "Change" },
      { key: "effectiveFromDisp", header: "Effective from", sortField: "effectiveFrom" },
      { key: "_status", header: "Status", sortField: "status" },
      { key: "submittedDisp", header: "Submitted", sortField: "submittedAt" },
      { key: "_link", header: "" },
    ],
    [],
  );

  const sourceRows = useMemo((): Record<string, unknown>[] => {
    return list.map((r) => {
      const emp = r.employee;
      const employeeLabel = emp
        ? `${emp.name}${emp.empId ? ` (${emp.empId})` : ""}`
        : r.employeeId;
      const changeLabel = isPostingChangeType(r.changeType)
        ? postingChangeTypeLabel(r.changeType as PostingChangeType)
        : r.changeType;
      return {
        id: r.id,
        requestNo: r.requestNo,
        employeeLabel,
        changeLabel,
        effectiveFrom: r.effectiveFrom,
        effectiveFromDisp: formatYmdToDisplay(r.effectiveFrom),
        status: r.status,
        submittedAt: r.submittedAt ?? "",
        submittedDisp: r.submittedAt ? formatApiDateOrDateTime(r.submittedAt) : "—",
        _status: <Badge variant={statusBadgeVariant(r.status)}>{r.status}</Badge>,
        _link: (
          <Button size="sm" variant="outline" asChild>
            <Link href={`/hr/posting-updates/${r.id}`}>Open</Link>
          </Button>
        ),
      };
    });
  }, [list]);

  if (!canRead) {
    return (
      <AppShell breadcrumbs={[{ label: "HR", href: "/hr/employees" }, { label: "Posting updates" }]}>
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            You need M-01 Read permission to view posting updates.
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "HR", href: "/hr/employees" }, { label: "Posting updates" }]}>
      <Card>
        <CardHeader className="space-y-3">
          <CardTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5" />
            Posting updates
          </CardTitle>
          <Tabs value={filter} onValueChange={(v) => setFilter(v as ListFilter)}>
            <TabsList>
              <TabsTrigger value="pending">Pending my action</TabsTrigger>
              <TabsTrigger value="mine">My requests</TabsTrigger>
              <TabsTrigger value="all">All</TabsTrigger>
            </TabsList>
          </Tabs>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <ClientDataGrid
              columns={columns}
              sourceRows={sourceRows}
              searchKeys={["requestNo", "employeeLabel", "changeLabel", "status"]}
              searchPlaceholder="Search posting updates…"
              defaultSortKey="submittedAt"
              defaultSortDir="desc"
              resetPageDependency={listUrl}
              emptyMessage="No posting updates."
            />
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
