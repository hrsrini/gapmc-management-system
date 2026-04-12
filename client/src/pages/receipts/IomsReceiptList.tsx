import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { ClientDataGrid } from "@/components/reports/ClientDataGrid";
import type { ReportTableColumn } from "@/components/reports/ReportDataTable";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { Receipt, AlertCircle, ExternalLink } from "lucide-react";
const REVENUE_HEADS = [
  "Rent",
  "GSTInvoice",
  "MarketFee",
  "LicenceFee",
  "SecurityDeposit",
  "Miscellaneous",
];

interface IomsReceipt {
  id: string;
  receiptNo: string;
  yardId: string;
  revenueHead: string;
  payerName: string | null;
  amount: number;
  totalAmount: number;
  paymentMode: string;
  status: string;
  sourceModule: string | null;
  createdAt: string;
}

export default function IomsReceiptList() {
  const [yardId, setYardId] = useState<string>("all");
  const [revenueHead, setRevenueHead] = useState<string>("all");

  const { data: yards } = useQuery<{ id: string; name: string; code: string }[]>({
    queryKey: ["/api/yards"],
  });

  const params = new URLSearchParams();
  if (yardId && yardId !== "all") params.set("yardId", yardId);
  if (revenueHead && revenueHead !== "all") params.set("revenueHead", revenueHead);
  const url = params.toString() ? `/api/ioms/receipts?${params.toString()}` : "/api/ioms/receipts";
  const { data: receipts, isLoading, isError } = useQuery<IomsReceipt[]>({
    queryKey: [url],
  });

  const receiptColumns = useMemo(
    (): ReportTableColumn[] => [
      { key: "_receiptNo", header: "Receipt No", sortField: "receiptNo" },
      { key: "revenueHead", header: "Revenue head" },
      { key: "payerName", header: "Payer" },
      { key: "_total", header: "Amount", sortField: "totalAmount" },
      { key: "paymentMode", header: "Mode" },
      { key: "_status", header: "Status", sortField: "status" },
      { key: "createdAt", header: "Created" },
      { key: "_verify", header: "" },
    ],
    [],
  );

  const receiptRows = useMemo((): Record<string, unknown>[] => {
    return (receipts ?? []).map((r) => ({
      id: r.id,
      receiptNo: r.receiptNo,
      _receiptNo: (
        <Link href={`/receipts/ioms/${r.id}`} className="text-primary hover:underline font-mono text-sm">
          {r.receiptNo}
        </Link>
      ),
      revenueHead: r.revenueHead,
      payerName: r.payerName ?? "—",
      totalAmount: r.totalAmount,
      _total: `₹${Number(r.totalAmount).toLocaleString("en-IN")}`,
      paymentMode: r.paymentMode,
      status: r.status,
      _status: <Badge variant={r.status === "Paid" ? "default" : "secondary"}>{r.status}</Badge>,
      createdAt: r.createdAt,
      _verify: (
        <a
          href={`/verify/${encodeURIComponent(r.receiptNo)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary text-xs flex items-center gap-1"
        >
          Verify <ExternalLink className="h-3 w-3" />
        </a>
      ),
    }));
  }, [receipts]);

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "Receipts", href: "/receipts" }, { label: "IOMS Receipts" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Failed to load IOMS receipts.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Receipts", href: "/receipts" }, { label: "IOMS Receipts" }]}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5" />
            IOMS Receipts (M-05)
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Central receipt engine — GAPLMB/[LOC]/[FY]/[HEAD]/[NNN]. Verify at /verify/[receiptNo]
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-4 items-end">
            <div className="space-y-2">
              <Label>Yard</Label>
              <Select value={yardId} onValueChange={setYardId}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="All yards" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All yards</SelectItem>
                  {(yards ?? []).map((y) => (
                    <SelectItem key={y.id} value={y.id}>{y.name} ({y.code})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Revenue head</Label>
              <Select value={revenueHead} onValueChange={setRevenueHead}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {REVENUE_HEADS.map((h) => (
                    <SelectItem key={h} value={h}>{h}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <ClientDataGrid
              columns={receiptColumns}
              sourceRows={receiptRows}
              searchKeys={["receiptNo", "revenueHead", "payerName", "paymentMode", "status"]}
              defaultSortKey="createdAt"
              defaultSortDir="desc"
              emptyMessage="No IOMS receipts yet. Receipts are created by other modules (M-02, M-03, M-04, M-06, M-08)."
              resetPageDependency={url}
            />
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
