import { useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Receipt, ArrowLeft, ShieldCheck, CheckCircle, XCircle, Banknote, AlertCircle } from "lucide-react";

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

  const { data: voucher, isLoading, isError } = useQuery<Voucher>({
    queryKey: ["/api/ioms/vouchers", id],
    enabled: !!id,
  });
  const { data: yards = [] } = useQuery<YardRef[]>({
    queryKey: ["/api/yards"],
  });
  const yardById = Object.fromEntries(yards.map((y) => [y.id, y.name]));

  const statusMutation = useMutation({
    mutationFn: async (status: string) => {
      const res = await fetch(`/api/ioms/vouchers/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? res.statusText);
      }
      return res.json();
    },
    onSuccess: (_, status) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/vouchers", id] });
      toast({ title: "Status updated", description: `Voucher set to ${status}.` });
    },
    onError: (e: Error) => {
      toast({ title: "Update failed", description: e.message, variant: "destructive" });
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
              {(canVerify || canApprove) && (
                <div className="flex flex-wrap gap-2 pt-2">
                  {canVerify && (voucher.status === "Draft" || voucher.status === "Submitted") && (
                    <Button size="sm" variant="outline" onClick={() => statusMutation.mutate("Verified")} disabled={statusMutation.isPending}>
                      <ShieldCheck className="h-3.5 w-3.5 mr-1" /> Verify
                    </Button>
                  )}
                  {canApprove && voucher.status === "Verified" && (
                    <>
                      <Button size="sm" onClick={() => statusMutation.mutate("Approved")} disabled={statusMutation.isPending}>
                        <CheckCircle className="h-3.5 w-3.5 mr-1" /> Approve
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => statusMutation.mutate("Rejected")} disabled={statusMutation.isPending}>
                        <XCircle className="h-3.5 w-3.5 mr-1" /> Reject
                      </Button>
                    </>
                  )}
                  {canApprove && voucher.status === "Approved" && (
                    <Button size="sm" variant="secondary" onClick={() => statusMutation.mutate("Paid")} disabled={statusMutation.isPending}>
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
              {voucher.paidAt && <div><span className="text-muted-foreground">Paid at</span><p>{voucher.paidAt}</p></div>}
              {voucher.description && <div className="md:col-span-2"><span className="text-muted-foreground">Description</span><p>{voucher.description}</p></div>}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </AppShell>
  );
}
