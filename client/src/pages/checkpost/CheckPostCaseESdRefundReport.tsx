import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ClientDataGrid } from "@/components/reports/ClientDataGrid";
import type { ReportTableColumn } from "@/components/reports/ReportDataTable";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { formatInr } from "@/lib/formatInr";
import { fetchApiGet } from "@/lib/queryClient";
import { AlertCircle, Download, FileBarChart, RefreshCw, Undo2 } from "lucide-react";

interface RefundRow {
  sNo: number;
  id: string;
  transactionNo: string | null;
  vehicleNumber: string | null;
  traderName: string;
  paymentMode: string | null;
  entryLocationName: string;
  originalReceiptNo: string | null;
  refundCheckPostName: string | null;
  refundReceiptId: string | null;
  refundReceiptNo: string | null;
  refundDate: string | null;
  refundAmount: number;
  securityDepositAmount: number;
  recordedAt: string | null;
  processedByName: string;
  status: string;
}

interface Reconciliation {
  from: string;
  to: string;
  totals: {
    receipts: number;
    collected: number;
    refunded: number;
    notRefunded: number;
    expiredNotRefunded: number;
    expiredNotRefundedCount: number;
    refundedCount: number;
    refundPct: number;
  };
  byCheckPost: Array<{
    checkPostId: string;
    checkPostName: string;
    receipts: number;
    collected: number;
    refunded: number;
    notRefunded: number;
    expiredNotRefunded: number;
    refundPct: number;
    duplicates: string;
  }>;
  expiredNotRefunded: Array<{
    id: string;
    receiptNo: string | null;
    transactionNo: string | null;
    vehicleNumber: string | null;
    checkPostName: string;
    securityDepositAmount: number;
    expiredAt: string | null;
  }>;
}

interface AuditDetail {
  id: string;
  caseLabel: string;
  transactionNo: string | null;
  vehicleNumber: string | null;
  securityDepositAmount: number;
  originalReceipt: {
    receiptNo: string | null;
    generatedAt: string | null;
    collectedAt: string;
    collectedBy: string | null;
    paymentMode: string | null;
  };
  refund: {
    receiptNo: string | null;
    amount: number;
    date: string | null;
    recordedAt: string | null;
    checkPostName: string | null;
    processedByName: string | null;
    paymentMode: string | null;
    timeSinceReceipt: string | null;
    netPosition: number;
    status: string;
  } | null;
  validations: {
    isCaseE: boolean;
    withinWindowAtRefund: boolean | null;
    noDuplicate: boolean;
    amountNotExceedingDeposit: boolean;
  };
}

function monthRange(d = new Date()): { from: string; to: string } {
  const y = d.getFullYear();
  const m = d.getMonth();
  const from = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  const to = new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
  return { from, to };
}

export default function CheckPostCaseESdRefundReport() {
  const { can } = useAuth();
  const canRead = can("M-04", "Read");
  const { toast } = useToast();
  const initial = monthRange();

  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [checkPostId, setCheckPostId] = useState("all");
  const [q, setQ] = useState("");
  const [applied, setApplied] = useState({
    from: initial.from,
    to: initial.to,
    checkPostId: "",
    q: "",
  });
  const [auditId, setAuditId] = useState<string | null>(null);

  const { data: yards = [] } = useQuery<Array<{ id: string; name: string; code: string }>>({
    queryKey: ["/api/yards"],
    enabled: canRead,
  });

  const { data, isLoading, isFetching, refetch } = useQuery<{ count: number; rows: RefundRow[] }>({
    queryKey: ["/api/ioms/market/transaction-wizard/case-e/refunds", applied],
    enabled: canRead,
    queryFn: async () => {
      const u = new URL("/api/ioms/market/transaction-wizard/case-e/refunds", window.location.origin);
      u.searchParams.set("from", applied.from);
      u.searchParams.set("to", applied.to);
      if (applied.checkPostId) u.searchParams.set("checkPostId", applied.checkPostId);
      if (applied.q) u.searchParams.set("q", applied.q);
      return fetchApiGet(u.pathname + u.search);
    },
  });

  const { data: recon, isLoading: reconLoading } = useQuery<Reconciliation>({
    queryKey: ["/api/ioms/market/transaction-wizard/case-e/reconciliation", applied.from, applied.to],
    enabled: canRead,
    queryFn: async () => {
      const u = new URL("/api/ioms/market/transaction-wizard/case-e/reconciliation", window.location.origin);
      u.searchParams.set("from", applied.from);
      u.searchParams.set("to", applied.to);
      return fetchApiGet(u.pathname + u.search);
    },
  });

  const { data: audit, isFetching: auditLoading } = useQuery<AuditDetail>({
    queryKey: ["/api/ioms/market/transaction-wizard/case-e/refunds", auditId, "audit"],
    enabled: Boolean(auditId),
    queryFn: () => fetchApiGet(`/api/ioms/market/transaction-wizard/case-e/refunds/${auditId}/audit`),
  });

  const columns = useMemo(
    (): ReportTableColumn[] => [
      { key: "sNo", header: "S.No." },
      { key: "refundReceiptNo", header: "Refund ref." },
      { key: "originalReceiptNo", header: "Original receipt" },
      { key: "vehicleNumber", header: "Vehicle" },
      { key: "refundCheckPostName", header: "Check post" },
      { key: "paymentMode", header: "Payment" },
      { key: "_collected", header: "Collected", sortField: "securityDepositAmount" },
      { key: "_refunded", header: "Refunded", sortField: "refundAmount" },
      { key: "refundDate", header: "Refunded on" },
      { key: "processedByName", header: "Processed by" },
      { key: "_status", header: "Status" },
      { key: "_actions", header: "" },
    ],
    [],
  );

  const gridRows = useMemo((): Record<string, unknown>[] => {
    return (data?.rows ?? []).map((r) => ({
      id: r.id,
      sNo: r.sNo,
      refundReceiptNo: r.refundReceiptNo ?? "—",
      originalReceiptNo: r.originalReceiptNo ?? "—",
      vehicleNumber: r.vehicleNumber ?? "—",
      refundCheckPostName: r.refundCheckPostName ?? "—",
      paymentMode: r.paymentMode ?? "—",
      securityDepositAmount: r.securityDepositAmount,
      refundAmount: r.refundAmount,
      refundDate: r.refundDate
        ? `${r.refundDate}${r.recordedAt ? ` ${new Date(r.recordedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}` : ""}`
        : "—",
      processedByName: r.processedByName,
      _collected: formatInr(r.securityDepositAmount),
      _refunded: formatInr(r.refundAmount),
      _status: <Badge variant="default">{r.status}</Badge>,
      _actions: (
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => setAuditId(r.id)}>
            Audit
          </Button>
          {r.refundReceiptId ? (
            <Button size="sm" variant="outline" asChild>
              <Link href={`/receipts/ioms/${r.refundReceiptId}`}>Receipt</Link>
            </Button>
          ) : null}
        </div>
      ),
    }));
  }, [data?.rows]);

  async function exportCsv() {
    try {
      const u = new URL("/api/ioms/market/transaction-wizard/case-e/refunds", window.location.origin);
      u.searchParams.set("from", applied.from);
      u.searchParams.set("to", applied.to);
      if (applied.checkPostId) u.searchParams.set("checkPostId", applied.checkPostId);
      if (applied.q) u.searchParams.set("q", applied.q);
      u.searchParams.set("format", "csv");
      const res = await fetch(u.pathname + u.search, { credentials: "include" });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `sd-refund-report-${applied.from}_${applied.to}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      toast({
        title: "Export failed",
        description: e instanceof Error ? e.message : "Could not download CSV",
        variant: "destructive",
      });
    }
  }

  if (!canRead) {
    return (
      <AppShell breadcrumbs={[{ label: "Check Post", href: "/checkpost/case-e-sd-refund" }, { label: "Refund Report" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3 text-destructive">
            <AlertCircle className="h-5 w-5" />
            M-04 Read permission required.
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell
      breadcrumbs={[
        { label: "Check Post", href: "/checkpost/inward" },
        { label: "Security Deposit Refund", href: "/checkpost/case-e-sd-refund" },
        { label: "Refund Report" },
      ]}
    >
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FileBarChart className="h-5 w-5" />
              Security Deposit Refund Report
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              All Case E SD refunds across check posts, with reconciliation against deposits collected.
            </p>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link href="/checkpost/case-e-sd-refund">
              <Undo2 className="h-4 w-4 mr-2" />
              Process refunds
            </Link>
          </Button>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="space-y-1">
              <Label>From</Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>To</Label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Check post</Label>
              <Select value={checkPostId} onValueChange={setCheckPostId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All (scoped)</SelectItem>
                  {yards.map((y) => (
                    <SelectItem key={y.id} value={y.id}>
                      {y.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Receipt / refund / vehicle</Label>
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" />
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <Button
                onClick={() => {
                  if (!from || !to || from > to) {
                    toast({ title: "Invalid date range", variant: "destructive" });
                    return;
                  }
                  setApplied({
                    from,
                    to,
                    checkPostId: checkPostId === "all" ? "" : checkPostId,
                    q: q.trim(),
                  });
                }}
              >
                Apply
              </Button>
              <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
                <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
                Refresh
              </Button>
              <Button variant="secondary" onClick={exportCsv}>
                <Download className="h-4 w-4 mr-2" />
                CSV
              </Button>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-md border p-3">
              <p className="text-xs text-muted-foreground">Refunds processed</p>
              <p className="text-2xl font-semibold">{data?.count ?? recon?.totals.refundedCount ?? "—"}</p>
            </div>
            <div className="rounded-md border p-3">
              <p className="text-xs text-muted-foreground">Total amount refunded</p>
              <p className="text-2xl font-semibold">{formatInr(recon?.totals.refunded ?? 0)}</p>
            </div>
            <div className="rounded-md border p-3">
              <p className="text-xs text-muted-foreground">Deposits collected (Case E)</p>
              <p className="text-2xl font-semibold">{formatInr(recon?.totals.collected ?? 0)}</p>
              <p className="text-xs text-muted-foreground">{recon?.totals.receipts ?? 0} receipts</p>
            </div>
            <div className="rounded-md border p-3">
              <p className="text-xs text-muted-foreground">Expired, not refunded</p>
              <p className="text-2xl font-semibold text-amber-700 dark:text-amber-400">
                {recon?.totals.expiredNotRefundedCount ?? "—"}
              </p>
              <p className="text-xs text-muted-foreground">{formatInr(recon?.totals.expiredNotRefunded ?? 0)} retained</p>
            </div>
          </div>

          {isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <ClientDataGrid
              columns={columns}
              sourceRows={gridRows}
              searchKeys={[
                "refundReceiptNo",
                "originalReceiptNo",
                "vehicleNumber",
                "refundCheckPostName",
                "processedByName",
              ]}
              searchPlaceholder="Filter refunds…"
              defaultSortKey="refundDate"
              defaultSortDir="desc"
              emptyMessage="No SD refunds in this range."
            />
          )}

          <div className="space-y-3">
            <h3 className="font-medium">Financial reconciliation by check post</h3>
            <p className="text-sm text-muted-foreground">
              Security Deposits collected under Case E versus refunds processed ({applied.from} – {applied.to}).
            </p>
            {reconLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-left">
                    <tr>
                      <th className="p-2">Check post</th>
                      <th className="p-2">Receipts</th>
                      <th className="p-2">Collected</th>
                      <th className="p-2">Refunded</th>
                      <th className="p-2">Not refunded</th>
                      <th className="p-2">%</th>
                      <th className="p-2">Duplicates</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(recon?.byCheckPost ?? []).map((r) => (
                      <tr key={r.checkPostId} className="border-t">
                        <td className="p-2">{r.checkPostName}</td>
                        <td className="p-2">{r.receipts}</td>
                        <td className="p-2">{formatInr(r.collected)}</td>
                        <td className="p-2">{formatInr(r.refunded)}</td>
                        <td className="p-2">{formatInr(r.notRefunded)}</td>
                        <td className="p-2">{r.refundPct}%</td>
                        <td className="p-2">{r.duplicates}</td>
                      </tr>
                    ))}
                    {recon?.totals ? (
                      <tr className="border-t font-medium bg-muted/20">
                        <td className="p-2">All check posts</td>
                        <td className="p-2">{recon.totals.receipts}</td>
                        <td className="p-2">{formatInr(recon.totals.collected)}</td>
                        <td className="p-2">{formatInr(recon.totals.refunded)}</td>
                        <td className="p-2">{formatInr(recon.totals.notRefunded)}</td>
                        <td className="p-2">{recon.totals.refundPct}%</td>
                        <td className="p-2">None</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {(recon?.expiredNotRefunded?.length ?? 0) > 0 && (
            <div className="space-y-2">
              <h3 className="font-medium">Not refunded – validity expired</h3>
              <p className="text-sm text-muted-foreground">
                Receipts that passed the 8-hour window with no refund processed.
              </p>
              <ul className="grid gap-2 sm:grid-cols-2">
                {recon!.expiredNotRefunded.map((e) => (
                  <li key={e.id} className="rounded-md border p-3 text-sm">
                    <p className="font-mono font-medium">{e.receiptNo ?? e.transactionNo ?? e.id}</p>
                    <p className="text-muted-foreground">
                      {e.vehicleNumber ?? "—"} · {e.checkPostName}
                    </p>
                    <p>
                      {formatInr(e.securityDepositAmount)} ·{" "}
                      <Badge variant="outline">Expired</Badge>
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={Boolean(auditId)} onOpenChange={(o) => !o && setAuditId(null)}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Refund audit record</DialogTitle>
          </DialogHeader>
          {auditLoading || !audit ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <div className="space-y-4 text-sm">
              <div className="flex flex-wrap gap-2">
                <Badge>{audit.refund?.status ?? "Open"}</Badge>
                <span className="font-mono">{audit.refund?.receiptNo ?? "—"}</span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <p className="text-muted-foreground">Original receipt</p>
                  <p className="font-mono">{audit.originalReceipt.receiptNo ?? "—"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Net position</p>
                  <p>
                    {formatInr(audit.securityDepositAmount)} collected − {formatInr(audit.refund?.amount ?? 0)}{" "}
                    refunded = {formatInr(audit.refund?.netPosition ?? audit.securityDepositAmount)}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Collected at</p>
                  <p>
                    {audit.originalReceipt.collectedAt} · {audit.originalReceipt.collectedBy ?? "—"}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Refunded at</p>
                  <p>
                    {audit.refund?.checkPostName ?? "—"} · {audit.refund?.processedByName ?? "—"}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Date &amp; time of refund</p>
                  <p>
                    {audit.refund?.recordedAt
                      ? new Date(audit.refund.recordedAt).toLocaleString("en-IN")
                      : audit.refund?.date ?? "—"}
                  </p>
                  {audit.refund?.timeSinceReceipt ? (
                    <p className="text-xs text-muted-foreground">{audit.refund.timeSinceReceipt}</p>
                  ) : null}
                </div>
                <div>
                  <p className="text-muted-foreground">Vehicle</p>
                  <p>{audit.vehicleNumber ?? "—"}</p>
                </div>
              </div>
              <div>
                <p className="font-medium mb-1">Validation checks</p>
                <ul className="space-y-1 text-xs">
                  <li>Case E – Transit through Goa: {audit.validations.isCaseE ? "Passed" : "Failed"}</li>
                  <li>
                    Within 8 hours:{" "}
                    {audit.validations.withinWindowAtRefund == null
                      ? "—"
                      : audit.validations.withinWindowAtRefund
                        ? "Passed"
                        : "Failed"}
                  </li>
                  <li>Linked / no duplicate: {audit.validations.noDuplicate ? "Passed" : "—"}</li>
                  <li>
                    Amount ≤ deposit: {audit.validations.amountNotExceedingDeposit ? "Passed" : "Failed"}
                  </li>
                </ul>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
