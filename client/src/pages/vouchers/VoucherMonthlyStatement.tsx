import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ClientDataGrid } from "@/components/reports/ClientDataGrid";
import type { ReportTableColumn } from "@/components/reports/ReportDataTable";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { CalendarDays, Download, AlertCircle } from "lucide-react";

interface StatementRow {
  expenditureHeadId: string;
  headCode: string;
  headDescription: string;
  voucherCount: number;
  totalAmount: number;
}

interface MonthlyPayload {
  month: string;
  basis: "paid";
  monthStart: string;
  monthEnd: string;
  yardId: string | null;
  voucherCount: number;
  grandTotal: number;
  rows: StatementRow[];
}

interface Yard {
  id: string;
  code?: string | null;
  name?: string | null;
}

function defaultMonthYyyyMm(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function VoucherMonthlyStatement() {
  const { toast } = useToast();
  const [month, setMonth] = useState(defaultMonthYyyyMm);
  const [yardId, setYardId] = useState<string>("all");

  const jsonUrl = useMemo(() => {
    const p = new URLSearchParams({ month });
    if (yardId && yardId !== "all") p.set("yardId", yardId);
    return `/api/ioms/vouchers/monthly-statement?${p.toString()}`;
  }, [month, yardId]);

  const { data, isLoading, isError, error } = useQuery<MonthlyPayload>({
    queryKey: ["monthly-statement", month, yardId],
    queryFn: async () => {
      const res = await fetch(jsonUrl, { credentials: "include", headers: { Accept: "application/json" } });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || res.statusText);
      }
      return res.json() as Promise<MonthlyPayload>;
    },
  });

  const { data: yards = [] } = useQuery<Yard[]>({ queryKey: ["/api/yards"] });
  const yardLabel = (id: string) => yards.find((y) => y.id === id)?.name ?? yards.find((y) => y.id === id)?.code ?? id;

  const downloadBlob = async (format: "csv" | "xlsx" | "pdf", ext: string) => {
    try {
      const p = new URLSearchParams({ month, format });
      if (yardId && yardId !== "all") p.set("yardId", yardId);
      const res = await fetch(`/api/ioms/vouchers/monthly-statement?${p}`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `voucher-statement-${month}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Download started", description: `voucher-statement-${month}.${ext}` });
    } catch (e) {
      toast({
        title: "Download failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const downloadCsv = () => downloadBlob("csv", "csv");
  const downloadXlsx = () => downloadBlob("xlsx", "xlsx");
  const downloadPdf = () => downloadBlob("pdf", "pdf");

  const statementColumns = useMemo(
    (): ReportTableColumn[] => [
      { key: "headCode", header: "Head code" },
      { key: "headDescription", header: "Description" },
      { key: "voucherCount", header: "Vouchers" },
      { key: "_totalAmount", header: "Total (INR)", sortField: "totalAmount" },
    ],
    [],
  );

  const statementRows = useMemo((): Record<string, unknown>[] => {
    if (!data) return [];
    return data.rows.map((r) => ({
      id: r.expenditureHeadId,
      headCode: r.headCode,
      headDescription: r.headDescription || "—",
      voucherCount: r.voucherCount,
      totalAmount: r.totalAmount,
      _totalAmount: `₹${r.totalAmount.toLocaleString()}`,
    }));
  }, [data]);

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "Vouchers", href: "/vouchers" }, { label: "Monthly statement" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive shrink-0" />
            <span className="text-destructive">
              {error instanceof Error ? error.message : "Failed to load statement."}
            </span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Vouchers", href: "/vouchers" }, { label: "Monthly statement" }]}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5" />
            Monthly voucher statement (M-06)
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Paid vouchers only; amounts grouped by expenditure head for the selected calendar month (by paid date).
          </p>
          <div className="flex flex-wrap items-end gap-4 pt-2">
            <div className="space-y-1">
              <Label htmlFor="stmt-month">Month</Label>
              <Input
                id="stmt-month"
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className="w-[200px]"
              />
            </div>
            <div className="space-y-1">
              <Label>Yard</Label>
              <Select value={yardId} onValueChange={setYardId}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="All yards" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All yards</SelectItem>
                  {yards.map((y) => (
                    <SelectItem key={y.id} value={y.id}>
                      {y.name ?? y.code ?? y.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={downloadCsv} disabled={!month}>
              <Download className="h-4 w-4 mr-2" />
              CSV
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={downloadXlsx} disabled={!month}>
              <Download className="h-4 w-4 mr-2" />
              XLSX
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={downloadPdf} disabled={!month}>
              <Download className="h-4 w-4 mr-2" />
              PDF
            </Button>
            <Button type="button" variant="ghost" size="sm" asChild>
              <Link href="/vouchers">Back to vouchers</Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : data ? (
            <>
              <p className="text-sm text-muted-foreground mb-4">
                Period {data.monthStart} — {data.monthEnd}
                {data.yardId ? ` · Yard: ${yardLabel(data.yardId)}` : ""} · {data.voucherCount} paid voucher(s) · Grand
                total ₹{data.grandTotal.toLocaleString()}
              </p>
              <ClientDataGrid
                columns={statementColumns}
                sourceRows={statementRows}
                searchKeys={["headCode", "headDescription"]}
                defaultSortKey="headCode"
                defaultSortDir="asc"
                emptyMessage="No paid vouchers in this month for the selected filter."
                resetPageDependency={`${month}|${yardId}`}
              />
            </>
          ) : null}
        </CardContent>
      </Card>
    </AppShell>
  );
}
