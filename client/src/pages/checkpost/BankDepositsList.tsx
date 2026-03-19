import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Landmark, AlertCircle, Plus, ShieldCheck, Pencil } from "lucide-react";

interface BankDeposit {
  id: string;
  checkPostId: string;
  depositDate: string;
  bankName: string;
  amount: number;
  status: string;
  accountNumber?: string | null;
  verifiedBy?: string | null;
}

export default function BankDepositsList() {
  const { user, can } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canCreate = can("M-04", "Create");
  const canUpdate = can("M-04", "Update");
  const roles = user?.roles?.map((r) => r.tier) ?? [];
  const canVerify = roles.includes("DV") || roles.includes("ADMIN");
  const [open, setOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState("");
  const [checkPostId, setCheckPostId] = useState("");
  const [depositDate, setDepositDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [bankName, setBankName] = useState("");
  const [amount, setAmount] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [voucherDetails, setVoucherDetails] = useState("");
  const [narration, setNarration] = useState("");

  const { data: list, isLoading, isError } = useQuery<BankDeposit[]>({
    queryKey: ["/api/ioms/checkpost/bank-deposits"],
  });
  const { data: checkposts = [] } = useQuery<Array<{ id: string; name: string; code: string }>>({
    queryKey: ["/api/yards"],
  });
  const checkPostIds = useMemo(() => new Set(checkposts.map((c) => c.id)), [checkposts]);
  const checkPostById = useMemo(() => new Map(checkposts.map((c) => [c.id, c])), [checkposts]);
  const createError = useMemo(() => {
    if (!checkPostId.trim()) return "Check post ID is required.";
    if (!checkPostIds.has(checkPostId.trim())) return "Check post ID is invalid or out of scope.";
    if (!depositDate.trim()) return "Deposit date is required.";
    if (!bankName.trim()) return "Bank name is required.";
    const amt = Number(amount);
    if (Number.isNaN(amt) || amt <= 0) return "Amount must be greater than 0.";
    return null;
  }, [checkPostId, checkPostIds, depositDate, bankName, amount]);

  const createMutation = useMutation({
    mutationFn: async () => {
      if (createError) throw new Error(createError);
      const res = await fetch("/api/ioms/checkpost/bank-deposits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          checkPostId,
          depositDate,
          bankName,
          amount: Number(amount || 0),
          accountNumber,
          voucherDetails,
          narration,
          status: "Recorded",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/checkpost/bank-deposits"] });
      toast({ title: "Bank deposit recorded" });
      setOpen(false);
      setCheckPostId("");
      setDepositDate(new Date().toISOString().slice(0, 10));
      setBankName("");
      setAmount("");
      setAccountNumber("");
      setVoucherDetails("");
      setNarration("");
    },
    onError: (e: Error) => toast({ title: "Create failed", description: e.message, variant: "destructive" }),
  });

  const verifyMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/ioms/checkpost/bank-deposits/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status: "Verified", verifiedBy: user?.id ?? null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/checkpost/bank-deposits"] });
      toast({ title: "Deposit verified" });
    },
    onError: (e: Error) => toast({ title: "Verify failed", description: e.message, variant: "destructive" }),
  });
  const updateMutation = useMutation({
    mutationFn: async () => {
      if (createError) throw new Error(createError);
      const res = await fetch(`/api/ioms/checkpost/bank-deposits/${editId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          checkPostId,
          depositDate,
          bankName,
          amount: Number(amount || 0),
          accountNumber,
          voucherDetails,
          narration,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/checkpost/bank-deposits"] });
      toast({ title: "Deposit updated" });
      setEditOpen(false);
      setEditId("");
    },
    onError: (e: Error) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });
  const openEdit = (d: BankDeposit) => {
    setEditId(d.id);
    setCheckPostId(d.checkPostId ?? "");
    setDepositDate(d.depositDate ?? "");
    setBankName(d.bankName ?? "");
    setAmount(String(d.amount ?? ""));
    setAccountNumber(d.accountNumber ?? "");
    setVoucherDetails("");
    setNarration("");
    setEditOpen(true);
  };

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "Check post (M-04)", href: "/checkpost/inward" }, { label: "Bank deposits" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Failed to load bank deposits.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Check post (M-04)", href: "/checkpost/inward" }, { label: "Bank deposits" }]}>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Landmark className="h-5 w-5" />
              Bank deposits (M-04)
            </CardTitle>
            <p className="text-sm text-muted-foreground">Check post collections deposited to bank.</p>
          </div>
          {canCreate && (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Record deposit</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Create bank deposit</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  {createError && <p className="text-sm text-destructive">{createError}</p>}
                  <div className="space-y-1">
                    <Label>Check post</Label>
                    <Select value={checkPostId || undefined} onValueChange={setCheckPostId}>
                      <SelectTrigger><SelectValue placeholder="Select check post" /></SelectTrigger>
                      <SelectContent>
                        {checkposts.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {`${c.name} (${c.code})`.slice(0, 64)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1"><Label>Deposit date</Label><Input type="date" value={depositDate} onChange={(e) => setDepositDate(e.target.value)} /></div>
                    <div className="space-y-1"><Label>Bank</Label><Input value={bankName} onChange={(e) => setBankName(e.target.value)} /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1"><Label>Amount</Label><Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
                    <div className="space-y-1"><Label>Account no</Label><Input value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} /></div>
                  </div>
                  <div className="space-y-1"><Label>Voucher details</Label><Input value={voucherDetails} onChange={(e) => setVoucherDetails(e.target.value)} /></div>
                  <div className="space-y-1"><Label>Narration</Label><Input value={narration} onChange={(e) => setNarration(e.target.value)} /></div>
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => setOpen(false)} disabled={createMutation.isPending}>Cancel</Button>
                    <Button disabled={createMutation.isPending || createError !== null} onClick={() => createMutation.mutate()}>
                      {createMutation.isPending ? "Creating..." : "Create"}
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          )}
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Deposit date</TableHead>
                  <TableHead>Check post</TableHead>
                  <TableHead>Bank</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Verified by</TableHead>
                  {canUpdate && <TableHead className="w-[100px]">Edit</TableHead>}
                  {canVerify && <TableHead className="w-[120px]">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {(list ?? []).map((d) => (
                  <TableRow key={d.id}>
                    <TableCell>{d.depositDate}</TableCell>
                    <TableCell>{checkPostById.get(d.checkPostId)?.name ?? d.checkPostId}</TableCell>
                    <TableCell>{d.bankName}</TableCell>
                    <TableCell className="text-right">₹{d.amount.toLocaleString()}</TableCell>
                    <TableCell><Badge variant="secondary">{d.status}</Badge></TableCell>
                    <TableCell>{d.verifiedBy ?? "—"}</TableCell>
                    {canUpdate && (
                      <TableCell>
                        {d.status !== "Verified" && (
                          <Button size="sm" variant="outline" onClick={() => openEdit(d)}>
                            <Pencil className="h-3.5 w-3.5 mr-1" />
                            Edit
                          </Button>
                        )}
                      </TableCell>
                    )}
                    {canVerify && (
                      <TableCell>
                        {d.status !== "Verified" && (
                          <Button size="sm" variant="outline" onClick={() => verifyMutation.mutate(d.id)} disabled={verifyMutation.isPending || updateMutation.isPending}>
                            <ShieldCheck className="h-3.5 w-3.5 mr-1" />
                            {verifyMutation.isPending ? "Verifying..." : "Verify"}
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
            <p className="text-sm text-muted-foreground py-4">No bank deposits.</p>
          )}
        </CardContent>
      </Card>
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit bank deposit</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {createError && <p className="text-sm text-destructive">{createError}</p>}
            <div className="space-y-1">
              <Label>Check post</Label>
              <Select value={checkPostId || undefined} onValueChange={setCheckPostId}>
                <SelectTrigger><SelectValue placeholder="Select check post" /></SelectTrigger>
                <SelectContent>
                  {checkposts.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {`${c.name} (${c.code})`.slice(0, 64)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1"><Label>Deposit date</Label><Input type="date" value={depositDate} onChange={(e) => setDepositDate(e.target.value)} /></div>
              <div className="space-y-1"><Label>Bank</Label><Input value={bankName} onChange={(e) => setBankName(e.target.value)} /></div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1"><Label>Amount</Label><Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
              <div className="space-y-1"><Label>Account no</Label><Input value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} /></div>
            </div>
            <div className="space-y-1"><Label>Voucher details</Label><Input value={voucherDetails} onChange={(e) => setVoucherDetails(e.target.value)} /></div>
            <div className="space-y-1"><Label>Narration</Label><Input value={narration} onChange={(e) => setNarration(e.target.value)} /></div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditOpen(false)} disabled={updateMutation.isPending}>Cancel</Button>
              <Button disabled={updateMutation.isPending || createError !== null} onClick={() => updateMutation.mutate()}>
                {updateMutation.isPending ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
