import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ClientDataGrid } from "@/components/reports/ClientDataGrid";
import type { ReportTableColumn } from "@/components/reports/ReportDataTable";
import { Skeleton } from "@/components/ui/skeleton";
import { Bug, PlusCircle, LayoutDashboard, AlertCircle } from "lucide-react";
import { BUG_STATUSES } from "@shared/bug-taxonomy";
import { bugsListQueryKey, bugsListUrl } from "@/lib/bugsQueryKeys";
import { fetchApiGet } from "@/lib/queryClient";

interface BugRow {
  id: string;
  ticketNo: string;
  title: string;
  bugType: string;
  bugSubtype: string;
  severity: string;
  status: string;
  reporterUserId: string;
  reporterName: string;
  assignedToUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

function severityVariant(s: string): "default" | "secondary" | "destructive" | "outline" {
  if (s === "critical") return "destructive";
  if (s === "high") return "destructive";
  if (s === "medium") return "secondary";
  return "outline";
}

export default function BugList() {
  const [scope, setScope] = useState<"all" | "mine">("all");
  const [status, setStatus] = useState<string>("");
  const { data: list, isLoading, isError, error } = useQuery<BugRow[]>({
    queryKey: bugsListQueryKey(scope, status),
    queryFn: async ({ queryKey }) => {
      const [, , sc, st] = queryKey as readonly [string, string, "all" | "mine", string];
      const url = bugsListUrl(sc, st === "any" ? "" : st);
      return fetchApiGet<BugRow[]>(url);
    },
  });

  const columns = useMemo(
    (): ReportTableColumn[] => [
      { key: "_ticketNo", header: "Ticket", sortField: "ticketNo" },
      { key: "title", header: "Title" },
      { key: "typeSubtype", header: "Type" },
      { key: "_severity", header: "Severity", sortField: "severity" },
      { key: "reporterName", header: "Reporter" },
      { key: "_status", header: "Status", sortField: "status" },
      { key: "createdAt", header: "Created" },
    ],
    [],
  );

  const sourceRows = useMemo((): Record<string, unknown>[] => {
    return (list ?? []).map((b) => ({
      id: b.id,
      ticketNo: b.ticketNo,
      _ticketNo: (
        <Link href={`/bugs/${b.id}`} className="text-primary hover:underline font-mono text-sm">
          {b.ticketNo}
        </Link>
      ),
      title: b.title,
      typeSubtype: `${b.bugType} / ${b.bugSubtype}`,
      severity: b.severity,
      _severity: <Badge variant={severityVariant(b.severity)}>{b.severity}</Badge>,
      reporterName: b.reporterName,
      status: b.status,
      _status: <Badge variant="secondary">{b.status.replace(/_/g, " ")}</Badge>,
      createdAt: b.createdAt,
    }));
  }, [list]);

  const filterKey = `${scope}|${status || "any"}`;

  return (
    <AppShell
      breadcrumbs={[
        { label: "Bugs", href: "/bugs" },
        { label: "All tickets" },
      ]}
    >
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            <Bug className="h-5 w-5" />
            Bug tickets
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Everyone can see all reported bugs. You can add comments only on tickets you created.
          </p>
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <Button asChild variant="default" size="sm">
              <Link href="/bugs/new">
                <PlusCircle className="h-4 w-4 mr-2" />
                Report bug
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/bugs/dashboard">
                <LayoutDashboard className="h-4 w-4 mr-2" />
                Dashboard
              </Link>
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-4 pt-4">
            <Tabs
              value={scope}
              onValueChange={(v) => setScope(v === "mine" ? "mine" : "all")}
            >
              <TabsList>
                <TabsTrigger value="all">All bugs</TabsTrigger>
                <TabsTrigger value="mine">My bugs</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="w-[min(100%,220px)] min-w-[180px]">
              <Select
                value={status || "any"}
                onValueChange={(v) => setStatus(v === "any" ? "" : v)}
              >
                <SelectTrigger aria-label="Filter by status">
                  <SelectValue placeholder="Any status" />
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectItem value="any">Any status</SelectItem>
                  {BUG_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-xs text-muted-foreground pt-1">
            Showing:{" "}
            <span className="font-medium text-foreground">
              {scope === "mine" ? "My bugs" : "All bugs"}
            </span>
            {" · "}
            <span className="font-medium text-foreground">
              {status ? status.replace(/_/g, " ") : "Any status"}
            </span>
          </p>
        </CardHeader>
        <CardContent>
          {isError && (
            <div className="flex items-start gap-2 text-destructive text-sm py-4 rounded-md border border-destructive/30 bg-destructive/5 px-3">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>
                Failed to load bugs.
                {error instanceof Error && error.message ? (
                  <span className="block mt-1 font-mono text-xs opacity-90 break-all">{error.message}</span>
                ) : null}
              </span>
            </div>
          )}
          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <ClientDataGrid
              columns={columns}
              sourceRows={sourceRows}
              searchKeys={["ticketNo", "title", "typeSubtype", "reporterName", "severity", "status"]}
              defaultSortKey="createdAt"
              defaultSortDir="desc"
              emptyMessage="No bugs match the current filters."
              resetPageDependency={filterKey}
            />
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
