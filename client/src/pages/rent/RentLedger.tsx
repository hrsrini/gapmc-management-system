import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { BookOpen, AlertCircle, Receipt } from "lucide-react";
import { Link } from "wouter";
import {
  ReportDataTable,
  type ReportPagedParams,
  type ReportTableColumn,
} from "@/components/reports/ReportDataTable";
import { sliceClientReport } from "@/lib/clientReportSlice";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatInr } from "@/lib/formatInr";
import { useToast } from "@/hooks/use-toast";

interface LedgerEntry {
  id: string;
  tenantLicenceId: string;
  tenantLicenceDisplayName?: string | null;
  unifiedEntityId?: string | null;
  unifiedEntityDisplayName?: string | null;
  assetId: string;
  assetDisplay?: string | null;
  entryDate: string;
  entryType: string;
  debit: number;
  credit: number;
  balance: number;
  invoiceId?: string | null;
  invoiceNo?: string | null;
  receiptId?: string | null;
  receiptNo?: string | null;
  refDisplay?: string | null;
  interestPaymentStatus?: string | null;
  settledReceiptId?: string | null;
}

interface LedgerPaymentContext {
  invoiceId: string;
  invoiceNo: string | null;
  outstandingRent: number;
  isGovtEntity: boolean;
  status: string;
}

interface TraderReceiptRow {
  id: string;
  receiptNo: string;
  revenueHead: string;
  totalAmount: number;
  status: string;
  sourceModule?: string | null;
  sourceRecordId?: string | null;
  createdAt: string;
}

const columns: ReportTableColumn[] = [
  { key: "entryDate", header: "Entry date" },
  { key: "tenantLicenceDisplay", header: "Tenant licence (no. / id)" },
  { key: "unifiedEntityDisplay", header: "Unified entity (name)" },
  { key: "assetDisplay", header: "Asset" },
  { key: "entryType", header: "Type" },
  { key: "_debit", header: "Debit", sortField: "debit" },
  { key: "_credit", header: "Credit", sortField: "credit" },
  { key: "_balance", header: "Balance", sortField: "balance" },
  { key: "refDisplay", header: "Invoice / Receipt" },
  { key: "_payStatus", header: "Payment status" },
  { key: "_actions", header: "Actions" },
];

type PayMode = "rent_only" | "interest_only" | "combined";

export default function RentLedger() {
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const unifiedEntityFromUrl = searchParams.get("unifiedEntityId")?.trim() ?? "";
  const tenantLicenceFromUrl = searchParams.get("tenantLicenceId")?.trim() ?? "";
  const assetIdFromUrl = searchParams.get("assetId")?.trim() ?? "";

  const ledgerApiUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (unifiedEntityFromUrl) params.set("unifiedEntityId", unifiedEntityFromUrl);
    else if (tenantLicenceFromUrl) params.set("tenantLicenceId", tenantLicenceFromUrl);
    if (assetIdFromUrl) params.set("assetId", assetIdFromUrl);
    return params.toString() ? `/api/ioms/rent/ledger?${params.toString()}` : "/api/ioms/rent/ledger";
  }, [unifiedEntityFromUrl, tenantLicenceFromUrl, assetIdFromUrl]);

  const [tableParams, setTableParams] = useState<ReportPagedParams>({
    page: 1,
    pageSize: 25,
    q: "",
    sortKey: "entryDate",
    sortDir: "desc",
  });

  const mergeParams = useCallback((next: Partial<ReportPagedParams>) => {
    setTableParams((s) => ({ ...s, ...next }));
  }, []);

  const receiptParams = new URLSearchParams();
  if (unifiedEntityFromUrl) receiptParams.set("unifiedEntityId", unifiedEntityFromUrl);
  else if (tenantLicenceFromUrl) receiptParams.set("tenantLicenceId", tenantLicenceFromUrl);
  const traderReceiptsUrl = receiptParams.toString()
    ? `/api/ioms/rent/ledger/trader-receipts?${receiptParams.toString()}`
    : "";

  const [payDialog, setPayDialog] = useState<{
    invoiceId: string;
    selectedInterestIds: string[];
  } | null>(null);
  const [payMode, setPayMode] = useState<PayMode>("interest_only");
  const [rentAmountInput, setRentAmountInput] = useState("");

  useEffect(() => {
    setTableParams((p) => ({ ...p, page: 1 }));
  }, [ledgerApiUrl]);

  const { data: list = [], isLoading, isError } = useQuery<LedgerEntry[]>({ queryKey: [ledgerApiUrl] });
  const { data: traderReceipts = [], isLoading: traderReceiptsLoading } = useQuery<TraderReceiptRow[]>({
    queryKey: [traderReceiptsUrl],
    enabled: Boolean(traderReceiptsUrl),
  });
  const paymentContextUrl = payDialog
    ? `/api/ioms/rent/invoices/${encodeURIComponent(payDialog.invoiceId)}/ledger-payment-context`
    : "";
  const { data: paymentContext } = useQuery<LedgerPaymentContext>({
    queryKey: [paymentContextUrl],
    enabled: Boolean(paymentContextUrl),
  });

  const openPayInterest = useCallback((row: LedgerEntry) => {
    const invId = String(row.invoiceId ?? "").trim();
    if (!invId) {
      toast({ title: "Missing invoice", description: "This interest line has no linked invoice id.", variant: "destructive" });
      return;
    }
    setPayMode("interest_only");
    setRentAmountInput("");
    setPayDialog({ invoiceId: invId, selectedInterestIds: [row.id] });
  }, [toast]);

  const payMutation = useMutation({
    mutationFn: async () => {
      if (!payDialog) throw new Error("No dialog");
      const rentAmt = payMode === "interest_only" ? 0 : Number(rentAmountInput);
      if ((payMode === "rent_only" || payMode === "combined") && (!Number.isFinite(rentAmt) || rentAmt <= 0)) {
        throw new Error("Enter a valid rent amount.");
      }
      if ((payMode === "interest_only" || payMode === "combined") && payDialog.selectedInterestIds.length === 0) {
        throw new Error("Select at least one interest line.");
      }
      const res = await apiRequest("POST", "/api/ioms/rent/ledger/record-payment", {
        invoiceId: payDialog.invoiceId,
        mode: payMode,
        rentAmount: payMode === "interest_only" ? undefined : rentAmt,
        interestLedgerEntryIds:
          payMode === "rent_only" ? undefined : payDialog.selectedInterestIds,
        paymentMode: "Cash",
      });
      return (await res.json()) as { receiptId: string; receiptNo: string; ledgerMessages?: string[] };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [ledgerApiUrl] });
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/rent/invoices"] });
      queryClient.invalidateQueries({ queryKey: [paymentContextUrl] });
      setPayDialog(null);
      toast({
        title: "Payment recorded",
        description: `${data.receiptNo}${data.ledgerMessages?.length ? ` — ${data.ledgerMessages.join(" ")}` : ""}`,
      });
    },
    onError: (e: unknown) => {
      toast({
        title: "Payment failed",
        description: e instanceof Error ? e.message : "Request failed",
        variant: "destructive",
      });
    },
  });

  const unpaidInterestForInvoice = useMemo(() => {
    if (!payDialog) return [];
    return list.filter(
      (e) =>
        e.entryType === "Interest" &&
        String(e.invoiceId ?? "") === payDialog.invoiceId &&
        String(e.interestPaymentStatus ?? "").trim() !== "Paid",
    );
  }, [list, payDialog]);

  const sourceRows = useMemo((): Record<string, unknown>[] => {
    return list.map((e) => {
      const isInterest = e.entryType === "Interest";
      const paid = String(e.interestPaymentStatus ?? "").trim() === "Paid";
      const payStatus =
        isInterest ? (paid ? "Paid" : "Unpaid") : "—";
      const canPayInterest =
        isInterest &&
        !paid &&
        e.invoiceId &&
        (Number(e.debit ?? 0) > 0.001);
      const settledLink =
        isInterest && paid && e.settledReceiptId ? (
          <Link
            href={`/receipts/ioms/${encodeURIComponent(e.settledReceiptId)}`}
            className="text-primary hover:underline text-xs font-mono"
          >
            Receipt
          </Link>
        ) : null;
      return {
        id: e.id,
        entryDate: e.entryDate.slice(0, 10),
        tenantLicenceId: e.tenantLicenceId,
        tenantLicenceDisplay: e.tenantLicenceDisplayName?.trim() || e.tenantLicenceId || "—",
        unifiedEntityDisplay: e.unifiedEntityDisplayName?.trim() || "—",
        assetDisplay: e.assetDisplay?.trim() || "—",
        entryType: e.entryType === "Collection" ? "Rent" : e.entryType,
        debit: e.debit,
        credit: e.credit,
        balance: e.balance,
        _debit: `${formatInr(e.debit)}`,
        _credit: `${formatInr(e.credit)}`,
        _balance: `${formatInr(e.balance)}`,
        refDisplay: e.refDisplay?.trim() || e.invoiceNo?.trim() || e.receiptNo?.trim() || "—",
        _payStatus: (
          <div className="flex flex-col gap-0.5 text-sm">
            <span>{payStatus}</span>
            {settledLink}
          </div>
        ),
        _actions: canPayInterest ? (
          <Button size="sm" variant="secondary" onClick={() => openPayInterest(e)}>
            Pay interest
          </Button>
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
        ),
      };
    });
  }, [list, openPayInterest]);

  const { rows, total } = useMemo(
    () =>
      sliceClientReport(sourceRows, tableParams, [
        "entryDate",
        "tenantLicenceId",
        "tenantLicenceDisplay",
        "unifiedEntityId",
        "unifiedEntityDisplay",
        "assetDisplay",
        "entryType",
        "debit",
        "credit",
        "balance",
        "refDisplay",
      ]),
    [sourceRows, tableParams],
  );

  const totalPages =
    tableParams.pageSize === "all" ? 1 : Math.max(1, Math.ceil(total / tableParams.pageSize));

  useEffect(() => {
    if (total > 0 && tableParams.page > totalPages) {
      setTableParams((p) => ({ ...p, page: totalPages }));
    }
  }, [total, totalPages, tableParams.page]);

  const toggleInterestId = (id: string, checked: boolean) => {
    if (!payDialog) return;
    setPayDialog((d) => {
      if (!d) return d;
      const set = new Set(d.selectedInterestIds);
      if (checked) set.add(id);
      else set.delete(id);
      return { ...d, selectedInterestIds: Array.from(set) };
    });
  };

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "Rent (IOMS)", href: "/rent/ioms" }, { label: "Rent deposit ledger" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Failed to load ledger.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  const out = paymentContext?.outstandingRent ?? 0;
  const allowCombined = out > 0.01;

  return (
    <AppShell breadcrumbs={[{ label: "Rent (IOMS)", href: "/rent/ioms" }, { label: "Rent deposit ledger" }]}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            Rent deposit ledger (M-03)
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Per tenant per asset — opening balance, rent, interest, and rent receipts. Accrued <span className="font-medium">Interest</span> lines can be settled with <span className="font-medium">Pay interest</span> (creates an IOMS receipt and posts an <span className="font-medium">InterestCollection</span> credit). Use{" "}
            <span className="font-medium">combined</span> to pay outstanding rent and selected interest on one receipt (PDF shows both components).
          </p>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <ReportDataTable
              columns={columns}
              rows={rows}
              total={total}
              params={tableParams}
              onParamsChange={mergeParams}
              isLoading={false}
              searchPlaceholder="Search date, licence no/id, firm name, TA id, asset code, type, amounts, invoice…"
            />
          )}
        </CardContent>
      </Card>

      <Dialog open={Boolean(payDialog)} onOpenChange={(o) => !o && setPayDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Record rent / interest payment</DialogTitle>
          </DialogHeader>
          {payDialog ? (
            <div className="grid gap-4 text-sm">
              <p className="text-muted-foreground">
                Invoice{" "}
                <span className="font-mono text-foreground">
                  {paymentContext?.invoiceNo ?? payDialog.invoiceId.slice(0, 8)}…
                </span>
                {paymentContext != null ? (
                  <>
                    {" "}
                    — outstanding rent{" "}
                    <span className="font-medium text-foreground">{formatInr(out)}</span>
                  </>
                ) : null}
              </p>
              <div className="grid gap-2">
                <Label>Payment type</Label>
                <Select
                  value={payMode}
                  onValueChange={(v) => setPayMode(v as PayMode)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="interest_only">Interest only</SelectItem>
                    {allowCombined ? <SelectItem value="combined">Rent + interest (one receipt)</SelectItem> : null}
                    {allowCombined ? <SelectItem value="rent_only">Rent only</SelectItem> : null}
                  </SelectContent>
                </Select>
              </div>
              {(payMode === "rent_only" || payMode === "combined") && (
                <div className="grid gap-2">
                  <Label htmlFor="rent-amt">Rent amount (₹)</Label>
                  <Input
                    id="rent-amt"
                    inputMode="decimal"
                    value={rentAmountInput}
                    onChange={(ev) => setRentAmountInput(ev.target.value)}
                    placeholder={allowCombined ? `Max ${formatInr(out)}` : "Amount"}
                  />
                </div>
              )}
              {(payMode === "interest_only" || payMode === "combined") && (
                <div className="grid gap-2">
                  <Label>Unpaid interest lines</Label>
                  <div className="max-h-40 overflow-y-auto rounded border p-2 space-y-2">
                    {unpaidInterestForInvoice.map((row) => (
                      <label key={row.id} className="flex items-center gap-2 cursor-pointer">
                        <Checkbox
                          checked={payDialog.selectedInterestIds.includes(row.id)}
                          onCheckedChange={(c) => toggleInterestId(row.id, c === true)}
                        />
                        <span className="tabular-nums">
                          {formatInr(Number(row.debit ?? 0))} — {row.entryDate.slice(0, 10)}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : null}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setPayDialog(null)}>
              Cancel
            </Button>
            <Button onClick={() => payMutation.mutate()} disabled={payMutation.isPending}>
              {payMutation.isPending ? "Saving…" : "Create receipt & post ledger"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {traderReceiptsUrl ? (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Receipt className="h-4 w-4" />
              Trader-linked IOMS receipts
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Receipts with payer <span className="font-medium">TraderLicence</span> = this tenant (any revenue head /
              source module). Does not alter deposit ledger running balance.
            </p>
          </CardHeader>
          <CardContent>
            {traderReceiptsLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : traderReceipts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No receipts found for this trader licence payer ref.</p>
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50 text-left">
                      <th className="p-2 font-medium">Receipt</th>
                      <th className="p-2 font-medium">Head</th>
                      <th className="p-2 font-medium">Source</th>
                      <th className="p-2 font-medium text-right">Amount</th>
                      <th className="p-2 font-medium">Status</th>
                      <th className="p-2 font-medium">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {traderReceipts.map((r) => (
                      <tr key={r.id} className="border-b last:border-0">
                        <td className="p-2">
                          <Link
                            href={`/receipts/ioms/${encodeURIComponent(r.id)}`}
                            className="text-primary hover:underline font-mono"
                          >
                            {r.receiptNo}
                          </Link>
                        </td>
                        <td className="p-2">{r.revenueHead}</td>
                        <td className="p-2 font-mono text-xs">
                          {r.sourceModule ?? "—"}
                          {r.sourceRecordId ? ` · ${r.sourceRecordId.slice(0, 8)}…` : ""}
                        </td>
                        <td className="p-2 text-right tabular-nums">{formatInr(Number(r.totalAmount ?? 0))}</td>
                        <td className="p-2">{r.status}</td>
                        <td className="p-2 text-muted-foreground whitespace-nowrap">
                          {r.createdAt?.slice(0, 10) ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}
    </AppShell>
  );
}
