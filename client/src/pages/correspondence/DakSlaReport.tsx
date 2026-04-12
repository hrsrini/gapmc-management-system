import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { AlertCircle, ClipboardList } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatYmdToDisplay } from "@/lib/dateFormat";
import {
  ReportDataTable,
  type ReportPagedParams,
  type ReportTableColumn,
} from "@/components/reports/ReportDataTable";
import { sliceClientReport } from "@/lib/clientReportSlice";

interface InwardRow {
  id: string;
  diaryNo?: string | null;
  receivedDate: string;
  fromParty: string;
  subject: string;
  status: string;
  assignedTo?: string | null;
  deadline?: string | null;
}

interface SlaPayload {
  asOf: string;
  count: number;
  rows: InwardRow[];
}

const columns: ReportTableColumn[] = [
  { key: "diaryNo", header: "Diary" },
  { key: "deadline", header: "Deadline", sortField: "deadlineSort" },
  { key: "fromParty", header: "From" },
  { key: "subject", header: "Subject" },
  { key: "_status", header: "Status", sortField: "status" },
  { key: "assignedTo", header: "Assigned" },
  { key: "_open", header: "" },
];

export default function DakSlaReport() {
  const [tableParams, setTableParams] = useState<ReportPagedParams>({
    page: 1,
    pageSize: 25,
    q: "",
    sortKey: "deadlineSort",
    sortDir: "asc",
  });

  const mergeParams = useCallback((next: Partial<ReportPagedParams>) => {
    setTableParams((s) => ({ ...s, ...next }));
  }, []);

  const { data, isLoading, isError } = useQuery<SlaPayload>({
    queryKey: ["/api/ioms/dak/inward/sla-overdue"],
  });

  const sourceRows = useMemo((): Record<string, unknown>[] => {
    const rows = data?.rows ?? [];
    return rows.map((r) => {
      const deadlineRaw = r.deadline?.slice(0, 10) ?? "";
      return {
        id: r.id,
        diaryNo: r.diaryNo ?? "—",
        deadline: r.deadline ? formatYmdToDisplay(r.deadline) : "—",
        deadlineSort: deadlineRaw || "9999-12-31",
        fromParty: r.fromParty,
        subject: r.subject,
        status: r.status,
        _status: <Badge variant="secondary">{r.status}</Badge>,
        assignedTo: r.assignedTo ?? "—",
        _open: (
          <Link href={`/correspondence/inward/${r.id}`} className="text-sm text-primary underline">
            Open
          </Link>
        ),
      };
    });
  }, [data?.rows]);

  const { rows, total } = useMemo(
    () =>
      sliceClientReport(sourceRows, tableParams, [
        "diaryNo",
        "deadline",
        "fromParty",
        "subject",
        "status",
        "assignedTo",
      ]),
    [sourceRows, tableParams],
  );

  const totalPages =
    tableParams.pageSize === "all" ? 1 : Math.max(1, Math.ceil(total / tableParams.pageSize));

  useEffect(() => {
    if (total > 0 && tableParams.page > totalPages) {
      setTableParams((p) => ({ ...p, page: totalPages }));
    }
  }, [total, totalPages, tableParams.page]);

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "Correspondence (M-09)", href: "/correspondence/inward" }, { label: "SLA breach report" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Failed to load SLA breach list.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Correspondence (M-09)", href: "/correspondence/inward" }, { label: "SLA breach report" }]}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5" />
            Dak SLA breach report
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Inward items with deadline on or before {data?.asOf ? formatYmdToDisplay(data.asOf) : "—"} and status other than Closed.
            Escalations are created on the hourly SLA job when{" "}
            <code className="text-xs bg-muted px-1 rounded">sla_config</code> includes M-09/DAK.
          </p>
          {data != null && (
            <p className="text-sm font-medium pt-1">
              {data.count} overdue item(s)
            </p>
          )}
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <ReportDataTable
              columns={columns}
              rows={rows}
              total={total}
              params={tableParams}
              onParamsChange={mergeParams}
              isLoading={false}
              searchPlaceholder="Search by diary no., deadline, from, subject, status, assignee…"
            />
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
