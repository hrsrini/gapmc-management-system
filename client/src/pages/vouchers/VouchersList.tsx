import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ClientDataGrid } from "@/components/reports/ClientDataGrid";
import type { ReportTableColumn } from "@/components/reports/ReportDataTable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Link } from "wouter";
import { Receipt, AlertCircle, ShieldCheck, CheckCircle, XCircle, Banknote, PlusCircle, SendHorizontal } from "lucide-react";
import { REJECTION_REASON_CODES, MIN_WORKFLOW_REMARKS_LENGTH } from "@shared/workflow-rejection";

interface Voucher {
  id: string;
  voucherNo?: string | null;
  voucherType: string;
  yardId: string;
  payeeName: string;
  amount: number;
  status: string;
}

export default function VouchersList() {
  const { user, can } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const roles = user?.roles?.map((r) => r.tier) ?? [];
  const canUpdate = can("M-06", "Update");
  const canVerify = (roles.includes("DV") || roles.includes("ADMIN")) && canUpdate;
  const canApprove = (roles.includes("DA") || roles.includes("ADMIN")) && canUpdate;
  const canReturnSubmittedToDraft =
    canUpdate && (roles.includes("DO") || roles.includes("ADMIN"));
  const canCreate = can("M-06", "Create");
  const [pendingOnly, setPendingOnly] = useState(false);
  const { data: list, isLoading, isError } = useQuery<Voucher[]>({
    queryKey: ["/api/ioms/vouchers", { pendingMyAction: pendingOnly }],
    queryFn: async () => {
      const q = pendingOnly ? "?pendingMyAction=1" : "";
      const res = await fetch(`/api/ioms/vouchers${q}`, {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? res.statusText);
      }
      return res.json() as Promise<Voucher[]>;
    },
  });
  const { data: yards = [] } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ["/api/yards"],
  });
  const yardById = Object.fromEntries(yards.map((y) => [y.id, y.name]));

  const [rejectVoucherId, setRejectVoucherId] = useState<string | null>(null);
  const [rejectCode, setRejectCode] = useState<string>(REJECTION_REASON_CODES[0]);
  const [rejectRemarks, setRejectRemarks] = useState("");
  const [returnDraftVoucherId, setReturnDraftVoucherId] = useState<string | null>(null);
  const [returnDraftRemarks, setReturnDraftRemarks] = useState("");

  const statusMutation = useMutation({
    mutationFn: async (vars: { id: string } & Record<string, unknown>) => {
      const { id, ...body } = vars;
      const res = await fetch(`/api/ioms/vouchers/${id}`, {
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
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/vouchers"] });
      toast({ title: "Status updated", description: `Voucher set to ${String(vars.status)}.` });
      if (vars.status === "Rejected") {
        setRejectVoucherId(null);
        setRejectRemarks("");
      }
      if (vars.status === "Draft" && "returnRemarks" in vars) {
        setReturnDraftVoucherId(null);
        setReturnDraftRemarks("");
      }
    },
    onError: (e: Error) => {
      toast({ title: "Update failed", description: e.message, variant: "destructive" });
    },
  });

  const voucherColumns = useMemo((): ReportTableColumn[] => {
    const base: ReportTableColumn[] = [
      { key: "_voucherNo", header: "Voucher No", sortField: "voucherNoSort" },
      { key: "voucherType", header: "Type" },
      { key: "yardName", header: "Yard" },
      { key: "payeeName", header: "Payee" },
      { key: "amount", header: "Amount" },
      { key: "_status", header: "Status", sortField: "status" },
    ];
    if (canVerify || canApprove || canReturnSubmittedToDraft) {
      base.push({ key: "_actions", header: "Actions" });
    }
    return base;
  }, [canVerify, canApprove, canReturnSubmittedToDraft]);

  const voucherRows = useMemo((): Record<string, unknown>[] => {
    return (list ?? []).map((v) => ({
      id: v.id,
      voucherNoSort: v.voucherNo ?? v.id,
      _voucherNo: (
        <Link href={`/vouchers/${v.id}`} className="text-primary hover:underline font-mono text-sm">
          {v.voucherNo ?? v.id.slice(0, 8)}
        </Link>
      ),
      voucherType: v.voucherType,
      yardName: yardById[v.yardId] ?? v.yardId,
      payeeName: v.payeeName,
      amount: v.amount,
      status: v.status,
      _status: <Badge variant="secondary">{v.status}</Badge>,
      _actions: (canVerify || canApprove || canReturnSubmittedToDraft) ? (
        <div className="flex flex-wrap gap-1">
          {canVerify && (v.status === "Draft" || v.status === "Submitted") && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => statusMutation.mutate({ id: v.id, status: "Verified" })}
              disabled={statusMutation.isPending}
            >
              <ShieldCheck className="h-3.5 w-3.5 mr-1" />
              Verify
            </Button>
          )}
          {canReturnSubmittedToDraft && v.status === "Submitted" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setReturnDraftVoucherId(v.id);
                setReturnDraftRemarks("");
              }}
              disabled={statusMutation.isPending}
            >
              <SendHorizontal className="h-3.5 w-3.5 mr-1" />
              Return to draft
            </Button>
          )}
          {canApprove && v.status === "Verified" && (
            <>
              <Button
                size="sm"
                variant="default"
                onClick={() => statusMutation.mutate({ id: v.id, status: "Approved" })}
                disabled={statusMutation.isPending}
              >
                <CheckCircle className="h-3.5 w-3.5 mr-1" />
                Approve
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => {
                  setRejectVoucherId(v.id);
                  setRejectCode(REJECTION_REASON_CODES[0]);
                  setRejectRemarks("");
                }}
                disabled={statusMutation.isPending}
              >
                <XCircle className="h-3.5 w-3.5 mr-1" />
                Reject
              </Button>
            </>
          )}
          {canApprove && v.status === "Approved" && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => statusMutation.mutate({ id: v.id, status: "Paid" })}
              disabled={statusMutation.isPending}
            >
              <Banknote className="h-3.5 w-3.5 mr-1" />
              Mark Paid
            </Button>
          )}
        </div>
      ) : null,
    }));
  }, [
    list,
    yardById,
    canVerify,
    canApprove,
    canReturnSubmittedToDraft,
    statusMutation,
  ]);

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "Vouchers", href: "/vouchers" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Failed to load vouchers.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Vouchers (M-06)", href: "/vouchers" }]}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5" />
            Payment Vouchers (IOMS M-06)
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Expenditure vouchers — Salary, Contractor, Operational, Advance, Refund.
            {canVerify && <span className="block mt-1">You can verify Draft/Submitted → Verified.</span>}
            {canReturnSubmittedToDraft && (
              <span className="block mt-1">You can return Submitted vouchers to Draft with remarks (DO/Admin).</span>
            )}
            {canApprove && <span className="block mt-1">You can approve Verified → Approved/Rejected, or set Paid.</span>}
          </p>
          {(canVerify || canApprove) && (
            <div className="flex items-center gap-2 pt-2">
              <Checkbox
                id="vouchers-pending-me"
                checked={pendingOnly}
                onCheckedChange={(c) => setPendingOnly(c === true)}
              />
              <Label htmlFor="vouchers-pending-me" className="text-sm font-normal cursor-pointer">
                Pending my action (DV/DA queue — excludes your own DO/DV records per segregation)
              </Label>
            </div>
          )}
          {canCreate && (
            <div className="pt-2">
              <Button asChild size="sm">
                <Link href="/vouchers/create"><PlusCircle className="h-4 w-4 mr-2" />Create voucher</Link>
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <ClientDataGrid
              columns={voucherColumns}
              sourceRows={voucherRows}
              searchKeys={["voucherNoSort", "voucherType", "yardName", "payeeName", "amount", "status"]}
              defaultSortKey="voucherNoSort"
              defaultSortDir="desc"
              emptyMessage="No vouchers."
              resetPageDependency={pendingOnly}
            />
          )}
        </CardContent>
      </Card>

      <Dialog
        open={rejectVoucherId !== null}
        onOpenChange={(open) => {
          if (!open) setRejectVoucherId(null);
        }}
      >
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
              <Label htmlFor="list-reject-remarks">Remarks (min {MIN_WORKFLOW_REMARKS_LENGTH} characters)</Label>
              <Textarea
                id="list-reject-remarks"
                value={rejectRemarks}
                onChange={(e) => setRejectRemarks(e.target.value)}
                rows={4}
                placeholder="Explain the rejection for audit trail"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRejectVoucherId(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={
                !rejectVoucherId ||
                rejectRemarks.trim().length < MIN_WORKFLOW_REMARKS_LENGTH ||
                statusMutation.isPending
              }
              onClick={() => {
                if (!rejectVoucherId) return;
                statusMutation.mutate({
                  id: rejectVoucherId,
                  status: "Rejected",
                  rejectionReasonCode: rejectCode,
                  rejectionRemarks: rejectRemarks.trim(),
                });
              }}
            >
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={returnDraftVoucherId !== null}
        onOpenChange={(open) => {
          if (!open) setReturnDraftVoucherId(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Return to draft</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Record why the voucher is withdrawn from Submitted (min {MIN_WORKFLOW_REMARKS_LENGTH} characters).
          </p>
          <div className="space-y-2">
            <Label htmlFor="list-return-draft-remarks">Return remarks</Label>
            <Textarea
              id="list-return-draft-remarks"
              value={returnDraftRemarks}
              onChange={(e) => setReturnDraftRemarks(e.target.value)}
              rows={4}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setReturnDraftVoucherId(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={
                !returnDraftVoucherId ||
                returnDraftRemarks.trim().length < MIN_WORKFLOW_REMARKS_LENGTH ||
                statusMutation.isPending
              }
              onClick={() => {
                if (!returnDraftVoucherId) return;
                statusMutation.mutate({
                  id: returnDraftVoucherId,
                  status: "Draft",
                  returnRemarks: returnDraftRemarks.trim(),
                });
              }}
            >
              Return to draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
