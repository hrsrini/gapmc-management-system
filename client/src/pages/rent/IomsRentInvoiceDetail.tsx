import { useEffect, useState } from "react";
import { useParams, useLocation } from "wouter";
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
import { FileText, ArrowLeft, ShieldCheck, CheckCircle, AlertCircle, SendHorizontal, Banknote, Ban, StickyNote } from "lucide-react";
import { formatApiDateOrDateTime, formatYearMonthToDisplay } from "@/lib/dateFormat";
import { MIN_WORKFLOW_REMARKS_LENGTH } from "@shared/workflow-rejection";

interface RentInvoice {
  id: string;
  invoiceNo?: string | null;
  allotmentId: string;
  tenantLicenceId: string;
  assetId: string;
  yardId: string;
  periodMonth: string;
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
}
interface YardRef {
  id: string;
  name: string;
}
interface AssetRef {
  id: string;
  assetId: string;
}
interface AllotmentRef {
  id: string;
  allotteeName?: string | null;
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
  const { data: allotments = [] } = useQuery<AllotmentRef[]>({
    queryKey: ["/api/ioms/asset-allotments"],
  });
  const { data: licences = [] } = useQuery<LicenceRef[]>({
    queryKey: ["/api/ioms/traders/licences"],
  });
  const yardById = Object.fromEntries(yards.map((y) => [y.id, y.name]));
  const assetById = Object.fromEntries(assets.map((a) => [a.id, a.assetId]));
  const allotmentById = Object.fromEntries(allotments.map((a) => [a.id, a.allotteeName ? `${a.id} — ${a.allotteeName}` : a.id]));
  const licenceById = Object.fromEntries(
    licences.map((l) => [l.id, l.licenceNo ? `${l.licenceNo}${l.firmName ? ` — ${l.firmName}` : ""}` : (l.firmName ?? l.id)]),
  );

  const [sendBackOpen, setSendBackOpen] = useState(false);
  const [returnRemarks, setReturnRemarks] = useState("");
  const [cnReason, setCnReason] = useState("");
  const [cnAmount, setCnAmount] = useState("");
  const [cnNo, setCnNo] = useState("");

  const { data: creditNoteList = [] } = useQuery<CreditNoteRow[]>({
    queryKey: ["/api/ioms/rent/credit-notes"],
    enabled: !!id,
  });
  const creditNotesForInvoice = creditNoteList.filter((c) => c.invoiceId === id);

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
            <Button variant="ghost" size="sm" onClick={() => setLocation("/rent/ioms")}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Back
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div><span className="text-muted-foreground">Yard</span><br />{yardById[invoice.yardId] ?? invoice.yardId}</div>
            <div><span className="text-muted-foreground">Period</span><br />{formatYearMonthToDisplay(invoice.periodMonth)}</div>
            <div><span className="text-muted-foreground">Asset</span><br />{assetById[invoice.assetId] ?? invoice.assetId}</div>
            <div><span className="text-muted-foreground">Allotment</span><br />{allotmentById[invoice.allotmentId] ?? invoice.allotmentId}</div>
            <div><span className="text-muted-foreground">Tenant licence</span><br />{licenceById[invoice.tenantLicenceId] ?? invoice.tenantLicenceId}</div>
            <div>
              <span className="text-muted-foreground">Status</span>
              <br />
              <Badge variant={overdue ? "destructive" : "secondary"}>{invoice.status}</Badge>
            </div>
            <div><span className="text-muted-foreground">Rent</span><br />₹{invoice.rentAmount.toLocaleString()}</div>
            <div><span className="text-muted-foreground">CGST / SGST</span><br />₹{invoice.cgst.toLocaleString()} / ₹{invoice.sgst.toLocaleString()}</div>
            <div><span className="text-muted-foreground">Total</span><br />₹{invoice.totalAmount.toLocaleString()}</div>
            {invoice.tdsApplicable ? (
              <div>
                <span className="text-muted-foreground">TDS (194-I style, on rent)</span>
                <br />₹{Number(invoice.tdsAmount ?? 0).toLocaleString()}
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
                      {l.label}: ₹{l.amount.toLocaleString()}
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
              <Button size="sm" variant="default" onClick={() => statusMutation.mutate({ status: "Paid" })} disabled={statusMutation.isPending}>
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
                    <span className="text-muted-foreground w-full">₹{c.amount.toLocaleString()} — {c.reason}</span>
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
