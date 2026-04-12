import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { BookOpen, AlertCircle } from "lucide-react";
import {
  ReportDataTable,
  type ReportPagedParams,
  type ReportTableColumn,
} from "@/components/reports/ReportDataTable";
import { sliceClientReport } from "@/lib/clientReportSlice";

interface LedgerEntry {
  id: string;
  tenantLicenceId: string;
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

const columns: ReportTableColumn[] = [
  { key: "entryDate", header: "Entry date" },
  { key: "tenantLicenceId", header: "Tenant licence" },
  { key: "assetDisplay", header: "Asset" },
  { key: "entryType", header: "Type" },
  { key: "_debit", header: "Debit", sortField: "debit" },
  { key: "_credit", header: "Credit", sortField: "credit" },
  { key: "_balance", header: "Balance", sortField: "balance" },
  { key: "refDisplay", header: "Invoice / Receipt" },
];

export default function RentLedger() {
  const [tenantLicenceId, setTenantLicenceId] = useState("");
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

  const params = new URLSearchParams();
  if (tenantLicenceId.trim()) params.set("tenantLicenceId", tenantLicenceId.trim());
  if (assetId.trim()) params.set("assetId", assetId.trim());
  const url = params.toString() ? `/api/ioms/rent/ledger?${params.toString()}` : "/api/ioms/rent/ledger";

  useEffect(() => {
    setTableParams((p) => ({ ...p, page: 1 }));
  }, [url]);

  const { data: list = [], isLoading, isError } = useQuery<LedgerEntry[]>({ queryKey: [url] });
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
            Per tenant per asset — opening balance, rent, interest, collections. Use search and column headers to sort;
            pagination applies after server filter.
          </p>
          <div className="flex flex-wrap gap-4 pt-2">
            <div className="space-y-1">
              <Label>Tenant licence ID</Label>
              <Input
                className="w-[200px]"
                placeholder="Filter by tenant"
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
    </AppShell>
  );
}
