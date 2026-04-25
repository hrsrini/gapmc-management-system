import { useCallback, useMemo, useState } from "react";
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
import { useToast } from "@/hooks/use-toast";
import { FileText, Receipt, Banknote, Download, UserCircle, BarChart3, Table2, Truck, Clock } from "lucide-react";
import {
  ReportDataTable,
  type ReportPagedParams,
  type ReportTableColumn,
} from "@/components/reports/ReportDataTable";

interface Yard {
  id: string;
  code?: string | null;
  name?: string | null;
}

type ReportKind = "rent" | "voucher" | "receipt" | "staff" | "licences";

function defaultSortKey(kind: ReportKind): string {
  switch (kind) {
    case "rent":
      return "periodMonth";
    case "voucher":
      return "createdAt";
    case "receipt":
      return "createdAt";
    case "staff":
      return "joiningDate";
    case "licences":
      return "createdAt";
    default:
      return "id";
  }
}

function buildPreviewUrl(
  kind: ReportKind,
  yardId: string,
  from: string,
  to: string,
  p: ReportPagedParams,
): string {
  const sp = new URLSearchParams({
    paged: "1",
    page: String(p.page),
    pageSize: String(p.pageSize),
    q: p.q,
    sort: p.sortKey,
    sortDir: p.sortDir,
  });
  if (yardId && yardId !== "all") sp.set("yardId", yardId);
  if (from) sp.set("from", from);
  if (to) sp.set("to", to);
  switch (kind) {
    case "rent":
      return `/api/ioms/reports/rent-summary?${sp}`;
    case "voucher":
      return `/api/ioms/reports/voucher-summary?${sp}`;
    case "receipt":
      return `/api/ioms/reports/receipt-register?${sp}`;
    case "staff":
      return `/api/hr/reports/staff-list?${sp}`;
    case "licences":
      return `/api/ioms/traders/licences?${sp}`;
    default:
      return `/api/ioms/reports/rent-summary?${sp}`;
  }
}

function columnsForKind(kind: ReportKind): ReportTableColumn[] {
  switch (kind) {
    case "rent":
      return [
        { key: "invoiceNo", header: "Invoice no." },
        { key: "yardId", header: "Yard" },
        { key: "periodMonth", header: "Period" },
        { key: "assetId", header: "Asset" },
        { key: "rentAmount", header: "Rent" },
        { key: "totalAmount", header: "Total" },
        { key: "status", header: "Status" },
      ];
    case "voucher":
      return [
        { key: "voucherNo", header: "Voucher no." },
        { key: "yardId", header: "Yard" },
        { key: "voucherType", header: "Type" },
        { key: "payeeName", header: "Payee" },
        { key: "amount", header: "Amount" },
        { key: "status", header: "Status" },
        { key: "createdAt", header: "Created" },
      ];
    case "receipt":
      return [
        { key: "receiptNo", header: "Receipt no." },
        { key: "yardId", header: "Yard" },
        { key: "revenueHead", header: "Head" },
        { key: "payerName", header: "Payer" },
        { key: "totalAmount", header: "Total" },
        { key: "paymentMode", header: "Mode" },
        { key: "status", header: "Status" },
        { key: "createdAt", header: "Created" },
      ];
    case "staff":
      return [
        { key: "empId", header: "Emp. ID" },
        { key: "firstName", header: "First name" },
        { key: "surname", header: "Surname" },
        { key: "designation", header: "Designation" },
        { key: "joiningDate", header: "Joining" },
        { key: "yardId", header: "Yard" },
        { key: "mobile", header: "Mobile" },
        { key: "status", header: "Status" },
      ];
    case "licences":
      return [
        { key: "licenceNo", header: "Licence no." },
        { key: "firmName", header: "Firm / trader name" },
        { key: "licenceType", header: "Type" },
        { key: "mobile", header: "Mobile" },
        { key: "yardId", header: "Yard" },
        { key: "validTo", header: "Valid to" },
        { key: "status", header: "Status" },
      ];
    default:
      return [];
  }
}

function searchPlaceholderForKind(kind: ReportKind): string {
  if (kind === "licences") {
    return "Search by name of trader, licence number, trader mobile no.";
  }
  if (kind === "staff") {
    return "Search by name, emp. ID, mobile, email…";
  }
  return "Search across columns (partial text or numbers)…";
}

interface PagedRowsResponse {
  total: number;
  page: number;
  pageSize: number | "all";
  rows: Record<string, unknown>[];
}

export default function IomsReports() {
  const { toast } = useToast();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [yardId, setYardId] = useState<string>("all");
  const [previewKind, setPreviewKind] = useState<ReportKind>("licences");
  const [ageingAsOf, setAgeingAsOf] = useState(() => new Date().toISOString().slice(0, 10));
  const [tableParams, setTableParams] = useState<ReportPagedParams>({
    page: 1,
    pageSize: 25,
    q: "",
    sortKey: defaultSortKey("licences"),
    sortDir: "desc",
  });

  const mergeTableParams = useCallback((next: Partial<ReportPagedParams>) => {
    setTableParams((s) => ({ ...s, ...next }));
  }, []);

  const previewUrl = useMemo(
    () => buildPreviewUrl(previewKind, yardId, from, to, tableParams),
    [previewKind, yardId, from, to, tableParams],
  );

  const { data: yards = [] } = useQuery<Yard[]>({ queryKey: ["/api/yards/for-reports"] });
  const ageingUrl = useMemo(() => {
    const p = new URLSearchParams();
    p.set("asOf", ageingAsOf);
    if (yardId && yardId !== "all") p.set("yardId", yardId);
    return `/api/ioms/rent/reports/ageing?${p.toString()}`;
  }, [ageingAsOf, yardId]);
  const { data: ageingData, isLoading: ageingLoading, isError: ageingError } = useQuery<{
    asOfDate: string;
    rows: {
      invoiceId: string;
      invoiceNo: string;
      periodMonth: string;
      dueDate: string;
      daysPastDue: number;
      ageingBucket: string;
      outstandingAmount: number;
      status: string;
    }[];
    totals: { count: number; outstanding: number };
    bucketTotals: { bucket: string; count: number; outstanding: number }[];
  }>({
    queryKey: [ageingUrl],
    queryFn: async () => {
      const res = await fetch(ageingUrl, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });
  const consolidatedUrl =
    yardId && yardId !== "all"
      ? `/api/hr/reports/consolidated?yardId=${encodeURIComponent(yardId)}`
      : "/api/hr/reports/consolidated";
  const { data: consolidated } = useQuery<{
    total: number;
    byYard: Record<string, number>;
    byStatus: Record<string, number>;
    byEmployeeType: Record<string, number>;
  }>({
    queryKey: [consolidatedUrl],
    queryFn: async () => {
      const res = await fetch(consolidatedUrl, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const {
    data: pagedData,
    isLoading: previewLoading,
    isError: previewError,
  } = useQuery<PagedRowsResponse>({
    queryKey: [previewUrl],
    queryFn: async () => {
      const res = await fetch(previewUrl, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json() as Promise<PagedRowsResponse>;
    },
  });

  const previewColumns = useMemo(() => columnsForKind(previewKind), [previewKind]);

  const downloadTallyExportCsv = async (layout: "legacy" | "srs") => {
    try {
      const params = new URLSearchParams({ format: "csv" });
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (layout === "srs") params.set("columns", "srs");
      const res = await fetch(`/api/ioms/reports/tally-export?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = layout === "srs" ? "tally-export-srs.csv" : "tally-export.csv";
      a.click();
      URL.revokeObjectURL(url);
      toast({
        title: "Download started",
        description:
          layout === "srs"
            ? "SRS column order (Date, Voucher Type, Receipt No., Party Name, Ledger Head, Tally Group, Dr, Cr, Narration)."
            : "Legacy developer columns (kind, docNo, yardId, amounts, ledger id/name).",
      });
    } catch (e) {
      toast({
        title: "Download failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const downloadCsv = async (report: "rent-summary" | "voucher-summary" | "receipt-register", filename: string) => {
    try {
      const params = new URLSearchParams({ format: "csv" });
      if (yardId && yardId !== "all") params.set("yardId", yardId);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const res = await fetch(`/api/ioms/reports/${report}?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Download started", description: `${filename} is being saved.` });
    } catch (e) {
      toast({
        title: "Download failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const downloadCheckPostCsv = async (endpoint: "check-post-arrivals" | "check-post-passway-transit", filename: string) => {
    try {
      const params = new URLSearchParams({ format: "csv" });
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const res = await fetch(`/api/ioms/reports/${endpoint}?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Download started", description: `${filename} is being saved.` });
    } catch (e) {
      toast({
        title: "Download failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const downloadStaffListCsv = async () => {
    try {
      const params = new URLSearchParams({ format: "csv" });
      if (yardId && yardId !== "all") params.set("yardId", yardId);
      const res = await fetch(`/api/hr/reports/staff-list?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "staff-list.csv";
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Download started", description: "staff-list.csv is being saved." });
    } catch (e) {
      toast({
        title: "Download failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  return (
    <AppShell breadcrumbs={[{ label: "Reports", href: "/reports" }, { label: "IOMS Reports" }]}>
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>IOMS Reports & Export</CardTitle>
            <CardDescription>
              Yard-scoped reports. Optionally filter by yard and date range, then preview data in the table below or
              download CSV (opens in Excel).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Yard</Label>
                <Select value={yardId} onValueChange={setYardId}>
                  <SelectTrigger>
                    <SelectValue placeholder="All yards" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All yards</SelectItem>
                    {(yards as Yard[]).map((y) => (
                      <SelectItem key={y.id} value={y.id}>
                        {y.name ?? y.code ?? y.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>From (period/date)</Label>
                <Input type="text" placeholder="e.g. 2024-04" value={from} onChange={(e) => setFrom(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>To (period/date)</Label>
                <Input type="text" placeholder="e.g. 2025-03" value={to} onChange={(e) => setTo(e.target.value)} />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Table2 className="h-5 w-5" />
              Report preview (filter & search)
            </CardTitle>
            <CardDescription>
              Server-side pagination and search. A synced horizontal bar sits above the grid; the grid also scrolls
              horizontally at the bottom of the data pane. The header stays visible while scrolling vertically.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
              <div className="space-y-2 min-w-[200px]">
                <Label>Report</Label>
                <Select
                  value={previewKind}
                  onValueChange={(v) => {
                    setPreviewKind(v as ReportKind);
                    setTableParams({
                      page: 1,
                      pageSize: 25,
                      q: "",
                      sortKey: defaultSortKey(v as ReportKind),
                      sortDir: "desc",
                    });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="licences">Trader licences (M-02)</SelectItem>
                    <SelectItem value="rent">Rent summary</SelectItem>
                    <SelectItem value="voucher">Voucher summary</SelectItem>
                    <SelectItem value="receipt">Receipt register</SelectItem>
                    <SelectItem value="staff">Staff list (HR)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {previewError ? (
              <p className="text-sm text-destructive">Could not load this report. Check permissions and try again.</p>
            ) : (
              <ReportDataTable
                columns={previewColumns}
                rows={(pagedData?.rows ?? []) as Record<string, unknown>[]}
                total={pagedData?.total ?? 0}
                params={tableParams}
                onParamsChange={mergeTableParams}
                isLoading={previewLoading}
                searchPlaceholder={searchPlaceholderForKind(previewKind)}
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Rent outstanding ageing (M-03)
            </CardTitle>
            <CardDescription>
              Past-due Approved/Overdue invoices with positive balance (total minus Paid/Reconciled M-03 receipts). Due date
              is the last day of the invoice period month. Buckets are days after that due date, as of the date below.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-end gap-4">
              <div className="space-y-2">
                <Label>As of (YYYY-MM-DD)</Label>
                <Input
                  className="w-44"
                  type="text"
                  value={ageingAsOf}
                  onChange={(e) => setAgeingAsOf(e.target.value)}
                  placeholder="2026-04-25"
                />
              </div>
              {ageingData && (
                <p className="text-sm text-muted-foreground">
                  {ageingData.totals.count} line(s) · total outstanding ≈ ₹{ageingData.totals.outstanding.toLocaleString()}
                </p>
              )}
            </div>
            {ageingError && <p className="text-sm text-destructive">Could not load ageing (check M-03 read access).</p>}
            {ageingLoading && <Skeleton className="h-32 w-full" />}
            {!ageingLoading && !ageingError && ageingData && (
              <div className="space-y-3">
                {ageingData.bucketTotals && ageingData.bucketTotals.length > 0 && (
                  <div className="flex flex-wrap gap-2 text-xs">
                    {ageingData.bucketTotals.map((b) => (
                      <span
                        key={b.bucket}
                        className="rounded border bg-muted/50 px-2 py-1"
                        title="Bucket count / outstanding"
                      >
                        {b.bucket} d: {b.count} · ₹{b.outstanding.toLocaleString()}
                      </span>
                    ))}
                  </div>
                )}
                <div className="overflow-x-auto border rounded-md">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/30 text-left">
                        <th className="p-2">Invoice</th>
                        <th className="p-2">Period</th>
                        <th className="p-2">Due</th>
                        <th className="p-2">Days</th>
                        <th className="p-2">Bucket</th>
                        <th className="p-2">Outstanding</th>
                        <th className="p-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ageingData.rows.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="p-4 text-muted-foreground">
                            No past-due outstanding IOMS rent invoices for this filter.
                          </td>
                        </tr>
                      ) : (
                        ageingData.rows.map((r) => (
                          <tr key={r.invoiceId} className="border-b border-border/50">
                            <td className="p-2 font-mono text-xs">{r.invoiceNo}</td>
                            <td className="p-2">{r.periodMonth}</td>
                            <td className="p-2">{r.dueDate}</td>
                            <td className="p-2">{r.daysPastDue}</td>
                            <td className="p-2">{r.ageingBucket}</td>
                            <td className="p-2">₹{r.outstandingAmount.toLocaleString()}</td>
                            <td className="p-2">{r.status}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Rent summary
              </CardTitle>
              <CardDescription>IOMS rent invoices by period; totals and counts by status.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={() => downloadCsv("rent-summary", "rent-summary.csv")} variant="outline" className="w-full">
                <Download className="h-4 w-4 mr-2" />
                Download CSV
              </Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Banknote className="h-5 w-5" />
                Voucher summary
              </CardTitle>
              <CardDescription>Payment vouchers by yard; totals and counts by status.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                onClick={() => downloadCsv("voucher-summary", "voucher-summary.csv")}
                variant="outline"
                className="w-full"
              >
                <Download className="h-4 w-4 mr-2" />
                Download CSV
              </Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Truck className="h-5 w-5" />
                Check-post arrivals (excl. passway)
              </CardTitle>
              <CardDescription>
                Aggregated commodity quantities from verified inward entries. Passway/Transit is excluded (separate
                report). Uses From/To as entry dates (e.g. 2025-01-01).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                onClick={() => downloadCheckPostCsv("check-post-arrivals", "check-post-arrivals.csv")}
                variant="outline"
                className="w-full"
              >
                <Download className="h-4 w-4 mr-2" />
                Download CSV
              </Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Truck className="h-5 w-5" />
                Passway / transit volumes
              </CardTitle>
              <CardDescription>
                Same layout as arrivals, but only Passway/Transit lines (administrative tracking). Date filter as above.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                onClick={() => downloadCheckPostCsv("check-post-passway-transit", "check-post-passway-transit.csv")}
                variant="outline"
                className="w-full"
              >
                <Download className="h-4 w-4 mr-2" />
                Download CSV
              </Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Receipt className="h-5 w-5" />
                Receipt register
              </CardTitle>
              <CardDescription>IOMS receipts by yard and date; revenue head and amount.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                onClick={() => downloadCsv("receipt-register", "receipt-register.csv")}
                variant="outline"
                className="w-full"
              >
                <Download className="h-4 w-4 mr-2" />
                Download CSV
              </Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Tally export (CC-14)
              </CardTitle>
              <CardDescription>
                Receipts and payment vouchers with mapped Tally ledger names; optional date range and yard filter above.
                Use <strong>SRS layout</strong> for the agreed Tally CSV column order (Dr/Cr convention: receipts as Dr, payments as Cr).
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <Button onClick={() => downloadTallyExportCsv("legacy")} variant="outline" className="w-full">
                <Download className="h-4 w-4 mr-2" />
                Download (legacy columns)
              </Button>
              <Button onClick={() => downloadTallyExportCsv("srs")} variant="outline" className="w-full">
                <Download className="h-4 w-4 mr-2" />
                Download (SRS column order)
              </Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserCircle className="h-5 w-5" />
                Staff list (HR)
              </CardTitle>
              <CardDescription>
                Employee list by yard; empId, name, designation, joining, status. Optional yard filter above.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={downloadStaffListCsv} variant="outline" className="w-full">
                <Download className="h-4 w-4 mr-2" />
                Download CSV
              </Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                Consolidated HR
              </CardTitle>
              <CardDescription>Headcount summary by yard, status and type. Uses yard filter above.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {consolidated != null && (
                <>
                  <p className="text-2xl font-semibold">{consolidated.total} employees</p>
                  {Object.keys(consolidated.byStatus).length > 0 && (
                    <div className="text-sm text-muted-foreground">
                      By status: {Object.entries(consolidated.byStatus).map(([k, v]) => `${k}: ${v}`).join(", ")}
                    </div>
                  )}
                  {Object.keys(consolidated.byEmployeeType).length > 0 && (
                    <div className="text-sm text-muted-foreground">
                      By type: {Object.entries(consolidated.byEmployeeType).map(([k, v]) => `${k}: ${v}`).join(", ")}
                    </div>
                  )}
                  {yardId === "all" && Object.keys(consolidated.byYard).length > 0 && (
                    <div className="text-sm text-muted-foreground">
                      By yard: {Object.entries(consolidated.byYard).map(([k, v]) => `${k}: ${v}`).join(", ")}
                    </div>
                  )}
                </>
              )}
              <Button onClick={downloadStaffListCsv} variant="outline" className="w-full mt-2">
                <Download className="h-4 w-4 mr-2" />
                Download CSV
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
