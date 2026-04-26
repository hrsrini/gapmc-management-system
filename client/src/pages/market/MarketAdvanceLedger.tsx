import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ClientDataGrid } from "@/components/reports/ClientDataGrid";
import type { ReportTableColumn } from "@/components/reports/ReportDataTable";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, Wallet, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { useAuth } from "@/context/AuthContext";

interface LedgerEntry {
  id: string;
  traderLicenceId: string;
  yardId: string;
  entryDate: string;
  entryType: string;
  amountInr: number;
  receiptId?: string | null;
  sourceModule?: string | null;
  sourceRecordId?: string | null;
  createdAt?: string | null;
}

interface LedgerResponse {
  traderLicenceId: string;
  balance: number;
  belowThreshold?: boolean;
  thresholdInr?: number;
  entries: LedgerEntry[];
}

const cols: ReportTableColumn[] = [
  { key: "entryDate", header: "Date" },
  { key: "entryType", header: "Type" },
  { key: "_amount", header: "Amount" },
  { key: "_receipt", header: "Receipt" },
  { key: "sourceRecordId", header: "Source" },
];

export default function MarketAdvanceLedger() {
  const { can } = useAuth();
  const canRead = can("M-04", "Read");
  const canCreate = can("M-04", "Create");
  const { toast } = useToast();
  const qc = useQueryClient();

  const [traderLicenceId, setTraderLicenceId] = useState("");
  const [depositAmount, setDepositAmount] = useState("");
  const [paymentMode, setPaymentMode] = useState("Cash");
  const [refundAmount, setRefundAmount] = useState("");

  const { data: licences = [] } = useQuery<Array<{ id: string; firmName: string; licenceNo?: string | null }>>({
    queryKey: ["/api/ioms/traders/licences"],
    enabled: canRead,
  });

  const url = useMemo(() => {
    if (!traderLicenceId.trim()) return null;
    const u = new URL("/api/ioms/market/advance-ledger", window.location.origin);
    u.searchParams.set("traderLicenceId", traderLicenceId.trim());
    return u.pathname + u.search;
  }, [traderLicenceId]);

  const { data, isLoading, isError } = useQuery<LedgerResponse>({
    queryKey: [url ?? "no-trader-selected"],
    enabled: canRead && Boolean(url),
  });

  const depositMutation = useMutation({
    mutationFn: async () => {
      const amt = Number(depositAmount);
      if (!traderLicenceId.trim()) throw new Error("Select a trader first.");
      if (!Number.isFinite(amt) || amt <= 0) throw new Error("Deposit amount must be > 0.");
      const res = await fetch("/api/ioms/market/advance-ledger/deposit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ traderLicenceId: traderLicenceId.trim(), amountInr: amt, paymentMode }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error ?? res.statusText);
      return body;
    },
    onSuccess: () => {
      if (url) qc.invalidateQueries({ queryKey: [url] });
      setDepositAmount("");
      toast({ title: "Deposit recorded" });
    },
    onError: (e: Error) => toast({ title: "Deposit failed", description: e.message, variant: "destructive" }),
  });

  const refundMutation = useMutation({
    mutationFn: async () => {
      const amt = Number(refundAmount);
      if (!traderLicenceId.trim()) throw new Error("Select a trader first.");
      if (!Number.isFinite(amt) || amt <= 0) throw new Error("Refund amount must be > 0.");
      const res = await fetch("/api/ioms/market/advance-ledger/refund", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ traderLicenceId: traderLicenceId.trim(), amountInr: amt, paymentMode }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error ?? res.statusText);
      return body;
    },
    onSuccess: () => {
      if (url) qc.invalidateQueries({ queryKey: [url] });
      setRefundAmount("");
      toast({ title: "Refund recorded" });
    },
    onError: (e: Error) => toast({ title: "Refund failed", description: e.message, variant: "destructive" }),
  });

  const rows = useMemo((): Record<string, unknown>[] => {
    return (data?.entries ?? []).map((e) => ({
      id: e.id,
      entryDate: String(e.entryDate ?? "").slice(0, 10),
      entryType: <Badge variant={e.entryType === "Deposit" ? "default" : "secondary"}>{e.entryType}</Badge>,
      _amount: `${Number(e.amountInr) >= 0 ? "+" : ""}₹${Math.abs(Number(e.amountInr ?? 0)).toLocaleString("en-IN")}`,
      _receipt: e.receiptId ? (
        <Link className="text-primary hover:underline text-sm font-mono" href={`/receipts/ioms/${e.receiptId}`}>
          View
        </Link>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
      sourceRecordId: e.sourceRecordId ?? "—",
    }));
  }, [data?.entries]);

  if (!canRead) {
    return (
      <AppShell breadcrumbs={[{ label: "Market (M-04)", href: "/market/transactions" }, { label: "Advance ledger" }]}>
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
    <AppShell breadcrumbs={[{ label: "Market (M-04)", href: "/market/transactions" }, { label: "Advance ledger" }]}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5" />
            Market fee advance ledger
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Deposit advance MarketFee and auto-adjust it against Approved purchase fees when sufficient balance exists.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
            <div className="space-y-1 md:col-span-2">
              <Label>Trader licence</Label>
              <Select value={traderLicenceId || "none"} onValueChange={(v) => setTraderLicenceId(v === "none" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Select trader" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Select…</SelectItem>
                  {licences.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {`${l.firmName}${l.licenceNo ? ` (${l.licenceNo})` : ""}`.slice(0, 72)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Balance</Label>
              <Input
                readOnly
                className="bg-muted"
                value={traderLicenceId ? `₹${Number(data?.balance ?? 0).toLocaleString("en-IN")}` : "—"}
              />
              {traderLicenceId && data?.belowThreshold ? (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  Low balance: below ₹{Number(data.thresholdInr ?? 0).toLocaleString("en-IN")}
                </p>
              ) : null}
            </div>
          </div>

          {canCreate && (
            <Card className="border-muted">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Plus className="h-4 w-4" /> Deposit
                </CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
                <div className="space-y-1">
                  <Label>Amount (INR)</Label>
                  <Input type="number" value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>Mode</Label>
                  <Select value={paymentMode} onValueChange={setPaymentMode}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Cash">Cash</SelectItem>
                      <SelectItem value="Cheque">Cheque</SelectItem>
                      <SelectItem value="DD">DD</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="md:col-span-2 flex gap-2">
                  <Button
                    type="button"
                    disabled={depositMutation.isPending || !traderLicenceId.trim()}
                    onClick={() => depositMutation.mutate()}
                  >
                    {depositMutation.isPending ? "Recording..." : "Record deposit"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {canCreate && (
            <Card className="border-muted">
              <CardHeader>
                <CardTitle className="text-base">Refund (advance payout)</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
                <div className="space-y-1">
                  <Label>Amount (INR)</Label>
                  <Input type="number" value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>Mode</Label>
                  <Select value={paymentMode} onValueChange={setPaymentMode}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Cash">Cash</SelectItem>
                      <SelectItem value="Cheque">Cheque</SelectItem>
                      <SelectItem value="DD">DD</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="md:col-span-2 flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={refundMutation.isPending || !traderLicenceId.trim()}
                    onClick={() => refundMutation.mutate()}
                  >
                    {refundMutation.isPending ? "Recording..." : "Record refund"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {!traderLicenceId ? (
            <div className="text-sm text-muted-foreground">Select a trader to view ledger entries.</div>
          ) : isError ? (
            <Card className="bg-destructive/10 border-destructive/20">
              <CardContent className="p-6 flex items-center gap-3">
                <AlertCircle className="h-5 w-5 text-destructive" />
                <span className="text-destructive">Failed to load advance ledger.</span>
              </CardContent>
            </Card>
          ) : isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <ClientDataGrid
              columns={cols}
              sourceRows={rows}
              searchKeys={["entryDate", "entryType", "sourceRecordId"]}
              defaultSortKey="entryDate"
              defaultSortDir="desc"
              emptyMessage="No advance ledger entries."
            />
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}

