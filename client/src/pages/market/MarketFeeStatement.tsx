import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { Banknote, AlertCircle, ExternalLink } from "lucide-react";
import { Link } from "wouter";

interface TraderLicenceRef {
  id: string;
  licenceNo?: string | null;
  firmName?: string | null;
  yardId: string;
  status?: string | null;
}

interface Statement {
  traderLicenceId: string;
  toPeriod: string;
  totalPayable: number;
  totalPaid: number;
  outstanding: number;
  note?: string;
}

function monthDefault(): string {
  return new Date().toISOString().slice(0, 7);
}

export default function MarketFeeStatement() {
  const { toast } = useToast();
  const { can } = useAuth();
  const canCreate = can("M-04", "Create") || can("M-04", "Update");

  const [traderLicenceId, setTraderLicenceId] = useState("");
  const [toPeriod, setToPeriod] = useState(monthDefault());

  const { data: licences = [], isLoading: licLoading } = useQuery<TraderLicenceRef[]>({
    queryKey: ["/api/ioms/traders/licences"],
  });

  const licenceLabelById = useMemo(() => {
    return Object.fromEntries(
      licences.map((l) => [l.id, l.licenceNo ? `${l.licenceNo}${l.firmName ? ` — ${l.firmName}` : ""}` : (l.firmName ?? l.id)]),
    );
  }, [licences]);

  const stmtEnabled = Boolean(traderLicenceId && /^\d{4}-\d{2}$/.test(toPeriod));
  const { data: statement, isLoading, isError, error } = useQuery<Statement>({
    queryKey: ["/api/ioms/market/fee-statement", traderLicenceId, toPeriod],
    queryFn: async ({ queryKey }) => {
      const [, tid, p] = queryKey as [string, string, string];
      const u = new URL("/api/ioms/market/fee-statement", window.location.origin);
      u.searchParams.set("traderLicenceId", tid);
      u.searchParams.set("toPeriod", p);
      const r = await fetch(u.toString(), { credentials: "include" });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? r.statusText);
      }
      return r.json();
    },
    enabled: stmtEnabled,
  });

  const payMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/ioms/market/fee-statement/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ traderLicenceId, toPeriod }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? r.statusText);
      }
      return r.json() as Promise<{ ok: boolean; receiptId: string; receiptNo: string }>;
    },
    onSuccess: (data) => {
      toast({ title: "Receipt created", description: `Receipt ${data.receiptNo} created (Pending).` });
    },
    onError: (e: Error) => toast({ title: "Pay failed", description: e.message, variant: "destructive" }),
  });

  return (
    <AppShell breadcrumbs={[{ label: "Market (M-04)", href: "/market/transactions" }, { label: "Fee statement" }]}>
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Banknote className="h-5 w-5" />
              Consolidated final fee statement (M-04)
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Shows payable vs paid vs outstanding up to the selected month, and can generate a MarketFee receipt for outstanding.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {licLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                <div className="space-y-1 md:col-span-2">
                  <Label>Trader licence</Label>
                  <Select value={traderLicenceId} onValueChange={setTraderLicenceId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select trader licence" />
                    </SelectTrigger>
                    <SelectContent>
                      {licences.map((l) => (
                        <SelectItem key={l.id} value={l.id}>
                          {licenceLabelById[l.id] ?? l.id}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Up to month (YYYY-MM)</Label>
                  <Input value={toPeriod} onChange={(e) => setToPeriod(e.target.value)} placeholder="2026-04" />
                </div>
              </div>
            )}

            {!stmtEnabled ? (
              <p className="text-sm text-muted-foreground">Select a trader and month to view statement.</p>
            ) : isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : isError ? (
              <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {error instanceof Error ? error.message : "Failed to load statement"}
              </div>
            ) : statement ? (
              <div className="space-y-2">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <Card>
                    <CardHeader className="py-3">
                      <CardTitle className="text-sm text-muted-foreground">Total payable (₹)</CardTitle>
                    </CardHeader>
                    <CardContent className="pt-0 text-xl font-semibold">
                      {Number(statement.totalPayable ?? 0).toLocaleString()}
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="py-3">
                      <CardTitle className="text-sm text-muted-foreground">Total paid (₹)</CardTitle>
                    </CardHeader>
                    <CardContent className="pt-0 text-xl font-semibold">
                      {Number(statement.totalPaid ?? 0).toLocaleString()}
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="py-3">
                      <CardTitle className="text-sm text-muted-foreground">Outstanding (₹)</CardTitle>
                    </CardHeader>
                    <CardContent className="pt-0 text-xl font-semibold">
                      {Number(statement.outstanding ?? 0).toLocaleString()}
                    </CardContent>
                  </Card>
                </div>

                {statement.note ? <p className="text-xs text-muted-foreground">{statement.note}</p> : null}

                <div className="flex flex-wrap gap-2 pt-1">
                  <Button
                    type="button"
                    disabled={!canCreate || payMutation.isPending || Number(statement.outstanding ?? 0) <= 0}
                    onClick={() => payMutation.mutate()}
                  >
                    Pay now (generate receipt)
                  </Button>
                  <Link href="/receipts/ioms" className="text-sm text-primary underline inline-flex items-center gap-1">
                    View receipts <ExternalLink className="h-4 w-4" />
                  </Link>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

