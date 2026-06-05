import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { formatInr } from "@/lib/formatInr";
import { formatApiDateOrDateTime } from "@/lib/dateFormat";
import { Loader2, Landmark } from "lucide-react";
import { Link } from "wouter";

interface UndepositedRow {
  id: string;
  receiptNo: string;
  createdAt: string;
  payerName: string | null;
  paymentMode: string;
  totalAmount: number;
  daysSinceIssue: number;
  yardId: string;
}

interface BankAccount {
  id: string;
  bankName: string;
  accountNumber: string;
  ifscCode?: string | null;
}

interface YardRef {
  id: string;
  name: string;
  code: string;
}

export default function ReceiptDepositEntry() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [yardId, setYardId] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bankAccountId, setBankAccountId] = useState("");
  const [depositDate, setDepositDate] = useState(() => new Date().toISOString().slice(0, 10));

  const { data: yards = [] } = useQuery<YardRef[]>({ queryKey: ["/api/yards"] });

  const undepositedUrl = yardId
    ? `/api/ioms/receipt-deposits/undeposited?yardId=${encodeURIComponent(yardId)}`
    : "";
  const { data: undeposited = [], isLoading } = useQuery<UndepositedRow[]>({
    queryKey: [undepositedUrl],
    enabled: Boolean(yardId),
    queryFn: async () => {
      const res = await fetch(undepositedUrl, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load undeposited receipts");
      return res.json();
    },
  });

  const bankUrl = yardId
    ? `/api/ioms/receipt-deposits/bank-accounts?yardId=${encodeURIComponent(yardId)}`
    : "";
  const { data: banks = [] } = useQuery<BankAccount[]>({
    queryKey: [bankUrl],
    enabled: Boolean(yardId),
    queryFn: async () => {
      const res = await fetch(bankUrl, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load bank accounts");
      return res.json();
    },
  });

  const selectedRows = useMemo(
    () => undeposited.filter((r) => selected.has(r.id)),
    [undeposited, selected],
  );
  const totalCash = selectedRows.filter((r) => r.paymentMode === "Cash").reduce((s, r) => s + r.totalAmount, 0);
  const totalCheque = selectedRows.filter((r) => r.paymentMode !== "Cash").reduce((s, r) => s + r.totalAmount, 0);
  const grandTotal = totalCash + totalCheque;

  const submitMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/ioms/receipt-deposits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          yardId,
          bankAccountId,
          depositDate,
          receiptIds: Array.from(selected),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { message?: string }).message ?? res.statusText);
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [undepositedUrl] });
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/receipt-deposits/cash-in-hand"] });
      toast({ title: "Deposit submitted", description: data.depositRefNo ?? "" });
      setSelected(new Set());
    },
    onError: (e: Error) => toast({ title: "Deposit failed", description: e.message, variant: "destructive" }),
  });

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllCash = () => {
    setSelected(new Set(undeposited.filter((r) => r.paymentMode === "Cash").map((r) => r.id)));
  };
  const selectAllCheque = () => {
    setSelected(new Set(undeposited.filter((r) => r.paymentMode !== "Cash").map((r) => r.id)));
  };

  return (
    <AppShell breadcrumbs={[{ label: "Receipts", href: "/receipts/ioms" }, { label: "Record deposit" }]}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Landmark className="h-5 w-5" />
            Undeposited receipts — deposit entry (SCR-RCP-05)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1">
              <Label>Location *</Label>
              <Select value={yardId || undefined} onValueChange={(v) => { setYardId(v); setSelected(new Set()); }}>
                <SelectTrigger>
                  <SelectValue placeholder="Select yard" />
                </SelectTrigger>
                <SelectContent>
                  {yards.map((y) => (
                    <SelectItem key={y.id} value={y.id}>
                      {y.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Bank account *</Label>
              <Select value={bankAccountId || undefined} onValueChange={setBankAccountId} disabled={!yardId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select account" />
                </SelectTrigger>
                <SelectContent>
                  {banks.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.bankName} — {b.accountNumber}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Deposit date</Label>
              <Input type="date" value={depositDate} onChange={(e) => setDepositDate(e.target.value)} />
            </div>
          </div>

          {yardId && (
            <>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" onClick={selectAllCash}>
                  Select all cash
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={selectAllCheque}>
                  Select all cheque/DD
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => setSelected(new Set())}>
                  Deselect all
                </Button>
              </div>

              {isLoading ? (
                <Loader2 className="h-6 w-6 animate-spin" />
              ) : (
                <div className="border rounded-md divide-y max-h-80 overflow-y-auto">
                  {undeposited.length === 0 && (
                    <p className="p-4 text-sm text-muted-foreground">No undeposited receipts for this location.</p>
                  )}
                  {undeposited.map((r) => (
                    <label
                      key={r.id}
                      className="flex items-center gap-3 p-3 hover:bg-muted/40 cursor-pointer text-sm"
                    >
                      <Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggle(r.id)} />
                      <span className="font-mono">{r.receiptNo}</span>
                      <span className="text-muted-foreground">{formatApiDateOrDateTime(r.createdAt)}</span>
                      <span className="flex-1 truncate">{r.payerName ?? "—"}</span>
                      <span>{r.paymentMode}</span>
                      <span className="font-medium">{formatInr(r.totalAmount)}</span>
                      <span className="text-muted-foreground">{r.daysSinceIssue}d</span>
                    </label>
                  ))}
                </div>
              )}

              <div className="rounded-md bg-muted/40 p-3 text-sm space-y-1">
                <div>Selected: {selected.size} receipt(s)</div>
                <div>Cash: {formatInr(totalCash)} · Cheque/DD: {formatInr(totalCheque)}</div>
                <div className="font-semibold">Grand total: {formatInr(grandTotal)}</div>
              </div>

              <div className="flex justify-end gap-2">
                <Button asChild variant="outline">
                  <Link href="/receipts/ioms/cash-in-hand">Cancel</Link>
                </Button>
                <Button
                  disabled={
                    submitMutation.isPending ||
                    !yardId ||
                    !bankAccountId ||
                    selected.size === 0
                  }
                  onClick={() => submitMutation.mutate()}
                >
                  {submitMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Submit deposit"}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
