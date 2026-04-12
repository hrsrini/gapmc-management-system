import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarChart3, Download, FileText, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { downloadCsv } from "@/lib/csvDownload";
import { formatYmdToDisplay } from "@/lib/dateFormat";
import type { Invoice, Trader } from "@shared/schema";
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

function invoiceMatchesSelectedYard(
  inv: Invoice,
  selectedYard: string,
  yardRows: ApiYardRef[],
): boolean {
  if (selectedYard === "all") return true;
  const y = yardRows.find((r) => r.id === selectedYard);
  if (!y) return false;
  return legacyRentRowMatchesApiYard(inv.yardId, inv.yard, y);
}

function invoiceInDateRange(inv: Invoice, dateFrom: string, dateTo: string): boolean {
  const d = inv.invoiceDate.slice(0, 10);
  if (dateFrom && d < dateFrom) return false;
  if (dateTo && d > dateTo) return false;
  return true;
}

export default function RentReports() {
  const { toast } = useToast();
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selectedYard, setSelectedYard] = useState<string>("all");
  const [activeTab, setActiveTab] = useState("outstanding");

  const [outParams, setOutParams] = useState<ReportPagedParams>({
    page: 1,
    pageSize: 25,
    q: "",
    sortKey: "invoiceNo",
    sortDir: "desc",
  });
  const [yardParams, setYardParams] = useState<ReportPagedParams>({
    page: 1,
    pageSize: 25,
    q: "",
    sortKey: "yard",
    sortDir: "asc",
  });
  const [gstParams, setGstParams] = useState<ReportPagedParams>({
    page: 1,
    pageSize: 25,
    q: "",
    sortKey: "metric",
    sortDir: "asc",
  });

  const mergeOut = useCallback((next: Partial<ReportPagedParams>) => {
    setOutParams((s) => ({ ...s, ...next }));
  }, []);
  const mergeYard = useCallback((next: Partial<ReportPagedParams>) => {
    setYardParams((s) => ({ ...s, ...next }));
  }, []);
  const mergeGst = useCallback((next: Partial<ReportPagedParams>) => {
    setGstParams((s) => ({ ...s, ...next }));
  }, []);

  useEffect(() => {
    setOutParams((p) => ({ ...p, page: 1 }));
    setYardParams((p) => ({ ...p, page: 1 }));
    setGstParams((p) => ({ ...p, page: 1 }));
  }, [dateFrom, dateTo, selectedYard]);

  const { data: invoices, isLoading: invoicesLoading, isError: invoicesError } = useQuery<Invoice[]>({
    queryKey: ["/api/invoices"],
  });

  const { data: traders, isLoading: tradersLoading } = useQuery<Trader[]>({
    queryKey: ["/api/traders"],
  });

  const { data: yards = [], isLoading: yardsLoading, isError: yardsError } = useQuery<ApiYardRef[]>({
    queryKey: ["/api/yards/for-reports"],
  });

  const yardRows = useMemo(() => filterApiYardsForLegacyRentReports(yards), [yards]);

  const invoicesInDateRange = useMemo(() => {
    return (invoices ?? []).filter((inv) => invoiceInDateRange(inv, dateFrom, dateTo));
  }, [invoices, dateFrom, dateTo]);

  const invoicesForFilters = useMemo(() => {
    return invoicesInDateRange.filter((inv) => invoiceMatchesSelectedYard(inv, selectedYard, yardRows));
  }, [invoicesInDateRange, selectedYard, yardRows]);

  const isLoading = invoicesLoading || tradersLoading || yardsLoading;

  const outstandingSourceRows = useMemo((): Record<string, unknown>[] => {
    return invoicesForFilters
      .filter((i) => i.status !== "Paid")
      .map((inv) => {
        const trader = (traders ?? []).find((t) => t.id === inv.traderId);
        const traderMobile = trader?.mobile || "";
        return {
          id: inv.id,
          invoiceNo: inv.id,
          traderName: inv.traderName,
          traderMobile,
          yard: inv.yard,
          total: inv.total,
          _amount: `₹${inv.total.toLocaleString()}`,
          status: inv.status,
          _status: (
            <span
              className={`px-2 py-1 rounded text-xs ${
                inv.status === "Overdue"
                  ? "bg-destructive/10 text-destructive"
                  : "bg-amber-500/10 text-amber-600"
              }`}
            >
              {inv.status}
            </span>
          ),
        };
      });
  }, [invoicesForFilters, traders]);

  const yardWiseCollection = useMemo(() => {
    const rows = yardRows.map((apiYard) => {
      const yardInvoices = invoicesInDateRange.filter((i) => legacyRentRowMatchesApiYard(i.yardId, i.yard, apiYard));
      const total = yardInvoices.reduce((sum, i) => sum + i.total, 0);
      const paid = yardInvoices.filter((i) => i.status === "Paid").reduce((sum, i) => sum + i.total, 0);
      const pending = yardInvoices.filter((i) => i.status !== "Paid").reduce((sum, i) => sum + i.total, 0);
      return {
        yardId: apiYard.id,
        yard: apiYard.name,
        code: apiYard.code ?? "—",
        inactive: apiYard.isActive === false,
        totalInvoices: yardInvoices.length,
        totalAmount: total,
        collected: paid,
        pending,
      };
    });
    const withData = rows.filter((y) => y.totalInvoices > 0);
    if (selectedYard === "all") return withData;
    return withData.filter((r) => r.yardId === selectedYard);
  }, [invoicesInDateRange, yardRows, selectedYard]);

  const yardSourceRows = useMemo(
    (): Record<string, unknown>[] =>
      yardWiseCollection.map((item) => ({
        id: item.yardId,
        yard: item.yard,
        yardNote: item.inactive ? `${item.yard} (inactive)` : item.yard,
        code: item.code,
        totalInvoices: item.totalInvoices,
        totalAmount: item.totalAmount,
        collected: item.collected,
        pending: item.pending,
        _totalAmt: `₹${item.totalAmount.toLocaleString()}`,
        _collected: `₹${item.collected.toLocaleString()}`,
        _pending: `₹${item.pending.toLocaleString()}`,
      })),
    [yardWiseCollection],
  );

  const gstSummary = useMemo(() => {
    return invoicesForFilters.reduce(
      (acc, inv) => ({
        totalBase: acc.totalBase + inv.baseRent,
        totalCGST: acc.totalCGST + inv.cgst,
        totalSGST: acc.totalSGST + inv.sgst,
        totalInterest: acc.totalInterest + inv.interest,
        grandTotal: acc.grandTotal + inv.total,
      }),
      { totalBase: 0, totalCGST: 0, totalSGST: 0, totalInterest: 0, grandTotal: 0 },
    );
  }, [invoicesForFilters]);

  const gstSourceRows = useMemo((): Record<string, unknown>[] => {
    return [
      {
        id: "base",
        metric: "Total base rent",
        amount: gstSummary.totalBase,
        _amount: `₹${gstSummary.totalBase.toLocaleString()}`,
      },
      {
        id: "cgst",
        metric: "Total CGST",
        amount: gstSummary.totalCGST,
        _amount: `₹${gstSummary.totalCGST.toLocaleString()}`,
      },
      {
        id: "sgst",
        metric: "Total SGST",
        amount: gstSummary.totalSGST,
        _amount: `₹${gstSummary.totalSGST.toLocaleString()}`,
      },
      {
        id: "interest",
        metric: "Total interest",
        amount: gstSummary.totalInterest,
        _amount: `₹${gstSummary.totalInterest.toLocaleString()}`,
      },
      {
        id: "grand",
        metric: "Grand total",
        amount: gstSummary.grandTotal,
        _amount: `₹${gstSummary.grandTotal.toLocaleString()}`,
      },
    ];
  }, [gstSummary]);

  const outSlice = useMemo(
    () =>
      sliceClientReport(outstandingSourceRows, outParams, [
        "invoiceNo",
        "traderName",
        "traderMobile",
        "yard",
        "total",
        "status",
      ]),
    [outstandingSourceRows, outParams],
  );

  const yardSlice = useMemo(
    () =>
      sliceClientReport(yardSourceRows, yardParams, ["yard", "code", "totalInvoices", "totalAmount", "collected", "pending"]),
    [yardSourceRows, yardParams],
  );

  const gstSlice = useMemo(
    () => sliceClientReport(gstSourceRows, gstParams, ["metric", "amount"]),
    [gstSourceRows, gstParams],
  );

  const outTotalPages =
    outParams.pageSize === "all" ? 1 : Math.max(1, Math.ceil(outSlice.total / outParams.pageSize));
  const yardTotalPages =
    yardParams.pageSize === "all" ? 1 : Math.max(1, Math.ceil(yardSlice.total / yardParams.pageSize));
  const gstTotalPages =
    gstParams.pageSize === "all" ? 1 : Math.max(1, Math.ceil(gstSlice.total / gstParams.pageSize));

  useEffect(() => {
    if (outSlice.total > 0 && outParams.page > outTotalPages) {
      setOutParams((p) => ({ ...p, page: outTotalPages }));
    }
  }, [outSlice.total, outTotalPages, outParams.page]);

  useEffect(() => {
    if (yardSlice.total > 0 && yardParams.page > yardTotalPages) {
      setYardParams((p) => ({ ...p, page: yardTotalPages }));
    }
  }, [yardSlice.total, yardTotalPages, yardParams.page]);

  useEffect(() => {
    if (gstSlice.total > 0 && gstParams.page > gstTotalPages) {
      setGstParams((p) => ({ ...p, page: gstTotalPages }));
    }
  }, [gstSlice.total, gstTotalPages, gstParams.page]);

  const outstandingColumns = useMemo(
    (): ReportTableColumn[] => [
      { key: "invoiceNo", header: "Invoice No" },
      { key: "traderName", header: "Trader Name" },
      { key: "traderMobile", header: "Mobile" },
      { key: "yard", header: "Yard" },
      { key: "_amount", header: "Amount Due", sortField: "total" },
      { key: "_status", header: "Status", sortField: "status" },
    ],
    [],
  );

  const yardColumns = useMemo(
    (): ReportTableColumn[] => [
      { key: "yardNote", header: "Yard", sortField: "yard" },
      { key: "code", header: "Code" },
      { key: "totalInvoices", header: "Invoices" },
      { key: "_totalAmt", header: "Total Amount", sortField: "totalAmount" },
      { key: "_collected", header: "Collected", sortField: "collected" },
      { key: "_pending", header: "Pending", sortField: "pending" },
    ],
    [],
  );

  const gstColumns = useMemo(
    (): ReportTableColumn[] => [
      { key: "metric", header: "Metric" },
      { key: "_amount", header: "Amount (₹)", sortField: "amount" },
    ],
    [],
  );

  const handleExport = useCallback(() => {
    const suffix = dateFrom || dateTo ? `_${dateFrom || "start"}_${dateTo || "end"}` : "";
    if (activeTab === "outstanding") {
      const flat = invoicesForFilters
        .filter((i) => i.status !== "Paid")
        .map((item) => {
          const trader = (traders ?? []).find((t) => t.id === item.traderId);
          return {
            ...item,
            traderMobile: trader?.mobile || "",
          };
        });
      downloadCsv(
        `rent-outstanding${suffix}`,
        ["Invoice ID", "Trader", "Mobile", "Yard", "Amount", "Status", "Invoice date (DD-MM-YYYY)"],
        flat.map((item) => [
          item.id,
          item.traderName,
          item.traderMobile,
          item.yard,
          item.total,
          item.status,
          formatYmdToDisplay(item.invoiceDate),
        ]),
      );
    } else if (activeTab === "yardwise") {
      downloadCsv(
        `rent-yardwise${suffix}`,
        ["Yard", "Code", "Invoices", "Total", "Collected", "Pending"],
        yardWiseCollection.map((item) => [
          item.yard,
          item.code,
          item.totalInvoices,
          item.totalAmount,
          item.collected,
          item.pending,
        ]),
      );
    } else {
      downloadCsv(`rent-gst-summary${suffix}`, ["Metric", "Amount (₹)"], [
        ["Total base rent", gstSummary.totalBase],
        ["Total CGST", gstSummary.totalCGST],
        ["Total SGST", gstSummary.totalSGST],
        ["Total interest", gstSummary.totalInterest],
        ["Grand total", gstSummary.grandTotal],
      ]);
    }
    toast({ title: "Download started", description: "CSV file download should begin shortly." });
  }, [
    activeTab,
    dateFrom,
    dateTo,
    invoicesForFilters,
    traders,
    yardWiseCollection,
    gstSummary,
    toast,
  ]);

  if (invoicesError || yardsError) {
    return (
      <AppShell breadcrumbs={[{ label: "Rent & Tax", href: "/rent" }, { label: "Reports" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Failed to load report data. Please try again.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Rent & Tax", href: "/rent" }, { label: "Reports" }]}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-primary" />
            Rent Reports
          </h1>
          <p className="text-muted-foreground">
            Generate and export rent/tax reports (yards: your scope, including inactive). Tables support search, sort,
            pagination, and scroll.
          </p>
        </div>

        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-base">Report Filters</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
            <TabsList className="grid w-full grid-cols-3 lg:w-auto lg:inline-grid">
              <TabsTrigger value="outstanding" data-testid="tab-outstanding">
                Outstanding Dues
              </TabsTrigger>
              <TabsTrigger value="yardwise" data-testid="tab-yardwise">
                Yard-wise Collection
              </TabsTrigger>
              <TabsTrigger value="gst" data-testid="tab-gst">
                GST Summary
              </TabsTrigger>
            </TabsList>

            <TabsContent value="outstanding">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FileText className="h-5 w-5" />
                    Outstanding Dues Report
                  </CardTitle>
                  <CardDescription>Traders with pending payments</CardDescription>
                </CardHeader>
                <CardContent>
                  <ReportDataTable
                    columns={outstandingColumns}
                    rows={outSlice.rows}
                    total={outSlice.total}
                    params={outParams}
                    onParamsChange={mergeOut}
                    searchPlaceholder="Search by invoice no., trader, mobile, yard, status…"
                  />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="yardwise">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BarChart3 className="h-5 w-5" />
                    Yard-wise Collection Report
                  </CardTitle>
                  <CardDescription>Collection summary by yard</CardDescription>
                </CardHeader>
                <CardContent>
                  <ReportDataTable
                    columns={yardColumns}
                    rows={yardSlice.rows}
                    total={yardSlice.total}
                    params={yardParams}
                    onParamsChange={mergeYard}
                    searchPlaceholder="Search by yard, code…"
                  />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="gst">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FileText className="h-5 w-5" />
                    GST Summary (for GSTR-1 filing)
                  </CardTitle>
                  <CardDescription>Tax summary for the selected period</CardDescription>
                </CardHeader>
                <CardContent>
                  <ReportDataTable
                    columns={gstColumns}
                    rows={gstSlice.rows}
                    total={gstSlice.total}
                    params={gstParams}
                    onParamsChange={mergeGst}
                    searchPlaceholder="Search by metric…"
                  />
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        )}
      </div>
    </AppShell>
  );
}
