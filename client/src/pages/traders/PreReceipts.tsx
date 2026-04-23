import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { AlertCircle, FileText, Plus, Loader2 } from "lucide-react";
import { ClientDataGrid } from "@/components/reports/ClientDataGrid";
import type { ReportTableColumn } from "@/components/reports/ReportDataTable";
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
import { Link } from "wouter";

interface EntityRef {
  id: string;
  entityCode?: string | null;
  name: string;
  yardId: string;
  subType?: string | null;
}
interface PreReceipt {
  id: string;
  preReceiptNo?: string | null;
  entityId: string;
  yardId: string;
  amount: number;
  purpose?: string | null;
  status: string;
  settledReceiptId?: string | null;
  updatedAt?: string | null;
}

const columns: ReportTableColumn[] = [
  { key: "_no", header: "Pre-receipt no." },
  { key: "entityLabel", header: "Entity" },
  { key: "purpose", header: "Purpose" },
  { key: "amount", header: "Amount", sortField: "amountNum" },
  { key: "_status", header: "Status", sortField: "status" },
  { key: "_settled", header: "Settled receipt" },
];

export default function PreReceipts() {
  const { toast } = useToast();
  const { can } = useAuth();
  const canCreate = can("M-02", "Create");
  const queryClient = useQueryClient();

  const { data: entities = [], isLoading: entLoading } = useQuery<EntityRef[]>({ queryKey: ["/api/ioms/entities"] });
  const { data: list = [], isLoading, isError } = useQuery<PreReceipt[]>({ queryKey: ["/api/ioms/pre-receipts"] });

  const govtEntities = useMemo(() => entities.filter((e) => String(e.subType ?? "").trim() === "Govt"), [entities]);

  const entityLabelById = useMemo(
    () =>
      Object.fromEntries(
        entities.map((e) => [e.id, `${e.entityCode ?? e.id} — ${e.name}`]),
      ),
    [entities],
  );

  const [open, setOpen] = useState(false);
  const [entityId, setEntityId] = useState("");
  const [purpose, setPurpose] = useState("");
  const [amount, setAmount] = useState("");

  const createMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch("/api/ioms/pre-receipts", {
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
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/pre-receipts"] });
      toast({ title: "Pre-receipt issued" });
      setOpen(false);
      setPurpose("");
      setAmount("");
    },
    onError: (e: Error) => toast({ title: "Create failed", description: e.message, variant: "destructive" }),
  });

  const sourceRows = useMemo((): Record<string, unknown>[] => {
    return (list ?? []).map((p) => ({
      id: p.id,
      no: p.preReceiptNo ?? p.id,
      _no: (
        <Link className="text-primary hover:underline" href={`/traders/pre-receipts/${encodeURIComponent(p.id)}`}>
          {p.preReceiptNo ?? p.id}
        </Link>
      ),
      entityLabel: entityLabelById[p.entityId] ?? p.entityId,
      purpose: p.purpose ?? "—",
      amount: `₹${Number(p.amount ?? 0).toLocaleString()}`,
      amountNum: Number(p.amount ?? 0),
      status: p.status,
      _status: <span>{p.status}</span>,
      _settled: p.settledReceiptId ? p.settledReceiptId : "—",
    }));
  }, [list, entityLabelById]);

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "Traders", href: "/traders/licences" }, { label: "Pre-receipts" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Failed to load pre-receipts.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Traders", href: "/traders/licences" }, { label: "Pre-receipts (Track B)" }]}>
      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Pre-receipts (M-02 Track B)
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Issued / dispatched / acknowledged / settled tracking. Only <span className="font-medium text-foreground">Govt</span> Track B
              entities can receive pre-receipts; Commercial and Ad-hoc occupant entities use tax-invoice flows (M-03).
            </p>
          </div>
          {canCreate && (
            <Button size="sm" onClick={() => setOpen(true)} disabled={entLoading || govtEntities.length === 0}>
              <Plus className="h-4 w-4 mr-1" />
              Issue pre-receipt
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <ClientDataGrid
              columns={columns}
              sourceRows={sourceRows}
              searchKeys={["no", "entityLabel", "purpose", "status"]}
              searchPlaceholder="Search pre-receipts…"
              defaultSortKey="no"
              defaultSortDir="desc"
              emptyMessage="No pre-receipts."
            />
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Issue pre-receipt</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Entity *</Label>
              <Select value={entityId || "__pick__"} onValueChange={(v) => setEntityId(v === "__pick__" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Select entity" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__pick__">Select…</SelectItem>
                  {govtEntities.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {(e.entityCode ?? e.id) + " — " + e.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Purpose</Label>
              <Input value={purpose} onChange={(e) => setPurpose(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Amount (INR)</Label>
              <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              type="button"
              disabled={createMutation.isPending || !entityId}
              onClick={() => {
                const amt = amount.trim() ? Number(amount) : 0;
                if (!Number.isFinite(amt) || amt < 0) {
                  toast({ title: "Invalid amount", description: "Use a valid amount.", variant: "destructive" });
                  return;
                }
                createMutation.mutate({ entityId, purpose: purpose.trim() || null, amount: amt });
              }}
            >
              {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Issue"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

