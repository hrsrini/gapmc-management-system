import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ClientDataGrid } from "@/components/reports/ClientDataGrid";
import type { ReportTableColumn } from "@/components/reports/ReportDataTable";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { FileCheck, AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface AmcContract {
  id: string;
  yardId: string;
  contractorName: string;
  description?: string | null;
  amountPerPeriod: number;
  periodType?: string | null;
  contractStart: string;
  contractEnd: string;
  status: string;
  daUser?: string | null;
}
interface Yard {
  id: string;
  code?: string | null;
  name?: string | null;
}

interface AmcRenewalAlert {
  contractId: string;
  contractorName: string;
  contractEnd: string;
  daysRemaining: number;
  urgency: "overdue" | "30d" | "60d";
}

export default function ConstructionAmc() {
  const [yardId, setYardId] = useState("all");

  const params = new URLSearchParams();
  if (yardId && yardId !== "all") params.set("yardId", yardId);
  const url = params.toString() ? `/api/ioms/amc?${params.toString()}` : "/api/ioms/amc";

  const { data: list = [], isLoading, isError } = useQuery<AmcContract[]>({ queryKey: [url] });
  const { data: yards = [] } = useQuery<Yard[]>({ queryKey: ["/api/yards"] });
  const yardById = useMemo(() => new Map(yards.map((y) => [y.id, y.name ?? y.code ?? y.id])), [yards]);

  const columns = useMemo(
    (): ReportTableColumn[] => [
      { key: "yardName", header: "Yard" },
      { key: "contractorName", header: "Contractor" },
      { key: "periodType", header: "Period type" },
      { key: "contractStart", header: "Start" },
      { key: "contractEnd", header: "End" },
      { key: "_amountPerPeriod", header: "Amount/period", sortField: "amountPerPeriod" },
      { key: "_status", header: "Status", sortField: "status" },
    ],
    [],
  );

  const sourceRows = useMemo((): Record<string, unknown>[] => {
    return list.map((a) => ({
      id: a.id,
      yardName: yardById.get(a.yardId) ?? a.yardId,
      contractorName: a.contractorName,
      periodType: a.periodType ?? "—",
      contractStart: a.contractStart.slice(0, 10),
      contractEnd: a.contractEnd.slice(0, 10),
      amountPerPeriod: a.amountPerPeriod,
      _amountPerPeriod: `₹${a.amountPerPeriod.toLocaleString()}`,
      status: a.status,
      _status: <Badge variant="secondary">{a.status}</Badge>,
    }));
  }, [list, yardById]);

  const alertsUrl =
    yardId && yardId !== "all"
      ? `/api/ioms/amc/renewal-alerts?yardId=${encodeURIComponent(yardId)}`
      : "/api/ioms/amc/renewal-alerts";
  const { data: amcAlertsPayload } = useQuery<{ alerts: AmcRenewalAlert[] }>({ queryKey: [alertsUrl] });
  const amcAlerts = amcAlertsPayload?.alerts ?? [];
  const overdueAmc = amcAlerts.filter((a) => a.urgency === "overdue").length;

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "Construction (M-08)", href: "/construction" }, { label: "AMC" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Failed to load AMC contracts.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Construction (M-08)", href: "/construction" }, { label: "AMC contracts" }]}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileCheck className="h-5 w-5" />
            AMC contracts
          </CardTitle>
          <p className="text-sm text-muted-foreground">Annual / periodic maintenance contracts by yard.</p>
          {amcAlerts.length > 0 && (
            <Alert variant={overdueAmc > 0 ? "destructive" : "default"} className="mt-3">
              <AlertTitle>Contract end reminders</AlertTitle>
              <AlertDescription>
                {amcAlerts.length} active AMC contract(s) ending within 60 days or overdue
                {overdueAmc > 0 ? ` (${overdueAmc} overdue).` : "."}
              </AlertDescription>
            </Alert>
          )}
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
              searchKeys={["yardName", "contractorName", "periodType", "contractStart", "contractEnd", "status"]}
              defaultSortKey="contractEnd"
              defaultSortDir="desc"
              emptyMessage="No AMC contracts."
              resetPageDependency={url}
            />
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
