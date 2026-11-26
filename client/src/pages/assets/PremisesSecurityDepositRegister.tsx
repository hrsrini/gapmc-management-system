import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ClientDataGrid } from "@/components/reports/ClientDataGrid";
import type { ReportTableColumn } from "@/components/reports/ReportDataTable";
import { formatInr } from "@/lib/formatInr";
import { useYardLabels } from "@/hooks/useYardLabels";
import { Landmark, Plus, Receipt } from "lucide-react";

type DepositRow = {
  id: string;
  yardId: string;
  assetId: string;
  premisesLabel?: string | null;
  payerType: string;
  payerRefId: string;
  payerName?: string | null;
  amount: number;
  status: string;
  depositReceiptNo?: string | null;
  depositReceiptDate?: string | null;
  depositReceiptId?: string | null;
  refundReceiptNo?: string | null;
  refundReceiptId?: string | null;
  vacatedOn?: string | null;
};

const columns: ReportTableColumn[] = [
  { key: "premisesLabel", header: "Premises" },
  { key: "payerName", header: "Trader / entity" },
  { key: "yardName", header: "Yard" },
  { key: "amountDisp", header: "Deposit (₹)", sortField: "amount" },
  { key: "receiptDisp", header: "Original receipt" },
  { key: "refundDisp", header: "Refund" },
  { key: "statusBadge", header: "Status", sortField: "status" },
];

export default function PremisesSecurityDepositRegister() {
  const [status, setStatus] = useState("all");
  const { getYardName } = useYardLabels();
  const q = status === "all" ? "" : `?status=${encodeURIComponent(status)}`;
  const { data, isLoading } = useQuery<{
    rows: DepositRow[];
    summary: { collected: number; refunded: number; held: number; refundPending: number };
  }>({
    queryKey: [`/api/ioms/premises-security-deposits${q}`],
    queryFn: async () => {
      const res = await fetch(`/api/ioms/premises-security-deposits${q}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load register");
      return res.json();
    },
  });

  const rows = useMemo(() => {
    return (data?.rows ?? []).map((r) => ({
      ...r,
      yardName: getYardName(r.yardId),
      amountDisp: formatInr(r.amount),
      receiptDisp: r.depositReceiptNo
        ? `${r.depositReceiptNo}${r.depositReceiptDate ? ` · ${r.depositReceiptDate}` : ""}`
        : "—",
      refundDisp: r.refundReceiptNo ?? (r.status === "Reserved" ? "Pending approval" : "—"),
      statusBadge: <Badge variant={r.status === "Refunded" ? "secondary" : "default"}>{r.status}</Badge>,
      _receiptLink: r.depositReceiptId ? (
        <Link href={`/receipts/ioms/${r.depositReceiptId}`} className="text-primary underline text-xs">
          Open
        </Link>
      ) : null,
    }));
  }, [data?.rows, getYardName]);

  const summary = data?.summary;

  return (
    <AppShell breadcrumbs={[{ label: "Assets", href: "/assets" }, { label: "Security deposits" }]}>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Landmark className="h-6 w-6" /> Security deposit register
          </h1>
          <p className="text-sm text-muted-foreground">
            One row per premises under Tally head Cash Security Deposit for Godown.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/assets/security-deposits/collect">
              <Receipt className="h-4 w-4 mr-1" /> Collect / consolidate
            </Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/assets/security-deposits/refund">
              <Plus className="h-4 w-4 mr-1" /> Refund of SD
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/assets/security-deposits/ledger">Trader SD ledger</Link>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {[
          ["Collected", summary?.collected],
          ["Refunded", summary?.refunded],
          ["Currently held", summary?.held],
          ["Refund pending", summary?.refundPending],
        ].map(([label, val]) => (
          <Card key={String(label)}>
            <CardHeader className="py-3 pb-1">
              <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 text-lg font-semibold">{formatInr(Number(val ?? 0))}</CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle className="text-base">Deposits</CardTitle>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All premises</SelectItem>
              <SelectItem value="Held">Held</SelectItem>
              <SelectItem value="RefundPending">Refund pending</SelectItem>
              <SelectItem value="Refunded">Refunded</SelectItem>
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <ClientDataGrid
              columns={columns}
              sourceRows={rows}
              searchKeys={["premisesLabel", "payerName", "receiptDisp", "status"]}
              searchPlaceholder="Search deposits…"
              defaultSortKey="premisesLabel"
              emptyMessage="No security deposits yet."
            />
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
