import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ClientDataGrid } from "@/components/reports/ClientDataGrid";
import type { ReportTableColumn } from "@/components/reports/ReportDataTable";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { formatInr } from "@/lib/formatInr";
import { formatApiDateOrDateTime } from "@/lib/dateFormat";
import { Landmark, Loader2, ShieldCheck } from "lucide-react";

interface DepositLine {
  receiptId: string;
  receiptNo: string;
  payerName: string | null;
  paymentMode: string;
  amount: number;
}

interface DepositRecord {
  id: string;
  depositRefNo: string;
  yardId: string;
  depositDate: string;
  totalAmount: number;
  status: string;
  hasDishonouredCheque?: boolean;
  dishonourDate?: string | null;
  passbookReference?: string | null;
  passbookDate?: string | null;
  verifiedAt?: string | null;
  approvedAt?: string | null;
  bankAccount?: { bankName: string; accountNumber: string } | null;
  lines: DepositLine[];
}

export default function ReceiptDepositRegister() {
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const tiers = user?.roles?.map((r) => r.tier) ?? [];
  const canVerify = tiers.includes("DV") || tiers.includes("DA") || tiers.includes("ADMIN");
  const canApprove = tiers.includes("DA") || tiers.includes("ADMIN");

  const [verifyId, setVerifyId] = useState<string | null>(null);
  const [passbookReference, setPassbookReference] = useState("");
  const [passbookDate, setPassbookDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [reverseId, setReverseId] = useState<string | null>(null);
  const [reverseReason, setReverseReason] = useState("");

  const MIN_REVERSE_REASON = 100;

  const { data: list = [], isLoading } = useQuery<DepositRecord[]>({
    queryKey: ["/api/ioms/receipt-deposits"],
  });

  const verifyMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/ioms/receipt-deposits/${verifyId}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ passbookReference, passbookDate }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { message?: string }).message ?? res.statusText);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/receipt-deposits"] });
      toast({ title: "Deposit verified" });
      setVerifyId(null);
    },
    onError: (e: Error) => toast({ title: "Verify failed", description: e.message, variant: "destructive" }),
  });

  const approveMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/ioms/receipt-deposits/${id}/approve`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { message?: string }).message ?? res.statusText);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/receipt-deposits"] });
      toast({ title: "Deposit approved and settled" });
    },
    onError: (e: Error) => toast({ title: "Approve failed", description: e.message, variant: "destructive" }),
  });

  const rejectMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/ioms/receipt-deposits/${rejectId}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ rejectionReason: rejectReason }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { message?: string }).message ?? res.statusText);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/receipt-deposits"] });
      toast({ title: "Deposit returned to DV" });
      setRejectId(null);
      setRejectReason("");
    },
    onError: (e: Error) => toast({ title: "Reject failed", description: e.message, variant: "destructive" }),
  });

  const reverseMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/ioms/receipt-deposits/${reverseId}/reverse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ reversalReason: reverseReason }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { message?: string }).message ?? res.statusText);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/receipt-deposits"] });
      toast({ title: "Deposit reversed; receipts returned to undeposited" });
      setReverseId(null);
      setReverseReason("");
    },
    onError: (e: Error) => toast({ title: "Reverse failed", description: e.message, variant: "destructive" }),
  });

  const columns: ReportTableColumn[] = [
    { key: "depositRefNo", header: "Deposit ref." },
    { key: "depositDate", header: "Date" },
    { key: "bank", header: "Bank account" },
    { key: "_amount", header: "Amount" },
    { key: "_status", header: "Status" },
    { key: "_flags", header: "Flags" },
    { key: "receiptCount", header: "Receipts" },
    { key: "_actions", header: "Actions" },
  ];

  const sourceRows = useMemo(
    () =>
      list.map((d) => ({
        id: d.id,
        depositRefNo: d.depositRefNo,
        depositDate: d.depositDate.slice(0, 10),
        bank: d.bankAccount ? `${d.bankAccount.bankName} (${d.bankAccount.accountNumber})` : "—",
        _amount: formatInr(d.totalAmount),
        status: d.status,
        _status: <Badge variant="secondary">{d.status}</Badge>,
        _flags: d.hasDishonouredCheque ? (
          <Badge variant="destructive">Dishonoured cheque</Badge>
        ) : (
          "—"
        ),
        receiptCount: String(d.lines?.length ?? 0),
        _actions: (
          <div className="flex flex-wrap gap-1">
            {canVerify && d.status === "DepositedPendingVerification" && (
              <Button size="sm" variant="outline" onClick={() => setVerifyId(d.id)}>
                <ShieldCheck className="h-3.5 w-3.5 mr-1" />
                Verify
              </Button>
            )}
            {canApprove && d.status === "VerifiedPendingApproval" && (
              <>
                <Button
                  size="sm"
                  onClick={() => approveMutation.mutate(d.id)}
                  disabled={approveMutation.isPending}
                >
                  Approve
                </Button>
                <Button size="sm" variant="destructive" onClick={() => setRejectId(d.id)}>
                  Reject
                </Button>
              </>
            )}
            {canApprove && d.status === "ApprovedSettled" && (
              <Button size="sm" variant="outline" onClick={() => setReverseId(d.id)}>
                Reverse
              </Button>
            )}
          </div>
        ),
      })),
    [list, canVerify, canApprove, approveMutation],
  );

  return (
    <AppShell breadcrumbs={[{ label: "Receipts", href: "/receipts/ioms" }, { label: "Deposit register" }]}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Landmark className="h-5 w-5" />
            Deposit register (DV / DA workflow)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Loader2 className="h-6 w-6 animate-spin" />
          ) : (
            <ClientDataGrid columns={columns} sourceRows={sourceRows} defaultSortKey="depositDate" defaultSortDir="desc" emptyMessage="No deposits." />
          )}
        </CardContent>
      </Card>

      <Dialog open={Boolean(verifyId)} onOpenChange={(o) => !o && setVerifyId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Verify deposit (DV)</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Passbook / statement reference *</Label>
              <Input value={passbookReference} onChange={(e) => setPassbookReference(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Passbook date *</Label>
              <Input type="date" value={passbookDate} onChange={(e) => setPassbookDate(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVerifyId(null)}>
              Cancel
            </Button>
            <Button disabled={verifyMutation.isPending || !passbookReference.trim()} onClick={() => verifyMutation.mutate()}>
              {verifyMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Mark verified"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(rejectId)} onOpenChange={(o) => !o && setRejectId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject deposit (DA)</DialogTitle>
          </DialogHeader>
          <div className="space-y-1">
            <Label>Reason *</Label>
            <Input value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={rejectMutation.isPending || !rejectReason.trim()}
              onClick={() => rejectMutation.mutate()}
            >
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(reverseId)} onOpenChange={(o) => !o && setReverseId(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Reverse approved deposit (DA)</DialogTitle>
          </DialogHeader>
          <div className="space-y-1">
            <Label>Reversal reason (min {MIN_REVERSE_REASON} characters) *</Label>
            <textarea
              className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={reverseReason}
              onChange={(e) => setReverseReason(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {reverseReason.trim().length}/{MIN_REVERSE_REASON} characters
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReverseId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={reverseMutation.isPending || reverseReason.trim().length < MIN_REVERSE_REASON}
              onClick={() => reverseMutation.mutate()}
            >
              {reverseMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Reverse deposit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
