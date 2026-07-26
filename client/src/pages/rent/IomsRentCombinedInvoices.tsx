import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ClientDataGrid } from "@/components/reports/ClientDataGrid";
import type { ReportTableColumn } from "@/components/reports/ReportDataTable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/context/AuthContext";
import { Link } from "wouter";
import { formatInr } from "@/lib/formatInr";
import { FileStack, Plus, Download, Loader2, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface CombinedBundle {
  id: string;
  bundleInvoiceNo: string;
  periodMonth: string;
  yardId: string;
  tenantLicenceId: string;
  tenantName?: string | null;
  totalAmount: number;
  outstandingTotal: number;
  status: string;
  children: Array<{ assetCode: string }>;
}

export default function IomsRentCombinedInvoices() {
  const { can } = useAuth();
  const { toast } = useToast();
  const canCreate = can("M-03", "Create");
  const [pdfLoadingId, setPdfLoadingId] = useState<string | null>(null);
  const { data: yards = [] } = useQuery<Array<{ id: string; name: string }>>({ queryKey: ["/api/yards"] });
  const yardById = Object.fromEntries(yards.map((y) => [y.id, y.name]));
  const { data: list, isLoading, isError } = useQuery<CombinedBundle[]>({
    queryKey: ["/api/ioms/rent/combined-invoices"],
  });

  const downloadPdf = async (bundle: CombinedBundle) => {
    setPdfLoadingId(bundle.id);
    try {
      const res = await fetch(`/api/ioms/rent/combined-invoices/${encodeURIComponent(bundle.id)}/pdf`, {
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? res.statusText);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `combined-rent-invoice-${bundle.bundleInvoiceNo.replace(/[/\\]/g, "-")}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Bundle PDF downloaded" });
    } catch (e: unknown) {
      toast({
        title: "PDF download failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setPdfLoadingId(null);
    }
  };

  const columns = useMemo((): ReportTableColumn[] => [
    { key: "_no", header: "Bundle No", sortField: "bundleInvoiceNo" },
    { key: "tenantName", header: "Trader / Entity name", sortField: "tenantName" },
    { key: "periodMonth", header: "Billing month" },
    { key: "yardName", header: "Yard" },
    { key: "_premises", header: "Premises" },
    { key: "_total", header: "Total (₹)", sortField: "totalAmount" },
    { key: "_outstanding", header: "Outstanding (₹)", sortField: "outstandingTotal" },
    { key: "_status", header: "Status", sortField: "status" },
    { key: "_actions", header: "Actions" },
  ], []);

  const rows = useMemo(() => {
    return (list ?? []).map((b) => ({
      id: b.id,
      bundleInvoiceNo: b.bundleInvoiceNo,
      tenantName: b.tenantName?.trim() || "—",
      periodMonth: b.periodMonth,
      yardName: yardById[b.yardId] ?? b.yardId,
      totalAmount: b.totalAmount,
      outstandingTotal: b.outstandingTotal,
      status: b.status,
      _no: (
        <Link href={`/rent/ioms/combined-invoices/${b.id}`} className="text-primary hover:underline font-mono text-sm">
          {b.bundleInvoiceNo}
        </Link>
      ),
      _premises: `${b.children.length} premises`,
      _total: formatInr(b.totalAmount),
      _outstanding: formatInr(b.outstandingTotal),
      _status: <Badge variant="secondary">{b.status}</Badge>,
      _actions: (
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => void downloadPdf(b)} disabled={pdfLoadingId === b.id}>
            {pdfLoadingId === b.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          </Button>
        </div>
      ),
    }));
  }, [list, yardById, pdfLoadingId]);

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "Rent (IOMS)", href: "/rent/ioms" }, { label: "Combined invoices" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Failed to load combined invoices.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Rent (IOMS)", href: "/rent/ioms" }, { label: "Combined invoices" }]}>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FileStack className="h-5 w-5" />
              Combined tax invoices (multiple premises)
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Same billing month, same tenant and yard. Individual premises PDFs are replaced by the bundle PDF only.
            </p>
          </div>
          {canCreate ? (
            <Button asChild size="sm">
              <Link href="/rent/ioms/combined-invoices/new">
                <Plus className="h-4 w-4 mr-2" /> Create combined invoice
              </Link>
            </Button>
          ) : null}
        </CardHeader>
        <CardContent>
          {isLoading ? <Skeleton className="h-48 w-full" /> : (
            <ClientDataGrid
              columns={columns}
              sourceRows={rows}
              searchKeys={["bundleInvoiceNo", "tenantName", "periodMonth", "yardName", "status"]}
              defaultSortKey="bundleInvoiceNo"
              defaultSortDir="desc"
            />
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
