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
import { AlertCircle, ArrowLeft, FileText, Loader2 } from "lucide-react";
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

  const { data: list = [], isLoading, isError } = useQuery<PreReceipt[]>({
    queryKey: ["/api/ioms/pre-receipts"],
  });
  const row = useMemo(() => list.find((x) => x.id === id), [list, id]);

  const { data: entities = [] } = useQuery<EntityRef[]>({ queryKey: ["/api/ioms/entities"] });
  const { data: receipts = [] } = useQuery<ReceiptRef[]>({ queryKey: ["/api/ioms/receipts"] });

  const entityLabelById = useMemo(
    () => Object.fromEntries(entities.map((e) => [e.id, `${e.entityCode ?? e.id} — ${e.name}`])),
    [entities],
  );
  const receiptLabelById = useMemo(
    () => Object.fromEntries(receipts.map((r) => [r.id, r.receiptNo])),
    [receipts],
  );

  const [status, setStatus] = useState<string>("Issued");
  const [settledReceiptId, setSettledReceiptId] = useState<string>("");

  useEffect(() => {
    if (!row) return;
    setStatus(row.status);
    setSettledReceiptId(row.settledReceiptId ?? "");
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
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? res.statusText);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/pre-receipts"] });
      toast({ title: "Updated" });
    },
    onError: (e: Error) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "Pre-receipts", href: "/traders/pre-receipts" }, { label: "Detail" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Failed to load.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  if (isLoading || !row) {
    return (
      <AppShell breadcrumbs={[{ label: "Pre-receipts", href: "/traders/pre-receipts" }, { label: "Detail" }]}>
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
    <AppShell breadcrumbs={[{ label: "Pre-receipts", href: "/traders/pre-receipts" }, { label: row.preReceiptNo ?? row.id }]}>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            {row.preReceiptNo ?? row.id}
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={() => setLocation("/traders/pre-receipts")}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-muted-foreground">Entity:</span> {entityLabelById[row.entityId] ?? row.entityId}
            </div>
            <div>
              <span className="text-muted-foreground">Yard:</span> {row.yardId}
            </div>
            <div>
              <span className="text-muted-foreground">Amount:</span> ₹{Number(row.amount ?? 0).toLocaleString()}
            </div>
            <div>
              <span className="text-muted-foreground">Status:</span>{" "}
              <Badge variant="secondary">{row.status}</Badge>
            </div>
            <div className="md:col-span-2">
              <span className="text-muted-foreground">Purpose:</span> {row.purpose ?? "—"}
            </div>
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
                  updateMutation.mutate({
                    status,
                    settledReceiptId: status === "Settled" ? settledReceiptId : undefined,
                  });
                }}
              >
                {updateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
              </Button>
              <Button type="button" variant="outline" asChild>
                <Link href="/receipts/ioms">Go to receipts</Link>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </AppShell>
  );
}

