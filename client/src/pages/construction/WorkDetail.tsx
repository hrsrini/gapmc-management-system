import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { HardHat, ArrowLeft, Pencil, FileText, AlertCircle, Plus, Loader2 } from "lucide-react";

interface Work {
  id: string;
  workNo?: string | null;
  yardId: string;
  workType: string;
  status: string;
  description?: string | null;
  location?: string | null;
  contractorName?: string | null;
  contractorContact?: string | null;
  estimateAmount?: number | null;
  tenderValue?: number | null;
  workOrderNo?: string | null;
  workOrderDate?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  completionDate?: string | null;
}
interface WorkBill {
  id: string;
  workId: string;
  billNo?: string | null;
  billDate: string;
  amount: number;
  cumulativePaid?: number | null;
  voucherId?: string | null;
  status: string;
  approvedBy?: string | null;
}
interface YardRef {
  id: string;
  name: string;
}
interface VoucherRef {
  id: string;
  voucherNo?: string | null;
}

export default function WorkDetail() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { can } = useAuth();
  const canUpdate = can("M-08", "Update");
  const canCreate = can("M-08", "Create");
  const [billOpen, setBillOpen] = useState(false);
  const [billNo, setBillNo] = useState("");
  const [billDate, setBillDate] = useState("");
  const [amount, setAmount] = useState("");
  const [cumulativePaid, setCumulativePaid] = useState("");
  const [status, setStatus] = useState("Pending");

  const { data: work, isLoading, isError } = useQuery<Work>({
    queryKey: ["/api/ioms/works", id],
  });
  const { data: bills = [], isLoading: billsLoading } = useQuery<WorkBill[]>({
    queryKey: [`/api/ioms/works/${id}/bills`],
    enabled: !!id,
  });
  const { data: yards = [] } = useQuery<YardRef[]>({
    queryKey: ["/api/yards"],
  });
  const { data: vouchers = [] } = useQuery<VoucherRef[]>({
    queryKey: ["/api/ioms/vouchers"],
  });
  const yardById = Object.fromEntries(yards.map((y) => [y.id, y.name]));
  const voucherNoById = Object.fromEntries(vouchers.map((v) => [v.id, v.voucherNo ?? v.id]));

  const addBillMutation = useMutation({
    mutationFn: async (body: { workId: string; billNo?: string; billDate: string; amount: number; cumulativePaid?: number; status?: string }) => {
      const res = await fetch("/api/ioms/works/bills", {
        method: "POST",
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/ioms/works/${id}/bills`] });
      toast({ title: "Bill added" });
      setBillOpen(false);
      setBillNo("");
      setBillDate("");
      setAmount("");
      setCumulativePaid("");
      setStatus("Pending");
    },
    onError: (e: Error) => toast({ title: "Failed to add bill", description: e.message, variant: "destructive" }),
  });

  const handleAddBill = (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(amount);
    if (!billDate || !Number.isFinite(amt) || amt < 0) return;
    addBillMutation.mutate({
      workId: id!,
      billNo: billNo || undefined,
      billDate,
      amount: amt,
      cumulativePaid: cumulativePaid ? parseFloat(cumulativePaid) : 0,
      status,
    });
  };

  if (isLoading || work === undefined) {
    return (
      <AppShell breadcrumbs={[{ label: "Construction", href: "/construction" }, { label: "Work" }]}>
        <Card>
          <CardContent className="p-6">
            <Skeleton className="h-8 w-48 mb-4" />
            <Skeleton className="h-32 w-full" />
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  if (isError || !work) {
    return (
      <AppShell breadcrumbs={[{ label: "Construction", href: "/construction" }, { label: "Work" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Work not found.</span>
            <Button variant="outline" size="sm" onClick={() => setLocation("/construction")}>Back to list</Button>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Construction", href: "/construction" }, { label: work.workNo ?? work.id }]}>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <HardHat className="h-5 w-5" />
            {work.workNo ?? work.id}
          </CardTitle>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setLocation("/construction")}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Back
            </Button>
            {canUpdate && (
              <Button variant="outline" size="sm" asChild>
                <Link href={`/construction/works/${id}/edit`}><Pencil className="h-4 w-4 mr-1" /> Edit</Link>
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div><span className="text-muted-foreground">Yard</span><br />{yardById[work.yardId] ?? work.yardId}</div>
            <div><span className="text-muted-foreground">Type</span><br />{work.workType}</div>
            <div><span className="text-muted-foreground">Status</span><br /><Badge variant="secondary">{work.status}</Badge></div>
            <div><span className="text-muted-foreground">Contractor</span><br />{work.contractorName ?? "—"}</div>
            <div><span className="text-muted-foreground">Location</span><br />{work.location ?? "—"}</div>
            <div><span className="text-muted-foreground">Estimate</span><br />{work.estimateAmount != null ? `₹${work.estimateAmount.toLocaleString()}` : "—"}</div>
            <div><span className="text-muted-foreground">Tender value</span><br />{work.tenderValue != null ? `₹${work.tenderValue.toLocaleString()}` : "—"}</div>
            <div><span className="text-muted-foreground">Work order</span><br />{work.workOrderNo ?? "—"} {work.workOrderDate ? `(${work.workOrderDate})` : ""}</div>
            <div><span className="text-muted-foreground">Start / End</span><br />{work.startDate ?? "—"} / {work.endDate ?? "—"}</div>
            <div><span className="text-muted-foreground">Completion</span><br />{work.completionDate ?? "—"}</div>
            {work.description && (
              <div className="md:col-span-2"><span className="text-muted-foreground">Description</span><br />{work.description}</div>
            )}
          </div>

          <Tabs defaultValue="bills">
            <TabsList>
              <TabsTrigger value="bills"><FileText className="h-4 w-4 mr-1" /> Bills ({bills.length})</TabsTrigger>
            </TabsList>
            <TabsContent value="bills" className="pt-2">
              {canCreate && (
              <div className="flex justify-end mb-2">
                <Dialog open={billOpen} onOpenChange={setBillOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Add bill</Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader><DialogTitle>Add contractor bill</DialogTitle></DialogHeader>
                    <form onSubmit={handleAddBill} className="space-y-4">
                      <div><Label>Bill no</Label><Input value={billNo} onChange={(e) => setBillNo(e.target.value)} placeholder="Optional" /></div>
                      <div><Label>Bill date *</Label><Input type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} required /></div>
                      <div><Label>Amount *</Label><Input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} required /></div>
                      <div><Label>Cumulative paid</Label><Input type="number" step="0.01" min="0" value={cumulativePaid} onChange={(e) => setCumulativePaid(e.target.value)} /></div>
                      <div><Label>Status</Label><Input value={status} onChange={(e) => setStatus(e.target.value)} placeholder="Pending" /></div>
                      <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setBillOpen(false)}>Cancel</Button>
                        <Button type="submit" disabled={addBillMutation.isPending}>
                          {addBillMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Add bill
                        </Button>
                      </DialogFooter>
                    </form>
                  </DialogContent>
                </Dialog>
              </div>
              )}
              {billsLoading ? (
                <Skeleton className="h-32 w-full" />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Bill No</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="text-right">Cumulative paid</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Voucher</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {bills.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-muted-foreground text-center py-6">No bills for this work.</TableCell>
                      </TableRow>
                    ) : (
                      bills.map((b) => (
                        <TableRow key={b.id}>
                          <TableCell className="font-mono text-sm">{b.billNo ?? "—"}</TableCell>
                          <TableCell>{b.billDate}</TableCell>
                          <TableCell className="text-right">₹{b.amount.toLocaleString()}</TableCell>
                          <TableCell className="text-right">₹{(b.cumulativePaid ?? 0).toLocaleString()}</TableCell>
                          <TableCell><Badge variant="outline">{b.status}</Badge></TableCell>
                          <TableCell>{b.voucherId ? (voucherNoById[b.voucherId] ?? b.voucherId) : "—"}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </AppShell>
  );
}
