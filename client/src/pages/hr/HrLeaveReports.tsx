import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { CalendarDays, Download, FileText } from "lucide-react";
import { EmployeeSearchSelect } from "@/components/selects/employee-search-select";
import { localCalendarYmd } from "@shared/premises-allocation";
import { formatLeaveOrderDateDisplay } from "@shared/hr-leave-display";
import { ClientDataGrid } from "@/components/reports/ClientDataGrid";
import type { ReportTableColumn } from "@/components/reports/ReportDataTable";

type EmployeeLeaveReportRow = {
  srNo: number;
  empId: string;
  employeeName: string;
  designation: string;
  primaryLocation: string;
  secondaryLocation: string;
  thirdLocation: string;
  leaveType: string;
  daysInPeriod: number;
  sanctionedPeriod: string;
  fromDate: string;
  toDate: string;
};

type EmployeeLeaveReportPayload = {
  title: string;
  mode: "date" | "range";
  fromDate: string;
  toDate: string;
  filterLabel: string;
  generatedAtDisplay: string;
  rows: EmployeeLeaveReportRow[];
};

async function downloadBlob(url: string, fallbackName: string) {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? res.statusText);
  }
  const blob = await res.blob();
  const cd = res.headers.get("Content-Disposition") ?? "";
  const match = /filename="([^"]+)"/.exec(cd);
  const filename = match?.[1] ?? fallbackName;
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}

export default function HrLeaveReports() {
  const { user } = useAuth();
  const { toast } = useToast();
  const isAdmin = Boolean(user?.roles?.some((r) => r.tier === "ADMIN"));

  const [individualEmployeeId, setIndividualEmployeeId] = useState(user?.employeeId ?? "");
  const [individualBusy, setIndividualBusy] = useState(false);

  const [mode, setMode] = useState<"date" | "range">("date");
  const [onDate, setOnDate] = useState(() => localCalendarYmd());
  const [fromDate, setFromDate] = useState(() => localCalendarYmd());
  const [toDate, setToDate] = useState(() => localCalendarYmd());
  const [exporting, setExporting] = useState<"pdf" | "xlsx" | null>(null);
  const [previewKey, setPreviewKey] = useState(0);

  const orgQueryUrl = useMemo(() => {
    if (!isAdmin) return "";
    const params = new URLSearchParams({ mode, format: "json" });
    if (mode === "date") params.set("date", onDate);
    else {
      params.set("fromDate", fromDate);
      params.set("toDate", toDate);
    }
    return `/api/hr/reports/employee-leave?${params.toString()}`;
  }, [isAdmin, mode, onDate, fromDate, toDate]);

  const {
    data: orgReport,
    isLoading: orgLoading,
    isFetching,
    error: orgError,
  } = useQuery<EmployeeLeaveReportPayload>({
    queryKey: [orgQueryUrl, previewKey],
    queryFn: async () => {
      const res = await fetch(orgQueryUrl, { credentials: "include" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? res.statusText);
      }
      return res.json();
    },
    enabled: isAdmin && Boolean(orgQueryUrl) && previewKey > 0,
  });

  const columns = useMemo(
    (): ReportTableColumn[] => [
      { key: "srNo", header: "Sr. No." },
      { key: "empId", header: "Employee ID" },
      { key: "employeeName", header: "Employee Name" },
      { key: "designation", header: "Designation" },
      { key: "primaryLocation", header: "Primary Location Posted" },
      { key: "secondaryLocation", header: "Secondary Location (Additional Charge)" },
      { key: "thirdLocation", header: "Third Location (Additional Charge)" },
      { key: "leaveType", header: "Leave Type" },
      { key: "daysInPeriod", header: "Days in Report Period" },
      { key: "sanctionedPeriod", header: "Actual Sanctioned Leave Period" },
    ],
    [],
  );

  const sourceRows = useMemo(
    () =>
      (orgReport?.rows ?? []).map((r) => ({
        ...r,
        id: `${r.empId}-${r.fromDate}-${r.toDate}-${r.leaveType}-${r.srNo}`,
      })),
    [orgReport],
  );

  async function downloadIndividualStatement() {
    const employeeId = isAdmin ? individualEmployeeId : user?.employeeId ?? "";
    if (!employeeId) {
      toast({
        title: "Select employee",
        description: "Choose an employee for the individual leave balance statement.",
        variant: "destructive",
      });
      return;
    }
    setIndividualBusy(true);
    try {
      await downloadBlob(
        `/api/hr/leave-balance-statement?employeeIds=${encodeURIComponent(employeeId)}`,
        "Leave_Balance_Statement.pdf",
      );
      toast({ title: "Downloaded", description: "Individual Leave Balance Statement PDF ready." });
    } catch (e) {
      toast({
        title: "Download failed",
        description: e instanceof Error ? e.message : "Could not generate statement.",
        variant: "destructive",
      });
    } finally {
      setIndividualBusy(false);
    }
  }

  async function exportOrg(format: "pdf" | "xlsx") {
    if (!isAdmin) return;
    setExporting(format);
    try {
      const params = new URLSearchParams({ mode, format });
      if (mode === "date") params.set("date", onDate);
      else {
        params.set("fromDate", fromDate);
        params.set("toDate", toDate);
      }
      await downloadBlob(
        `/api/hr/reports/employee-leave?${params.toString()}`,
        `Employee_Leave_Report.${format === "xlsx" ? "xlsx" : "pdf"}`,
      );
      toast({
        title: "Downloaded",
        description: format === "xlsx" ? "Excel report downloaded." : "PDF report downloaded.",
      });
    } catch (e) {
      toast({
        title: "Export failed",
        description: e instanceof Error ? e.message : "Could not export report.",
        variant: "destructive",
      });
    } finally {
      setExporting(null);
    }
  }

  function runPreview() {
    if (mode === "range" && fromDate > toDate) {
      toast({
        title: "Invalid dates",
        description: "From date must be on or before To date.",
        variant: "destructive",
      });
      return;
    }
    setPreviewKey((k) => k + 1);
  }

  return (
    <AppShell breadcrumbs={[{ label: "HR", href: "/hr/employees" }, { label: "Leave reports" }]}>
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Individual Employee Leave Balance Statement
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              PDF as on generation date/time — balances after all approved / sanctioned leave to date.
            </p>
          </CardHeader>
          <CardContent className="flex flex-col sm:flex-row gap-3 sm:items-end">
            {isAdmin ? (
              <div className="space-y-1 flex-1 min-w-[220px]">
                <Label>Employee</Label>
                <EmployeeSearchSelect
                  value={individualEmployeeId}
                  onValueChange={setIndividualEmployeeId}
                  placeholder="Select employee…"
                />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground flex-1">
                Statement will be generated for your linked employee record.
              </p>
            )}
            <Button type="button" onClick={() => void downloadIndividualStatement()} disabled={individualBusy}>
              <Download className="h-4 w-4 mr-1" />
              {individualBusy ? "Preparing…" : "Download PDF"}
            </Button>
          </CardContent>
        </Card>

        {isAdmin ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CalendarDays className="h-5 w-5" />
                Employee Leave Report (Organisation)
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Sanctioned leave for a particular date, or overlapping a date range. Export to Excel or PDF.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-4 items-end">
                <div className="space-y-1">
                  <Label>Filter mode</Label>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={mode === "date" ? "default" : "outline"}
                      onClick={() => setMode("date")}
                    >
                      Particular date
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={mode === "range" ? "default" : "outline"}
                      onClick={() => setMode("range")}
                    >
                      Date range
                    </Button>
                  </div>
                </div>
                {mode === "date" ? (
                  <div className="space-y-1">
                    <Label htmlFor="leave-report-on-date">Date</Label>
                    <Input
                      id="leave-report-on-date"
                      type="date"
                      value={onDate}
                      onChange={(e) => setOnDate(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Selected: {formatLeaveOrderDateDisplay(onDate)}
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="space-y-1">
                      <Label htmlFor="leave-report-from">From</Label>
                      <Input
                        id="leave-report-from"
                        type="date"
                        value={fromDate}
                        onChange={(e) => setFromDate(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="leave-report-to">To</Label>
                      <Input
                        id="leave-report-to"
                        type="date"
                        value={toDate}
                        onChange={(e) => setToDate(e.target.value)}
                      />
                    </div>
                  </>
                )}
                <Button type="button" variant="secondary" onClick={runPreview}>
                  Preview
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={exporting != null}
                  onClick={() => void exportOrg("xlsx")}
                >
                  <Download className="h-4 w-4 mr-1" />
                  {exporting === "xlsx" ? "…" : "Export Excel"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={exporting != null}
                  onClick={() => void exportOrg("pdf")}
                >
                  <Download className="h-4 w-4 mr-1" />
                  {exporting === "pdf" ? "…" : "Export PDF"}
                </Button>
              </div>

              {previewKey === 0 ? (
                <p className="text-sm text-muted-foreground">Choose dates and click Preview to load results.</p>
              ) : orgLoading || isFetching ? (
                <Skeleton className="h-48 w-full" />
              ) : orgError ? (
                <p className="text-sm text-destructive">
                  {(orgError as Error).message || "Failed to load report."}
                </p>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm font-medium">{orgReport?.title}</p>
                  <p className="text-xs text-muted-foreground">{orgReport?.filterLabel}</p>
                  <ClientDataGrid
                    columns={columns}
                    sourceRows={sourceRows}
                    defaultSortKey="srNo"
                    defaultSortDir="asc"
                    searchPlaceholder="Search leave report…"
                    emptyMessage="No sanctioned leave for the selected criteria."
                    resetPageDependency={previewKey}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">
              Organisation Employee Leave Report (date / range) is available to Admin users.
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
