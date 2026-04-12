import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ClientDataGrid } from "@/components/reports/ClientDataGrid";
import type { ReportTableColumn } from "@/components/reports/ReportDataTable";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Bug, List, AlertCircle, LayoutDashboard } from "lucide-react";

interface RecentRow {
  id: string;
  ticketNo: string;
  title: string;
  status: string;
  severity: string;
  reporterName?: string;
  createdAt: string;
}

interface DashboardData {
  isAdmin: boolean;
  statusAll: Record<string, number>;
  severityAll: Record<string, number>;
  statusMine: Record<string, number>;
  severityMine: Record<string, number>;
  recentAll: RecentRow[];
  recentMine: RecentRow[];
  unassignedOpen?: number;
}

function toChartData(obj: Record<string, number>) {
  return Object.entries(obj).map(([name, count]) => ({
    name: name.replace(/_/g, " "),
    count,
  }));
}

const recentAllColumns: ReportTableColumn[] = [
  { key: "_ticketNo", header: "Ticket", sortField: "ticketNo" },
  { key: "title", header: "Title" },
  { key: "reporterName", header: "Reporter" },
  { key: "_severity", header: "Severity", sortField: "severity" },
  { key: "_status", header: "Status", sortField: "status" },
];

const recentMineColumns: ReportTableColumn[] = [
  { key: "_ticketNo", header: "Ticket", sortField: "ticketNo" },
  { key: "title", header: "Title" },
  { key: "_severity", header: "Severity", sortField: "severity" },
  { key: "_status", header: "Status", sortField: "status" },
];

export default function BugDashboard() {
  const { data, isLoading, isError, error } = useQuery<DashboardData>({
    queryKey: ["/api/bugs/dashboard"],
  });

  const recentAllRows = useMemo((): Record<string, unknown>[] => {
    if (!data) return [];
    return data.recentAll.map((r) => ({
      id: r.id,
      ticketNo: r.ticketNo,
      _ticketNo: (
        <Link href={`/bugs/${r.id}`} className="text-primary hover:underline font-mono text-sm">
          {r.ticketNo}
        </Link>
      ),
      title: r.title,
      reporterName: r.reporterName ?? "—",
      severity: r.severity,
      _severity: <Badge variant="outline">{r.severity}</Badge>,
      status: r.status,
      _status: <Badge variant="secondary">{r.status.replace(/_/g, " ")}</Badge>,
    }));
  }, [data]);

  const recentMineRows = useMemo((): Record<string, unknown>[] => {
    if (!data) return [];
    return data.recentMine.map((r) => ({
      id: r.id,
      ticketNo: r.ticketNo,
      _ticketNo: (
        <Link href={`/bugs/${r.id}`} className="text-primary hover:underline font-mono text-sm">
          {r.ticketNo}
        </Link>
      ),
      title: r.title,
      severity: r.severity,
      _severity: <Badge variant="outline">{r.severity}</Badge>,
      status: r.status,
      _status: <Badge variant="secondary">{r.status.replace(/_/g, " ")}</Badge>,
    }));
  }, [data]);

  return (
    <AppShell
      breadcrumbs={[
        { label: "Bugs", href: "/bugs" },
        { label: "Dashboard" },
      ]}
    >
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <LayoutDashboard className="h-6 w-6" />
            Bug dashboard
          </h1>
          <Button asChild variant="outline" size="sm">
            <Link href="/bugs">
              <List className="h-4 w-4 mr-2" />
              Ticket list
            </Link>
          </Button>
        </div>

        {isError && (
          <Card className="border-destructive/30 bg-destructive/5">
            <CardContent className="flex items-start gap-2 py-4 text-destructive text-sm">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>
                Failed to load dashboard.
                {error instanceof Error && error.message ? (
                  <span className="block mt-1 font-mono text-xs opacity-90 break-all">{error.message}</span>
                ) : null}
              </span>
            </CardContent>
          </Card>
        )}

        {isLoading && <Skeleton className="h-[480px] w-full" />}

        {data && (
          <>
            {data.isAdmin && data.unassignedOpen !== undefined && (
              <Card className="border-amber-200/80 bg-amber-50/50 dark:bg-amber-950/20">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Admin — triage</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm">
                    <span className="font-semibold">{data.unassignedOpen}</span> open ticket
                    {data.unassignedOpen === 1 ? "" : "s"} with no assignee.
                  </p>
                </CardContent>
              </Card>
            )}

            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">All tickets — by status</CardTitle>
                </CardHeader>
                <CardContent className="h-[220px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={toChartData(data.statusAll)}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">All tickets — by severity</CardTitle>
                </CardHeader>
                <CardContent className="h-[220px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={toChartData(data.severityAll)}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Bar dataKey="count" fill="hsl(var(--chart-2))" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">My tickets — by status</CardTitle>
                </CardHeader>
                <CardContent className="h-[220px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={toChartData(data.statusMine)}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Bar dataKey="count" fill="hsl(var(--chart-3))" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">My tickets — by severity</CardTitle>
                </CardHeader>
                <CardContent className="h-[220px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={toChartData(data.severityMine)}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Bar dataKey="count" fill="hsl(var(--chart-4))" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Bug className="h-4 w-4" />
                  Recent — all users
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ClientDataGrid
                  columns={recentAllColumns}
                  sourceRows={recentAllRows}
                  searchKeys={["ticketNo", "title", "reporterName", "severity", "status"]}
                  defaultSortKey="ticketNo"
                  defaultSortDir="desc"
                  emptyMessage="No tickets yet."
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Recent — reported by me</CardTitle>
              </CardHeader>
              <CardContent>
                <ClientDataGrid
                  columns={recentMineColumns}
                  sourceRows={recentMineRows}
                  searchKeys={["ticketNo", "title", "severity", "status"]}
                  defaultSortKey="ticketNo"
                  defaultSortDir="desc"
                  emptyMessage="You have not reported any bugs yet."
                />
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppShell>
  );
}
