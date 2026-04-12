import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ClientDataGrid } from "@/components/reports/ClientDataGrid";
import type { ReportTableColumn } from "@/components/reports/ReportDataTable";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { BellRing, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface EscalationRow {
  id: string;
  inwardId: string;
  escalatedTo: string;
  escalationReason?: string | null;
  escalatedAt: string;
  resolvedAt?: string | null;
}

const columns: ReportTableColumn[] = [
  { key: "_inward", header: "Inward", sortField: "inwardId" },
  { key: "escalatedTo", header: "Escalated to" },
  { key: "escalationReason", header: "Reason" },
  { key: "escalatedAt", header: "Escalated at" },
  { key: "resolvedAt", header: "Resolved" },
];

export default function DakEscalations() {
  const { data: list, isLoading, isError } = useQuery<EscalationRow[]>({
    queryKey: ["/api/ioms/dak/escalations"],
  });

  const sourceRows = useMemo((): Record<string, unknown>[] => {
    return (list ?? []).map((r) => ({
      id: r.id,
      inwardId: r.inwardId,
      _inward: (
        <Link href={`/correspondence/inward/${r.inwardId}`} className="text-primary hover:underline font-mono text-sm">
          {r.inwardId}
        </Link>
      ),
      escalatedTo: r.escalatedTo,
      escalationReason: r.escalationReason ?? "—",
      escalatedAt: r.escalatedAt,
      resolvedAt: r.resolvedAt ?? "—",
    }));
  }, [list]);

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "Correspondence (M-09)", href: "/correspondence/inward" }, { label: "Escalations" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Failed to load dak escalations.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Correspondence (M-09)", href: "/correspondence/inward" }, { label: "Escalations" }]}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BellRing className="h-5 w-5" />
            Dak escalations
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            SLA reminder and manual escalation records (yard-scoped). Open the inward file for context.
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
              searchKeys={["inwardId", "escalatedTo", "escalationReason", "escalatedAt", "resolvedAt"]}
              defaultSortKey="escalatedAt"
              defaultSortDir="desc"
              emptyMessage="No escalations in your scope."
            />
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
