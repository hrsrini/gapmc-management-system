import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ClientDataGrid } from "@/components/reports/ClientDataGrid";
import type { ReportTableColumn } from "@/components/reports/ReportDataTable";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { Inbox, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Inward {
  id: string;
  diaryNo?: string | null;
  receivedDate: string;
  fromParty: string;
  subject: string;
  modeOfReceipt: string;
  status: string;
  assignedTo?: string | null;
  deadline?: string | null;
}

const LIST_URL = "/api/ioms/dak/inward?assignedToMe=1";

const columns: ReportTableColumn[] = [
  { key: "_diary", header: "Diary No", sortField: "diarySort" },
  { key: "receivedDate", header: "Received" },
  { key: "fromParty", header: "From" },
  { key: "subject", header: "Subject" },
  { key: "assignedTo", header: "Assigned" },
  { key: "deadline", header: "Deadline" },
  { key: "_status", header: "Status", sortField: "status" },
];

export default function DakMyPending() {
  const { data: list, isLoading, isError } = useQuery<Inward[]>({
    queryKey: [LIST_URL],
  });

  const sourceRows = useMemo((): Record<string, unknown>[] => {
    return (list ?? []).map((d) => ({
      id: d.id,
      diarySort: d.diaryNo ?? d.id,
      _diary: (
        <Link href={`/correspondence/inward/${d.id}`} className="text-primary hover:underline font-mono text-sm">
          {d.diaryNo ?? d.id}
        </Link>
      ),
      receivedDate: d.receivedDate.slice(0, 10),
      fromParty: d.fromParty,
      subject: d.subject,
      assignedTo: d.assignedTo ?? "—",
      deadline: d.deadline ? d.deadline.slice(0, 10) : "—",
      status: d.status,
      _status: <Badge variant="secondary">{d.status}</Badge>,
    }));
  }, [list]);

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "Correspondence (M-09)", href: "/correspondence/inward" }, { label: "My pending" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Failed to load assigned inward dak.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Correspondence (M-09)", href: "/correspondence/inward" }, { label: "My pending" }]}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Inbox className="h-5 w-5" />
            My pending dak (assigned to me)
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Open inward items assigned to your user id, email, or display name (excludes Closed).
          </p>
          <div className="pt-2">
            <Button variant="outline" size="sm" asChild>
              <Link href="/correspondence/inward">All inward</Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <ClientDataGrid
              columns={columns}
              sourceRows={sourceRows}
              searchKeys={["diarySort", "receivedDate", "fromParty", "subject", "assignedTo", "deadline", "status"]}
              defaultSortKey="receivedDate"
              defaultSortDir="desc"
              emptyMessage="No pending items assigned to you."
            />
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
