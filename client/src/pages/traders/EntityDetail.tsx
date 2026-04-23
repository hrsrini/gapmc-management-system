import { useEffect, useMemo, useState } from "react";
import { useLocation, useParams, Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { AlertCircle, ArrowLeft, KeyRound, Plus, Loader2 } from "lucide-react";
import { sanitizeMobile10Input, parseIndianMobile10Digits } from "@shared/india-validation";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { unifiedEntityIdFromTrackB } from "@shared/unified-entity-id";
import { isTrackBGovtSubType, trackBBillingProfileHint, trackBShortBillingLabel } from "@shared/track-b-entity";
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
interface AssetRef {
  id: string;
  assetId: string;
}
interface Allotment {
  id: string;
  assetId: string;
  entityId: string;
  allotteeName: string;
  fromDate: string;
  toDate: string;
  status: string;
  securityDeposit?: number | null;
}

const allotmentColumns: ReportTableColumn[] = [
  { key: "assetDisplay", header: "Asset" },
  { key: "allotteeName", header: "Allottee" },
  { key: "fromDate", header: "From" },
  { key: "toDate", header: "To" },
  { key: "_status", header: "Status", sortField: "status" },
  { key: "securityDeposit", header: "Security deposit" },
];

export default function EntityDetail() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { can } = useAuth();
  const canCreate = can("M-02", "Create");
  const canUpdate = can("M-02", "Update");
  const queryClient = useQueryClient();

  const { data: entity, isLoading, isError } = useQuery<Entity>({
    queryKey: ["/api/ioms/entities", id],
    enabled: !!id,
  });
  const { data: subtypes } = useQuery<EntitySubtypeRef>({
    queryKey: ["/api/ioms/reference/entity-subtypes"],
  });
  const { data: allotments = [] } = useQuery<Allotment[]>({
    queryKey: [id ? `/api/ioms/entity-allotments?entityId=${encodeURIComponent(id)}` : ""],
    enabled: !!id,
    queryFn: async () => {
      const res = await fetch(`/api/ioms/entity-allotments?entityId=${encodeURIComponent(id!)}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load allotments");
      return res.json();
    },
  });
  const { data: assets = [] } = useQuery<AssetRef[]>({ queryKey: ["/api/ioms/assets"] });
  const assetDisplayById = useMemo(() => Object.fromEntries(assets.map((a) => [a.id, a.assetId])), [assets]);

  const [open, setOpen] = useState(false);
  const [assetId, setAssetId] = useState("");
  const [allotteeName, setAllotteeName] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [status, setStatus] = useState("Active");
  const [securityDeposit, setSecurityDeposit] = useState("");
  const [editName, setEditName] = useState("");
  const [editSubType, setEditSubType] = useState("");
  const [editMobile, setEditMobile] = useState("");
  const [editPan, setEditPan] = useState("");
  const [editGstin, setEditGstin] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [editStatus, setEditStatus] = useState("Active");

  useEffect(() => {
    if (!entity) return;
    setEditName(entity.name ?? "");
    setEditSubType(entity.subType ?? "");
    setEditMobile(sanitizeMobile10Input(entity.mobile ?? ""));
    setEditPan(entity.pan ?? "");
    setEditGstin(entity.gstin ?? "");
    setEditEmail(entity.email ?? "");
    setEditAddress(entity.address ?? "");
    setEditStatus(entity.status ?? "Active");
  }, [entity]);

  const updateEntityMutation = useMutation({
    mutationFn: async () => {
      const mobileDigits = parseIndianMobile10Digits(editMobile);
      if (editMobile.trim() && !mobileDigits) {
        throw new Error("Enter a valid 10-digit mobile or leave it blank.");
      }
      const body: Record<string, unknown> = {
        name: editName.trim(),
        subType: editSubType.trim() || null,
        mobile: mobileDigits || null,
        pan: editPan.trim() || null,
        gstin: editGstin.trim() || null,
        email: editEmail.trim() || null,
        address: editAddress.trim() || null,
        status: editStatus,
      };
      const res = await fetch(`/api/ioms/entities/${encodeURIComponent(id!)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { message?: string; error?: string }).message ?? (err as { error?: string }).error ?? res.statusText);
      }
      return (await res.json()) as Entity;
    },
    onSuccess: (row) => {
      queryClient.setQueryData(["/api/ioms/entities", id], row);
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/entities"] });
      toast({ title: "Saved", description: "Entity register updated." });
    },
    onError: (e: Error) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  const createMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch("/api/ioms/entity-allotments", {
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
      queryClient.invalidateQueries({ queryKey: [`/api/ioms/entity-allotments?entityId=${encodeURIComponent(id!)}`] });
      toast({ title: "Allotment created" });
      setOpen(false);
      setAllotteeName("");
      setSecurityDeposit("");
    },
    onError: (e: Error) => toast({ title: "Create failed", description: e.message, variant: "destructive" }),
  });

  const allotmentRows = useMemo((): Record<string, unknown>[] => {
    return allotments.map((a) => ({
      id: a.id,
      assetDisplay: assetDisplayById[a.assetId] ?? a.assetId,
      allotteeName: a.allotteeName,
      fromDate: a.fromDate,
      toDate: a.toDate,
      status: a.status,
      securityDeposit: a.securityDeposit != null ? `₹${Number(a.securityDeposit).toLocaleString()}` : "—",
      _status: <Badge variant={a.status === "Active" ? "default" : "secondary"}>{a.status}</Badge>,
    }));
  }, [allotments, assetDisplayById]);

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "Entities", href: "/traders/entities" }, { label: "Detail" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Entity not found.</span>
            <Button variant="outline" size="sm" onClick={() => setLocation("/traders/entities")}>
              Back
            </Button>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Traders", href: "/traders/licences" }, { label: "Entities", href: "/traders/entities" }, { label: entity?.entityCode ?? id }]} >
      {isLoading || !entity ? (
        <Card>
          <CardContent className="p-6">
            <Skeleton className="h-8 w-48 mb-4" />
            <Skeleton className="h-32 w-full" />
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <KeyRound className="h-5 w-5" />
                {entity.name}
              </CardTitle>
              <Button variant="ghost" size="sm" asChild>
                <Link href="/traders/entities">
                  <ArrowLeft className="h-4 w-4 mr-1" /> Back
                </Link>
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                <div><span className="text-muted-foreground">Entity ID:</span> {entity.entityCode ?? entity.id}</div>
                <div><span className="text-muted-foreground">Track:</span> {entity.track}</div>
                <div><span className="text-muted-foreground">Sub-type:</span> {entity.subType ?? "—"}</div>
                <div><span className="text-muted-foreground">Yard:</span> {entity.yardId}</div>
                <div><span className="text-muted-foreground">Mobile:</span> {entity.mobile ?? "—"}</div>
                <div><span className="text-muted-foreground">Status:</span> {entity.status}</div>
                <div><span className="text-muted-foreground">PAN:</span> {entity.pan ?? "—"}</div>
                <div className="md:col-span-2"><span className="text-muted-foreground">GSTIN:</span> {entity.gstin ?? "—"}</div>
                <div className="md:col-span-3 break-all"><span className="text-muted-foreground">Email:</span> {entity.email ?? "—"}</div>
                <div className="md:col-span-3"><span className="text-muted-foreground">Address:</span>{" "}
                  <span className="whitespace-pre-wrap">{entity.address?.trim() ? entity.address : "—"}</span>
                </div>
              </div>
              <Alert>
                <AlertTitle>Billing route — {trackBShortBillingLabel(entity.subType)}</AlertTitle>
                <AlertDescription className="text-foreground space-y-2">
                  <p>{trackBBillingProfileHint(entity.subType)}</p>
                  <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                    <Link
                      className="text-primary font-medium hover:underline"
                      href={`/traders/dues?unifiedId=${encodeURIComponent(unifiedEntityIdFromTrackB(entity.id))}`}
                    >
                      Outstanding dues
                    </Link>
                    {isTrackBGovtSubType(entity.subType) ? (
                      <Link className="text-primary font-medium hover:underline" href="/traders/pre-receipts">
                        Pre-receipts register
                      </Link>
                    ) : (
                      <>
                        <Link
                          className="text-primary font-medium hover:underline"
                          href={`/rent/ioms/ledger?unifiedEntityId=${encodeURIComponent(unifiedEntityIdFromTrackB(entity.id))}`}
                        >
                          Rent deposit ledger (M-03)
                        </Link>
                        <Link className="text-primary font-medium hover:underline" href="/rent/ioms/invoices">
                          Rent / GST invoices (M-03)
                        </Link>
                      </>
                    )}
                  </p>
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>

          {canUpdate && (
            <Card className="mt-6">
              <CardHeader>
                <CardTitle>Edit register</CardTitle>
                <p className="text-sm text-muted-foreground">Track B entity master fields (M-02 Update).</p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="md:col-span-2 space-y-1">
                    <Label>Name *</Label>
                    <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label>Sub-type</Label>
                    <Select value={editSubType || "__none__"} onValueChange={(v) => setEditSubType(v === "__none__" ? "" : v)}>
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
                    <Label>Status</Label>
                    <Select value={editStatus} onValueChange={setEditStatus}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Draft">Draft</SelectItem>
                        <SelectItem value="Active">Active</SelectItem>
                        <SelectItem value="Inactive">Inactive</SelectItem>
                        <SelectItem value="Blocked">Blocked</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label>Mobile</Label>
                    <Input
                      value={editMobile}
                      onChange={(e) => setEditMobile(sanitizeMobile10Input(e.target.value))}
                      placeholder="10-digit mobile"
                      inputMode="numeric"
                      maxLength={10}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>PAN</Label>
                    <Input value={editPan} onChange={(e) => setEditPan(e.target.value)} placeholder="Optional" />
                  </div>
                  <div className="space-y-1 md:col-span-2">
                    <Label>GSTIN</Label>
                    <Input value={editGstin} onChange={(e) => setEditGstin(e.target.value)} placeholder="Optional" />
                  </div>
                  <div className="space-y-1 md:col-span-2">
                    <Label>Email</Label>
                    <Input type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} placeholder="Optional" />
                  </div>
                  <div className="space-y-1 md:col-span-2">
                    <Label>Address</Label>
                    <Textarea value={editAddress} onChange={(e) => setEditAddress(e.target.value)} rows={3} placeholder="Optional" />
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      if (!entity) return;
                      setEditName(entity.name ?? "");
                      setEditSubType(entity.subType ?? "");
                      setEditMobile(sanitizeMobile10Input(entity.mobile ?? ""));
                      setEditPan(entity.pan ?? "");
                      setEditGstin(entity.gstin ?? "");
                      setEditEmail(entity.email ?? "");
                      setEditAddress(entity.address ?? "");
                      setEditStatus(entity.status ?? "Active");
                    }}
                  >
                    Reset
                  </Button>
                  <Button
                    type="button"
                    disabled={updateEntityMutation.isPending || !editName.trim()}
                    onClick={() => updateEntityMutation.mutate()}
                  >
                    {updateEntityMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          <Card className="mt-6">
            <CardHeader className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
              <div>
                <CardTitle>Premises allocations ({allotments.length})</CardTitle>
                <p className="text-sm text-muted-foreground">Track B premises allocation list.</p>
              </div>
              {canCreate && (
                <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
                  <Plus className="h-4 w-4 mr-1" /> Add allotment
                </Button>
              )}
            </CardHeader>
            <CardContent>
              <ClientDataGrid
                columns={allotmentColumns}
                sourceRows={allotmentRows}
                searchKeys={["assetDisplay", "allotteeName", "fromDate", "toDate", "status"]}
                searchPlaceholder="Search allocations…"
                defaultSortKey="fromDate"
                defaultSortDir="desc"
                resetPageDependency={id}
                emptyMessage="No allocations."
              />
            </CardContent>
          </Card>
        </>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New premises allocation</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="md:col-span-2 space-y-1">
              <Label>Asset *</Label>
              <Select value={assetId || "__pick__"} onValueChange={(v) => setAssetId(v === "__pick__" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Select asset" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__pick__">Select…</SelectItem>
                  {assets.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.assetId}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-2 space-y-1">
              <Label>Allottee name *</Label>
              <Input value={allotteeName} onChange={(e) => setAllotteeName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>From *</Label>
              <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>To *</Label>
              <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Active">Active</SelectItem>
                  <SelectItem value="Vacated">Vacated</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Security deposit</Label>
              <Input value={securityDeposit} onChange={(e) => setSecurityDeposit(e.target.value)} inputMode="decimal" />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              type="button"
              disabled={createMutation.isPending || !assetId || !allotteeName.trim() || !fromDate || !toDate}
              onClick={() =>
                createMutation.mutate({
                  assetId,
                  entityId: id,
                  allotteeName: allotteeName.trim(),
                  fromDate,
                  toDate,
                  status,
                  securityDeposit: securityDeposit.trim() ? Number(securityDeposit) : null,
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

