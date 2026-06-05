import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ClientDataGrid } from "@/components/reports/ClientDataGrid";
import type { ReportTableColumn } from "@/components/reports/ReportDataTable";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { formatInr } from "@/lib/formatInr";
import { formatApiDateOrDateTime } from "@/lib/dateFormat";
import { Landmark, Mail, Wallet } from "lucide-react";
import { Link } from "wouter";

interface CashInHandResponse {
  hardCashBalance: number;
  chequesPendingDeposit: number;
  totalUndeposited: number;
  oldestUndepositedDate: string | null;
  maxCarryForwardDays: number;
  receipts: Array<{
    id: string;
    receiptNo: string;
    createdAt: string;
    payerName: string | null;
    paymentMode: string;
    totalAmount: number;
    daysSinceIssue: number;
    depositOverdue: boolean;
  }>;
}

interface YardRef {
  id: string;
  name: string;
  code: string;
}

export default function ReceiptCashInHand() {
  const { toast } = useToast();
  const { user } = useAuth();
  const tiers = user?.roles?.map((r) => r.tier) ?? [];
  const canSendSummary = tiers.includes("DV") || tiers.includes("DA") || tiers.includes("ADMIN");
  const [yardId, setYardId] = useState("");

  const { data: yards = [] } = useQuery<YardRef[]>({ queryKey: ["/api/yards"] });
  const queryKey = yardId
    ? `/api/ioms/receipt-deposits/cash-in-hand?yardId=${encodeURIComponent(yardId)}`
    : "/api/ioms/receipt-deposits/cash-in-hand";

  const { data, isLoading } = useQuery<CashInHandResponse>({
    queryKey: [queryKey],
    queryFn: async () => {
      const url = yardId
        ? `/api/ioms/receipt-deposits/cash-in-hand?yardId=${encodeURIComponent(yardId)}`
        : "/api/ioms/receipt-deposits/cash-in-hand";
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load cash-in-hand");
      return res.json();
    },
  });

  const columns: ReportTableColumn[] = [
    { key: "receiptNo", header: "Receipt no." },
    { key: "issued", header: "Date" },
    { key: "payerName", header: "Payer" },
    { key: "paymentMode", header: "Mode" },
    { key: "amount", header: "Amount" },
    { key: "days", header: "Days" },
    { key: "_status", header: "Status" },
  ];

  const sourceRows = useMemo(() => {
    return (data?.receipts ?? []).map((r) => ({
      id: r.id,
      receiptNo: r.receiptNo,
      issued: formatApiDateOrDateTime(r.createdAt),
      payerName: r.payerName ?? "—",
      paymentMode: r.paymentMode,
      amount: formatInr(r.totalAmount),
      days: String(r.daysSinceIssue),
      _status: r.depositOverdue ? (
        <span className="text-destructive font-medium">Deposit overdue</span>
      ) : (
        "Undeposited"
      ),
    }));
  }, [data]);

  const sendSummaryMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/ioms/receipt-deposits/cash-in-hand/send-summary", {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { message?: string }).message ?? res.statusText);
      return data;
    },
    onSuccess: () => toast({ title: "EOD summary sent", description: "Check NOTIFY_EMAIL_TO / webhook." }),
    onError: (e: Error) => toast({ title: "Send failed", description: e.message, variant: "destructive" }),
  });

  return (
    <AppShell breadcrumbs={[{ label: "Receipts", href: "/receipts/ioms" }, { label: "Cash-in-hand" }]}>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Select value={yardId || "__all__"} onValueChange={(v) => setYardId(v === "__all__" ? "" : v)}>
            <SelectTrigger className="w-56">
              <SelectValue placeholder="All locations" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All locations</SelectItem>
              {yards.map((y) => (
                <SelectItem key={y.id} value={y.id}>
                  {y.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button asChild size="sm">
          <Link href="/receipts/ioms/deposit-entry">Initiate deposit</Link>
        </Button>
        {canSendSummary && (
          <Button
            size="sm"
            variant="outline"
            disabled={sendSummaryMutation.isPending}
            onClick={() => sendSummaryMutation.mutate()}
          >
            <Mail className="h-4 w-4 mr-1" />
            Send EOD summary
          </Button>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-4 mb-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Hard cash</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{formatInr(data?.hardCashBalance ?? 0)}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Cheques pending</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {formatInr(data?.chequesPendingDeposit ?? 0)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total undeposited</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{formatInr(data?.totalUndeposited ?? 0)}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Oldest receipt</CardTitle>
          </CardHeader>
          <CardContent className="text-lg">{data?.oldestUndepositedDate ?? "—"}</CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5" />
            Undeposited receipts
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            "Loading…"
          ) : (
            <ClientDataGrid columns={columns} sourceRows={sourceRows} defaultSortKey="receiptNo" defaultSortDir="asc" emptyMessage="No undeposited receipts." />
          )}
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Landmark className="h-5 w-5" />
            Deposit register
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline" size="sm">
            <Link href="/receipts/ioms/deposits">View deposit records</Link>
          </Button>
        </CardContent>
      </Card>
    </AppShell>
  );
}
