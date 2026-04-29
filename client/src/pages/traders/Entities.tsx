import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { AlertCircle, Building2, Plus, Loader2 } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { trackBShortBillingLabel } from "@shared/track-b-entity";
import { sanitizeMobile10Input } from "@shared/india-validation";
import { PanInput } from "@/components/inputs/PanInput";

interface Entity {
  id: string;
  entityCode?: string | null;
  track: string;
  subType?: string | null;
  name: string;
  yardId: string;
  mobile?: string | null;
  pan?: string | null;
  gstin?: string | null;
  email?: string | null;
  address?: string | null;
  status: string;
}

interface EntitySubtypeRef {
  trackB: string[];
}

const columns: ReportTableColumn[] = [
  { key: "_code", header: "Entity ID" },
  { key: "name", header: "Name" },
  { key: "track", header: "Track" },
  { key: "subType", header: "Sub-type" },
  { key: "_billing", header: "Billing", sortField: "billingLabel" },
  { key: "yardName", header: "Yard" },
  { key: "mobile", header: "Mobile" },
  { key: "_status", header: "Status", sortField: "status" },
];

export default function Entities() {
  const { toast } = useToast();
  const { can } = useAuth();
  const canCreate = can("M-02", "Create");
  const queryClient = useQueryClient();

  const {
    data: entities = [],
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery<Entity[]>({
    queryKey: ["/api/ioms/entities"],
  });
  const { data: subtypes } = useQuery<EntitySubtypeRef>({
    queryKey: ["/api/ioms/reference/entity-subtypes"],
  });
  const { data: yards = [] } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ["/api/yards"],
  });
  const yardById = Object.fromEntries(yards.map((y) => [y.id, y.name]));

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [yardId, setYardId] = useState("");
  const [track] = useState("TrackB");
  const [subType, setSubType] = useState("Govt");
  const [mobile, setMobile] = useState("");
  const [pan, setPan] = useState("");
  const [gstin, setGstin] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");

  const createMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch("/api/ioms/entities", {
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
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/entities"] });
      toast({ title: "Entity created" });
      setOpen(false);
      setName("");
      setMobile("");
      setPan("");
      setGstin("");
      setEmail("");
      setAddress("");
    },
    onError: (e: Error) => toast({ title: "Create failed", description: e.message, variant: "destructive" }),
  });

  const sourceRows = useMemo((): Record<string, unknown>[] => {
    return (entities ?? []).map((e) => {
      const billingLabel = trackBShortBillingLabel(e.subType);
      return {
        id: e.id,
        code: e.entityCode ?? e.id,
        _code: (
          <Link className="text-primary hover:underline" href={`/traders/entities/${encodeURIComponent(e.id)}`}>
            {e.entityCode ?? e.id}
          </Link>
        ),
        name: e.name,
        track: e.track,
        subType: e.subType ?? "—",
        billingLabel,
        _billing: <Badge variant="outline">{billingLabel}</Badge>,
        yardName: yardById[e.yardId] ?? e.yardId,
        mobile: e.mobile ?? "—",
        status: e.status,
        _status: <span>{e.status}</span>,
      };
    });
  }, [entities, yardById]);

  if (isError) {
    const detail = error instanceof Error ? error.message : String(error);
    return (
      <AppShell breadcrumbs={[{ label: "Traders", href: "/traders/licences" }, { label: "Entities" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 space-y-3">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              <div className="space-y-1 min-w-0">
                <p className="font-medium text-destructive">Failed to load entities</p>
                <p className="text-sm text-muted-foreground break-words font-mono">{detail}</p>
                {detail.includes("503:") || detail.includes("ENTITY_SCHEMA_MISSING") ? (
                  <p className="text-sm text-foreground">
                    Apply the Track B entities migration, then refresh:{" "}
                    <code className="rounded bg-muted px-1 py-0.5 text-xs">npm run db:apply-m02-trackb-entities</code>{" "}
                    or <code className="rounded bg-muted px-1 py-0.5 text-xs">npm run db:push</code>.
                  </p>
                ) : null}
                {detail.includes("403:") ? (
                  <p className="text-sm text-foreground">
                    Your role may lack M-02 Read on this environment. Ask an administrator to update the permission matrix.
                  </p>
                ) : null}
              </div>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              {isFetching ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Retrying…
                </>
              ) : (
                "Try again"
              )}
            </Button>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Traders", href: "/traders/licences" }, { label: "Entities (Track B)" }]}>
      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              Entities (M-02 Track B)
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Non-trader / government / ad-hoc occupants entity register (Track B). The Billing column follows
              sub-type: <span className="font-medium text-foreground">Govt</span> uses pre-receipts;{" "}
              <span className="font-medium text-foreground">Commercial</span> and{" "}
              <span className="font-medium text-foreground">Ad-hoc occupant</span> use M-03 rent / GST invoices — open
              an entity profile for links and hints.
            </p>
          </div>
          {canCreate && (
            <Button size="sm" onClick={() => setOpen(true)}>
              <Plus className="h-4 w-4 mr-1" />
              New entity
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
              searchKeys={["code", "name", "track", "subType", "billingLabel", "yardName", "mobile", "status"]}
              searchPlaceholder="Search entities…"
              defaultSortKey="name"
              defaultSortDir="asc"
              emptyMessage="No entities."
            />
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New entity (Track B)</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="md:col-span-2 space-y-1">
              <Label>Name *</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Track</Label>
              <Select value={track} onValueChange={() => {}}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="TrackB">TrackB</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Sub-type</Label>
              <Select value={subType || "__none__"} onValueChange={(v) => setSubType(v === "__none__" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Select…</SelectItem>
                  {(subtypes?.trackB ?? ["Govt", "Commercial", "AdHocOccupant"]).map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Yard *</Label>
              <Select value={yardId || "__pick__"} onValueChange={(v) => setYardId(v === "__pick__" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Select yard" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__pick__">Select…</SelectItem>
                  {yards.map((y) => (
                    <SelectItem key={y.id} value={y.id}>{y.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Mobile</Label>
              <Input
                value={mobile}
                onChange={(e) => setMobile(sanitizeMobile10Input(e.target.value))}
                placeholder="10-digit mobile"
                inputMode="numeric"
                maxLength={10}
              />
            </div>
            <div className="space-y-1">
              <Label>PAN</Label>
              <PanInput id="entity-create-pan" value={pan} onChange={setPan} />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label>GSTIN</Label>
              <Input value={gstin} onChange={(e) => setGstin(e.target.value)} placeholder="Optional" />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label>Email</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Optional" />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label>Address</Label>
              <Textarea value={address} onChange={(e) => setAddress(e.target.value)} rows={2} placeholder="Optional" />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              type="button"
              disabled={createMutation.isPending || !name.trim() || !yardId}
              onClick={() =>
                createMutation.mutate({
                  name: name.trim(),
                  yardId,
                  track,
                  subType: subType.trim() || null,
                  mobile: mobile.trim() || null,
                  pan: pan.trim() || null,
                  gstin: gstin.trim() || null,
                  email: email.trim() || null,
                  address: address.trim() || null,
                  status: "Active",
                })
              }
            >
              {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

