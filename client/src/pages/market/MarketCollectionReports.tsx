import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ClientDataGrid } from "@/components/reports/ClientDataGrid";
import type { ReportTableColumn } from "@/components/reports/ReportDataTable";
import { useAuth } from "@/context/AuthContext";
import { AlertCircle, BarChart3 } from "lucide-react";
import { Link } from "wouter";

interface YardRef {
  id: string;
  name: string;
  code: string;
  type?: string;
}

interface ReceiptRow {
  id: string;
  receiptNo: string;
  yardId: string;
  payerRefId?: string | null;
  payerName?: string | null;
  paymentMode: string;
  totalAmount: number;
  createdAt: string;
  isGracePeriod?: boolean | null;
}

interface CollectionsReport {
  from: string | null;
  to: string | null;
  yardId: string | null;
  traderLicenceId: string | null;
  count: number;
  grandTotal: number;
  totalsByMode: Record<string, number>;
  receipts: ReceiptRow[];
}

interface BankDepositRow {
  id: string;
  checkPostId: string;
  depositDate: string;
  bankName: string;
  amount: number;
  status: string;
  accountNumber?: string | null;
  voucherDetails?: string | null;
  narration?: string | null;
  verifiedBy?: string | null;
}

interface BankDepositReport {
  from: string | null;
  to: string | null;
  checkPostId: string | null;
  count: number;
  totalAmount: number;
  rows: BankDepositRow[];
}

const receiptCols: ReportTableColumn[] = [
  { key: "_receiptNo", header: "Receipt" },
  { key: "createdAt", header: "Created" },
  { key: "yardName", header: "Location" },
  { key: "payerName", header: "Payer" },
  { key: "paymentMode", header: "Mode" },
  { key: "_amount", header: "Amount" },
  { key: "_grace", header: "Grace" },
];

const depositCols: ReportTableColumn[] = [
  { key: "depositDate", header: "Deposit date" },
  { key: "checkPostName", header: "Check post" },
  { key: "bankName", header: "Bank" },
  { key: "_amount", header: "Amount" },
  { key: "_status", header: "Status" },
];

export default function MarketCollectionReports() {
  const { can } = useAuth();
  const canRead = can("M-04", "Read");

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [yardId, setYardId] = useState<string>("all");
  const [traderLicenceId, setTraderLicenceId] = useState("");
  const [checkPostId, setCheckPostId] = useState<string>("all");

  const { data: yards = [] } = useQuery<YardRef[]>({ queryKey: ["/api/yards"] });
  const yardById = Object.fromEntries(yards.map((y) => [y.id, `${y.name} (${y.code})`]));
  const checkPosts = yards.filter((y) => String(y.type ?? "") === "CheckPost");

  const collectionsUrl = useMemo(() => {
    const u = new URL("/api/ioms/market/reports/collections", window.location.origin);
    if (from) u.searchParams.set("from", from);
    if (to) u.searchParams.set("to", to);
    if (yardId && yardId !== "all") u.searchParams.set("yardId", yardId);
    if (traderLicenceId.trim()) u.searchParams.set("traderLicenceId", traderLicenceId.trim());
    return u.pathname + (u.search ? u.search : "");
  }, [from, to, yardId, traderLicenceId]);

  const depositsUrl = useMemo(() => {
    const u = new URL("/api/ioms/market/reports/bank-deposits", window.location.origin);
    if (from) u.searchParams.set("from", from);
    if (to) u.searchParams.set("to", to);
    if (checkPostId && checkPostId !== "all") u.searchParams.set("checkPostId", checkPostId);
    return u.pathname + (u.search ? u.search : "");
  }, [from, to, checkPostId]);

  const { data: collections, isLoading: colLoading, isError: colError } = useQuery<CollectionsReport>({
    queryKey: [collectionsUrl],
    enabled: canRead,
  });
  const { data: deposits, isLoading: depLoading, isError: depError } = useQuery<BankDepositReport>({
    queryKey: [depositsUrl],
    enabled: canRead,
  });

  const totalsByMode = collections?.totalsByMode ?? {};
  const modeBadges = Object.entries(totalsByMode).sort((a, b) => a[0].localeCompare(b[0]));

  const receiptRows = useMemo(() => {
    return (collections?.receipts ?? []).map((r) => ({
      id: r.id,
      receiptNo: r.receiptNo,
      _receiptNo: (
        <Link className="text-primary hover:underline font-mono text-sm" href={`/receipts/ioms/${r.id}`}>
          {r.receiptNo}
        </Link>
      ),
      createdAt: r.createdAt,
      yardName: yardById[r.yardId] ?? r.yardId,
      payerName: r.payerName ?? r.payerRefId ?? "—",
      paymentMode: r.paymentMode,
      totalAmount: r.totalAmount,
      _amount: `₹${Number(r.totalAmount ?? 0).toLocaleString("en-IN")}`,
      _grace: r.isGracePeriod ? <Badge variant="outline">Yes</Badge> : <span className="text-muted-foreground">—</span>,
    }));
  }, [collections?.receipts, yardById]);

  const depositRows = useMemo(() => {
    return (deposits?.rows ?? []).map((d) => ({
      id: d.id,
      depositDate: d.depositDate,
      checkPostName: yardById[d.checkPostId] ?? d.checkPostId,
      bankName: d.bankName,
      amount: d.amount,
      _amount: `₹${Number(d.amount ?? 0).toLocaleString("en-IN")}`,
      status: d.status,
      _status: <Badge variant={d.status === "Verified" ? "default" : "secondary"}>{d.status}</Badge>,
    }));
  }, [deposits?.rows, yardById]);

  const loading = colLoading || depLoading;
  const anyError = colError || depError;

  if (!canRead) {
    return (
      <AppShell breadcrumbs={[{ label: "Market (M-04)", href: "/market/transactions" }, { label: "Reports" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">M-04 Read permission required.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Market (M-04)", href: "/market/transactions" }, { label: "Reports" }]}>
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              Market fee collections & bank deposits
            </CardTitle>
            <p className="text-sm text-muted-foreground">Filter and review MarketFee receipts and checkpost bank deposits.</p>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
            <div className="space-y-1">
              <Label>From</Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>To</Label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label>Location (yard/check post)</Label>
              <Select value={yardId} onValueChange={setYardId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All (scoped)</SelectItem>
                  {yards.map((y) => (
                    <SelectItem key={y.id} value={y.id}>
                      {y.name} ({y.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label>Trader licence ID (optional)</Label>
              <Input value={traderLicenceId} onChange={(e) => setTraderLicenceId(e.target.value)} placeholder="Paste licence id" />
            </div>

            <div className="space-y-1 md:col-span-3">
              <Label>Bank deposit: Check post</Label>
              <Select value={checkPostId} onValueChange={setCheckPostId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All check posts (scoped)</SelectItem>
                  {checkPosts.map((y) => (
                    <SelectItem key={y.id} value={y.id}>
                      {y.name} ({y.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {anyError ? (
          <Card className="bg-destructive/10 border-destructive/20">
            <CardContent className="p-6 flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-destructive" />
              <span className="text-destructive">Failed to load report data.</span>
            </CardContent>
          </Card>
        ) : loading ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Collections (MarketFee receipts)</CardTitle>
                <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
                  <span>
                    Count: <span className="text-foreground font-medium">{collections?.count ?? 0}</span>
                  </span>
                  <span>
                    Grand total: <span className="text-foreground font-medium">₹{Number(collections?.grandTotal ?? 0).toLocaleString("en-IN")}</span>
                  </span>
                </div>
                {modeBadges.length > 0 && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {modeBadges.map(([mode, amt]) => (
                      <Badge key={mode} variant="outline">
                        {mode}: ₹{Number(amt).toLocaleString("en-IN")}
                      </Badge>
                    ))}
                  </div>
                )}
              </CardHeader>
              <CardContent>
                <ClientDataGrid
                  columns={receiptCols}
                  sourceRows={receiptRows}
                  searchKeys={["receiptNo", "payerName", "paymentMode", "yardName"]}
                  defaultSortKey="createdAt"
                  defaultSortDir="desc"
                  emptyMessage="No MarketFee receipts in this filter."
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Bank deposit details (check posts)</CardTitle>
                <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
                  <span>
                    Count: <span className="text-foreground font-medium">{deposits?.count ?? 0}</span>
                  </span>
                  <span>
                    Total amount: <span className="text-foreground font-medium">₹{Number(deposits?.totalAmount ?? 0).toLocaleString("en-IN")}</span>
                  </span>
                </div>
              </CardHeader>
              <CardContent>
                <ClientDataGrid
                  columns={depositCols}
                  sourceRows={depositRows}
                  searchKeys={["depositDate", "checkPostName", "bankName", "status"]}
                  defaultSortKey="depositDate"
                  defaultSortDir="desc"
                  emptyMessage="No bank deposits in this filter."
                />
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppShell>
  );
}

