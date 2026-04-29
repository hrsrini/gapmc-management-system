import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ClientDataGrid } from "@/components/reports/ClientDataGrid";
import type { ReportTableColumn } from "@/components/reports/ReportDataTable";
import { AlertCircle, RefreshCcw, Receipt, CircleCheck, XCircle } from "lucide-react";
import { Link } from "wouter";
import { useAuth } from "@/context/AuthContext";

type GatewayLogStatus = "Initiated" | "Paid" | "Failed" | "Reconciled";

interface ReconciliationResponse {
  gatewayLogCount: number;
  receiptCount: number;
  matched: { logId: string; receiptId: string }[];
  unmatchedLogs: Array<{
    id: string;
    receiptId: string;
    gateway: string;
    gatewayTxnId?: string | null;
    status: GatewayLogStatus | string;
    amount: number;
    createdAt: string;
  }>;
}

export default function IomsReceiptReconciliation() {
  const { can } = useAuth();
  const canRead = can("M-05", "Read");

  const unmatchedColumns = useMemo(
    (): ReportTableColumn[] => [
      { key: "_status", header: "Status", sortField: "status" },
      { key: "gatewayTxnId", header: "Gateway txn" },
      { key: "_receipt", header: "Receipt ID", sortField: "receiptId" },
      { key: "_amount", header: "Amount", sortField: "amount" },
      { key: "createdAt", header: "Created" },
    ],
    [],
  );

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<ReconciliationResponse>({
    queryKey: ["/api/ioms/receipts/reconciliation"],
    queryFn: async () => {
      const res = await fetch("/api/ioms/receipts/reconciliation", { credentials: "include" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? res.statusText);
      }
      return (await res.json()) as ReconciliationResponse;
    },
  });

  const errorMessage = error instanceof Error ? error.message : "Unknown error";

  const unmatchedRows = useMemo((): Record<string, unknown>[] => {
    if (!data) return [];
    return data.unmatchedLogs.map((log) => ({
      id: log.id,
      status: log.status,
      _status: (
        <Badge
          variant={
            log.status === "Paid" ? "default" : log.status === "Failed" ? "destructive" : "secondary"
          }
        >
          {log.status}
        </Badge>
      ),
      gatewayTxnId: log.gatewayTxnId ?? "—",
      receiptId: log.receiptId,
      _receipt: (
        <Link href={`/receipts/ioms/${log.receiptId}`} className="text-primary hover:underline font-mono text-xs">
          {log.receiptId.slice(0, 10)}…
        </Link>
      ),
      amount: log.amount,
      _amount: `₹${Number(log.amount).toLocaleString("en-IN")}`,
      createdAt: log.createdAt,
    }));
  }, [data]);

  if (!canRead) {
    return (
      <AppShell breadcrumbs={[{ label: "Receipts", href: "/receipts" }, { label: "Reconciliation" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Access denied.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Receipts", href: "/receipts" }, { label: "IOMS Reconciliation" }]}>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Receipt className="h-5 w-5" />
              IOMS Receipt Reconciliation (M-05)
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Compares recent payment gateway logs with receipts for status `Paid`.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCcw className="h-4 w-4 mr-1" />
              Refresh
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {isLoading ? (
            <Skeleton className="h-72 w-full" />
          ) : isError ? (
            <div className="bg-destructive/10 border border-destructive/20 rounded-md p-4 flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-destructive mt-0.5" />
              <div className="space-y-1">
                <div className="font-medium text-destructive">Failed to load reconciliation</div>
                <div className="text-sm text-muted-foreground">{errorMessage}</div>
                <div className="text-sm text-muted-foreground">Try again with Refresh.</div>
              </div>
            </div>
          ) : !data ? (
            <div className="text-sm text-muted-foreground py-6">No data.</div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="p-3 rounded-md border bg-background">
                  <div className="text-xs text-muted-foreground">Gateway log entries</div>
                  <div className="text-2xl font-semibold">{data.gatewayLogCount}</div>
                </div>
                <div className="p-3 rounded-md border bg-background">
                  <div className="text-xs text-muted-foreground">Receipts fetched</div>
                  <div className="text-2xl font-semibold">{data.receiptCount}</div>
                </div>
                <div className="p-3 rounded-md border bg-background">
                  <div className="text-xs text-muted-foreground">Matched (Paid receipts)</div>
                  <div className="text-2xl font-semibold flex items-center gap-2">
                    <CircleCheck className="h-5 w-5 text-green-600" />
                    {data.matched.length}
                  </div>
                </div>
                <div className="p-3 rounded-md border bg-background">
                  <div className="text-xs text-muted-foreground">Unmatched logs (preview)</div>
                  <div className="text-2xl font-semibold flex items-center gap-2">
                    <XCircle className="h-5 w-5 text-destructive" />
                    {data.unmatchedLogs.length}
                  </div>
                </div>
              </div>

              <Card className="shadow-none border-dashed">
                <CardHeader>
                  <CardTitle className="text-base">Unmatched gateway logs</CardTitle>
                  <p className="text-sm text-muted-foreground">Showing up to 50 most recent logs.</p>
                </CardHeader>
                <CardContent className="pt-0">
                  {data.unmatchedLogs.length === 0 ? (
                    <div className="text-sm text-muted-foreground py-6 text-center">No unmatched logs in this window.</div>
                  ) : (
                    <ClientDataGrid
                      columns={unmatchedColumns}
                      sourceRows={unmatchedRows}
                      searchKeys={["status", "gatewayTxnId", "receiptId"]}
                      defaultSortKey="createdAt"
                      defaultSortDir="desc"
                      emptyMessage="No unmatched logs."
                      resetPageDependency={data.unmatchedLogs.length}
                    />
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}

