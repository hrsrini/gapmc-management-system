import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ClientDataGrid } from "@/components/reports/ClientDataGrid";
import type { ReportTableColumn } from "@/components/reports/ReportDataTable";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Mail, AlertCircle, PlusCircle, Search, Download } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatYmdToDisplay } from "@/lib/dateFormat";
import { localCalendarYmd } from "@shared/premises-allocation";

type RegisterRow = {
  id: string;
  srNo: number;
  inwardNo: string;
  date: string;
  dateYmd: string;
  fromParty: string;
  address: string;
  subject: string;
  modeOfReceipt: string;
};

type RegisterPayload = {
  title: string;
  mode: "date" | "range";
  fromDate: string;
  toDate: string;
  filterLabel: string;
  generatedAtDisplay: string;
  rows: RegisterRow[];
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

export default function DakInward() {
  const { can } = useAuth();
  const { toast } = useToast();
  const canCreate = can("M-09", "Create");
  const [searchParams, setSearchParams] = useSearchParams();
  const [subjectDraft, setSubjectDraft] = useState("");
  const [subjectApplied, setSubjectApplied] = useState("");

  const [mode, setMode] = useState<"date" | "range">("date");
  const [onDate, setOnDate] = useState(() => localCalendarYmd());
  const [fromDate, setFromDate] = useState(() => localCalendarYmd());
  const [toDate, setToDate] = useState(() => localCalendarYmd());
  const [previewKey, setPreviewKey] = useState(1);
  const [exporting, setExporting] = useState<"pdf" | "xlsx" | null>(null);

  useEffect(() => {
    const s = searchParams.get("subject")?.trim() ?? "";
    setSubjectDraft(s);
    setSubjectApplied(s);
  }, [searchParams]);

  const reportQueryUrl = useMemo(() => {
    if (previewKey === 0) return "";
    const params = new URLSearchParams({ mode, format: "json" });
    if (mode === "date") params.set("date", onDate);
    else {
      params.set("fromDate", fromDate);
      params.set("toDate", toDate);
    }
    if (subjectApplied.trim()) params.set("subject", subjectApplied.trim());
    return `/api/ioms/dak/inward/register-report?${params.toString()}`;
  }, [previewKey, mode, onDate, fromDate, toDate, subjectApplied]);

  const {
    data: report,
    isLoading,
    isFetching,
    isError,
    error,
  } = useQuery<RegisterPayload>({
    queryKey: [reportQueryUrl],
    queryFn: async () => {
      const res = await fetch(reportQueryUrl, { credentials: "include" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? res.statusText);
      }
      return res.json();
    },
    enabled: Boolean(reportQueryUrl),
  });

  const { data: slaPayload } = useQuery<{ count: number; asOf: string }>({
    queryKey: ["/api/ioms/dak/inward/sla-overdue"],
  });

  const inwardColumns = useMemo(
    (): ReportTableColumn[] => [
      { key: "_inwardNo", header: "Inward No.", sortField: "inwardNoSort" },
      { key: "dateDisplay", header: "Date", sortField: "dateSort" },
      { key: "fromParty", header: "From" },
      { key: "address", header: "Address" },
      { key: "subject", header: "Subject" },
      { key: "modeOfReceipt", header: "Mode of Receipt" },
    ],
    [],
  );

  const inwardRows = useMemo((): Record<string, unknown>[] => {
    return (report?.rows ?? []).map((d) => ({
      id: d.id,
      inwardNoSort: d.inwardNo,
      _inwardNo: (
        <Link href={`/correspondence/inward/${encodeURIComponent(d.id)}`} className="text-primary hover:underline font-mono text-sm">
          {d.inwardNo}
        </Link>
      ),
      dateSort: d.dateYmd,
      dateDisplay: d.date,
      fromParty: d.fromParty,
      address: d.address,
      subject: d.subject,
      modeOfReceipt: d.modeOfReceipt,
    }));
  }, [report?.rows]);

  function runPreview() {
    if (mode === "date" && !onDate) {
      toast({ title: "Date required", description: "Select a date for Particular date.", variant: "destructive" });
      return;
    }
    if (mode === "range" && (!fromDate || !toDate)) {
      toast({ title: "Date range required", description: "Select From and To dates.", variant: "destructive" });
      return;
    }
    if (mode === "range" && fromDate > toDate) {
      toast({ title: "Invalid range", description: "From date must be on or before To date.", variant: "destructive" });
      return;
    }
    setPreviewKey((k) => k + 1);
  }

  async function exportReport(format: "pdf" | "xlsx") {
    try {
      setExporting(format);
      const params = new URLSearchParams({ mode, format });
      if (mode === "date") params.set("date", onDate);
      else {
        params.set("fromDate", fromDate);
        params.set("toDate", toDate);
      }
      if (subjectApplied.trim()) params.set("subject", subjectApplied.trim());
      await downloadBlob(
        `/api/ioms/dak/inward/register-report?${params.toString()}`,
        `Inward_Register.${format === "xlsx" ? "xlsx" : "pdf"}`,
      );
      toast({
        title: "Export ready",
        description: format === "xlsx" ? "Excel register downloaded." : "A4 PDF register downloaded.",
      });
    } catch (e) {
      toast({
        title: "Export failed",
        description: e instanceof Error ? e.message : "Export failed",
        variant: "destructive",
      });
    } finally {
      setExporting(null);
    }
  }

  return (
    <AppShell breadcrumbs={[{ label: "Correspondence (M-09)", href: "/correspondence/inward" }]}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Tapal Inward (IOMS M-09)
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Inward register search — print/paste columns only (no Status). Click column headers to sort.{" "}
            <Link href="/correspondence/inward/subjects" className="text-primary hover:underline">
              Browse by subject
            </Link>
          </p>
          {slaPayload != null && slaPayload.count > 0 && (
            <Alert variant="destructive" className="mt-3">
              <AlertTitle>Deadline overdue</AlertTitle>
              <AlertDescription>
                {slaPayload.count} inward item(s) have a deadline on or before {formatYmdToDisplay(slaPayload.asOf)} and
                are not Closed.
              </AlertDescription>
            </Alert>
          )}

          <div className="flex flex-wrap gap-4 items-end pt-3">
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
                <Label htmlFor="dak-on-date">Date</Label>
                <Input
                  id="dak-on-date"
                  type="date"
                  value={onDate}
                  onChange={(e) => setOnDate(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">Selected: {formatYmdToDisplay(onDate)}</p>
              </div>
            ) : (
              <>
                <div className="space-y-1">
                  <Label htmlFor="dak-from">From</Label>
                  <Input
                    id="dak-from"
                    type="date"
                    value={fromDate}
                    onChange={(e) => setFromDate(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="dak-to">To</Label>
                  <Input id="dak-to" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
                </div>
              </>
            )}
            <Button type="button" variant="secondary" size="sm" onClick={runPreview}>
              Preview
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={exporting != null}
              onClick={() => void exportReport("xlsx")}
            >
              <Download className="h-4 w-4 mr-1" />
              {exporting === "xlsx" ? "…" : "Export Excel"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={exporting != null}
              onClick={() => void exportReport("pdf")}
            >
              <Download className="h-4 w-4 mr-1" />
              {exporting === "pdf" ? "…" : "Export PDF"}
            </Button>
            {canCreate && (
              <Button asChild size="sm" className="ml-auto">
                <Link href="/correspondence/inward/new">
                  <PlusCircle className="h-4 w-4 mr-2" />
                  Add inward
                </Link>
              </Button>
            )}
          </div>

          <div className="flex flex-wrap items-end gap-3 pt-2">
            <div className="space-y-1 min-w-[200px] flex-1 max-w-md">
              <Label htmlFor="dak-subject">Subject contains</Label>
              <Input
                id="dak-subject"
                placeholder="Filter by subject text…"
                value={subjectDraft}
                onChange={(e) => setSubjectDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    setSubjectApplied(subjectDraft.trim());
                    setPreviewKey((k) => (k === 0 ? 1 : k + 1));
                  }
                }}
              />
            </div>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => {
                const t = subjectDraft.trim();
                setSubjectApplied(t);
                setSearchParams(
                  (prev) => {
                    const p = new URLSearchParams(prev);
                    if (t) p.set("subject", t);
                    else p.delete("subject");
                    return p;
                  },
                  { replace: true },
                );
                if (previewKey > 0) setPreviewKey((k) => k + 1);
              }}
            >
              <Search className="h-4 w-4 mr-2" />
              Search
            </Button>
            {subjectApplied && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setSubjectDraft("");
                  setSubjectApplied("");
                  setSearchParams(
                    (prev) => {
                      const p = new URLSearchParams(prev);
                      p.delete("subject");
                      return p;
                    },
                    { replace: true },
                  );
                  if (previewKey > 0) setPreviewKey((k) => k + 1);
                }}
              >
                Clear
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {previewKey === 0 ? (
            <p className="text-sm text-muted-foreground">Choose dates and click Preview to load the inward register.</p>
          ) : isLoading || isFetching ? (
            <Skeleton className="h-64 w-full" />
          ) : isError ? (
            <div className="flex items-center gap-2 text-destructive text-sm">
              <AlertCircle className="h-4 w-4" />
              {(error as Error)?.message || "Failed to load inward register."}
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm font-medium">{report?.title}</p>
              <p className="text-xs text-muted-foreground">{report?.filterLabel}</p>
              <ClientDataGrid
                columns={inwardColumns}
                sourceRows={inwardRows}
                searchKeys={["inwardNoSort", "dateDisplay", "fromParty", "address", "subject", "modeOfReceipt"]}
                searchPlaceholder="Search register…"
                defaultSortKey="dateSort"
                defaultSortDir="desc"
                emptyMessage="No inward items for the selected criteria."
                resetPageDependency={reportQueryUrl}
              />
            </div>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
