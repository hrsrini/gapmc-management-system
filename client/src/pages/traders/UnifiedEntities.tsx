import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { ClientDataGrid } from "@/components/reports/ClientDataGrid";
import type { ReportTableColumn } from "@/components/reports/ReportDataTable";
import { AlertCircle, Building2, Plus, Wallet } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Link } from "wouter";

interface UnifiedEntityRow {
  id: string; // TA:<id> | TB:<id> | AH:<id>
  kind: "TrackA" | "TrackB" | "AdHoc";
  refId: string;
  yardId: string;
  name: string;
  status: string;
  mobile?: string | null;
  email?: string | null;
  pan?: string | null;
  gstin?: string | null;
  subType?: string | null;
}

const columns: ReportTableColumn[] = [
  { key: "kind", header: "Type", sortField: "kind" },
  { key: "name", header: "Name" },
  { key: "yardId", header: "Yard" },
  { key: "status", header: "Status", sortField: "status" },
  { key: "mobile", header: "Mobile" },
  { key: "pan", header: "PAN" },
  { key: "gstin", header: "GSTIN" },
  { key: "id", header: "Unified ID" },
  { key: "_actions", header: "Actions" },
];

export default function UnifiedEntities() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [draft, setDraft] = useState({
    name: "",
    yardId: "",
    mobile: "",
    email: "",
    pan: "",
    gstin: "",
    address: "",
  });

  const params = new URLSearchParams();
  if (q.trim()) params.set("q", q.trim());
  const url = params.toString() ? `/api/ioms/unified-entities?${params.toString()}` : "/api/ioms/unified-entities";

  const { data: list = [], isLoading, isError } = useQuery<UnifiedEntityRow[]>({
    queryKey: [url],
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/ioms/unified-entities/ad-hoc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: draft.name.trim(),
          yardId: draft.yardId.trim(),
          mobile: draft.mobile.trim() || null,
          email: draft.email.trim() || null,
          pan: draft.pan.trim() || null,
          gstin: draft.gstin.trim() || null,
          address: draft.address.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/unified-entities"] });
      setCreateOpen(false);
      setDraft({ name: "", yardId: "", mobile: "", email: "", pan: "", gstin: "", address: "" });
      toast({ title: "Created", description: "Ad-hoc entity created." });
    },
    onError: (e: Error) => toast({ title: "Create failed", description: e.message, variant: "destructive" }),
  });

  const rows = useMemo(() => {
    return (list ?? []).map((r) => ({
      ...r,
      status: r.status ?? "—",
      mobile: r.mobile ?? "—",
      pan: r.pan ?? "—",
      gstin: r.gstin ?? "—",
      _actions: (
        <Button variant="outline" size="sm" asChild>
          <Link href={`/traders/dues?unifiedId=${encodeURIComponent(r.id)}`}>
            <Wallet className="h-4 w-4 mr-1" />
            Dues
          </Link>
        </Button>
      ),
    })) as Record<string, unknown>[];
  }, [list]);

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "Traders", href: "/traders/licences" }, { label: "Unified entities" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Failed to load entities.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Traders", href: "/traders/licences" }, { label: "Unified entities (Sr.15)" }]}>
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Unified entity master
          </CardTitle>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-1" />
            Add ad-hoc entity
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Search</Label>
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, PAN, GSTIN, mobile, ID…" />
            </div>
          </div>
          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <ClientDataGrid
              columns={columns}
              sourceRows={rows}
              searchKeys={["name", "id", "kind", "yardId", "mobile", "pan", "gstin", "status"]}
              searchPlaceholder="Filter…"
              defaultSortKey="name"
              defaultSortDir="asc"
              emptyMessage="No entities found."
            />
          )}
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add ad-hoc entity</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1 md:col-span-2">
              <Label>Name</Label>
              <Input value={draft.name} onChange={(e) => setDraft((s) => ({ ...s, name: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Yard ID</Label>
              <Input value={draft.yardId} onChange={(e) => setDraft((s) => ({ ...s, yardId: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Mobile</Label>
              <Input value={draft.mobile} onChange={(e) => setDraft((s) => ({ ...s, mobile: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Email</Label>
              <Input value={draft.email} onChange={(e) => setDraft((s) => ({ ...s, email: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>PAN</Label>
              <Input value={draft.pan} onChange={(e) => setDraft((s) => ({ ...s, pan: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>GSTIN</Label>
              <Input value={draft.gstin} onChange={(e) => setDraft((s) => ({ ...s, gstin: e.target.value }))} />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label>Address</Label>
              <Textarea value={draft.address} onChange={(e) => setDraft((s) => ({ ...s, address: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending || !draft.name.trim() || !draft.yardId.trim()}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

