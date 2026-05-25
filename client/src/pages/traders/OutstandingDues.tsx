import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { AlertCircle, Wallet, CheckCircle } from "lucide-react";
import { ClientDataGrid } from "@/components/reports/ClientDataGrid";
import type { ReportTableColumn } from "@/components/reports/ReportDataTable";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Link } from "wouter";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatInr } from "@/lib/formatInr";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { formatUnifiedEntityOptionLabel } from "@shared/unified-entity-display";
import { PaymentPreferenceForm } from "@/components/payments/PaymentPreferenceForm";
import {
  buildCounterDuesPaymentApiBody,
  defaultPaymentPreferenceValue,
  validatePaymentPreference,
  type PaymentPreferenceValue,
} from "@/lib/duesCounterPayment";
import { useScopedActiveYards } from "@/hooks/useScopedActiveYards";

interface UnifiedEntityRow {
  id: string;
  kind: "TrackA" | "TrackB" | "AdHoc";
  refId: string;
  yardId: string;
  name: string;
  status: string;
  publicEntityCode?: string | null;
  displayEntityId?: string | null;
}

interface DueRentInvoice {
  kind: "RentInvoice";
  invoiceId: string;
  invoiceNo?: string | null;
  periodMonth: string;
  assetId: string;
  yardId: string;
  totalAmount: number;
  paidAmount: number;
  outstandingAmount: number;
  status: string;
}
interface DuePreReceipt {
  kind: "PreReceipt";
  preReceiptId: string;
  preReceiptNo?: string | null;
  yardId: string;
  amount: number;
  status: string;
}

interface DueMarketFeePurchase {
  kind: "MarketFeePurchase";
  purchaseTransactionId: string;
  transactionNo?: string | null;
  transactionDate: string;
  yardId: string;
  commodityId: string;
  totalAmount: number;
  paidAmount: number;
  outstandingAmount: number;
  receiptId?: string | null;
  receiptStatus?: string | null;
}

interface DuesApiResponse {
  dues: Array<DueRentInvoice | DuePreReceipt | DueMarketFeePurchase>;
  trackBBillingHint?: string;
  trackBEntitySubType?: string | null;
}
interface AssetRef {
  id: string;
  assetId: string;
}

const columns: ReportTableColumn[] = [
  { key: "kind", header: "Type", sortField: "kind" },
  { key: "_ref", header: "Reference" },
  { key: "periodMonth", header: "Period" },
  { key: "assetLabel", header: "Asset" },
  { key: "_amount", header: "Amount" },
  { key: "_paid", header: "Paid" },
  { key: "_outstanding", header: "Outstanding" },
  { key: "_status", header: "Status" },
  { key: "_actions", header: "Actions" },
];

export default function OutstandingDues() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { can, user } = useAuth();
  const { data: yards = [] } = useScopedActiveYards();
  const canMarkPaid = can("M-03", "Update");
  const canPayMarketFee = can("M-04", "Create") || can("M-04", "Update");

  const { data: unified = [], isLoading: unifiedLoading } = useQuery<UnifiedEntityRow[]>({
    queryKey: ["/api/ioms/unified-entities"],
  });
  const { data: assets = [] } = useQuery<AssetRef[]>({ queryKey: ["/api/ioms/assets"] });
  const assetLabelById = useMemo(() => Object.fromEntries(assets.map((a) => [a.id, a.assetId])), [assets]);

  const [unifiedId, setUnifiedId] = useState("");
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const uid = params.get("unifiedId");
    if (uid && uid.trim()) {
      setUnifiedId(uid.trim());
      return;
    }
    const legacy = params.get("licenceId");
    if (legacy && legacy.trim()) setUnifiedId(`TA:${legacy.trim()}`);
  }, []);

  const duesUrl = unifiedId.trim() ? `/api/ioms/dues?unifiedId=${encodeURIComponent(unifiedId.trim())}` : "";
  const { data: duesResp, isLoading, isError } = useQuery<DuesApiResponse>({
    queryKey: [duesUrl],
    enabled: Boolean(duesUrl),
    queryFn: async () => {
      const res = await fetch(duesUrl, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load dues");
      return (await res.json()) as DuesApiResponse;
    },
  });
  const dues = duesResp?.dues ?? [];

  const totalOutstanding = useMemo(() => {
    return dues.reduce((s, d) => {
      if (d.kind === "RentInvoice" || d.kind === "MarketFeePurchase") return s + Number(d.outstandingAmount ?? 0);
      return s + Number(d.amount ?? 0);
    }, 0);
  }, [dues]);

  const [payOpen, setPayOpen] = useState(false);
  const [payStep, setPayStep] = useState<"summary" | "payment">("summary");
  const [payKind, setPayKind] = useState<"rent" | "market">("rent");
  const [payInvoice, setPayInvoice] = useState<DueRentInvoice | null>(null);
  const [payMarket, setPayMarket] = useState<DueMarketFeePurchase | null>(null);
  const [payYardId, setPayYardId] = useState("");
  const [payAmount, setPayAmount] = useState("");
  const [paymentPref, setPaymentPref] = useState<PaymentPreferenceValue>(() => defaultPaymentPreferenceValue());
  const [onlineReceiptHref, setOnlineReceiptHref] = useState<string>("");

  const receivedByLabel = user?.name ? `${user.name} (Logged in user)` : "Logged in user";
  const receivedAtLabel = useMemo(() => {
    if (!payYardId) return "—";
    return yards.find((y) => y.id === payYardId)?.name ?? payYardId;
  }, [payYardId, yards]);

  const openPayDialog = (kind: "rent" | "market", invoice: DueRentInvoice | null, market: DueMarketFeePurchase | null, outstanding: number, yardId: string) => {
    setPayKind(kind);
    setPayInvoice(invoice);
    setPayMarket(market);
    setPayYardId(yardId);
    setPayAmount(String(Math.max(0, outstanding)));
    setPaymentPref(defaultPaymentPreferenceValue(outstanding));
    setPayStep("summary");
    setPayOpen(true);
  };

  const payMutation = useMutation({
    mutationFn: async () => {
      const prefErr = validatePaymentPreference({ ...paymentPref, paidAmount: paymentPref.paidAmount || payAmount });
      if (prefErr) throw new Error(prefErr);
      const amt = Number(paymentPref.paidAmount || payAmount);
      if (!Number.isFinite(amt) || amt <= 0) throw new Error("Enter a valid amount");
      const payBody = buildCounterDuesPaymentApiBody({ ...paymentPref, paidAmount: String(amt) }, amt);
      if (payKind === "rent") {
        if (!payInvoice) throw new Error("Select an invoice");
        const res = await fetch("/api/ioms/dues/pay-rent-invoice", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ invoiceId: payInvoice.invoiceId, ...payBody }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const msg = (data as { message?: string; error?: string }).message ?? (data as { error?: string }).error;
          throw new Error(msg ?? res.statusText);
        }
        return { kind: "rent" as const, receiptNo: (data as { receiptNo?: string }).receiptNo ?? "" };
      }
      if (!payMarket) throw new Error("Select a purchase");
      const res = await fetch("/api/ioms/dues/pay-market-fee", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ purchaseTransactionId: payMarket.purchaseTransactionId, ...payBody }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = (data as { message?: string; error?: string }).message ?? (data as { error?: string }).error;
        throw new Error(msg ?? res.statusText);
      }
      return { kind: "market" as const, receiptNo: (data as { receiptNo?: string }).receiptNo ?? "" };
    },
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: [duesUrl] });
      toast({
        title: "Payment recorded",
        description: r.receiptNo ? `Receipt ${r.receiptNo}.` : "Payment saved.",
      });
      setPayOpen(false);
      setPayStep("summary");
      setPayInvoice(null);
      setPayMarket(null);
      setPayYardId("");
      setPayAmount("");
      setPaymentPref(defaultPaymentPreferenceValue());
    },
    onError: (e: Error) => toast({ title: "Payment failed", description: e.message, variant: "destructive" }),
  });

  const onlineMutation = useMutation({
    mutationFn: async () => {
      const amt = Number(payAmount);
      if (!Number.isFinite(amt) || amt <= 0) throw new Error("Enter a valid amount");
      const body =
        payKind === "rent"
          ? { kind: "rent", invoiceId: payInvoice?.invoiceId, amount: amt }
          : { kind: "market", purchaseTransactionId: payMarket?.purchaseTransactionId, amount: amt };
      const res = await fetch("/api/ioms/dues/create-online-receipt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText);
      return data as { receiptId: string; receiptNo?: string };
    },
    onSuccess: (d) => {
      setPayOpen(false);
      setPayInvoice(null);
      setPayMarket(null);
      setPayAmount("");
      const href = `/receipts/ioms/${encodeURIComponent(d.receiptId)}`;
      setOnlineReceiptHref(href);
      toast({
        title: "Online receipt created",
        description: d.receiptNo ? `Receipt ${d.receiptNo}. Open it to initiate payment.` : "Open receipt to initiate payment.",
      });
    },
    onError: (e: Error) => toast({ title: "Online payment failed", description: e.message, variant: "destructive" }),
  });

  const unifiedLabelById = useMemo(() => {
    return Object.fromEntries(
      unified.map((u) => [
        u.id,
        formatUnifiedEntityOptionLabel({
          kind: u.kind,
          publicEntityCode: u.publicEntityCode,
          name: u.name,
        }),
      ]),
    );
  }, [unified]);

  const rows = useMemo((): Record<string, unknown>[] => {
    return dues.map((d) => {
      if (d.kind === "MarketFeePurchase") {
        return {
          id: `m04:${d.purchaseTransactionId}`,
          kind: "Market fee (M-04)",
          _ref: d.receiptId ? (
            <Link href={`/receipts/ioms/${encodeURIComponent(d.receiptId)}`} className="text-primary hover:underline font-mono text-sm">
              {d.transactionNo ?? d.purchaseTransactionId}
            </Link>
          ) : (
            <Link href="/market/transactions" className="text-primary hover:underline font-mono text-sm">
              {d.transactionNo ?? d.purchaseTransactionId}
            </Link>
          ),
          periodMonth: d.transactionDate?.slice(0, 7) ?? d.transactionDate ?? "—",
          assetLabel: d.commodityId,
          _amount: `${formatInr(Number(d.totalAmount ?? 0))}`,
          _paid: `${formatInr(Number(d.paidAmount ?? 0))}`,
          _outstanding: `${formatInr(Number(d.outstandingAmount ?? 0))}`,
          _status: (
            <span>
              {d.receiptStatus ?? "Pending receipt"}
            </span>
          ),
          _actions: (
            <Button
              size="sm"
              disabled={!canPayMarketFee}
              onClick={() => openPayDialog("market", null, d, d.outstandingAmount, d.yardId)}
            >
              <CheckCircle className="h-4 w-4 mr-1" />
              Pay
            </Button>
          ),
        };
      }
      if (d.kind === "PreReceipt") {
        return {
          id: `pre:${d.preReceiptId}`,
          kind: "Pre-receipt",
          _ref: (
            <Link href={`/traders/pre-receipts/${encodeURIComponent(d.preReceiptId)}`} className="text-primary hover:underline font-mono text-sm">
              {d.preReceiptNo ?? d.preReceiptId}
            </Link>
          ),
          periodMonth: "—",
          assetLabel: "—",
          _amount: `${formatInr(Number(d.amount ?? 0))}`,
          _paid: "—",
          _outstanding: `${formatInr(Number(d.amount ?? 0))}`,
          _status: <span>{d.status}</span>,
          _actions: <span className="text-sm text-muted-foreground">Open to settle</span>,
        };
      }

      return {
        id: `inv:${d.invoiceId}`,
        kind: "Rent invoice",
        _ref: (
          <Link href={`/rent/ioms/invoices/${d.invoiceId}`} className="text-primary hover:underline font-mono text-sm">
            {d.invoiceNo ?? d.invoiceId}
          </Link>
        ),
        periodMonth: d.periodMonth,
        assetLabel: assetLabelById[d.assetId] ?? d.assetId,
        _amount: `${formatInr(Number(d.totalAmount ?? 0))}`,
        _paid: `${formatInr(Number(d.paidAmount ?? 0))}`,
        _outstanding: `${formatInr(Number(d.outstandingAmount ?? 0))}`,
        _status: <span>{d.status}</span>,
        _actions: (
          <Button
            size="sm"
            disabled={!canMarkPaid}
            onClick={() => openPayDialog("rent", d, null, d.outstandingAmount, d.yardId)}
          >
            <CheckCircle className="h-4 w-4 mr-1" />
            Pay
          </Button>
        ),
      };
    });
  }, [dues, assetLabelById, canMarkPaid, canPayMarketFee]);

  const loading = unifiedLoading || isLoading;

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "Traders", href: "/traders/licences" }, { label: "Outstanding dues" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Failed to load dues.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Traders", href: "/traders/licences" }, { label: "Outstanding dues" }]}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5" />
            Outstanding dues (unified entity)
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Select a unified entity ID (<span className="font-mono">TA:</span>/<span className="font-mono">TB:</span>/<span className="font-mono">AH:</span>). Track A shows rent invoice dues (counter pay) plus M-04 market fee outstanding (counter pay records M-05 receipts; partial payments supported). Track B shows pre-receipt dues only for{" "}
            <span className="font-medium text-foreground">Govt</span> sub-type entities; other Track B sub-types use M-03 tax invoices.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-end">
            <div className="space-y-1">
              <Label>Unified entity</Label>
              <Select value={unifiedId || "__none__"} onValueChange={(v) => setUnifiedId(v === "__none__" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select entity…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Select…</SelectItem>
                  {unified.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {unifiedLabelById[u.id]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="text-sm">
              <span className="text-muted-foreground">Total outstanding:</span>{" "}
              <span className="font-medium">{formatInr(totalOutstanding)}</span>
            </div>
          </div>

          {duesResp?.trackBBillingHint ? (
            <Alert>
              <AlertTitle>Track B billing</AlertTitle>
              <AlertDescription className="text-sm">{duesResp.trackBBillingHint}</AlertDescription>
            </Alert>
          ) : null}

          {loading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <ClientDataGrid
              columns={columns}
              sourceRows={rows}
              searchKeys={["kind", "periodMonth", "assetLabel"]}
              searchPlaceholder="Search dues…"
              defaultSortKey="kind"
              defaultSortDir="asc"
              emptyMessage={unifiedId.trim() ? "No outstanding dues." : "Select a unified entity to load dues."}
            />
          )}
        </CardContent>
      </Card>

      <Dialog
        open={payOpen}
        onOpenChange={(open) => {
          setPayOpen(open);
          if (!open) {
            setPayStep("summary");
            setPayInvoice(null);
            setPayMarket(null);
            setPayYardId("");
            setPayAmount("");
            setPaymentPref(defaultPaymentPreferenceValue());
            setOnlineReceiptHref("");
          }
        }}
      >
        <DialogContent className={payStep === "payment" ? "sm:max-w-2xl max-h-[90vh]" : "sm:max-w-md"}>
          <DialogHeader>
            <DialogTitle>{payKind === "rent" ? "Pay rent invoice" : "Pay market fee (M-04)"}</DialogTitle>
          </DialogHeader>
          {payStep === "summary" ? (
            <div className="space-y-3">
              {payKind === "rent" && payInvoice?.invoiceId ? (
                <Alert className="border-amber-500/30 bg-muted/40">
                  <AlertTitle className="text-sm">After a cheque/DD dishonour</AlertTitle>
                  <AlertDescription className="text-xs text-muted-foreground space-y-1">
                    <p>
                      If this invoice had a reversed receipt earlier, the replacement receipt may show an{" "}
                      <strong>arrears interest disclosure</strong> (not added to the receipt total). Open the new receipt
                      from the register after you pay here, or review the invoice workflow.
                    </p>
                    <Link
                      className="text-primary font-medium hover:underline inline-block"
                      href={`/rent/ioms/invoices/${encodeURIComponent(payInvoice.invoiceId)}`}
                    >
                      Rent invoice detail
                    </Link>
                  </AlertDescription>
                </Alert>
              ) : null}
              <div className="text-sm">
                {payKind === "rent" ? (
                  <>
                    <span className="text-muted-foreground">Invoice:</span>{" "}
                    <span className="font-mono">{payInvoice?.invoiceNo ?? payInvoice?.invoiceId}</span>
                    <br />
                    <span className="text-muted-foreground">Outstanding:</span>{" "}
                    <span className="font-medium">{formatInr(Number(payInvoice?.outstandingAmount ?? 0))}</span>
                  </>
                ) : (
                  <>
                    <span className="text-muted-foreground">Purchase:</span>{" "}
                    <span className="font-mono">{payMarket?.transactionNo ?? payMarket?.purchaseTransactionId}</span>
                    <br />
                    <span className="text-muted-foreground">Outstanding:</span>{" "}
                    <span className="font-medium">{formatInr(Number(payMarket?.outstandingAmount ?? 0))}</span>
                  </>
                )}
              </div>
              <div className="space-y-1">
                <Label>Amount</Label>
                <Input value={payAmount} onChange={(e) => setPayAmount(e.target.value)} placeholder="e.g. 11800" />
              </div>
            </div>
          ) : (
            <PaymentPreferenceForm
              value={paymentPref}
              onChange={setPaymentPref}
              receivedByLabel={receivedByLabel}
              receivedAtLabel={receivedAtLabel}
              summaryAmount={payAmount}
            />
          )}
          <DialogFooter className="flex-wrap gap-2">
            {payStep === "payment" ? (
              <Button
                variant="outline"
                onClick={() => {
                  setPayStep("summary");
                  setPaymentPref((p) => ({ ...p, paidAmount: payAmount }));
                }}
              >
                Back
              </Button>
            ) : null}
            <Button variant="outline" onClick={() => setPayOpen(false)}>
              Cancel
            </Button>
            {payStep === "summary" ? (
              <>
                <Button
                  variant="secondary"
                  onClick={() => onlineMutation.mutate()}
                  disabled={
                    onlineMutation.isPending ||
                    !Number.isFinite(Number(payAmount)) ||
                    Number(payAmount) <= 0 ||
                    (payKind === "rent" ? !payInvoice : !payMarket)
                  }
                >
                  Pay online
                </Button>
                <Button
                  onClick={() => {
                    const amt = Number(payAmount);
                    if (!Number.isFinite(amt) || amt <= 0) {
                      toast({ title: "Invalid amount", description: "Enter a valid amount.", variant: "destructive" });
                      return;
                    }
                    setPaymentPref(defaultPaymentPreferenceValue(amt));
                    setPayStep("payment");
                  }}
                  disabled={
                    !Number.isFinite(Number(payAmount)) ||
                    Number(payAmount) <= 0 ||
                    (payKind === "rent" ? !payInvoice : !payMarket)
                  }
                >
                  Pay
                </Button>
              </>
            ) : (
              <Button onClick={() => payMutation.mutate()} disabled={payMutation.isPending}>
                Confirm payment
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {onlineReceiptHref ? (
        <Alert className="mt-4">
          <AlertTitle>Next step</AlertTitle>
          <AlertDescription className="text-sm">
            Open the receipt and use <span className="font-medium">Initiate payment</span> (gateway must be enabled).
            <div className="mt-2">
              <Link className="text-primary font-medium hover:underline" href={onlineReceiptHref}>
                Open created receipt
              </Link>
            </div>
          </AlertDescription>
        </Alert>
      ) : null}
    </AppShell>
  );
}
