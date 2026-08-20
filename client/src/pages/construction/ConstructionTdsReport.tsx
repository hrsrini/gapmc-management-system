import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ClientDataGrid } from "@/components/reports/ClientDataGrid";
import type { ReportTableColumn } from "@/components/reports/ReportDataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { FileSpreadsheet, AlertCircle } from "lucide-react";
import { formatInr } from "@/lib/formatInr";

interface TdsRow {
  voucherId: string;
  voucherNo?: string | null;
  status: string;
  payeeName: string;
  grossAmount: number;
  tdsSection?: string | null;
  tdsRatePercent?: number | null;
  tdsApplicableAmount?: number | null;
  tdsAmount: number;
  netPayable: number;
  paymentMode?: string | null;
  paidAt?: string | null;
  createdAt?: string | null;
  workId?: string | null;
  workOrderNo?: string | null;
}

export default function ConstructionTdsReport() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    const s = p.toString();
    return s ? `?${s}` : "";
  }, [from, to]);

  const { data: rows = [], isLoading, isError } = useQuery<TdsRow[]>({
    queryKey: ["/api/ioms/works/reports/tds", qs],
    queryFn: async () => {
      const res = await fetch(`/api/ioms/works/reports/tds${qs}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load TDS report");
      return res.json();
    },
  });

  const columns = useMemo(
    (): ReportTableColumn[] => [
      { key: "_voucher", header: "Voucher", sortField: "voucherNo" },
      { key: "_work", header: "Work Order", sortField: "workOrderNo" },
      { key: "payeeName", header: "Payee / vendor" },
      { key: "_gross", header: "Gross", sortField: "grossAmount" },
      { key: "tdsSection", header: "Section" },
      { key: "_tds", header: "TDS", sortField: "tdsAmount" },
      { key: "_net", header: "Net payable", sortField: "netPayable" },
      { key: "_status", header: "Status", sortField: "status" },
    ],
    [],
  );

  const sourceRows = useMemo(
    () =>
      rows.map((r) => ({
        id: r.voucherId,
        voucherNo: r.voucherNo ?? r.voucherId,
        workOrderNo: r.workOrderNo ?? "—",
        payeeName: r.payeeName,
        grossAmount: r.grossAmount,
        tdsSection: r.tdsSection ?? "—",
        tdsAmount: r.tdsAmount,
        netPayable: r.netPayable,
        status: r.status,
        _voucher: (
          <Link href={`/vouchers/${r.voucherId}`} className="text-primary underline font-mono text-sm">
            {r.voucherNo ?? r.voucherId.slice(0, 8)}
          </Link>
        ),
        _work: r.workId ? (
          <Link href={`/construction/works/${r.workId}`} className="text-primary underline text-sm">
            {r.workOrderNo ?? r.workId.slice(0, 8)}
          </Link>
        ) : (
          "—"
        ),
        _gross: formatInr(r.grossAmount),
        _tds: `${formatInr(r.tdsAmount)}${r.tdsRatePercent != null ? ` (${r.tdsRatePercent}%)` : ""}`,
        _net: formatInr(r.netPayable),
        _status: <Badge variant="outline">{r.status}</Badge>,
      })),
    [rows],
  );

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, r) => {
        acc.gross += Number(r.grossAmount) || 0;
        acc.tds += Number(r.tdsAmount) || 0;
        acc.net += Number(r.netPayable) || 0;
        return acc;
      },
      { gross: 0, tds: 0, net: 0 },
    );
  }, [rows]);

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "Construction", href: "/construction" }, { label: "TDS report" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Failed to load TDS report.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Construction", href: "/construction" }, { label: "TDS report" }]}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            Works TDS report
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            M-08 payment vouchers with TDS applicable (linked Work Orders).
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label>From</Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>To</Label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            {(from || to) && (
              <Button type="button" variant="outline" size="sm" onClick={() => { setFrom(""); setTo(""); }}>
                Clear
              </Button>
            )}
          </div>
          <div className="flex flex-wrap gap-4 text-sm">
            <span>Gross: <strong>{formatInr(totals.gross)}</strong></span>
            <span>TDS: <strong>{formatInr(totals.tds)}</strong></span>
            <span>Net: <strong>{formatInr(totals.net)}</strong></span>
            <span className="text-muted-foreground">{rows.length} voucher(s)</span>
          </div>
          {isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <ClientDataGrid
              columns={columns}
              sourceRows={sourceRows}
              searchKeys={["voucherNo", "workOrderNo", "payeeName", "tdsSection", "status"]}
              defaultSortKey="voucherNo"
              defaultSortDir="desc"
              emptyMessage="No TDS vouchers for Works yet."
            />
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
