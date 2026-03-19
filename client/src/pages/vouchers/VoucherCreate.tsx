import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Receipt, ArrowLeft, Loader2 } from "lucide-react";

interface Yard {
  id: string;
  code?: string | null;
  name?: string | null;
}
interface ExpenditureHead {
  id: string;
  code: string;
  description: string;
}

const VOUCHER_TYPES = [
  "Salary",
  "ContractorBill",
  "OperationalExpense",
  "AdvanceRequest",
  "Refund",
];

export default function VoucherCreate() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [yardId, setYardId] = useState("");
  const [voucherType, setVoucherType] = useState("");
  const [expenditureHeadId, setExpenditureHeadId] = useState("");
  const [payeeName, setPayeeName] = useState("");
  const [payeeAccount, setPayeeAccount] = useState("");
  const [payeeBank, setPayeeBank] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");

  const { data: yards = [] } = useQuery<Yard[]>({ queryKey: ["/api/yards"] });
  const { data: heads = [] } = useQuery<ExpenditureHead[]>({
    queryKey: ["/api/ioms/expenditure-heads"],
  });

  const createMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch("/api/ioms/vouchers", {
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
    onSuccess: (row) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/vouchers"] });
      toast({ title: "Voucher created", description: "Draft voucher created." });
      setLocation(`/vouchers/${row.id}`);
    },
    onError: (e: Error) => {
      toast({ title: "Create failed", description: e.message, variant: "destructive" });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!yardId || !voucherType || !expenditureHeadId || !payeeName.trim() || !amount || Number(amount) <= 0) {
      toast({ title: "Validation", description: "Fill yard, type, head, payee and amount.", variant: "destructive" });
      return;
    }
    createMutation.mutate({
      yardId,
      voucherType,
      expenditureHeadId,
      payeeName: payeeName.trim(),
      amount: Number(amount),
      payeeAccount: payeeAccount.trim() || undefined,
      payeeBank: payeeBank.trim() || undefined,
      description: description.trim() || undefined,
    });
  };

  return (
    <AppShell breadcrumbs={[{ label: "Vouchers", href: "/vouchers" }, { label: "Create" }]}>
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5" />
            Create Payment Voucher
          </CardTitle>
          <p className="text-sm text-muted-foreground">DO creates draft; DV verifies, DA approves.</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Yard *</Label>
                <Select value={yardId} onValueChange={setYardId} required>
                  <SelectTrigger>
                    <SelectValue placeholder="Select yard" />
                  </SelectTrigger>
                  <SelectContent>
                    {(yards as Yard[]).map((y) => (
                      <SelectItem key={y.id} value={y.id}>
                        {y.name ?? y.code ?? y.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Voucher type *</Label>
                <Select value={voucherType} onValueChange={setVoucherType} required>
                  <SelectTrigger>
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    {VOUCHER_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Expenditure head *</Label>
              <Select value={expenditureHeadId} onValueChange={setExpenditureHeadId} required>
                <SelectTrigger>
                  <SelectValue placeholder="Select head" />
                </SelectTrigger>
                <SelectContent>
                  {(heads as ExpenditureHead[]).map((h) => (
                    <SelectItem key={h.id} value={h.id}>
                      {h.code} — {h.description}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Payee name *</Label>
              <Input value={payeeName} onChange={(e) => setPayeeName(e.target.value)} placeholder="Payee name" required />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Payee account</Label>
                <Input value={payeeAccount} onChange={(e) => setPayeeAccount(e.target.value)} placeholder="Account number" />
              </div>
              <div className="space-y-2">
                <Label>Payee bank</Label>
                <Input value={payeeBank} onChange={(e) => setPayeeBank(e.target.value)} placeholder="Bank name" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Amount *</Label>
              <Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" required />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional description" rows={2} />
            </div>
            <div className="flex gap-2 pt-2">
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Create voucher
              </Button>
              <Button type="button" variant="outline" onClick={() => setLocation("/vouchers")}>
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </AppShell>
  );
}
