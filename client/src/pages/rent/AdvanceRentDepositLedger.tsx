import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ClientDataGrid } from "@/components/reports/ClientDataGrid";
import type { ReportTableColumn } from "@/components/reports/ReportDataTable";
import { formatInr } from "@/lib/formatInr";
import { AlertCircle } from "lucide-react";

type Entry = {
  id: string;
  entryDate: string;
  entryType: string;
  amountInr: number;
  balanceAfter: number;
  invoiceNo?: string | null;
  adjustmentRef?: string | null;
  rentReceiptNo?: string | null;
  remarks?: string | null;
};

type Detail = {
  id: string;
  depositReceiptNo: string;
  depositAmount: number;
  adjustedAmount: number;
  balanceAmount: number;
  status: string;
  traderName?: string | null;
  premisesCode?: string | null;
  receiptId?: string | null;
  entries: Entry[];
};

export default function AdvanceRentDepositLedger() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, isError } = useQuery<Detail>({
    queryKey: [`/api/ioms/rent/advance-deposits/${id}`],
    enabled: Boolean(id),
  });

  const columns: ReportTableColumn[] = [
    { key: "entryDate", header: "Date" },
    { key: "_particulars", header: "Particulars" },
    { key: "_received", header: "Received (₹)" },
    { key: "_adjusted", header: "Adjusted (₹)" },
    { key: "_balance", header: "Balance (₹)" },
    { key: "adjustmentRef", header: "Ref." },
  ];

  const rows = (data?.entries ?? []).map((e) => {
    const received = e.amountInr > 0 ? e.amountInr : 0;
    const adjusted = e.amountInr < 0 ? Math.abs(e.amountInr) : 0;
    return {
      id: e.id,
      entryDate: e.entryDate,
      adjustmentRef: e.adjustmentRef ?? "—",
      _particulars: e.remarks || e.entryType,
      _received: received > 0 ? formatInr(received) : "—",
      _adjusted: adjusted > 0 ? formatInr(adjusted) : "—",
      _balance: formatInr(e.balanceAfter),
    };
  });

  if (isLoading) {
    return (
      <AppShell breadcrumbs={[{ label: "Advance rent deposits", href: "/rent/ioms/advance-deposits" }, { label: "Ledger" }]}>
        <Skeleton className="h-64 w-full" />
      </AppShell>
    );
  }
  if (isError || !data) {
    return (
      <AppShell breadcrumbs={[{ label: "Advance rent deposits", href: "/rent/ioms/advance-deposits" }, { label: "Ledger" }]}>
        <div className="flex items-center gap-2 text-destructive">
          <AlertCircle className="h-4 w-4" /> Deposit not found
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell
      breadcrumbs={[
        { label: "Rent (IOMS)", href: "/rent/ioms" },
        { label: "Advance rent deposits", href: "/rent/ioms/advance-deposits" },
        { label: "Deposit ledger" },
      ]}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h1 className="text-2xl font-semibold">Deposit ledger</h1>
            <p className="text-sm text-muted-foreground">
              {data.traderName} · {data.premisesCode} · {data.depositReceiptNo}
            </p>
          </div>
          <div className="flex gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/rent/ioms/advance-deposits">All deposits</Link>
            </Button>
            {data.receiptId && (
              <Button asChild variant="outline" size="sm">
                <Link href={`/receipts/ioms/${data.receiptId}`}>Deposit receipt</Link>
              </Button>
            )}
            <Button asChild size="sm" variant="secondary">
              <Link href="/traders/payment-adjustments">Refund or other adjustment</Link>
            </Button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">Deposit received</CardTitle>
            </CardHeader>
            <CardContent className="text-xl font-semibold">{formatInr(data.depositAmount)}</CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">Adjusted so far</CardTitle>
            </CardHeader>
            <CardContent className="text-xl font-semibold">{formatInr(data.adjustedAmount)}</CardContent>
          </Card>
          <Card className="bg-primary/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">Balance</CardTitle>
            </CardHeader>
            <CardContent className="text-xl font-semibold">{formatInr(data.balanceAmount)}</CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">Status</CardTitle>
            </CardHeader>
            <CardContent>
              <Badge variant={data.status === "Active" ? "default" : "secondary"}>
                {data.status === "FullyAdjusted" ? "Fully adjusted" : data.status}
              </Badge>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
          <ClientDataGrid
            columns={columns}
            sourceRows={rows as Record<string, unknown>[]}
            searchKeys={["entryDate", "adjustmentRef"]}
            searchPlaceholder="Filter entries…"
            defaultSortKey="entryDate"
          />
          <div className="space-y-3">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Adjustment rule</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground space-y-2">
                <p>
                  When an invoice for this premises is approved, the full invoice amount (rent, GST, interest) is
                  adjusted against the deposit up to the available balance.
                </p>
                <p>If the balance is less than the invoice, the remainder is collected via Outstanding dues.</p>
              </CardContent>
            </Card>
            <Card className="border-amber-500/40 bg-amber-500/10">
              <CardContent className="pt-4 text-sm">
                Refund or forfeiture of a remaining balance is done from Payment adjustments.
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
