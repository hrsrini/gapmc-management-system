import { useEffect, useMemo, useState } from "react";
import { useLocation, useParams, Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { fetchApiGet, readApiErrorEnvelope } from "@/lib/queryClient";
import { AlertCircle, ArrowLeft, Download, FileText, Loader2 } from "lucide-react";
import { formatInr } from "@/lib/formatInr";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface PreReceipt {
  id: string;
  preReceiptNo?: string | null;
  entityId: string;
  yardId: string;
  rentPremisesType?: string | null;
  rentPremisesRef?: string | null;
  rentBillingMonth?: string | null;
  purpose?: string | null;
  amount: number;
  status: string;
  issuedAt?: string | null;
  dispatchedAt?: string | null;
  acknowledgedAt?: string | null;
  settledAt?: string | null;
  settledReceiptId?: string | null;
  remarks?: string | null;
  updatedAt?: string | null;
}
interface EntityRef {
  id: string;
  entityCode?: string | null;
  name: string;
}
interface ReceiptRef {
  id: string;
  receiptNo: string;
}

const STATUS_OPTIONS = ["Issued", "Dispatched", "Acknowledged", "Settled", "Cancelled"] as const;

export default function PreReceiptDetail() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { can } = useAuth();
  const canUpdate = can("M-02", "Update");
  const queryClient = useQueryClient();

  const { data: row, isLoading, isError, error } = useQuery<PreReceipt>({
    queryKey: ["/api/ioms/pre-receipts", "detail", id],
    enabled: Boolean(id),
    queryFn: () => fetchApiGet<PreReceipt>(`/api/ioms/pre-receipts/${encodeURIComponent(id!)}`),
  });

  const { data: entities = [] } = useQuery<EntityRef[]>({ queryKey: ["/api/ioms/entities"] });
  const { data: receipts = [] } = useQuery<ReceiptRef[]>({ queryKey: ["/api/ioms/receipts"] });
  const { data: yards = [] } = useQuery<Array<{ id: string; name?: string | null; code?: string | null }>>({
    queryKey: ["/api/yards"],
  });

  const entityLabelById = useMemo(
    () => Object.fromEntries(entities.map((e) => [e.id, `${e.entityCode ?? e.id} — ${e.name}`])),
    [entities],
  );
  const receiptLabelById = useMemo(
    () => Object.fromEntries(receipts.map((r) => [r.id, r.receiptNo])),
    [receipts],
  );
  const yardLabelById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const y of yards) {
      m[y.id] = (y.name?.trim() || y.code?.trim() || y.id) as string;
    }
    return m;
  }, [yards]);

  const [status, setStatus] = useState<string>("Issued");
  const [settledReceiptId, setSettledReceiptId] = useState<string>("");
  const [purpose, setPurpose] = useState("");
  const [amount, setAmount] = useState("");
  const [rentPremisesType, setRentPremisesType] = useState("");
  const [rentPremisesRef, setRentPremisesRef] = useState("");
  const [rentBillingMonth, setRentBillingMonth] = useState("");

  useEffect(() => {
    if (!row) return;
    setStatus(row.status);
    setSettledReceiptId(row.settledReceiptId ?? "");
    setPurpose(row.purpose ?? "");
    setAmount(String(row.amount ?? ""));
    setRentPremisesType(row.rentPremisesType ?? "");
    setRentPremisesRef(row.rentPremisesRef ?? "");
    setRentBillingMonth(row.rentBillingMonth ?? "");
  }, [row]);

  const updateMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch(`/api/ioms/pre-receipts/${encodeURIComponent(id!)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "include",
      });
      if (!res.ok) {
        const { message, code } = await readApiErrorEnvelope(res);
        throw new Error(code ? `${code}: ${message}` : message);
      }
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/ioms/pre-receipts"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/ioms/pre-receipts", "detail", id] });
      toast({ title: "Saved" });
    },
    onError: (e: Error) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "Pre-receipts (Govt)", href: "/traders/pre-receipts" }, { label: "Detail" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">
              {error instanceof Error ? error.message : "Failed to load."}
            </span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  if (isLoading || !row) {
    return (
      <AppShell breadcrumbs={[{ label: "Pre-receipts (Govt)", href: "/traders/pre-receipts" }, { label: "Detail" }]}>
        <Card>
          <CardContent className="p-6">
            <Skeleton className="h-8 w-56 mb-4" />
            <Skeleton className="h-40 w-full" />
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Pre-receipts (Govt)", href: "/traders/pre-receipts" }, { label: row.preReceiptNo ?? row.id }]}>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            {row.preReceiptNo ?? row.id}
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={async () => {
                try {
                  const res = await fetch(`/api/ioms/pre-receipts/${encodeURIComponent(id!)}/pdf`, {
                    credentials: "include",
                  });
                  if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    throw new Error((err as { error?: string }).error ?? res.statusText);
                  }
                  const blob = await res.blob();
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `pre-receipt-${(row.preReceiptNo ?? id).replace(/[^\w.-]+/g, "_")}.pdf`;
                  a.click();
                  URL.revokeObjectURL(url);
                  toast({ title: "Download started" });
                } catch (e) {
                  toast({
                    title: "PDF failed",
                    description: e instanceof Error ? e.message : "Could not download PDF.",
                    variant: "destructive",
                  });
                }
              }}
            >
              <Download className="h-4 w-4 mr-1" />
              A4 PDF
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setLocation("/traders/pre-receipts")}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Back
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-muted-foreground">Entity:</span> {entityLabelById[row.entityId] ?? row.entityId}
            </div>
            <div>
              <span className="text-muted-foreground">Yard:</span> {yardLabelById[row.yardId] ?? row.yardId}
            </div>
            <div>
              <span className="text-muted-foreground">Amount:</span> {formatInr(Number(row.amount ?? 0))}
            </div>
            <div>
              <span className="text-muted-foreground">Status:</span>{" "}
              <Badge variant="secondary">{row.status}</Badge>
            </div>
            <div className="md:col-span-2">
              <span className="text-muted-foreground">Purpose:</span> {row.purpose ?? "—"}
            </div>
            <div>
              <span className="text-muted-foreground">Print — premises type:</span> {row.rentPremisesType ?? "—"}
            </div>
            <div>
              <span className="text-muted-foreground">Print — premises ref:</span> {row.rentPremisesRef ?? "—"}
            </div>
            <div>
              <span className="text-muted-foreground">Print — billing month:</span> {row.rentBillingMonth ?? "—"}
            </div>
          </div>

          <div className="rounded-md border p-4 space-y-3">
            <p className="text-sm font-medium">Pre-receipt text and PDF (A4, two copies per sheet)</p>
            <p className="text-xs text-muted-foreground">
              Amount in words and the rent sentence use these fields. Run{" "}
              <code className="text-xs">npm run db:apply-pre-receipt-print-fields</code> once if the database was created before print columns existed.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1 md:col-span-2">
                <Label>Purpose</Label>
                <Input value={purpose} onChange={(e) => setPurpose(e.target.value)} disabled={!canUpdate} />
              </div>
              <div className="space-y-1">
                <Label>Amount (₹)</Label>
                <Input value={amount} onChange={(e) => setAmount(e.target.value)} disabled={!canUpdate} inputMode="decimal" />
              </div>
              <div className="space-y-1">
                <Label>Premises type (PDF)</Label>
                <Input
                  value={rentPremisesType}
                  onChange={(e) => setRentPremisesType(e.target.value)}
                  disabled={!canUpdate}
                  placeholder="e.g. Godown"
                />
              </div>
              <div className="space-y-1">
                <Label>Premises No. / ref (PDF)</Label>
                <Input
                  value={rentPremisesRef}
                  onChange={(e) => setRentPremisesRef(e.target.value)}
                  disabled={!canUpdate}
                  placeholder="e.g. G-12"
                />
              </div>
              <div className="space-y-1">
                <Label>Billing month (YYYY-MM)</Label>
                <Input
                  type="month"
                  value={rentBillingMonth}
                  onChange={(e) => setRentBillingMonth(e.target.value)}
                  disabled={!canUpdate}
                />
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!canUpdate || updateMutation.isPending}
              onClick={() => {
                const amt = Number(amount);
                if (!Number.isFinite(amt) || amt < 0) {
                  toast({ title: "Invalid amount", variant: "destructive" });
                  return;
                }
                if (rentBillingMonth && !/^\d{4}-\d{2}$/.test(rentBillingMonth)) {
                  toast({ title: "Billing month", description: "Use YYYY-MM (month picker).", variant: "destructive" });
                  return;
                }
                updateMutation.mutate({
                  purpose: purpose.trim() || null,
                  amount: amt,
                  rentPremisesType: rentPremisesType.trim() || null,
                  rentPremisesRef: rentPremisesRef.trim() || null,
                  rentBillingMonth: rentBillingMonth.trim() || null,
                });
              }}
            >
              {updateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save print fields"}
            </Button>
          </div>

          <div className="rounded-md border p-4 space-y-3">
            <p className="text-sm font-medium">Update lifecycle</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-end">
              <div className="space-y-1">
                <Label>Status</Label>
                <Select value={status} onValueChange={setStatus} disabled={!canUpdate}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
              <Label>Settled receipt (optional; auto-created when Settled)</Label>
                <Select
                  value={settledReceiptId || "__none__"}
                  onValueChange={(v) => setSettledReceiptId(v === "__none__" ? "" : v)}
                  disabled={!canUpdate}
                >
                  <SelectTrigger><SelectValue placeholder="Select receipt" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {receipts.map((r) => (
                      <SelectItem key={r.id} value={r.id}>{r.receiptNo}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {settledReceiptId ? (
                  <p className="text-xs text-muted-foreground">
                    Receipt: {receiptLabelById[settledReceiptId] ?? settledReceiptId} (ID)
                  </p>
                ) : null}
                {status === "Settled" && !settledReceiptId ? (
                  <p className="text-xs text-muted-foreground">
                    If left blank, the system will create an IOMS receipt automatically on settlement.
                  </p>
                ) : null}
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                disabled={!canUpdate || updateMutation.isPending}
                onClick={() => {
                  const amt = Number(amount);
                  if (!Number.isFinite(amt) || amt < 0) {
                    toast({ title: "Invalid amount", variant: "destructive" });
                    return;
                  }
                  if (rentBillingMonth && !/^\d{4}-\d{2}$/.test(rentBillingMonth)) {
                    toast({ title: "Billing month", description: "Use YYYY-MM.", variant: "destructive" });
                    return;
                  }
                  updateMutation.mutate({
                    status,
                    settledReceiptId: status === "Settled" ? settledReceiptId : undefined,
                    purpose: purpose.trim() || null,
                    amount: amt,
                    rentPremisesType: rentPremisesType.trim() || null,
                    rentPremisesRef: rentPremisesRef.trim() || null,
                    rentBillingMonth: rentBillingMonth.trim() || null,
                  });
                }}
              >
                {updateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
              </Button>
              <Button type="button" variant="outline" asChild>
                <Link href="/traders/pre-receipts">Pre-receipts (Govt)</Link>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </AppShell>
  );
}

