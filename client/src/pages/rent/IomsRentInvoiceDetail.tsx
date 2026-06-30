import { useEffect, useMemo, useState } from "react";
import { useParams, useLocation, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FileText, ArrowLeft, ShieldCheck, CheckCircle, AlertCircle, SendHorizontal, Banknote, Ban, StickyNote, Download, Loader2, RefreshCw } from "lucide-react";
import { buildRentInvoiceBillingBreakdown } from "@shared/rent-invoice-billing-display";
import type { RentBillingType } from "@shared/rent-invoice-billing";
import { formatApiDateOrDateTime, formatYearMonthToDisplay, formatYmdToDisplay } from "@/lib/dateFormat";
import { MIN_WORKFLOW_REMARKS_LENGTH } from "@shared/workflow-rejection";
import type { AssetAllotmentRow, EntityAllotmentRow } from "./rent-allotments-ui";
import { formatInr } from "@/lib/formatInr";
import { CounterPaymentDialog } from "@/components/payments/CounterPaymentDialog";
import {
  entityIdFromRentInvoice,
  formatRentInvoiceAllotmentReference,
  formatRentInvoiceTenantCounterparty,
} from "./rent-allotments-ui";

interface RentInvoice {
  id: string;
  invoiceNo?: string | null;
  allotmentId: string;
  allotmentKind?: string | null;
  entityId?: string | null;
  tenantLicenceId: string;
  assetId: string;
  yardId: string;
  periodMonth: string;
  billingType?: string | null;
  occupancyFrom?: string | null;
  occupancyTo?: string | null;
  baseMonthlyRent?: number | null;
  daysInMonth?: number | null;
  billableDays?: number | null;
  billingFactor?: number | null;
  billingConfigJson?: string | null;
  rentAmount: number;
  cgst: number;
  sgst: number;
  totalAmount: number;
  tdsApplicable?: boolean | null;
  tdsAmount?: number | null;
  isGovtEntity?: boolean;
  status: string;
  doUser?: string | null;
  dvUser?: string | null;
  daUser?: string | null;
  generatedAt?: string | null;
  approvedAt?: string | null;
  workflowRevisionCount?: number | null;
  dvReturnRemarks?: string | null;
  nonGstChargesJson?: string | null;
  combinedBundleId?: string | null;
}
interface YardRef {
  id: string;
  name: string;
}
interface AssetRef {
  id: string;
  assetId: string;
}
interface LicenceRef {
  id: string;
  licenceNo?: string | null;
  firmName?: string | null;
}

interface CreditNoteRow {
  id: string;
  creditNoteNo: string;
  invoiceId: string;
  reason: string;
  amount: number;
  status: string;
}

export default function IomsRentInvoiceDetail() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { user, can } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const roles = user?.roles?.map((r) => r.tier) ?? [];
  const canVerify = roles.includes("DV") || roles.includes("ADMIN");
  const canApprove = roles.includes("DA") || roles.includes("ADMIN");

  const { data: invoice, isLoading, isError } = useQuery<RentInvoice>({
    queryKey: ["/api/ioms/rent/invoices", id],
    enabled: !!id,
  });
  const { data: yards = [] } = useQuery<YardRef[]>({
    queryKey: ["/api/yards"],
  });
  const { data: assets = [] } = useQuery<AssetRef[]>({
    queryKey: ["/api/ioms/assets"],
  });
  const { data: allotments = [] } = useQuery<AssetAllotmentRow[]>({
    queryKey: ["/api/ioms/asset-allotments"],
  });
  const { data: entityAllotments = [] } = useQuery<EntityAllotmentRow[]>({
    queryKey: ["/api/ioms/entity-allotments"],
  });
  const { data: licences = [] } = useQuery<LicenceRef[]>({
    queryKey: ["/api/ioms/traders/licences"],
  });
  const entityIdResolved = invoice ? entityIdFromRentInvoice(invoice) : null;
  const { data: entityMaster } = useQuery<{ id: string; name: string; entityCode?: string | null }>({
    queryKey: ["/api/ioms/entities", entityIdResolved],
    enabled: Boolean(entityIdResolved),
  });

  const [sendBackOpen, setSendBackOpen] = useState(false);
  const [markPaidOpen, setMarkPaidOpen] = useState(false);
  const [markPaidAmount, setMarkPaidAmount] = useState("");
  const [returnRemarks, setReturnRemarks] = useState("");
  const [cnReason, setCnReason] = useState("");
  const [cnAmount, setCnAmount] = useState("");
  const [cnNo, setCnNo] = useState("");
  const [draftBillingType, setDraftBillingType] = useState<RentBillingType>("FullMonth");

  const { data: creditNoteList = [] } = useQuery<CreditNoteRow[]>({
    queryKey: ["/api/ioms/rent/credit-notes"],
    enabled: !!id,
  });
  const paymentContextUrl = id ? `/api/ioms/rent/invoices/${encodeURIComponent(id)}/ledger-payment-context` : "";
  const { data: paymentContext } = useQuery<{
    outstandingRent: number;
    invoiceNo?: string | null;
    yardId: string;
  }>({
    queryKey: [paymentContextUrl],
    enabled: Boolean(paymentContextUrl),
  });
  const creditNotesForInvoice = creditNoteList.filter((c) => c.invoiceId === id);

  const yardById = Object.fromEntries(yards.map((y) => [y.id, y.name]));
  const assetById = Object.fromEntries(assets.map((a) => [a.id, a.assetId]));
  const licenceById = Object.fromEntries(
    licences.map((l) => [l.id, l.licenceNo ? `${l.licenceNo}${l.firmName ? ` — ${l.firmName}` : ""}` : (l.firmName ?? l.id)]),
  );

  const allotmentReferenceNo = useMemo(() => {
    if (!invoice) return "";
    return formatRentInvoiceAllotmentReference(
      invoice.allotmentId,
      entityAllotments,
      allotments,
      assetById,
      invoice.assetId,
    );
  }, [invoice, entityAllotments, allotments, assetById]);

  const tenantLabel = useMemo(() => {
    if (!invoice) return "";
    return formatRentInvoiceTenantCounterparty(invoice.tenantLicenceId, entityMaster, licenceById);
  }, [invoice, entityMaster, licenceById]);

  const markPaidPayMutation = useMutation({
    mutationFn: async (payBody: Record<string, unknown>) => {
      const res = await fetch("/api/ioms/dues/pay-rent-invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ invoiceId: id, ...payBody }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText);
      return data as { receiptNo?: string };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/rent/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/rent/invoices", id] });
      queryClient.invalidateQueries({ queryKey: [paymentContextUrl] });
      setMarkPaidOpen(false);
      toast({
        title: "Payment recorded",
        description: data.receiptNo ? `Receipt ${data.receiptNo}. Invoice marked paid when fully settled.` : "Payment saved.",
      });
    },
    onError: (e: Error) => toast({ title: "Payment failed", description: e.message, variant: "destructive" }),
  });

  const statusMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch(`/api/ioms/rent/invoices/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? res.statusText);
      }
      return res.json();
    },
    onSuccess: (_, body) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/rent/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/rent/invoices", id] });
      toast({ title: "Status updated", description: `Invoice set to ${String(body.status)}.` });
      setSendBackOpen(false);
      setReturnRemarks("");
    },
    onError: (e: Error) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  const createCreditNoteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/ioms/rent/credit-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          invoiceId: id,
          creditNoteNo: cnNo.trim() || undefined,
          reason: cnReason.trim(),
          amount: Number(cnAmount),
          status: "Draft",
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? res.statusText);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/rent/credit-notes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/rent/invoices", id] });
      setCnReason("");
      setCnNo("");
      toast({ title: "Credit note created", description: "Draft credit note saved." });
    },
    onError: (e: Error) => toast({ title: "Credit note failed", description: e.message, variant: "destructive" }),
  });

  useEffect(() => {
    if (!id) setLocation("/rent/ioms");
  }, [id, setLocation]);

  useEffect(() => {
    if (invoice?.totalAmount != null) {
      setCnAmount(String(invoice.totalAmount));
    }
  }, [invoice?.id, invoice?.totalAmount]);

  useEffect(() => {
    const bt = invoice?.billingType;
    if (bt === "FullMonth" || bt === "Prorated" || bt === "Overstay") {
      setDraftBillingType(bt);
    }
  }, [invoice?.id, invoice?.billingType]);

  const recalculateBillingMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/ioms/rent/invoices/${encodeURIComponent(id!)}/recalculate-billing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ billingType: draftBillingType }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data as { message?: string }).message ?? (data as { error?: string }).error ?? res.statusText);
      }
      return data as RentInvoice;
    },
    onSuccess: (row) => {
      queryClient.setQueryData(["/api/ioms/rent/invoices", id], row);
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/rent/invoices"] });
      toast({
        title: "Billing recalculated",
        description: `Rent ${formatInr(row.rentAmount)} · Total ${formatInr(row.totalAmount)}`,
      });
    },
    onError: (e: Error) =>
      toast({ title: "Recalculate failed", description: e.message, variant: "destructive" }),
  });

  const billingBreakdown = useMemo(
    () => (invoice ? buildRentInvoiceBillingBreakdown(invoice) : null),
    [invoice],
  );

  if (!id) return null;
  if (isLoading || invoice === undefined) {
    return (
      <AppShell breadcrumbs={[{ label: "Rent (IOMS)", href: "/rent/ioms" }, { label: "Invoice" }]}>
        <Card>
          <CardContent className="p-6">
            <Skeleton className="h-8 w-48 mb-4" />
            <Skeleton className="h-32 w-full" />
          </CardContent>
        </Card>
      </AppShell>
    );
  }
  if (isError || !invoice) {
    return (
      <AppShell breadcrumbs={[{ label: "Rent (IOMS)", href: "/rent/ioms" }, { label: "Invoice" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Invoice not found.</span>
            <Button variant="outline" size="sm" onClick={() => setLocation("/rent/ioms")}>Back to list</Button>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  const draft = invoice.status === "Draft";
  const verified = invoice.status === "Verified";
  const approved = invoice.status === "Approved";
  const overdue = invoice.status === "Overdue";
  const cancelled = invoice.status === "Cancelled";
  const canDoVerify = canVerify && draft;
  const canDoApprove = canApprove && verified;
  const canSendBack = canVerify && verified;
  const canMarkPaid = canApprove && (approved || overdue);
  const canCancel = canApprove && (approved || overdue);
  const canVoidDraft =
    draft &&
    (roles.includes("DO") || roles.includes("ADMIN")) &&
    (can("M-03", "Create") || can("M-03", "Update"));
  const canVoidVerified = verified && canApprove;
  const isDoOrAdmin = roles.includes("DO") || roles.includes("ADMIN");
  const canCreateCreditNote =
    (approved || overdue) && isDoOrAdmin && (can("M-03", "Create") || can("M-03", "Update"));
  const canRecalculateBilling =
    draft &&
    isDoOrAdmin &&
    (can("M-03", "Create") || can("M-03", "Update"));

  const nonGstLines: { label: string; amount: number }[] = (() => {
    const j = invoice.nonGstChargesJson;
    if (j == null || String(j).trim() === "") return [];
    try {
      const arr = JSON.parse(String(j)) as unknown;
      if (!Array.isArray(arr)) return [];
      return arr
        .map((o) => {
          const x = o as { label?: unknown; amount?: unknown };
          return { label: String(x?.label ?? ""), amount: Number(x?.amount) };
        })
        .filter((l) => l.label && Number.isFinite(l.amount) && l.amount > 0);
    } catch {
      return [];
    }
  })();

  return (
    <AppShell breadcrumbs={[{ label: "Rent (IOMS)", href: "/rent/ioms" }, { label: invoice.invoiceNo ?? invoice.id }]}>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            {invoice.invoiceNo ?? invoice.id}
          </CardTitle>
          <div className="flex gap-2">
            {!cancelled && !String(invoice.combinedBundleId ?? "").trim() ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={async () => {
                  try {
                    const res = await fetch(`/api/ioms/rent/invoices/${encodeURIComponent(id!)}/pdf`, {
                      credentials: "include",
                    });
                    if (!res.ok) {
                      const err = await res.json().catch(() => ({}));
                      throw new Error((err as { error?: string }).error ?? res.statusText);
                    }
                    const blob = await res.blob();
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `rent-invoice-${(invoice.invoiceNo ?? id).replace(/[^\w.-]+/g, "_")}.pdf`;
                    a.click();
                    URL.revokeObjectURL(url);
                    toast({ title: "Download started" });
                  } catch (e) {
                    toast({
                      title: "PDF failed",
                      description: e instanceof Error ? e.message : "Could not download PDF.",
                      variant: "destructive",
                    });
                  }
                }}
              >
                <Download className="h-4 w-4 mr-1" />
                PDF
              </Button>
            ) : null}
            {String(invoice.combinedBundleId ?? "").trim() ? (
              <Button asChild variant="secondary" size="sm">
                <Link href={`/rent/ioms/combined-invoices/${invoice.combinedBundleId}`}>
                  Combined bundle PDF
                </Link>
              </Button>
            ) : null}
            <Button variant="ghost" size="sm" onClick={() => setLocation("/rent/ioms")}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Back
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {cancelled ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              This invoice is <strong>Cancelled</strong>. PDF download and printing are disabled. A new invoice may be
              generated for the same billing month; it will receive a new invoice number.
            </div>
          ) : null}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div><span className="text-muted-foreground">Yard</span><br />{yardById[invoice.yardId] ?? invoice.yardId}</div>
            <div><span className="text-muted-foreground">Period</span><br />{formatYearMonthToDisplay(invoice.periodMonth)}</div>
            <div><span className="text-muted-foreground">Asset</span><br />{assetById[invoice.assetId] ?? invoice.assetId}</div>
            <div>
              <span className="text-muted-foreground">Allotment Reference No.</span>
              <br />
              {allotmentReferenceNo}
            </div>
            <div>
              <span className="text-muted-foreground">Tenant / counterparty</span>
              <br />
              {tenantLabel}
            </div>
            <div>
              <span className="text-muted-foreground">Status</span>
              <br />
              <Badge variant={cancelled || overdue ? "destructive" : "secondary"}>{invoice.status}</Badge>
            </div>
            <div>
              <span className="text-muted-foreground">Billing type</span>
              <br />
              {billingBreakdown?.billingTypeLabel ?? "Full month rent"}
            </div>
            {billingBreakdown?.occupancyFrom && billingBreakdown?.occupancyTo ? (
              <div className="md:col-span-2">
                <span className="text-muted-foreground">Occupancy period</span>
                <br />
                {formatYmdToDisplay(billingBreakdown.occupancyFrom)} — {formatYmdToDisplay(billingBreakdown.occupancyTo)}
              </div>
            ) : null}
          </div>

          {canRecalculateBilling && (
            <div className="rounded-lg border border-dashed p-4 space-y-3">
              <p className="font-medium text-sm">Edit draft billing</p>
              <p className="text-xs text-muted-foreground">
                Set billing type and recalculate rent, GST, and TDS from the allotment agreement and monthly rent.
              </p>
              <div className="flex flex-col sm:flex-row sm:items-end gap-3">
                <div className="space-y-2 flex-1 max-w-xs">
                  <Label>Billing type</Label>
                  <Select
                    value={draftBillingType}
                    onValueChange={(v) => setDraftBillingType(v as RentBillingType)}
                    disabled={recalculateBillingMutation.isPending}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="FullMonth">Full month rent</SelectItem>
                      <SelectItem value="Prorated">Prorated / partial month</SelectItem>
                      <SelectItem value="Overstay">Overstay / fine rent</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={recalculateBillingMutation.isPending}
                  onClick={() => recalculateBillingMutation.mutate()}
                >
                  {recalculateBillingMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-2" />
                  )}
                  Recalculate
                </Button>
              </div>
            </div>
          )}

          {billingBreakdown && (
            <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
              <p className="font-medium text-sm">Rent calculation summary</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
                {billingBreakdown.summaryLines.map((line) => {
                  const isMoney =
                    /rent|gst|total|fine/i.test(line.label) && !/factor|days/i.test(line.label);
                  return (
                    <div key={line.label} className="flex justify-between gap-3">
                      <span className="text-muted-foreground">{line.label}</span>
                      <span className="font-medium tabular-nums">
                        {isMoney ? formatInr(Number(line.value)) : line.value}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div><span className="text-muted-foreground">Rent (taxable)</span><br />{formatInr(invoice.rentAmount)}</div>
            <div><span className="text-muted-foreground">CGST / SGST</span><br />{formatInr(invoice.cgst)} / {formatInr(invoice.sgst)}</div>
            <div><span className="text-muted-foreground">Total</span><br />{formatInr(invoice.totalAmount)}</div>
            {invoice.tdsApplicable ? (
              <div>
                <span className="text-muted-foreground">TDS (194-I style, on rent)</span>
                <br />{formatInr(Number(invoice.tdsAmount ?? 0))}
              </div>
            ) : (
              <div>
                <span className="text-muted-foreground">TDS</span>
                <br />
                Not applicable
              </div>
            )}
            {nonGstLines.length > 0 && (
              <div className="md:col-span-2">
                <span className="text-muted-foreground">Non-GST charge lines (M-03)</span>
                <ul className="mt-1 list-disc list-inside text-sm">
                  {nonGstLines.map((l, i) => (
                    <li key={i}>
                      {l.label}: {formatInr(l.amount)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {invoice.isGovtEntity && <div><span className="text-muted-foreground">Govt entity</span><br />Yes</div>}
            {invoice.generatedAt && (
              <div>
                <span className="text-muted-foreground">Generated at</span>
                <br />
                {formatApiDateOrDateTime(invoice.generatedAt)}
              </div>
            )}
            {invoice.approvedAt && (
              <div>
                <span className="text-muted-foreground">Approved at</span>
                <br />
                {formatApiDateOrDateTime(invoice.approvedAt)}
              </div>
            )}
            {invoice.workflowRevisionCount != null && invoice.workflowRevisionCount > 0 && (
              <div><span className="text-muted-foreground">DV return count</span><br />{invoice.workflowRevisionCount}</div>
            )}
            {invoice.dvReturnRemarks && (
              <div className="md:col-span-2">
                <span className="text-muted-foreground">Last DV return remarks</span>
                <p className="mt-1 whitespace-pre-wrap text-sm">{invoice.dvReturnRemarks}</p>
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2 pt-2">
            {canDoVerify && (
              <Button size="sm" variant="outline" onClick={() => statusMutation.mutate({ status: "Verified" })} disabled={statusMutation.isPending}>
                <ShieldCheck className="h-4 w-4 mr-1" /> Verify
              </Button>
            )}
            {canDoApprove && (
              <Button size="sm" onClick={() => statusMutation.mutate({ status: "Approved" })} disabled={statusMutation.isPending}>
                <CheckCircle className="h-4 w-4 mr-1" /> Approve
              </Button>
            )}
            {canSendBack && (
              <Button size="sm" variant="outline" onClick={() => setSendBackOpen(true)} disabled={statusMutation.isPending}>
                <SendHorizontal className="h-4 w-4 mr-1" /> Send back
              </Button>
            )}
            {canMarkPaid && (
              <Button
                size="sm"
                variant="default"
                onClick={() => {
                  const out = paymentContext?.outstandingRent ?? Number(invoice.totalAmount ?? 0);
                  setMarkPaidAmount(String(Math.max(0, Math.round(out * 100) / 100)));
                  setMarkPaidOpen(true);
                }}
                disabled={markPaidPayMutation.isPending}
              >
                <Banknote className="h-4 w-4 mr-1" /> Mark Paid
              </Button>
            )}
            {canVoidDraft && (
              <Button size="sm" variant="outline" onClick={() => statusMutation.mutate({ status: "Cancelled" })} disabled={statusMutation.isPending}>
                <Ban className="h-4 w-4 mr-1" /> Void draft
              </Button>
            )}
            {canVoidVerified && (
              <Button size="sm" variant="destructive" onClick={() => statusMutation.mutate({ status: "Cancelled" })} disabled={statusMutation.isPending}>
                <Ban className="h-4 w-4 mr-1" /> Void verified invoice
              </Button>
            )}
            {canCancel && (
              <Button size="sm" variant="destructive" onClick={() => statusMutation.mutate({ status: "Cancelled" })} disabled={statusMutation.isPending}>
                <Ban className="h-4 w-4 mr-1" /> Cancel
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {(approved || overdue) && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <StickyNote className="h-5 w-5" />
              Credit notes (M-03)
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Draft credit notes for unsettled Approved/Overdue invoices. Approve credit notes from the list or via API (DA).
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {creditNotesForInvoice.length > 0 ? (
              <ul className="text-sm space-y-2 border rounded-md p-3 bg-muted/20">
                {creditNotesForInvoice.map((c) => (
                  <li key={c.id} className="flex flex-wrap justify-between gap-2">
                    <span className="font-mono">{c.creditNoteNo}</span>
                    <Badge variant="secondary">{c.status}</Badge>
                    <span className="text-muted-foreground w-full">{formatInr(c.amount)} — {c.reason}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No credit notes for this invoice yet.</p>
            )}
            {canCreateCreditNote && (
              <div className="space-y-3 max-w-lg border-t pt-4">
                <p className="text-sm font-medium">New draft credit note</p>
                <div className="space-y-2">
                  <Label htmlFor="cn-no">Credit note no. (optional)</Label>
                  <Input id="cn-no" value={cnNo} onChange={(e) => setCnNo(e.target.value)} placeholder="Leave blank to auto-generate" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="cn-amt">Amount (₹)</Label>
                  <Input id="cn-amt" type="text" inputMode="decimal" value={cnAmount} onChange={(e) => setCnAmount(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="cn-reason">Reason (min. 10 characters)</Label>
                  <Textarea id="cn-reason" rows={3} value={cnReason} onChange={(e) => setCnReason(e.target.value)} />
                </div>
                <Button
                  type="button"
                  size="sm"
                  disabled={
                    createCreditNoteMutation.isPending ||
                    cnReason.trim().length < 10 ||
                    !Number.isFinite(Number(cnAmount)) ||
                    Number(cnAmount) <= 0
                  }
                  onClick={() => createCreditNoteMutation.mutate()}
                >
                  Save draft credit note
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <CounterPaymentDialog
        open={markPaidOpen}
        onOpenChange={setMarkPaidOpen}
        title="Mark rent invoice paid"
        yardId={paymentContext?.yardId ?? invoice.yardId}
        amount={markPaidAmount}
        onAmountChange={setMarkPaidAmount}
        confirmPending={markPaidPayMutation.isPending}
        canAdvanceFromSummary={
          Number.isFinite(Number(markPaidAmount)) &&
          Number(markPaidAmount) > 0 &&
          (paymentContext?.outstandingRent ?? invoice.totalAmount) > 0.001
        }
        summaryContent={
          <div className="text-sm space-y-1">
            <p>
              <span className="text-muted-foreground">Invoice:</span>{" "}
              <span className="font-mono">{invoice.invoiceNo ?? invoice.id}</span>
            </p>
            <p>
              <span className="text-muted-foreground">Outstanding:</span>{" "}
              <span className="font-medium">
                {formatInr(paymentContext?.outstandingRent ?? invoice.totalAmount)}
              </span>
            </p>
          </div>
        }
        onConfirm={async (payBody) => {
          await markPaidPayMutation.mutateAsync(payBody);
        }}
      />

      <Dialog open={sendBackOpen} onOpenChange={setSendBackOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Send back to Draft</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            DV must record why the invoice is returned (min {MIN_WORKFLOW_REMARKS_LENGTH} characters).
          </p>
          <div className="space-y-2">
            <Label htmlFor="return-remarks">Return remarks</Label>
            <Textarea
              id="return-remarks"
              value={returnRemarks}
              onChange={(e) => setReturnRemarks(e.target.value)}
              rows={4}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setSendBackOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={returnRemarks.trim().length < MIN_WORKFLOW_REMARKS_LENGTH || statusMutation.isPending}
              onClick={() =>
                statusMutation.mutate({
                  status: "Draft",
                  returnRemarks: returnRemarks.trim(),
                })
              }
            >
              Send back
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
