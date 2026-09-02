import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TraderLicenceSearchSelect, formatTraderLicenceSelectLabel } from "@/components/selects/trader-licence-search-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { ClipboardList, AlertCircle, SendHorizontal } from "lucide-react";
import { ClientDataGrid } from "@/components/reports/ClientDataGrid";
import { formatInr } from "@/lib/formatInr";
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

interface CommodityRef {
  id: string;
  name: string;
  unit?: string | null;
}

/** Whole numbers only — strips non-digits. */
function sanitizeWholeQtyInput(value: string): string {
  if (value === "") return "";
  return value.replace(/\D/g, "");
}

function parseWholeQty(raw: string): number {
  const t = raw.trim();
  if (t === "") return 0;
  const n = Number.parseInt(t, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function formatWholeQty(value: number): string {
  return Math.round(value).toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

function maxSaleQty(openingQty: number, purchaseQty: number): number {
  const available = (Number(openingQty) || 0) + (Number(purchaseQty) || 0);
  return Math.max(0, Math.floor(available));
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

  const { data: licences = [] } = useQuery<TraderLicenceRef[]>({
    queryKey: ["/api/ioms/traders/licences"],
  });
  const { data: commodities = [] } = useQuery<CommodityRef[]>({
    queryKey: ["/api/ioms/commodities"],
  });
  const commodityNameById = useMemo(
    () => new Map(commodities.map((c) => [c.id, c.name] as const)),
    [commodities],
  );
  const commodityUnitById = useMemo(
    () => new Map(commodities.map((c) => [c.id, c.unit?.trim() || "—"] as const)),
    [commodities],
  );

  const licenceLabelById = useMemo(() => {
    return Object.fromEntries(
      licences.map((l) => [l.id, formatTraderLicenceSelectLabel(l)]),
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

  const returnForPeriod = useMemo(
    () => (myReturns ?? []).find((r) => r.period === period) ?? null,
    [myReturns, period],
  );
  const returnLocked = returnForPeriod != null && ["Verified", "Approved"].includes(returnForPeriod.status);

  useEffect(() => {
    if (!returnForPeriod?.id || step < 2) return;
    let cancelled = false;
    (async () => {
      const r = await fetch(`/api/ioms/market/returns/${encodeURIComponent(returnForPeriod.id)}`, {
        credentials: "include",
      });
      if (!r.ok || cancelled) return;
      const data = (await r.json()) as { lines?: Array<{ commodityId: string; salesQty?: number | null }> };
      const next: Record<string, string> = {};
      for (const line of data.lines ?? []) {
        const qty = Math.trunc(Number(line.salesQty ?? 0) || 0);
        if (qty > 0) next[line.commodityId] = String(qty);
      }
      if (!cancelled && Object.keys(next).length > 0) {
        setSalesByCommodity((prev) => ({ ...prev, ...next }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [returnForPeriod?.id, step]);

  const linesWithSales = useMemo((): Array<
    PreviewLine & { sales: number; closing: number; maxSales: number; salesOverMax: boolean }
  > => {
    const base = preview?.lines ?? [];
    return base.map((l) => {
      const raw = salesByCommodity[l.commodityId] ?? "";
      const sales = parseWholeQty(raw);
      const maxSales = maxSaleQty(l.openingQty, l.purchaseQty);
      const salesOverMax = sales > maxSales;
      const closing = maxSales - sales;
      return { ...l, sales, closing, maxSales, salesOverMax };
    });
  }, [preview?.lines, salesByCommodity]);

  const hasSalesValidationErrors = linesWithSales.some((l) => l.salesOverMax);

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!preview) throw new Error("Preview not loaded.");
      if (!canCreate) throw new Error("Insufficient permissions.");
      if (hasSalesValidationErrors) {
        throw new Error("Sale quantity cannot exceed opening qty + purchase qty for any commodity.");
      }
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
    onSuccess: (data: { updated?: boolean }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/market/returns"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/market/returns", traderLicenceId] });
      const updated = Boolean(data?.updated);
      toast({
        title: updated ? "Return updated" : "Return submitted",
        description: updated
          ? `Cumulative totals for ${period} were refreshed from current purchases.`
          : "Monthly return submitted successfully.",
      });
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
      value: formatInr(r.totalPurchaseValueInr ?? 0),
      fee: formatInr(r.totalMarketFeeInr ?? 0),
      late:
        Number(r.daysLate ?? 0) > 0
          ? `${Number(r.daysLate)}d late (${formatInr(r.interestAmountInr ?? 0, { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`
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
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
              <div className="space-y-1 md:col-span-2">
                <Label>Trader licence</Label>
                <TraderLicenceSearchSelect
                  value={traderLicenceId}
                  onValueChange={(v) => {
                    setTraderLicenceId(v);
                    setStep(1);
                    setSalesByCommodity({});
                  }}
                  placeholder="Select trader licence"
                />
              </div>
                <div className="space-y-1">
                  <Label>Period (YYYY-MM)</Label>
                  <Input value={period} onChange={(e) => { setPeriod(e.target.value); setStep(1); }} placeholder="2026-04" />
                </div>
                {returnForPeriod && !returnLocked && (
                  <div className="md:col-span-3 flex items-center gap-2 rounded-md border border-blue-500/40 bg-blue-500/10 px-3 py-2 text-sm text-blue-950 dark:text-blue-100">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    A return for {period} already exists ({returnForPeriod.status}). Submitting will update cumulative
                    purchase value, market fee, and late interest from current transactions.
                  </div>
                )}
                {returnLocked && (
                  <div className="md:col-span-3 flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-950 dark:text-amber-100">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    Return for {period} is {returnForPeriod?.status} and cannot be changed here.
                  </div>
                )}
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
                    disabled={
                      !canCreate ||
                      returnLocked ||
                      !traderLicenceId ||
                      !previewEnabled ||
                      previewLoading ||
                      previewIsError ||
                      step < 2 ||
                      hasSalesValidationErrors
                    }
                    onClick={() => submitMutation.mutate()}
                  >
                    <SendHorizontal className="h-4 w-4 mr-1" />
                    {returnForPeriod && !returnLocked ? "Update return" : "Submit return"}
                  </Button>
                </div>
              </div>
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
                Purchases are aggregated from Finalized wizard transactions, Approved yard purchases, and Verified
                checkpost inward entries. Enter sale quantities as whole numbers only; sales cannot exceed opening qty +
                purchase qty for each commodity.
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
                    <span className="font-medium">{formatInr(Number(preview.totalPurchaseValueInr ?? 0))}</span>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Commodity</TableHead>
                        <TableHead>Unit</TableHead>
                        <TableHead className="text-right">Opening qty</TableHead>
                        <TableHead className="text-right">Purchase qty</TableHead>
                        <TableHead className="text-right">Purchase value (₹)</TableHead>
                        <TableHead className="text-right">Sale qty</TableHead>
                        <TableHead className="text-right">Closing qty</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {linesWithSales.map((l) => (
                        <TableRow key={l.commodityId}>
                          <TableCell>{commodityNameById.get(l.commodityId) ?? l.commodityId}</TableCell>
                          <TableCell className="text-muted-foreground">{commodityUnitById.get(l.commodityId) ?? "—"}</TableCell>
                          <TableCell className="text-right">{formatWholeQty(l.openingQty ?? 0)}</TableCell>
                          <TableCell className="text-right">{formatWholeQty(l.purchaseQty ?? 0)}</TableCell>
                          <TableCell className="text-right">{formatInr(l.purchaseValueInr ?? 0)}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex flex-col items-end gap-1">
                              <Input
                                value={salesByCommodity[l.commodityId] ?? ""}
                                onChange={(e) =>
                                  setSalesByCommodity((m) => ({
                                    ...m,
                                    [l.commodityId]: sanitizeWholeQtyInput(e.target.value),
                                  }))
                                }
                                onBlur={() => {
                                  const raw = salesByCommodity[l.commodityId] ?? "";
                                  const sales = parseWholeQty(raw);
                                  if (sales > l.maxSales) {
                                    setSalesByCommodity((m) => ({
                                      ...m,
                                      [l.commodityId]: l.maxSales > 0 ? String(l.maxSales) : "",
                                    }));
                                  }
                                }}
                                inputMode="numeric"
                                pattern="[0-9]*"
                                className={`h-8 w-28 text-right ${l.salesOverMax ? "border-destructive" : ""}`}
                                placeholder="0"
                                disabled={!canCreate}
                                aria-invalid={l.salesOverMax}
                              />
                              {l.salesOverMax && (
                                <span className="text-xs text-destructive">
                                  Max {formatWholeQty(l.maxSales)} (opening + purchase)
                                </span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-right">{formatWholeQty(l.closing ?? 0)}</TableCell>
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

