import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { BookOpen, Download, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { downloadCsv } from "@/lib/csvDownload";
import { formatYmdToDisplay } from "@/lib/dateFormat";
import type { Receipt, Trader } from "@shared/schema";
import {
  type ApiYardRef,
  filterApiYardsForLegacyRentReports,
  legacyRentRowMatchesApiYard,
} from "@/lib/legacyYardMatch";
import {
  ReportDataTable,
  type ReportPagedParams,
  type ReportTableColumn,
} from "@/components/reports/ReportDataTable";
import { sliceClientReport } from "@/lib/clientReportSlice";

type ReportType = "trader" | "head" | "yard" | "daily" | "payment";

const reportTypes = [
  { value: "trader", label: "Trader-wise Ledger" },
  { value: "head", label: "Head-wise Collection Summary" },
  { value: "yard", label: "Yard-wise Collection" },
  { value: "daily", label: "Daily Collection Report" },
  { value: "payment", label: "Payment Mode Summary" },
];

function receiptInDateRange(r: Receipt, dateFrom: string, dateTo: string): boolean {
  const d = r.receiptDate.slice(0, 10);
  if (dateFrom && d < dateFrom) return false;
  if (dateTo && d > dateTo) return false;
  return true;
}

function defaultSortKey(reportType: ReportType): string {
  switch (reportType) {
    case "trader":
      return "receiptDate";
    case "head":
      return "total";
    case "yard":
      return "yard";
    case "daily":
      return "date";
    case "payment":
      return "total";
    default:
      return "id";
  }
}

export default function LedgerReports() {
  const { toast } = useToast();
  const [reportType, setReportType] = useState<ReportType>("trader");
  const [selectedTrader, setSelectedTrader] = useState<string>("all");
  const [selectedYard, setSelectedYard] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [tableParams, setTableParams] = useState<ReportPagedParams>({
    page: 1,
    pageSize: 25,
    q: "",
    sortKey: "receiptDate",
    sortDir: "desc",
  });

  const mergeParams = useCallback((next: Partial<ReportPagedParams>) => {
    setTableParams((s) => ({ ...s, ...next }));
  }, []);

  useEffect(() => {
    setTableParams({
      page: 1,
      pageSize: 25,
      q: "",
      sortKey: defaultSortKey(reportType),
      sortDir: "desc",
    });
  }, [reportType]);

  useEffect(() => {
    setTableParams((p) => ({ ...p, page: 1 }));
  }, [dateFrom, dateTo, selectedTrader, selectedYard]);

  const { data: receipts, isLoading: receiptsLoading } = useQuery<Receipt[]>({
    queryKey: ["/api/receipts"],
  });

  const { data: traders, isLoading: tradersLoading } = useQuery<Trader[]>({
    queryKey: ["/api/traders"],
  });

  const { data: yards = [], isLoading: yardsLoading, isError: yardsError } = useQuery<ApiYardRef[]>({
    queryKey: ["/api/yards/for-reports"],
  });

  const yardRows = useMemo(() => filterApiYardsForLegacyRentReports(yards), [yards]);

  const isLoading = receiptsLoading || tradersLoading || yardsLoading;

  const receiptsInDateRange = useMemo(() => {
    return (receipts ?? []).filter((r) => receiptInDateRange(r, dateFrom, dateTo));
  }, [receipts, dateFrom, dateTo]);

  const traderLedger = useMemo(() => {
    return receiptsInDateRange
      .filter((r) => selectedTrader === "all" || r.traderId === selectedTrader)
      .map((r) => ({
        ...r,
        traderDetails: (traders ?? []).find((t) => t.id === r.traderId),
      }));
  }, [receiptsInDateRange, selectedTrader, traders]);

  const headWiseSummary = useMemo(() => {
    return receiptsInDateRange.reduce(
      (acc, r) => {
        const key = `${r.type}-${r.head}`;
        if (!acc[key]) {
          acc[key] = { type: r.type, head: r.head, count: 0, total: 0 };
        }
        acc[key].count++;
        acc[key].total += r.total;
        return acc;
      },
      {} as Record<string, { type: string; head: string; count: number; total: number }>,
    );
  }, [receiptsInDateRange]);

  const yardWiseSummary = useMemo(() => {
    const rows = yardRows.map((apiYard) => {
      const yardReceipts = receiptsInDateRange.filter((r) =>
        legacyRentRowMatchesApiYard(r.yardId, r.yardName, apiYard),
      );
      return {
        yardId: apiYard.id,
        yard: apiYard.name,
        code: apiYard.code ?? "—",
        inactive: apiYard.isActive === false,
        count: yardReceipts.length,
        total: yardReceipts.reduce((sum, r) => sum + r.total, 0),
      };
    });
    const withData = rows.filter((y) => y.count > 0);
    if (selectedYard === "all") return withData;
    return withData.filter((r) => r.yardId === selectedYard);
  }, [receiptsInDateRange, yardRows, selectedYard]);

  const dailyCollection = useMemo(() => {
    const map = new Map<string, { date: string; count: number; total: number }>();
    for (const r of receiptsInDateRange) {
      const d = r.receiptDate.slice(0, 10);
      const cur = map.get(d) ?? { date: d, count: 0, total: 0 };
      cur.count += 1;
      cur.total += r.total;
      map.set(d, cur);
    }
    return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [receiptsInDateRange]);

  const paymentModeSummary = useMemo(() => {
    return receiptsInDateRange.reduce(
      (acc, r) => {
        if (!acc[r.paymentMode]) {
          acc[r.paymentMode] = { mode: r.paymentMode, count: 0, total: 0 };
        }
        acc[r.paymentMode].count++;
        acc[r.paymentMode].total += r.total;
        return acc;
      },
      {} as Record<string, { mode: string; count: number; total: number }>,
    );
  }, [receiptsInDateRange]);

  const reportSourceRows = useMemo((): Record<string, unknown>[] => {
    switch (reportType) {
      case "trader":
        return traderLedger.map((item) => ({
          id: item.id,
          receiptNo: item.receiptNo,
          receiptDate: item.receiptDate.slice(0, 10),
          traderName: item.traderName,
          type: item.type,
          head: item.head,
          total: item.total,
          _amount: `₹${item.total.toLocaleString()}`,
          paymentMode: item.paymentMode,
        }));
      case "head":
        return Object.entries(headWiseSummary).map(([key, item]) => ({
          id: key,
          type: item.type,
          head: item.head,
          count: item.count,
          total: item.total,
          _amount: `₹${item.total.toLocaleString()}`,
        }));
      case "yard":
        return yardWiseSummary.map((item) => ({
          id: item.yardId,
          yard: item.yard,
          yardNote: item.inactive ? `${item.yard} (inactive)` : item.yard,
          code: item.code,
          inactive: item.inactive,
          count: item.count,
          total: item.total,
          _amount: `₹${item.total.toLocaleString()}`,
        }));
      case "daily":
        return dailyCollection.map((row) => ({
          id: row.date,
          date: row.date,
          count: row.count,
          total: row.total,
          _amount: `₹${row.total.toLocaleString()}`,
        }));
      case "payment":
        return Object.values(paymentModeSummary).map((item) => ({
          id: item.mode,
          mode: item.mode,
          count: item.count,
          total: item.total,
          _amount: `₹${item.total.toLocaleString()}`,
        }));
      default:
        return [];
    }
  }, [
    reportType,
    traderLedger,
    headWiseSummary,
    yardWiseSummary,
    dailyCollection,
    paymentModeSummary,
  ]);

  const searchKeysForType = useMemo((): string[] | undefined => {
    switch (reportType) {
      case "trader":
        return ["receiptNo", "receiptDate", "traderName", "type", "head", "paymentMode", "total"];
      case "head":
        return ["type", "head", "count", "total"];
      case "yard":
        return ["yard", "code", "count", "total"];
      case "daily":
        return ["date", "count", "total"];
      case "payment":
        return ["mode", "count", "total"];
      default:
        return undefined;
    }
  }, [reportType]);

  const columns = useMemo((): ReportTableColumn[] => {
    switch (reportType) {
      case "trader":
        return [
          { key: "receiptNo", header: "Receipt No" },
          { key: "receiptDate", header: "Date" },
          { key: "traderName", header: "Trader" },
          { key: "type", header: "Type" },
          { key: "head", header: "Head" },
          { key: "_amount", header: "Amount", sortField: "total" },
          { key: "paymentMode", header: "Mode" },
        ];
      case "head":
        return [
          { key: "type", header: "Receipt Type" },
          { key: "head", header: "Head" },
          { key: "count", header: "Count" },
          { key: "_amount", header: "Total Amount", sortField: "total" },
        ];
      case "yard":
        return [
          { key: "yardNote", header: "Yard", sortField: "yard" },
          { key: "code", header: "Code" },
          { key: "count", header: "Receipts" },
          { key: "_amount", header: "Total Collection", sortField: "total" },
        ];
      case "daily":
        return [
          { key: "date", header: "Date" },
          { key: "count", header: "Receipts" },
          { key: "_amount", header: "Total", sortField: "total" },
        ];
      case "payment":
        return [
          { key: "mode", header: "Mode" },
          { key: "count", header: "Count" },
          { key: "_amount", header: "Total", sortField: "total" },
        ];
      default:
        return [];
    }
  }, [reportType]);

  const { rows, total } = useMemo(
    () => sliceClientReport(reportSourceRows, tableParams, searchKeysForType),
    [reportSourceRows, tableParams, searchKeysForType],
  );

  const totalPages =
    tableParams.pageSize === "all" ? 1 : Math.max(1, Math.ceil(total / tableParams.pageSize));

  useEffect(() => {
    if (total > 0 && tableParams.page > totalPages) {
      setTableParams((p) => ({ ...p, page: totalPages }));
    }
  }, [total, totalPages, tableParams.page]);

  const traderGrandTotal = useMemo(
    () => traderLedger.reduce((sum, r) => sum + r.total, 0),
    [traderLedger],
  );

  const searchPlaceholder = useMemo(() => {
    switch (reportType) {
      case "trader":
        return "Search by receipt no., trader, type, head, mode…";
      case "head":
        return "Search by receipt type, head…";
      case "yard":
        return "Search by yard, code…";
      case "daily":
        return "Search by date…";
      case "payment":
        return "Search by payment mode…";
      default:
        return "Search…";
    }
  }, [reportType]);

  const handleExport = () => {
    const suffix = dateFrom || dateTo ? `_${dateFrom || "start"}_${dateTo || "end"}` : "";
    if (reportType === "trader") {
      downloadCsv(
        `ledger-trader${suffix}`,
        ["Receipt No", "Date (DD-MM-YYYY)", "Trader", "Type", "Head", "Amount", "Mode"],
        traderLedger.map((item) => [
          item.receiptNo,
          formatYmdToDisplay(item.receiptDate),
          item.traderName,
          item.type,
          item.head,
          item.total,
          item.paymentMode,
        ]),
      );
    } else if (reportType === "head") {
      downloadCsv(
        `ledger-head${suffix}`,
        ["Receipt type", "Head", "Count", "Total"],
        Object.values(headWiseSummary).map((item) => [item.type, item.head, item.count, item.total]),
      );
    } else if (reportType === "yard") {
      downloadCsv(
        `ledger-yard${suffix}`,
        ["Yard", "Code", "Receipts", "Total"],
        yardWiseSummary.map((item) => [item.yard, item.code, item.count, item.total]),
      );
    } else if (reportType === "daily") {
      downloadCsv(
        `ledger-daily${suffix}`,
        ["Date (DD-MM-YYYY)", "Receipts", "Total"],
        dailyCollection.map((row) => [formatYmdToDisplay(row.date), row.count, row.total]),
      );
    } else {
      downloadCsv(
        `ledger-payment-modes${suffix}`,
        ["Mode", "Count", "Total"],
        Object.values(paymentModeSummary).map((item) => [item.mode, item.count, item.total]),
      );
    }
    toast({ title: "Download started", description: "CSV file download should begin shortly." });
  };

  if (yardsError) {
    return (
      <AppShell breadcrumbs={[{ label: "Receipts", href: "/receipts" }, { label: "Ledger Reports" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Failed to load yard list for reports. Please try again.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Receipts", href: "/receipts" }, { label: "Ledger Reports" }]}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BookOpen className="h-6 w-6 text-primary" />
            Ledger Reports
          </h1>
          <p className="text-muted-foreground">
            Generate and export receipt ledger reports (yards: your scope, including inactive). Tables support search,
            sort, pagination, and scroll.
          </p>
        </div>

        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-base">Report Configuration</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <div className="space-y-2">
                <Label>Report Type</Label>
                <Select value={reportType} onValueChange={(v) => setReportType(v as ReportType)}>
                  <SelectTrigger data-testid="select-report-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {reportTypes.map((type) => (
                      <SelectItem key={type.value} value={type.value}>
                        {type.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {reportType === "trader" && (
                <div className="space-y-2">
                  <Label>Trader</Label>
                  <Select value={selectedTrader} onValueChange={setSelectedTrader}>
                    <SelectTrigger data-testid="select-trader">
                      <SelectValue placeholder="All Traders" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Traders</SelectItem>
                      {(traders ?? []).map((trader) => (
                        <SelectItem key={trader.id} value={trader.id}>
                          {trader.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {reportType === "yard" && (
                <div className="space-y-2">
                  <Label>Yard</Label>
                  <Select value={selectedYard} onValueChange={setSelectedYard}>
                    <SelectTrigger data-testid="select-yard">
                      <SelectValue placeholder="All Yards" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Yards</SelectItem>
                      {yardRows.map((yard) => (
                        <SelectItem key={yard.id} value={yard.id}>
                          {yard.name}
                          {yard.isActive === false ? " (inactive)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-2">
                <Label>From Date</Label>
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  data-testid="input-date-from"
                />
              </div>
              <div className="space-y-2">
                <Label>To Date</Label>
                <Input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  data-testid="input-date-to"
                />
              </div>
              <div className="flex items-end">
                <Button onClick={handleExport} variant="outline" className="w-full" data-testid="button-export">
                  <Download className="h-4 w-4 mr-2" />
                  Export CSV
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {isLoading ? (
          <Card>
            <CardContent className="p-6">
              <Skeleton className="h-64 w-full" />
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>
                {reportTypes.find((t) => t.value === reportType)?.label ?? "Report"}
              </CardTitle>
              <CardDescription>
                {reportType === "trader" && "Receipt history by trader"}
                {reportType === "head" && "Collection summary by receipt head"}
                {reportType === "yard" && "Collection summary by yard"}
                {reportType === "daily" && "Receipt totals grouped by receipt date (uses From/To filters)"}
                {reportType === "payment" && "Collection summary by payment mode"}
              </CardDescription>
              {reportType === "trader" ? (
                <p className="text-sm font-medium pt-1">
                  Grand total: ₹{traderGrandTotal.toLocaleString()} ({traderLedger.length} receipt
                  {traderLedger.length === 1 ? "" : "s"})
                </p>
              ) : null}
            </CardHeader>
            <CardContent>
              <ReportDataTable
                columns={columns}
                rows={rows}
                total={total}
                params={tableParams}
                onParamsChange={mergeParams}
                isLoading={false}
                searchPlaceholder={searchPlaceholder}
              />
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
