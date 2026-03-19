import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { Receipt, AlertCircle, ShieldCheck, CheckCircle, XCircle, Banknote, PlusCircle } from "lucide-react";

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
  const canVerify = roles.includes("DV") || roles.includes("ADMIN");
  const canApprove = roles.includes("DA") || roles.includes("ADMIN");
  const canCreate = can("M-06", "Create");
  const { data: list, isLoading, isError } = useQuery<Voucher[]>({
    queryKey: ["/api/ioms/vouchers"],
  });
  const { data: yards = [] } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ["/api/yards"],
  });
  const yardById = Object.fromEntries(yards.map((y) => [y.id, y.name]));
  const statusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
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
    onSuccess: (_, { status }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/vouchers"] });
      toast({ title: "Status updated", description: `Voucher set to ${status}.` });
    },
    onError: (e: Error) => {
      toast({ title: "Update failed", description: e.message, variant: "destructive" });
    },
  });

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
            {canApprove && <span className="block mt-1">You can approve Verified → Approved/Rejected, or set Paid.</span>}
          </p>
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
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Voucher No</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Yard</TableHead>
                  <TableHead>Payee</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  {(canVerify || canApprove) && <TableHead className="w-[220px]">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {(list ?? []).map((v) => (
                  <TableRow key={v.id}>
                    <TableCell className="font-mono text-sm">
                      <Link href={`/vouchers/${v.id}`} className="text-primary hover:underline">{v.voucherNo ?? v.id.slice(0, 8)}</Link>
                    </TableCell>
                    <TableCell>{v.voucherType}</TableCell>
                    <TableCell>{yardById[v.yardId] ?? v.yardId}</TableCell>
                    <TableCell>{v.payeeName}</TableCell>
                    <TableCell>{v.amount}</TableCell>
                    <TableCell><Badge variant="secondary">{v.status}</Badge></TableCell>
                    {(canVerify || canApprove) && (
                      <TableCell className="space-x-2 flex flex-wrap gap-1">
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
                              onClick={() => statusMutation.mutate({ id: v.id, status: "Rejected" })}
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
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {!isLoading && (!list || list.length === 0) && (
            <p className="text-sm text-muted-foreground py-4">No vouchers.</p>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
