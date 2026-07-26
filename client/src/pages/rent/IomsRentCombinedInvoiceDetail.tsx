import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { formatInr } from "@/lib/formatInr";
import { ArrowLeft, Download, Loader2, Banknote, ChevronUp, ChevronDown } from "lucide-react";
import { CounterPaymentDialog } from "@/components/payments/CounterPaymentDialog";

interface ChildInvoice {
  id: string;
  invoiceNo: string | null;
  assetCode: string;
  rentAmount: number;
  cgst: number;
  sgst: number;
  tdsAmount: number;
  totalAmount: number;
  status: string;
  outstanding: number;
}

interface BundleDetail {
  id: string;
  bundleInvoiceNo: string;
  periodMonth: string;
  yardId: string;
  tenantLicenceId?: string;
  tenantName?: string | null;
  totalAmount: number;
  totalTdsAmount: number;
  outstandingTotal: number;
  status: string;
  children: ChildInvoice[];
}

type AllocRow = { invoiceId: string; amount: string; label: string; outstanding: number };

export default function IomsRentCombinedInvoiceDetail() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [pdfLoading, setPdfLoading] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [allocRows, setAllocRows] = useState<AllocRow[]>([]);
  const [payDialogOpen, setPayDialogOpen] = useState(false);
  const [dialogAmount, setDialogAmount] = useState("");

  const { data: bundle, isLoading } = useQuery<BundleDetail>({
    queryKey: [`/api/ioms/rent/combined-invoices/${id}`],
    enabled: Boolean(id),
  });

  const allocSeedKey = bundle
    ? `${bundle.id}|${bundle.outstandingTotal}|${bundle.children.map((c) => `${c.id}:${c.outstanding}`).join(",")}`
    : "";

  useEffect(() => {
    if (!bundle) return;
    setAllocRows(
      bundle.children.map((c) => ({
        invoiceId: c.id,
        amount: "",
        label: `${c.invoiceNo ?? c.id} · ${c.assetCode} (outstanding ${formatInr(c.outstanding)})`,
        outstanding: c.outstanding,
      })),
    );
  }, [allocSeedKey, bundle]);

  const moveRow = (idx: number, dir: -1 | 1) => {
    setAllocRows((rows) => {
      const next = [...rows];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return rows;
      [next[idx], next[j]] = [next[j]!, next[idx]!];
      return next;
    });
  };

  const activeAllocations = useMemo(
    () =>
      allocRows
        .map((r) => ({ invoiceId: r.invoiceId, amount: Number(r.amount), label: r.label }))
        .filter((a) => Number.isFinite(a.amount) && a.amount > 0),
    [allocRows],
  );

  const payMutation = useMutation({
    mutationFn: async (payBody: Record<string, unknown>) => {
      const amount = Number(payAmount);
      const allocations = activeAllocations.map((a) => ({ invoiceId: a.invoiceId, amount: a.amount }));
      const res = await fetch(`/api/ioms/rent/combined-invoices/${id}/record-payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ...payBody, amount, allocations }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? res.statusText);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/ioms/rent/combined-invoices/${id}`] });
      toast({ title: "Payment recorded", description: "Allocations applied in your chosen order." });
      setPayAmount("");
      setPayDialogOpen(false);
    },
    onError: (e: Error) => {
      toast({ title: "Payment failed", description: e.message, variant: "destructive" });
    },
  });

  const allocSum = allocRows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const canOpenPayDialog =
    Number.isFinite(Number(payAmount)) &&
    Number(payAmount) > 0 &&
    activeAllocations.length > 0 &&
    Math.abs(allocSum - Number(payAmount)) <= 0.02;

  const openPaymentMode = () => {
    if (!canOpenPayDialog) {
      toast({
        title: "Check amounts",
        description: "Payment amount must match the allocation sum.",
        variant: "destructive",
      });
      return;
    }
    setDialogAmount(String(Number(payAmount)));
    setPayDialogOpen(true);
  };

  const downloadPdf = async () => {
    setPdfLoading(true);
    try {
      const res = await fetch(`/api/ioms/rent/combined-invoices/${id}/pdf`, { credentials: "include" });
      if (!res.ok) throw new Error("PDF failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `combined-rent-invoice.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast({ title: "PDF failed", variant: "destructive" });
    } finally {
      setPdfLoading(false);
    }
  };

  if (isLoading || !bundle) {
    return (
      <AppShell breadcrumbs={[{ label: "Combined invoice" }]}>
        <Skeleton className="h-64 w-full" />
      </AppShell>
    );
  }

  return (
    <AppShell
      breadcrumbs={[
        { label: "Rent (IOMS)", href: "/rent/ioms" },
        { label: "Combined invoices", href: "/rent/ioms/combined-invoices" },
        { label: bundle.bundleInvoiceNo },
      ]}
    >
      <Button variant="ghost" size="sm" className="mb-4" asChild>
        <Link href="/rent/ioms/combined-invoices">
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Link>
      </Button>

      <Card className="mb-6">
        <CardHeader className="flex flex-row items-start justify-between">
          <div>
            <CardTitle className="font-mono">{bundle.bundleInvoiceNo}</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              {bundle.tenantName?.trim() ? (
                <>
                  <span className="text-foreground font-medium">{bundle.tenantName.trim()}</span>
                  {" · "}
                </>
              ) : null}
              Billing month {bundle.periodMonth} · {bundle.children.length} premises · TDS computed per premises (total{" "}
              {formatInr(bundle.totalTdsAmount)})
            </p>
          </div>
          <div className="flex gap-2 items-center">
            <Badge>{bundle.status}</Badge>
            <Button type="button" variant="outline" size="sm" onClick={() => void downloadPdf()} disabled={pdfLoading}>
              {pdfLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4 mr-1" />}
              Bundle PDF
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Total</span>
              <p className="font-medium">{formatInr(bundle.totalAmount)}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Outstanding</span>
              <p className="font-medium">{formatInr(bundle.outstandingTotal)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Premises (child invoices)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {bundle.children.map((c) => (
            <div key={c.id} className="flex flex-wrap gap-4 text-sm border-b pb-2">
              <Link href={`/rent/ioms/invoices/${c.id}`} className="font-mono text-primary hover:underline">
                {c.invoiceNo ?? c.id}
              </Link>
              <span>{c.assetCode}</span>
              <span>{formatInr(c.totalAmount)}</span>
              {c.tdsAmount > 0 ? <span className="text-muted-foreground">TDS {formatInr(c.tdsAmount)}</span> : null}
            </div>
          ))}
        </CardContent>
      </Card>

      {bundle.outstandingTotal > 0.01 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Banknote className="h-4 w-4" />
              Partial payment (user-selected allocation order)
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Set amounts per premises in the order you want them applied. Use arrows to reorder. Then Record payment to
              choose Cash / Cheque / NEFT.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="max-w-xs space-y-2">
              <Label>Payment amount (₹)</Label>
              <Input value={payAmount} onChange={(e) => setPayAmount(e.target.value)} type="number" min={0} step="0.01" />
            </div>
            {allocRows.map((row, idx) => (
              <div key={row.invoiceId} className="flex flex-wrap items-center gap-2">
                <div className="flex flex-col gap-0.5">
                  <Button type="button" size="icon" variant="ghost" className="h-6 w-6" onClick={() => moveRow(idx, -1)} disabled={idx === 0}>
                    <ChevronUp className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    onClick={() => moveRow(idx, 1)}
                    disabled={idx === allocRows.length - 1}
                  >
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </div>
                <span className="text-sm min-w-[12rem]">{row.label}</span>
                <Input
                  className="max-w-[8rem]"
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="0"
                  value={row.amount}
                  onChange={(e) => {
                    const v = e.target.value;
                    setAllocRows((rows) => rows.map((r, i) => (i === idx ? { ...r, amount: v } : r)));
                  }}
                />
              </div>
            ))}
            <p className="text-sm text-muted-foreground">Allocation sum: {formatInr(allocSum)}</p>
            <Button type="button" disabled={payMutation.isPending || !canOpenPayDialog} onClick={openPaymentMode}>
              Record payment
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <CounterPaymentDialog
        open={payDialogOpen}
        onOpenChange={setPayDialogOpen}
        title="Record combined invoice payment"
        yardId={bundle.yardId}
        amount={dialogAmount}
        onAmountChange={setDialogAmount}
        initialStep="payment"
        hideAmountOnSummary
        confirmPending={payMutation.isPending}
        canAdvanceFromSummary={canOpenPayDialog}
        summaryContent={
          <div className="text-sm space-y-2">
            <p>
              <span className="text-muted-foreground">Bundle:</span>{" "}
              <span className="font-mono">{bundle.bundleInvoiceNo}</span>
            </p>
            <p>
              <span className="text-muted-foreground">Outstanding:</span>{" "}
              <span className="font-medium">{formatInr(bundle.outstandingTotal)}</span>
            </p>
            <p>
              <span className="text-muted-foreground">Paying:</span>{" "}
              <span className="font-medium">{formatInr(Number(dialogAmount) || 0)}</span>
            </p>
            <ul className="list-disc pl-4 text-muted-foreground">
              {activeAllocations.map((a) => (
                <li key={a.invoiceId}>
                  {a.label.split(" (outstanding")[0]} — {formatInr(a.amount)}
                </li>
              ))}
            </ul>
          </div>
        }
        onConfirm={async (payBody) => {
          await payMutation.mutateAsync(payBody);
        }}
      />
    </AppShell>
  );
}
