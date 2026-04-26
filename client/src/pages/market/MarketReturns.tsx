import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { ClipboardList, AlertCircle, SendHorizontal } from "lucide-react";
import { ClientDataGrid } from "@/components/reports/ClientDataGrid";
import type { ReportTableColumn } from "@/components/reports/ReportDataTable";

type ReturnStatus = "Draft" | "Submitted" | "Verified" | "Approved";

interface TraderLicenceRef {
  id: string;
  licenceNo?: string | null;
  firmName?: string | null;
  yardId: string;
  status?: string | null;
}

interface ReturnRow {
  id: string;
  traderLicenceId: string;
  period: string;
  status: ReturnStatus;
  acknowledgementRef?: string | null;
  totalPurchaseValueInr?: number | null;
  totalMarketFeeInr?: number | null;
  deadlineDate?: string | null;
  daysLate?: number | null;
  interestAmountInr?: number | null;
  submittedAt?: string | null;
}

interface PreviewLine {
  commodityId: string;
  openingQty: number;
  purchaseQty: number;
  purchaseValueInr: number;
  salesQty: number;
  closingQty: number;
}

interface PreviewResponse {
  traderLicenceId: string;
  period: string;
  totalPurchaseValueInr: number;
  lines: PreviewLine[];
}

const submittedColumns: ReportTableColumn[] = [
  { key: "period", header: "Period", sortField: "period" },
  { key: "ack", header: "Ack ref", sortField: "ackSort" },
  { key: "value", header: "Purchase value (₹)" },
  { key: "fee", header: "Market fee (₹)" },
  { key: "late", header: "Late / interest" },
  { key: "_status", header: "Status", sortField: "status" },
  { key: "_pdf", header: "PDF" },
];

function monthDefault(): string {
  return new Date().toISOString().slice(0, 7);
}

export default function MarketReturns() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const canCreate = can("M-04", "Create") || can("M-04", "Update");

  const [traderLicenceId, setTraderLicenceId] = useState("");
  const [period, setPeriod] = useState(monthDefault());
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [salesByCommodity, setSalesByCommodity] = useState<Record<string, string>>({});

  const { data: licences = [], isLoading: licLoading } = useQuery<TraderLicenceRef[]>({
    queryKey: ["/api/ioms/traders/licences"],
  });

  const licenceLabelById = useMemo(() => {
    return Object.fromEntries(
      licences.map((l) => [l.id, l.licenceNo ? `${l.licenceNo}${l.firmName ? ` — ${l.firmName}` : ""}` : (l.firmName ?? l.id)]),
    );
  }, [licences]);

  const {
    data: myReturns = [],
    isLoading: retLoading,
    isError: retIsError,
  } = useQuery<ReturnRow[]>({
    queryKey: ["/api/ioms/market/returns", traderLicenceId],
    queryFn: async () => {
      if (!traderLicenceId) return [];
      const u = new URL("/api/ioms/market/returns", window.location.origin);
      u.searchParams.set("traderLicenceId", traderLicenceId);
      const r = await fetch(u.toString(), { credentials: "include" });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? r.statusText);
      }
      return r.json();
    },
    enabled: Boolean(traderLicenceId),
  });

  const previewEnabled = Boolean(traderLicenceId && /^\d{4}-\d{2}$/.test(period));
  const {
    data: preview,
    isLoading: previewLoading,
    isError: previewIsError,
    error: previewError,
  } = useQuery<PreviewResponse>({
    queryKey: ["/api/ioms/market/returns/preview", traderLicenceId, period],
    queryFn: async ({ queryKey }) => {
      const [, tid, p] = queryKey as [string, string, string];
      const u = new URL("/api/ioms/market/returns/preview", window.location.origin);
      u.searchParams.set("traderLicenceId", tid);
      u.searchParams.set("period", p);
      const r = await fetch(u.toString(), { credentials: "include" });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? r.statusText);
      }
      return r.json();
    },
    enabled: step >= 2 && previewEnabled,
  });

  const linesWithSales = useMemo((): Array<PreviewLine & { sales: number; closing: number }> => {
    const base = preview?.lines ?? [];
    return base.map((l) => {
      const raw = salesByCommodity[l.commodityId] ?? "";
      const sales = raw.trim() === "" ? 0 : Number(raw);
      const safeSales = Number.isFinite(sales) && sales >= 0 ? sales : 0;
      const closing = (Number(l.openingQty ?? 0) || 0) + (Number(l.purchaseQty ?? 0) || 0) - safeSales;
      return { ...l, sales: safeSales, closing };
    });
  }, [preview?.lines, salesByCommodity]);

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!preview) throw new Error("Preview not loaded.");
      if (!canCreate) throw new Error("Insufficient permissions.");
      const body = {
        traderLicenceId,
        period,
        status: "Submitted",
        filingMode: "Official",
        lines: linesWithSales.map((l) => ({
          commodityId: l.commodityId,
          openingQty: l.openingQty,
          purchaseQty: l.purchaseQty,
          purchaseValueInr: l.purchaseValueInr,
          salesQty: l.sales,
        })),
      };
      const r = await fetch("/api/ioms/market/returns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? r.statusText);
      }
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/market/returns"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/market/returns", traderLicenceId] });
      toast({ title: "Return submitted", description: "Monthly return submitted successfully." });
      setStep(3);
    },
    onError: (e: Error) => toast({ title: "Submit failed", description: e.message, variant: "destructive" }),
  });

  const submittedRows = useMemo(() => {
    return (myReturns ?? []).map((r) => ({
      id: r.id,
      period: r.period,
      ackSort: r.acknowledgementRef ?? "",
      ack: r.acknowledgementRef ?? "—",
      value: Number(r.totalPurchaseValueInr ?? 0).toLocaleString(),
      fee: Number(r.totalMarketFeeInr ?? 0).toLocaleString(),
      late:
        Number(r.daysLate ?? 0) > 0
          ? `${Number(r.daysLate)}d late (₹${Number(r.interestAmountInr ?? 0).toFixed(2)})`
          : "—",
      status: r.status,
      _status: <Badge variant="secondary">{r.status}</Badge>,
      _pdf: r.acknowledgementRef ? (
        <a
          className="text-primary underline text-sm"
          href={`/api/ioms/market/returns/${encodeURIComponent(r.id)}/pdf`}
          target="_blank"
          rel="noreferrer"
        >
          Download
        </a>
      ) : (
        <span className="text-sm text-muted-foreground">—</span>
      ),
    }));
  }, [myReturns]);

  return (
    <AppShell breadcrumbs={[{ label: "Market (M-04)", href: "/market/transactions" }, { label: "Monthly returns" }]}>
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ClipboardList className="h-5 w-5" />
              Monthly returns (M-04)
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              3-step wizard: select trader + period → review auto-filled purchases → enter sales and submit.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {licLoading ? (
              <Skeleton className="h-20 w-full" />
            ) : licences.length === 0 ? (
              <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-950 dark:text-amber-100">
                <AlertCircle className="h-4 w-4 shrink-0" />
                No trader licences available in your scope.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                <div className="space-y-1 md:col-span-2">
                  <Label>Trader licence</Label>
                  <Select value={traderLicenceId} onValueChange={(v) => { setTraderLicenceId(v); setStep(1); setSalesByCommodity({}); }}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select trader licence" />
                    </SelectTrigger>
                    <SelectContent>
                      {licences.map((l) => (
                        <SelectItem key={l.id} value={l.id}>
                          {licenceLabelById[l.id] ?? l.id}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Period (YYYY-MM)</Label>
                  <Input value={period} onChange={(e) => { setPeriod(e.target.value); setStep(1); }} placeholder="2026-04" />
                </div>
                <div className="md:col-span-3 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!traderLicenceId || !previewEnabled}
                    onClick={() => setStep(2)}
                  >
                    Step 2: Load purchases
                  </Button>
                  <Button
                    type="button"
                    disabled={!traderLicenceId || !previewEnabled || previewLoading || previewIsError}
                    onClick={() => submitMutation.mutate()}
                  >
                    <SendHorizontal className="h-4 w-4 mr-1" />
                    Submit return
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {traderLicenceId && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Return history</CardTitle>
              <p className="text-sm text-muted-foreground">{licenceLabelById[traderLicenceId] ?? traderLicenceId}</p>
            </CardHeader>
            <CardContent>
              {retIsError ? (
                <div className="text-sm text-destructive">Failed to load returns.</div>
              ) : retLoading ? (
                <Skeleton className="h-40 w-full" />
              ) : (
                <ClientDataGrid
                  columns={submittedColumns}
                  sourceRows={submittedRows}
                  searchKeys={["period", "ack", "status"]}
                  defaultSortKey="period"
                  defaultSortDir="desc"
                  emptyMessage="No returns yet."
                />
              )}
            </CardContent>
          </Card>
        )}

        {step >= 2 && traderLicenceId && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Step 2: Review purchases (auto-filled)</CardTitle>
              <p className="text-sm text-muted-foreground">
                Purchases are aggregated from Approved yard transactions + Verified checkpost inward entries.
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              {previewLoading ? (
                <Skeleton className="h-48 w-full" />
              ) : previewIsError ? (
                <div className="text-sm text-destructive">
                  {previewError instanceof Error ? previewError.message : "Failed to load preview."}
                </div>
              ) : !preview || preview.lines.length === 0 ? (
                <p className="text-sm text-muted-foreground">No purchase lines found for this trader and period.</p>
              ) : (
                <>
                  <div className="text-sm">
                    Total purchase value:{" "}
                    <span className="font-medium">₹{Number(preview.totalPurchaseValueInr ?? 0).toLocaleString()}</span>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Commodity</TableHead>
                        <TableHead className="text-right">Opening qty</TableHead>
                        <TableHead className="text-right">Purchase qty</TableHead>
                        <TableHead className="text-right">Purchase value (₹)</TableHead>
                        <TableHead className="text-right">Sales qty</TableHead>
                        <TableHead className="text-right">Closing qty</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {linesWithSales.map((l) => (
                        <TableRow key={l.commodityId}>
                          <TableCell className="font-mono text-xs">{l.commodityId}</TableCell>
                          <TableCell className="text-right">{Number(l.openingQty ?? 0)}</TableCell>
                          <TableCell className="text-right">{Number(l.purchaseQty ?? 0)}</TableCell>
                          <TableCell className="text-right">{Number(l.purchaseValueInr ?? 0).toLocaleString()}</TableCell>
                          <TableCell className="text-right">
                            <Input
                              value={salesByCommodity[l.commodityId] ?? ""}
                              onChange={(e) => setSalesByCommodity((m) => ({ ...m, [l.commodityId]: e.target.value }))}
                              inputMode="decimal"
                              className="h-8 text-right"
                              placeholder="0"
                              disabled={!canCreate}
                            />
                          </TableCell>
                          <TableCell className="text-right">{Number(l.closing ?? 0)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}

