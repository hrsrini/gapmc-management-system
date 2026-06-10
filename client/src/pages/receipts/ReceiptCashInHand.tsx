import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { formatInr } from "@/lib/formatInr";
import { formatApiDateOrDateTime } from "@/lib/dateFormat";
import { CalendarClock, ChevronDown, Landmark, Loader2, Mail, Wallet } from "lucide-react";
import { Link } from "wouter";

interface UndepositedRow {
  id: string;
  receiptNo: string;
  createdAt: string;
  payerName: string | null;
  paymentMode: string;
  totalAmount: number;
  daysSinceIssue: number;
  depositOverdue: boolean;
  depositDeferredUntil?: string | null;
  yardId?: string;
  yardName?: string | null;
  sourceModule?: string | null;
}

interface CashInHandResponse {
  hardCashBalance: number;
  chequesPendingDeposit: number;
  totalUndeposited: number;
  oldestUndepositedDate: string | null;
  maxCarryForwardDays: number;
  receipts: UndepositedRow[];
  deferredReceipts?: UndepositedRow[];
}

interface CashInHandLocationContext {
  canSelectAll: boolean;
  defaultYardId: string | null;
  yards: Array<{ id: string; name: string; code: string; type: string }>;
}

function tomorrowYmd(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export default function ReceiptCashInHand() {
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const tiers = user?.roles?.map((r) => r.tier) ?? [];
  const canSendSummary = tiers.includes("DV") || tiers.includes("DA") || tiers.includes("ADMIN");
  const canDefer = tiers.includes("DO") || tiers.includes("DV") || tiers.includes("DA") || tiers.includes("ADMIN");
  const [yardFilter, setYardFilter] = useState<string | undefined>(undefined);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deferOpen, setDeferOpen] = useState(false);
  const [deferUntil, setDeferUntil] = useState(tomorrowYmd);
  const [eodHelpOpen, setEodHelpOpen] = useState(false);

  const { data: locCtx } = useQuery<CashInHandLocationContext>({
    queryKey: ["/api/ioms/receipt-deposits/cash-in-hand/locations"],
    queryFn: async () => {
      const res = await fetch("/api/ioms/receipt-deposits/cash-in-hand/locations", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load locations");
      return res.json();
    },
  });

  useEffect(() => {
    if (locCtx && yardFilter === undefined) {
      setYardFilter(locCtx.defaultYardId ?? "");
    }
  }, [locCtx, yardFilter]);

  const yards = locCtx?.yards ?? [];
  const canSelectAll = locCtx?.canSelectAll ?? false;
  const showAllLocations = !yardFilter;

  const cashInHandUrl =
    yardFilter !== undefined
      ? yardFilter
        ? `/api/ioms/receipt-deposits/cash-in-hand?yardId=${encodeURIComponent(yardFilter)}`
        : "/api/ioms/receipt-deposits/cash-in-hand"
      : "";

  const { data, isLoading } = useQuery<CashInHandResponse>({
    queryKey: [cashInHandUrl],
    enabled: yardFilter !== undefined,
    queryFn: async () => {
      const res = await fetch(cashInHandUrl, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load cash-in-hand");
      return res.json();
    },
  });

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

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
    onSuccess: () =>
      toast({
        title: "EOD summary sent",
        description: "Check configured email (NOTIFY_EMAIL_TO) or server logs if SMTP is not set.",
      }),
    onError: (e: Error) => toast({ title: "Send failed", description: e.message, variant: "destructive" }),
  });

  const deferMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/ioms/receipt-deposits/defer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ receiptIds: Array.from(selected), untilDate: deferUntil }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { message?: string }).message ?? res.statusText);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/receipt-deposits/cash-in-hand"] });
      toast({ title: "Receipts deferred", description: `Hidden from cash-in-hand until ${deferUntil}` });
      setSelected(new Set());
      setDeferOpen(false);
    },
    onError: (e: Error) => toast({ title: "Defer failed", description: e.message, variant: "destructive" }),
  });

  const receipts = data?.receipts ?? [];
  const deferred = data?.deferredReceipts ?? [];

  const receiptTable = useMemo(
    () =>
      receipts.map((r) => ({
        ...r,
        key: r.id,
      })),
    [receipts],
  );

  const selectValue = yardFilter === undefined ? undefined : yardFilter || "__all__";

  return (
    <AppShell breadcrumbs={[{ label: "Receipts", href: "/receipts/ioms" }, { label: "Cash-in-hand" }]}>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <Select
          value={selectValue}
          onValueChange={(v) => {
            setYardFilter(v === "__all__" ? "" : v);
            setSelected(new Set());
          }}
          disabled={yardFilter === undefined}
        >
          <SelectTrigger className="w-56">
            <SelectValue placeholder="Loading locations…" />
          </SelectTrigger>
          <SelectContent>
            {canSelectAll ? <SelectItem value="__all__">All locations</SelectItem> : null}
            {yards.map((y) => (
              <SelectItem key={y.id} value={y.id}>
                {y.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex flex-wrap gap-2">
          {canDefer && selected.size > 0 && (
            <Button size="sm" variant="outline" onClick={() => setDeferOpen(true)}>
              <CalendarClock className="h-4 w-4 mr-1" />
              Defer ({selected.size})
            </Button>
          )}
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
      </div>

      {canSendSummary ? (
        <Collapsible open={eodHelpOpen} onOpenChange={setEodHelpOpen} className="mb-4">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 px-2 text-muted-foreground">
              <ChevronDown className={`h-4 w-4 mr-1 transition-transform ${eodHelpOpen ? "rotate-180" : ""}`} />
              How to use Send EOD summary
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <Card className="mt-1 border-dashed">
              <CardContent className="pt-4 text-sm text-muted-foreground space-y-2">
                <p>
                  <strong className="text-foreground">Who can send:</strong> users with DV, DA, or ADMIN role tier.
                </p>
                <p>
                  <strong className="text-foreground">What it does:</strong> runs the same end-of-day cash-in-hand digest as
                  the scheduled job — totals per location, overdue counts, and optional overdue alerts.
                </p>
                <p>
                  <strong className="text-foreground">Email delivery:</strong> set server environment variables{" "}
                  <code className="text-xs">NOTIFY_EMAIL_TO</code>, <code className="text-xs">SMTP_HOST</code>,{" "}
                  <code className="text-xs">SMTP_PORT</code>, and credentials on the app host. Without SMTP, the summary is
                  still written to server logs.
                </p>
                <p>
                  <strong className="text-foreground">Webhook (optional):</strong> set{" "}
                  <code className="text-xs">NOTIFY_WEBHOOK_URL</code> to POST JSON notifications to an external system.
                </p>
                <p>
                  Verify configuration locally with{" "}
                  <code className="text-xs">npm run smoke:receipt-deposit-notify</code>.
                </p>
              </CardContent>
            </Card>
          </CollapsibleContent>
        </Collapsible>
      ) : null}

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
          <CardContent className="text-2xl font-semibold">{formatInr(data?.chequesPendingDeposit ?? 0)}</CardContent>
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
          {isLoading || yardFilter === undefined ? (
            <Loader2 className="h-6 w-6 animate-spin" />
          ) : receiptTable.length === 0 ? (
            <p className="text-sm text-muted-foreground">No undeposited receipts due for deposit.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    {canDefer ? <th className="py-2 pr-2 w-8" /> : null}
                    <th className="py-2 pr-3">Receipt no.</th>
                    {showAllLocations ? <th className="py-2 pr-3">Location</th> : null}
                    <th className="py-2 pr-3">Date</th>
                    <th className="py-2 pr-3">Payer</th>
                    <th className="py-2 pr-3">Mode</th>
                    <th className="py-2 pr-3 text-right">Amount</th>
                    <th className="py-2 pr-3">Days</th>
                    <th className="py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {receiptTable.map((r) => (
                    <tr key={r.id} className="border-b border-border/50">
                      {canDefer ? (
                        <td className="py-2 pr-2">
                          <Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggle(r.id)} />
                        </td>
                      ) : null}
                      <td className="py-2 pr-3 font-mono">
                        <Link className="text-primary hover:underline" href={`/receipts/ioms/${r.id}`}>
                          {r.receiptNo}
                        </Link>
                      </td>
                      {showAllLocations ? (
                        <td className="py-2 pr-3 text-muted-foreground">{r.yardName ?? "—"}</td>
                      ) : null}
                      <td className="py-2 pr-3">{formatApiDateOrDateTime(r.createdAt)}</td>
                      <td className="py-2 pr-3">{r.payerName ?? "—"}</td>
                      <td className="py-2 pr-3">{r.paymentMode}</td>
                      <td className="py-2 pr-3 text-right">{formatInr(r.totalAmount)}</td>
                      <td className="py-2 pr-3">{r.daysSinceIssue}</td>
                      <td className="py-2">
                        {r.depositOverdue ? (
                          <span className="text-destructive font-medium">Deposit overdue</span>
                        ) : (
                          "Undeposited"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {deferred.length > 0 ? (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarClock className="h-4 w-4" />
              Deferred (not due for deposit yet)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-3">Receipt no.</th>
                    {showAllLocations ? <th className="py-2 pr-3">Location</th> : null}
                    <th className="py-2 pr-3">Deferred until</th>
                    <th className="py-2 pr-3">Mode</th>
                    <th className="py-2 pr-3 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {deferred.map((r) => (
                    <tr key={r.id} className="border-b border-border/50">
                      <td className="py-2 pr-3 font-mono">
                        <Link className="text-primary hover:underline" href={`/receipts/ioms/${r.id}`}>
                          {r.receiptNo}
                        </Link>
                      </td>
                      {showAllLocations ? (
                        <td className="py-2 pr-3 text-muted-foreground">{r.yardName ?? "—"}</td>
                      ) : null}
                      <td className="py-2 pr-3">{r.depositDeferredUntil?.slice(0, 10) ?? "—"}</td>
                      <td className="py-2 pr-3">{r.paymentMode}</td>
                      <td className="py-2 pr-3 text-right">{formatInr(r.totalAmount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : null}

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

      <Dialog open={deferOpen} onOpenChange={setDeferOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Defer deposit ({selected.size} receipt(s))</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Selected receipts will be hidden from cash-in-hand and overdue alerts until the date below (carry-forward).
          </p>
          <div className="space-y-1">
            <Label>Defer until *</Label>
            <Input type="date" value={deferUntil} onChange={(e) => setDeferUntil(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeferOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={deferMutation.isPending || !/^\d{4}-\d{2}-\d{2}$/.test(deferUntil)}
              onClick={() => deferMutation.mutate()}
            >
              {deferMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirm defer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
