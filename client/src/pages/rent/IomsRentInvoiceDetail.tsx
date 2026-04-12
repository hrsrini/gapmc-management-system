import { useEffect, useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { FileText, ArrowLeft, ShieldCheck, CheckCircle, AlertCircle, SendHorizontal, Banknote, Ban } from "lucide-react";
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
  isGovtEntity?: boolean;
  status: string;
  doUser?: string | null;
  dvUser?: string | null;
  daUser?: string | null;
  generatedAt?: string | null;
  approvedAt?: string | null;
  workflowRevisionCount?: number | null;
  dvReturnRemarks?: string | null;
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

export default function IomsRentInvoiceDetail() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { user } = useAuth();
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

  useEffect(() => {
    if (!id) setLocation("/rent/ioms");
  }, [id, setLocation]);
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
  const canDoVerify = canVerify && draft;
  const canDoApprove = canApprove && verified;
  const canSendBack = canVerify && verified;
  const canMarkPaid = canApprove && approved;
  const canCancel = canApprove && approved;

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
            <div><span className="text-muted-foreground">Status</span><br /><Badge variant="secondary">{invoice.status}</Badge></div>
            <div><span className="text-muted-foreground">Rent</span><br />₹{invoice.rentAmount.toLocaleString()}</div>
            <div><span className="text-muted-foreground">CGST / SGST</span><br />₹{invoice.cgst.toLocaleString()} / ₹{invoice.sgst.toLocaleString()}</div>
            <div><span className="text-muted-foreground">Total</span><br />₹{invoice.totalAmount.toLocaleString()}</div>
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
            {canCancel && (
              <Button size="sm" variant="destructive" onClick={() => statusMutation.mutate({ status: "Cancelled" })} disabled={statusMutation.isPending}>
                <Ban className="h-4 w-4 mr-1" /> Cancel
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

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
