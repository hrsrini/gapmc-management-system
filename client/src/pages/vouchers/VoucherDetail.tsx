import { useEffect, useRef, useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  Receipt,
  ArrowLeft,
  ShieldCheck,
  CheckCircle,
  XCircle,
  Banknote,
  AlertCircle,
  SendHorizontal,
  Paperclip,
  Trash2,
  Download,
} from "lucide-react";
import { REJECTION_REASON_CODES, MIN_WORKFLOW_REMARKS_LENGTH } from "@shared/workflow-rejection";
import { formatApiDateOrDateTime } from "@/lib/dateFormat";

interface Voucher {
  id: string;
  voucherNo?: string | null;
  voucherType: string;
  yardId: string;
  expenditureHeadId: string;
  payeeName: string;
  payeeAccount?: string | null;
  payeeBank?: string | null;
  amount: number;
  description?: string | null;
  status: string;
  paidAt?: string | null;
  paymentRef?: string | null;
  createdAt?: string | null;
  rejectionReasonCode?: string | null;
  rejectionRemarks?: string | null;
  workflowRevisionCount?: number | null;
  dvReturnRemarks?: string | null;
  supportingDocs?: string[] | null;
}
interface YardRef {
  id: string;
  name: string;
}

export default function VoucherDetail() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { user, can } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canUpdate = can("M-06", "Update");
  const roles = user?.roles?.map((r) => r.tier) ?? [];
  const canVerify = (roles.includes("DV") || roles.includes("ADMIN")) && canUpdate;
  const canApprove = (roles.includes("DA") || roles.includes("ADMIN")) && canUpdate;
  const canReturnSubmittedToDraft =
    canUpdate && (roles.includes("DO") || roles.includes("ADMIN"));

  const { data: voucher, isLoading, isError } = useQuery<Voucher>({
    queryKey: ["/api/ioms/vouchers", id],
    enabled: !!id,
  });
  const canManageAttachments =
    canUpdate &&
    (roles.includes("DO") || roles.includes("ADMIN")) &&
    Boolean(voucher?.status === "Draft" || voucher?.status === "Submitted");
  const { data: yards = [] } = useQuery<YardRef[]>({
    queryKey: ["/api/yards"],
  });
  const yardById = Object.fromEntries(yards.map((y) => [y.id, y.name]));

  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectCode, setRejectCode] = useState<string>(REJECTION_REASON_CODES[0]);
  const [rejectRemarks, setRejectRemarks] = useState("");
  const [returnDraftOpen, setReturnDraftOpen] = useState(false);
  const [returnDraftRemarks, setReturnDraftRemarks] = useState("");
  const attachmentInputRef = useRef<HTMLInputElement>(null);

  const statusMutation = useMutation({
    mutationFn: async (payload: { status: string } & Record<string, unknown>) => {
      const res = await fetch(`/api/ioms/vouchers/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? res.statusText);
      }
      return res.json();
    },
    onSuccess: (_, payload) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/vouchers", id] });
      toast({ title: "Status updated", description: `Voucher set to ${payload.status}.` });
      setRejectOpen(false);
      setRejectRemarks("");
      if (payload.status === "Draft" && "returnRemarks" in payload) {
        setReturnDraftOpen(false);
        setReturnDraftRemarks("");
      }
    },
    onError: (e: Error) => {
      toast({ title: "Update failed", description: e.message, variant: "destructive" });
    },
  });

  const attachmentMutation = useMutation({
    mutationFn: async (files: FileList | null) => {
      if (!id || !files?.length) throw new Error("Choose at least one file.");
      const fd = new FormData();
      for (let i = 0; i < files.length; i++) fd.append("files", files[i]);
      const res = await fetch(`/api/ioms/vouchers/${id}/attachments`, {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? res.statusText);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/vouchers", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/vouchers"] });
      toast({ title: "Attachments uploaded" });
      if (attachmentInputRef.current) attachmentInputRef.current.value = "";
    },
    onError: (e: Error) => {
      toast({ title: "Upload failed", description: e.message, variant: "destructive" });
    },
  });

  const deleteAttachmentMutation = useMutation({
    mutationFn: async (fileName: string) => {
      const res = await fetch(`/api/ioms/vouchers/${id}/files/${encodeURIComponent(fileName)}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? res.statusText);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/vouchers", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/vouchers"] });
      toast({ title: "Attachment removed" });
    },
    onError: (e: Error) => {
      toast({ title: "Remove failed", description: e.message, variant: "destructive" });
    },
  });

  useEffect(() => {
    if (!id) setLocation("/vouchers");
  }, [id, setLocation]);
  if (!id) return null;
  if (isError || (!isLoading && !voucher)) {
    return (
      <AppShell breadcrumbs={[{ label: "Vouchers", href: "/vouchers" }, { label: "Detail" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Voucher not found.</span>
            <Button variant="outline" size="sm" onClick={() => setLocation("/vouchers")}>Back to list</Button>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Vouchers", href: "/vouchers" }, { label: voucher?.voucherNo ?? id }]}>
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setLocation("/vouchers")}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
        </div>
        {isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : voucher ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Receipt className="h-5 w-5" />
                {voucher.voucherNo ?? "Voucher"} — <Badge variant="secondary">{voucher.status}</Badge>
              </CardTitle>
              {(canVerify || canApprove || (canReturnSubmittedToDraft && voucher.status === "Submitted")) && (
                <div className="flex flex-wrap gap-2 pt-2">
                  {canVerify && (voucher.status === "Draft" || voucher.status === "Submitted") && (
                    <Button size="sm" variant="outline" onClick={() => statusMutation.mutate({ status: "Verified" })} disabled={statusMutation.isPending}>
                      <ShieldCheck className="h-3.5 w-3.5 mr-1" /> Verify
                    </Button>
                  )}
                  {canReturnSubmittedToDraft && voucher.status === "Submitted" && (
                    <Button size="sm" variant="outline" onClick={() => setReturnDraftOpen(true)} disabled={statusMutation.isPending}>
                      <SendHorizontal className="h-3.5 w-3.5 mr-1" /> Return to draft
                    </Button>
                  )}
                  {canApprove && voucher.status === "Verified" && (
                    <>
                      <Button size="sm" onClick={() => statusMutation.mutate({ status: "Approved" })} disabled={statusMutation.isPending}>
                        <CheckCircle className="h-3.5 w-3.5 mr-1" /> Approve
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => setRejectOpen(true)} disabled={statusMutation.isPending}>
                        <XCircle className="h-3.5 w-3.5 mr-1" /> Reject
                      </Button>
                    </>
                  )}
                  {canApprove && voucher.status === "Approved" && (
                    <Button size="sm" variant="secondary" onClick={() => statusMutation.mutate({ status: "Paid" })} disabled={statusMutation.isPending}>
                      <Banknote className="h-3.5 w-3.5 mr-1" /> Mark Paid
                    </Button>
                  )}
                </div>
              )}
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div><span className="text-muted-foreground">Yard</span><p className="font-medium">{yardById[voucher.yardId] ?? voucher.yardId}</p></div>
              <div><span className="text-muted-foreground">Type</span><p className="font-medium">{voucher.voucherType}</p></div>
              <div><span className="text-muted-foreground">Payee</span><p className="font-medium">{voucher.payeeName}</p></div>
              <div><span className="text-muted-foreground">Amount</span><p className="font-medium">₹{voucher.amount}</p></div>
              {voucher.payeeAccount && <div><span className="text-muted-foreground">Account</span><p className="font-mono text-sm">{voucher.payeeAccount}</p></div>}
              {voucher.payeeBank && <div><span className="text-muted-foreground">Bank</span><p>{voucher.payeeBank}</p></div>}
              {voucher.paymentRef && <div><span className="text-muted-foreground">Payment ref</span><p>{voucher.paymentRef}</p></div>}
              {voucher.paidAt && (
                <div>
                  <span className="text-muted-foreground">Paid at</span>
                  <p>{formatApiDateOrDateTime(voucher.paidAt)}</p>
                </div>
              )}
              {voucher.description && <div className="md:col-span-2"><span className="text-muted-foreground">Description</span><p>{voucher.description}</p></div>}
              {voucher.status === "Rejected" && (voucher.rejectionReasonCode || voucher.rejectionRemarks) && (
                <div className="md:col-span-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
                  <span className="text-muted-foreground">Rejection</span>
                  <p className="font-medium">{voucher.rejectionReasonCode}</p>
                  {voucher.rejectionRemarks && <p className="mt-1 whitespace-pre-wrap">{voucher.rejectionRemarks}</p>}
                </div>
              )}
              {voucher.workflowRevisionCount != null && voucher.workflowRevisionCount > 0 && (
                <div><span className="text-muted-foreground">Return-to-draft count</span><p>{voucher.workflowRevisionCount}</p></div>
              )}
              {voucher.dvReturnRemarks && (
                <div className="md:col-span-2">
                  <span className="text-muted-foreground">Last return-to-draft remarks</span>
                  <p className="mt-1 whitespace-pre-wrap text-sm">{voucher.dvReturnRemarks}</p>
                </div>
              )}
            </CardContent>
          </Card>
        ) : null}

        {voucher && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Paperclip className="h-4 w-4" />
                Supporting documents
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                PDF or images up to 8 MB each; max 20 files per voucher. Add or remove while status is Draft or Submitted (DO / Admin).
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              <input
                ref={attachmentInputRef}
                type="file"
                multiple
                accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
                className="hidden"
                onChange={(e) => {
                  const fl = e.target.files;
                  if (fl?.length) attachmentMutation.mutate(fl);
                }}
              />
              {canManageAttachments && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={attachmentMutation.isPending}
                  onClick={() => attachmentInputRef.current?.click()}
                >
                  Upload files
                </Button>
              )}
              {(voucher.supportingDocs?.length ?? 0) === 0 ? (
                <p className="text-sm text-muted-foreground">No supporting documents attached.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {(voucher.supportingDocs ?? []).map((name) => (
                    <li key={name} className="flex flex-wrap items-center gap-2 border rounded-md px-3 py-2">
                      <span className="font-mono text-xs break-all flex-1 min-w-0">{name}</span>
                      <Button variant="ghost" size="sm" asChild>
                        <a
                          href={`/api/ioms/vouchers/${id}/files/${encodeURIComponent(name)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          download
                        >
                          <Download className="h-4 w-4" />
                        </a>
                      </Button>
                      {canManageAttachments && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          disabled={deleteAttachmentMutation.isPending}
                          onClick={() => deleteAttachmentMutation.mutate(name)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}

        <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Reject voucher</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-2">
                <Label>Reason code</Label>
                <Select value={rejectCode} onValueChange={setRejectCode}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {REJECTION_REASON_CODES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c.replace(/_/g, " ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="reject-remarks">Remarks (min {MIN_WORKFLOW_REMARKS_LENGTH} characters)</Label>
                <Textarea
                  id="reject-remarks"
                  value={rejectRemarks}
                  onChange={(e) => setRejectRemarks(e.target.value)}
                  rows={4}
                  placeholder="Explain the rejection for audit trail"
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRejectOpen(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={rejectRemarks.trim().length < MIN_WORKFLOW_REMARKS_LENGTH || statusMutation.isPending}
                onClick={() =>
                  statusMutation.mutate({
                    status: "Rejected",
                    rejectionReasonCode: rejectCode,
                    rejectionRemarks: rejectRemarks.trim(),
                  })
                }
              >
                Reject
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={returnDraftOpen} onOpenChange={setReturnDraftOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Return to draft</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              Record why the voucher is withdrawn from Submitted (min {MIN_WORKFLOW_REMARKS_LENGTH} characters).
            </p>
            <div className="space-y-2">
              <Label htmlFor="v-return-draft-remarks">Return remarks</Label>
              <Textarea
                id="v-return-draft-remarks"
                value={returnDraftRemarks}
                onChange={(e) => setReturnDraftRemarks(e.target.value)}
                rows={4}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setReturnDraftOpen(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                disabled={returnDraftRemarks.trim().length < MIN_WORKFLOW_REMARKS_LENGTH || statusMutation.isPending}
                onClick={() =>
                  statusMutation.mutate({
                    status: "Draft",
                    returnRemarks: returnDraftRemarks.trim(),
                  })
                }
              >
                Return to draft
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
