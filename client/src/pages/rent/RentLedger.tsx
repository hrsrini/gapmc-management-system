import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { BookOpen, AlertCircle, Receipt } from "lucide-react";
import { Link } from "wouter";
import {
  ReportDataTable,
  type ReportPagedParams,
  type ReportTableColumn,
} from "@/components/reports/ReportDataTable";
import { sliceClientReport } from "@/lib/clientReportSlice";

interface LedgerEntry {
  id: string;
  tenantLicenceId: string;
  unifiedEntityId?: string | null;
  assetId: string;
  entryDate: string;
  entryType: string;
  debit: number;
  credit: number;
  balance: number;
  invoiceId?: string | null;
  receiptId?: string | null;
}
interface AssetRef {
  id: string;
  assetId: string;
}
interface RentInvoiceRef {
  id: string;
  invoiceNo?: string | null;
}

interface TraderReceiptRow {
  id: string;
  receiptNo: string;
  revenueHead: string;
  totalAmount: number;
  status: string;
  sourceModule?: string | null;
  sourceRecordId?: string | null;
  createdAt: string;
}

const columns: ReportTableColumn[] = [
  { key: "entryDate", header: "Entry date" },
  { key: "tenantLicenceId", header: "Tenant licence" },
  { key: "unifiedEntityId", header: "Unified entity" },
  { key: "assetDisplay", header: "Asset" },
  { key: "entryType", header: "Type" },
  { key: "_debit", header: "Debit", sortField: "debit" },
  { key: "_credit", header: "Credit", sortField: "credit" },
  { key: "_balance", header: "Balance", sortField: "balance" },
  { key: "refDisplay", header: "Invoice / Receipt" },
];

export default function RentLedger() {
  const [searchParams] = useSearchParams();
  const [tenantLicenceId, setTenantLicenceId] = useState("");
  const [unifiedEntityIdFilter, setUnifiedEntityIdFilter] = useState("");
  const [assetId, setAssetId] = useState("");
  const [tableParams, setTableParams] = useState<ReportPagedParams>({
    page: 1,
    pageSize: 25,
    q: "",
    sortKey: "entryDate",
    sortDir: "desc",
  });

  const mergeParams = useCallback((next: Partial<ReportPagedParams>) => {
    setTableParams((s) => ({ ...s, ...next }));
  }, []);

  useEffect(() => {
    const u = searchParams.get("unifiedEntityId")?.trim() ?? "";
    if (u) setUnifiedEntityIdFilter(u);
  }, [searchParams]);

  const params = new URLSearchParams();
  if (unifiedEntityIdFilter.trim()) params.set("unifiedEntityId", unifiedEntityIdFilter.trim());
  else if (tenantLicenceId.trim()) params.set("tenantLicenceId", tenantLicenceId.trim());
  if (assetId.trim()) params.set("assetId", assetId.trim());
  const url = params.toString() ? `/api/ioms/rent/ledger?${params.toString()}` : "/api/ioms/rent/ledger";

  const receiptParams = new URLSearchParams();
  if (unifiedEntityIdFilter.trim()) receiptParams.set("unifiedEntityId", unifiedEntityIdFilter.trim());
  else if (tenantLicenceId.trim()) receiptParams.set("tenantLicenceId", tenantLicenceId.trim());
  const traderReceiptsUrl = receiptParams.toString()
    ? `/api/ioms/rent/ledger/trader-receipts?${receiptParams.toString()}`
    : "";

  useEffect(() => {
    setTableParams((p) => ({ ...p, page: 1 }));
  }, [url]);

  const { data: list = [], isLoading, isError } = useQuery<LedgerEntry[]>({ queryKey: [url] });
  const { data: traderReceipts = [], isLoading: traderReceiptsLoading } = useQuery<TraderReceiptRow[]>({
    queryKey: [traderReceiptsUrl],
    enabled: Boolean(traderReceiptsUrl),
  });
  const { data: assets = [] } = useQuery<AssetRef[]>({
    queryKey: ["/api/ioms/assets"],
  });
  const { data: invoices = [] } = useQuery<RentInvoiceRef[]>({
    queryKey: ["/api/ioms/rent/invoices"],
  });
  const assetLabelById = Object.fromEntries(assets.map((a) => [a.id, a.assetId]));
  const invoiceLabelById = Object.fromEntries(invoices.map((i) => [i.id, i.invoiceNo ?? i.id]));

  const sourceRows = useMemo((): Record<string, unknown>[] => {
    return list.map((e) => ({
      id: e.id,
      entryDate: e.entryDate.slice(0, 10),
      tenantLicenceId: e.tenantLicenceId,
      unifiedEntityId: e.unifiedEntityId?.trim() ? e.unifiedEntityId : "—",
      assetDisplay: assetLabelById[e.assetId] ?? e.assetId,
      entryType: e.entryType,
      debit: e.debit,
      credit: e.credit,
      balance: e.balance,
      _debit: `₹${e.debit.toLocaleString()}`,
      _credit: `₹${e.credit.toLocaleString()}`,
      _balance: `₹${e.balance.toLocaleString()}`,
      refDisplay:
        e.invoiceId != null && e.invoiceId !== ""
          ? (invoiceLabelById[e.invoiceId] ?? e.invoiceId)
          : (e.receiptId ?? "—"),
    }));
  }, [list, assetLabelById, invoiceLabelById]);

  const { rows, total } = useMemo(
    () =>
      sliceClientReport(sourceRows, tableParams, [
        "entryDate",
        "tenantLicenceId",
        "unifiedEntityId",
        "assetDisplay",
        "entryType",
        "debit",
        "credit",
        "balance",
        "refDisplay",
      ]),
    [sourceRows, tableParams],
  );

  const totalPages =
    tableParams.pageSize === "all" ? 1 : Math.max(1, Math.ceil(total / tableParams.pageSize));

  useEffect(() => {
    if (total > 0 && tableParams.page > totalPages) {
      setTableParams((p) => ({ ...p, page: totalPages }));
    }
  }, [total, totalPages, tableParams.page]);

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "Rent (IOMS)", href: "/rent/ioms" }, { label: "Rent deposit ledger" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Failed to load ledger.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Rent (IOMS)", href: "/rent/ioms" }, { label: "Rent deposit ledger" }]}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            Rent deposit ledger (M-03)
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Per tenant per asset — opening balance, rent, interest, collections. When you filter by{" "}
            <span className="font-mono">TA:…</span> or tenant licence id, a second panel lists other IOMS receipts (same
            payer ref) for cross-check with market/licence fees — balances stay on deposit rows only.
          </p>
          <div className="flex flex-wrap gap-4 pt-2">
            <div className="space-y-1">
              <Label>Unified entity (TA:…)</Label>
              <Input
                className="w-[220px] font-mono text-xs"
                placeholder="e.g. TA:…"
                value={unifiedEntityIdFilter}
                onChange={(e) => setUnifiedEntityIdFilter(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Tenant licence ID</Label>
              <Input
                className="w-[200px]"
                placeholder="Filter by tenant (if no TA:…)"
                value={tenantLicenceId}
                onChange={(e) => setTenantLicenceId(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Asset ID</Label>
              <Input
                className="w-[200px]"
                placeholder="Filter by asset"
                value={assetId}
                onChange={(e) => setAssetId(e.target.value)}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <ReportDataTable
              columns={columns}
              rows={rows}
              total={total}
              params={tableParams}
              onParamsChange={mergeParams}
              isLoading={false}
              searchPlaceholder="Search by date, tenant, asset, type, amounts, invoice/receipt…"
            />
          )}
        </CardContent>
      </Card>

      {traderReceiptsUrl ? (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Receipt className="h-4 w-4" />
              Trader-linked IOMS receipts
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Receipts with payer <span className="font-medium">TraderLicence</span> = this tenant (any revenue head /
              source module). Does not alter deposit ledger running balance.
            </p>
          </CardHeader>
          <CardContent>
            {traderReceiptsLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : traderReceipts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No receipts found for this trader licence payer ref.</p>
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50 text-left">
                      <th className="p-2 font-medium">Receipt</th>
                      <th className="p-2 font-medium">Head</th>
                      <th className="p-2 font-medium">Source</th>
                      <th className="p-2 font-medium text-right">Amount</th>
                      <th className="p-2 font-medium">Status</th>
                      <th className="p-2 font-medium">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {traderReceipts.map((r) => (
                      <tr key={r.id} className="border-b last:border-0">
                        <td className="p-2">
                          <Link
                            href={`/receipts/ioms/${encodeURIComponent(r.id)}`}
                            className="text-primary hover:underline font-mono"
                          >
                            {r.receiptNo}
                          </Link>
                        </td>
                        <td className="p-2">{r.revenueHead}</td>
                        <td className="p-2 font-mono text-xs">
                          {r.sourceModule ?? "—"}
                          {r.sourceRecordId ? ` · ${r.sourceRecordId.slice(0, 8)}…` : ""}
                        </td>
                        <td className="p-2 text-right tabular-nums">₹{Number(r.totalAmount ?? 0).toLocaleString()}</td>
                        <td className="p-2">{r.status}</td>
                        <td className="p-2 text-muted-foreground whitespace-nowrap">
                          {r.createdAt?.slice(0, 10) ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}
    </AppShell>
  );
}
