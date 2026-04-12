import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ClientDataGrid } from "@/components/reports/ClientDataGrid";
import type { ReportTableColumn } from "@/components/reports/ReportDataTable";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { useAuth } from "@/context/AuthContext";
import { Send, AlertCircle, PlusCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Outward {
  id: string;
  despatchNo?: string | null;
  despatchDate: string;
  toParty: string;
  subject: string;
  modeOfDespatch: string;
  toAddress?: string | null;
  inwardRefId?: string | null;
  despatchedBy?: string | null;
}

export default function DakOutward() {
  const { data: list, isLoading, isError } = useQuery<Outward[]>({
    queryKey: ["/api/ioms/dak/outward"],
  });

  const columns = useMemo(
    (): ReportTableColumn[] => [
      { key: "despatchNo", header: "Despatch No" },
      { key: "despatchDate", header: "Date" },
      { key: "toParty", header: "To" },
      { key: "subject", header: "Subject" },
      { key: "modeOfDespatch", header: "Mode" },
      { key: "despatchedBy", header: "Despatched by" },
      { key: "inwardRefId", header: "Inward ref" },
    ],
    [],
  );

  const sourceRows = useMemo((): Record<string, unknown>[] => {
    return (list ?? []).map((d) => ({
      id: d.id,
      despatchNo: d.despatchNo ?? "—",
      despatchDate: d.despatchDate.slice(0, 10),
      toParty: d.toParty,
      subject: d.subject,
      modeOfDespatch: d.modeOfDespatch,
      despatchedBy: d.despatchedBy ?? "—",
      inwardRefId: d.inwardRefId ?? "—",
    }));
  }, [list]);

  const { can } = useAuth();
  const canCreate = can("M-09", "Create");

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "Correspondence (M-09)", href: "/correspondence/outward" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Failed to load outward dak.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Correspondence (M-09)", href: "/correspondence/outward" }]}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Send className="h-5 w-5" />
            Dak Outward (IOMS M-09)
          </CardTitle>
          <p className="text-sm text-muted-foreground">Outward correspondence — despatch no, to party, subject, mode.</p>
          {canCreate && (
            <div className="pt-2">
              <Button asChild size="sm">
                <Link href="/correspondence/outward/new"><PlusCircle className="h-4 w-4 mr-2" />Add outward</Link>
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <ClientDataGrid
              columns={columns}
              sourceRows={sourceRows}
              searchKeys={["despatchNo", "despatchDate", "toParty", "subject", "modeOfDespatch", "despatchedBy", "inwardRefId"]}
              defaultSortKey="despatchDate"
              defaultSortDir="desc"
              emptyMessage="No outward dak."
            />
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
