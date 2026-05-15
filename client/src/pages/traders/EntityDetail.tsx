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
import { useAuth, type AuthUser } from "@/context/AuthContext";
import { AlertCircle, ArrowLeft, ExternalLink, KeyRound, Plus, Loader2, FileText, Pencil } from "lucide-react";
import { sanitizeMobile10Input, parseIndianMobile10Digits } from "@shared/india-validation";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { unifiedEntityIdFromTrackB } from "@shared/unified-entity-id";
import { isTrackBGovtSubType, trackBBillingProfileHint, trackBShortBillingLabel } from "@shared/track-b-entity";
import { ClientDataGrid } from "@/components/reports/ClientDataGrid";
import type { ReportTableColumn } from "@/components/reports/ReportDataTable";
import { PanInput } from "@/components/inputs/PanInput";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  inferAgreementTypeFromDates,
  defaultGstApplicableTrackBEntity,
  localCalendarYmd,
  RENT_REVISION_MODES,
} from "@shared/premises-allocation";

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
interface VacantAssetRow {
  asset: AssetRef & {
    assetType?: string | null;
    complexName?: string | null;
    premisesStatus?: string | null;
  };
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
  approvalStatus?: string | null;
  monthlyRent?: number | null;
  premisesRefNo?: string | null;
  agreementDocFile?: string | null;
  rentRevisionMode?: string | null;
  agreementType?: string | null;
  gstApplicable?: boolean | null;
  consecutiveRenewalCount?: number | null;
  doUser?: string | null;
}

function agreementTypeLabel(code: string | null | undefined): string {
  if (code === "RentalAgreement") return "Rental (≤11 mo approx.)";
  if (code === "LeaseAgreement") return "Lease (>11 mo)";
  return "—";
}

function userTierSet(user: AuthUser | null): Set<string> {
  return new Set((user?.roles ?? []).map((r) => String(r.tier ?? "").trim()).filter(Boolean));
}

const allotmentColumns: ReportTableColumn[] = [
  { key: "assetDisplay", header: "Premises" },
  { key: "allotteeName", header: "Allottee" },
  { key: "fromDate", header: "Agreement from" },
  { key: "toDate", header: "Agreement to" },
  { key: "monthlyRent", header: "Monthly rent" },
  { key: "_approval", header: "Approval", sortField: "approvalStatus" },
  { key: "_tenancy", header: "Tenancy", sortField: "status" },
  { key: "premisesRef", header: "Ref" },
  { key: "_actions", header: "" },
];

export default function EntityDetail() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { can, user } = useAuth();
  const tiers = useMemo(() => userTierSet(user ?? null), [user]);
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
  const { data: yards = [] } = useQuery<Array<{ id: string; name?: string | null; code?: string | null }>>({
    queryKey: ["/api/yards"],
  });
  const yardDisplayName = useMemo(() => {
    if (!entity?.yardId) return "—";
    const y = yards.find((x) => x.id === entity.yardId);
    if (!y) return entity.yardId;
    return (y.name?.trim() || y.code?.trim() || y.id) as string;
  }, [yards, entity?.yardId]);

  const { data: allotments = [] } = useQuery<Allotment[]>({
    queryKey: [id ? `/api/ioms/entity-allotments?entityId=${encodeURIComponent(id)}` : ""],
    enabled: !!id,
    queryFn: async () => {
      const res = await fetch(`/api/ioms/entity-allotments?entityId=${encodeURIComponent(id!)}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load allotments");
      return res.json();
    },
  });
  const vacantUrl = entity?.yardId ? `/api/ioms/assets/vacant?yardId=${encodeURIComponent(entity.yardId)}` : "";
  const { data: vacantRows = [] } = useQuery<VacantAssetRow[]>({
    queryKey: [vacantUrl],
    enabled: !!entity?.yardId,
    queryFn: async () => {
      const res = await fetch(vacantUrl, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load vacant premises");
      return res.json();
    },
  });
  const assets = useMemo(() => vacantRows.map((r) => r.asset), [vacantRows]);
  const assetDisplayById = useMemo(() => Object.fromEntries(assets.map((a) => [a.id, a.assetId])), [assets]);
  const vacantByAssetPk = useMemo(() => Object.fromEntries(vacantRows.map((r) => [r.asset.id, r])), [vacantRows]);

  const [open, setOpen] = useState(false);
  const [assetId, setAssetId] = useState("");
  const [allotteeName, setAllotteeName] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [monthlyRent, setMonthlyRent] = useState("");
  const [rentRevisionMode, setRentRevisionMode] = useState<string>("StandardConsecutiveRenewal");
  const [agreementTypeOverride, setAgreementTypeOverride] = useState<string>("__auto__");
  const [consecutiveRenewalCount, setConsecutiveRenewalCount] = useState("0");
  const [gstApplicableDraft, setGstApplicableDraft] = useState(true);
  const [securityDeposit, setSecurityDeposit] = useState("");

  const [manageRow, setManageRow] = useState<Allotment | null>(null);
  const [mAllottee, setMAllottee] = useState("");
  const [mFrom, setMFrom] = useState("");
  const [mTo, setMTo] = useState("");
  const [mRent, setMRent] = useState("");
  const [mRevMode, setMRevMode] = useState("");
  const [mGst, setMGst] = useState(false);
  const [mReject, setMReject] = useState("");
  const [mDvReturn, setMDvReturn] = useState("");
  const [mGapOv, setMGapOv] = useState(false);
  const [mGstDaOv, setMGstDaOv] = useState(false);
  const [tenancyVacateOn, setTenancyVacateOn] = useState("");
  const [agreementFile, setAgreementFile] = useState<File | null>(null);
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

  useEffect(() => {
    const r = manageRow;
    if (!r) return;
    setMAllottee(r.allotteeName ?? "");
    setMFrom(r.fromDate ?? "");
    setMTo(r.toDate ?? "");
    setMRent(r.monthlyRent != null ? String(r.monthlyRent) : "");
    setMRevMode(String(r.rentRevisionMode ?? "StandardConsecutiveRenewal"));
    setMGst(Boolean(r.gstApplicable));
    setMReject("");
    setMDvReturn("");
    setMGapOv(false);
    setMGstDaOv(false);
    setTenancyVacateOn(localCalendarYmd());
    setAgreementFile(null);
  }, [manageRow]);

  useEffect(() => {
    if (!entity?.subType) return;
    setGstApplicableDraft(defaultGstApplicableTrackBEntity(entity.subType));
  }, [entity?.subType, open]);

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
      queryClient.invalidateQueries({ queryKey: [vacantUrl] });
      toast({
        title: "Draft allocation created",
        description: "Upload the notarised agreement PDF, then DV verifies and DA approves.",
      });
      setOpen(false);
      setAllotteeName("");
      setSecurityDeposit("");
      setMonthlyRent("");
      setAssetId("");
      setAgreementTypeOverride("__auto__");
      setConsecutiveRenewalCount("0");
    },
    onError: (e: Error) => toast({ title: "Create failed", description: e.message, variant: "destructive" }),
  });

  const invalidateAllocs = () => {
    queryClient.invalidateQueries({ queryKey: [`/api/ioms/entity-allotments?entityId=${encodeURIComponent(id!)}`] });
    if (vacantUrl) queryClient.invalidateQueries({ queryKey: [vacantUrl] });
  };

  const patchAllotMutation = useMutation({
    mutationFn: async ({ allocId, body }: { allocId: string; body: Record<string, unknown> }) => {
      const res = await fetch(`/api/ioms/entity-allotments/${encodeURIComponent(allocId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? res.statusText);
      }
      return (await res.json()) as Allotment;
    },
    onSuccess: (row) => {
      invalidateAllocs();
      setManageRow(row);
      toast({ title: "Saved" });
    },
    onError: (e: Error) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  const uploadAgreementMutation = useMutation({
    mutationFn: async ({ allocId, file }: { allocId: string; file: File }) => {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/ioms/entity-allotments/${encodeURIComponent(allocId)}/agreement`, {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? res.statusText);
      }
      return (await res.json()) as Allotment;
    },
    onSuccess: (row) => {
      invalidateAllocs();
      setManageRow(row);
      setAgreementFile(null);
      toast({ title: "Agreement uploaded" });
    },
    onError: (e: Error) => toast({ title: "Upload failed", description: e.message, variant: "destructive" }),
  });

  const selectedVacant = assetId ? vacantByAssetPk[assetId] : undefined;
  const inferredAgType =
    fromDate && toDate && /^\d{4}-\d{2}-\d{2}$/.test(fromDate) && /^\d{4}-\d{2}-\d{2}$/.test(toDate)
      ? inferAgreementTypeFromDates(fromDate, toDate)
      : null;

  const allotmentRows = useMemo((): Record<string, unknown>[] => {
    return allotments.map((a) => {
      const appr = String(a.approvalStatus ?? "Draft");
      return {
        id: a.id,
        approvalStatus: appr,
        assetDisplay: assetDisplayById[a.assetId] ?? a.assetId,
        allotteeName: a.allotteeName,
        fromDate: a.fromDate,
        toDate: a.toDate,
        status: a.status,
        monthlyRent: a.monthlyRent != null ? `₹${Number(a.monthlyRent).toLocaleString()}` : "—",
        premisesRef: a.premisesRefNo?.trim() ? a.premisesRefNo : "—",
        _approval: (
          <Badge variant={appr === "Approved" ? "default" : appr === "Rejected" ? "destructive" : "secondary"}>{appr}</Badge>
        ),
        _tenancy: <Badge variant={a.status === "Active" ? "default" : "outline"}>{a.status}</Badge>,
        _actions: (
          <Button type="button" variant="ghost" size="sm" className="h-8 px-2" onClick={() => setManageRow(a)}>
            <Pencil className="h-4 w-4" />
            <span className="sr-only">Manage</span>
          </Button>
        ),
      };
    });
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
                <div><span className="text-muted-foreground">Yard:</span> {yardDisplayName}</div>
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
                    <PanInput
                      id="entity-edit-pan"
                      value={editPan}
                      onChange={setEditPan}
                      uniquenessExcludes={id ? { excludeEntityId: id } : undefined}
                    />
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
                <p className="text-sm text-muted-foreground">
                  DO drafts an allocation with rent and dates; DV verifies once the notarised PDF is uploaded; DA approves and assigns the premises reference.
                </p>
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
                searchKeys={["assetDisplay", "allotteeName", "fromDate", "toDate", "status", "approvalStatus", "premisesRef"]}
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
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New premises allocation (draft)</DialogTitle>
            <p className="text-sm text-muted-foreground">
              Agreement must start today or later. Tenancy becomes Active only after DA approval.
            </p>
          </DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="md:col-span-2 space-y-1">
              <Label>Vacant premises in this yard *</Label>
              <Select value={assetId || "__pick__"} onValueChange={(v) => setAssetId(v === "__pick__" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select premises" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__pick__">Select…</SelectItem>
                  {assets.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.assetId}
                      {a.assetType ? ` · ${a.assetType}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedVacant?.asset ? (
                <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground space-y-0.5">
                  <div>
                    <span className="font-medium text-foreground">Master:</span>{" "}
                    {selectedVacant.asset.complexName?.trim() || "—"}
                    {selectedVacant.asset.assetType ? ` · ${selectedVacant.asset.assetType}` : ""}
                  </div>
                  <div>
                    <span className="font-medium text-foreground">Premises status:</span>{" "}
                    {selectedVacant.asset.premisesStatus ?? "Active"}
                  </div>
                </div>
              ) : null}
            </div>
            <div className="md:col-span-2 space-y-1">
              <Label>Allottee name *</Label>
              <Input value={allotteeName} onChange={(e) => setAllotteeName(e.target.value)} placeholder="Shown on allocation record" />
            </div>
            <div className="space-y-1">
              <Label>Agreement from *</Label>
              <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Agreement to *</Label>
              <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            </div>
            <div className="md:col-span-2 rounded-md border bg-muted/30 px-3 py-2 text-xs">
              <span className="text-muted-foreground">Inferred agreement kind from period: </span>
              <span className="font-medium text-foreground">
                {inferredAgType ? agreementTypeLabel(inferredAgType) : "Pick both dates"}
              </span>
              <span className="text-muted-foreground"> · Override below if counsel classifies differently.</span>
            </div>
            <div className="space-y-1">
              <Label>Agreement type override</Label>
              <Select value={agreementTypeOverride} onValueChange={setAgreementTypeOverride}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__auto__">Auto from dates</SelectItem>
                  <SelectItem value="RentalAgreement">Rental agreement</SelectItem>
                  <SelectItem value="LeaseAgreement">Lease agreement</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Monthly rent *</Label>
              <Input value={monthlyRent} onChange={(e) => setMonthlyRent(e.target.value)} inputMode="decimal" placeholder="> 0" />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label>Rent revision mode *</Label>
              <Select value={rentRevisionMode} onValueChange={setRentRevisionMode}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RENT_REVISION_MODES.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m === "StandardConsecutiveRenewal" ? "Standard consecutive renewal" : "PWD certificate basis"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Consecutive renewal count</Label>
              <Input value={consecutiveRenewalCount} onChange={(e) => setConsecutiveRenewalCount(e.target.value)} inputMode="numeric" />
            </div>
            <div className="space-y-1">
              <Label>Security deposit</Label>
              <Input value={securityDeposit} onChange={(e) => setSecurityDeposit(e.target.value)} inputMode="decimal" />
            </div>
            {entity?.subType === "AdHocOccupant" ? (
              <div className="md:col-span-2 flex items-start gap-3 rounded-md border p-3">
                <Checkbox
                  id="gst-draft"
                  checked={gstApplicableDraft}
                  onCheckedChange={(c) => setGstApplicableDraft(c === true)}
                />
                <div>
                  <Label htmlFor="gst-draft" className="cursor-pointer">
                    GST applicable (Ad hoc)
                  </Label>
                  <p className="text-xs text-muted-foreground">Government and most commercial profiles follow fixed rules on the server; only Ad hoc can toggle here.</p>
                </div>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={
                createMutation.isPending ||
                !assetId ||
                !allotteeName.trim() ||
                !fromDate ||
                !toDate ||
                !Number.isFinite(Number(monthlyRent)) ||
                Number(monthlyRent) <= 0
              }
              onClick={() => {
                const mr = Number(monthlyRent);
                const body: Record<string, unknown> = {
                  assetId,
                  entityId: id,
                  allotteeName: allotteeName.trim(),
                  fromDate,
                  toDate,
                  monthlyRent: mr,
                  rentRevisionMode,
                  consecutiveRenewalCount: Number(consecutiveRenewalCount) || 0,
                  securityDeposit: securityDeposit.trim() ? Number(securityDeposit) : null,
                };
                if (agreementTypeOverride !== "__auto__") body.agreementType = agreementTypeOverride;
                if (entity?.subType === "AdHocOccupant") body.gstApplicable = gstApplicableDraft;
                createMutation.mutate(body);
              }}
            >
              {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create draft"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(manageRow)}
        onOpenChange={(o) => {
          if (!o) setManageRow(null);
        }}
      >
        <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
          {!manageRow ? null : (
            <>
              <DialogHeader>
                <DialogTitle>Manage premises allocation</DialogTitle>
                <p className="text-sm text-muted-foreground font-mono">
                  {assetDisplayById[manageRow.assetId] ?? manageRow.assetId}
                  {manageRow.premisesRefNo?.trim() ? ` · ${manageRow.premisesRefNo}` : ""}
                </p>
              </DialogHeader>

              <div className="space-y-4 text-sm">
                <div className="flex flex-wrap gap-2 items-center">
                  <Badge variant="secondary">{String(manageRow.approvalStatus ?? "Draft")}</Badge>
                  <Badge variant="outline">{manageRow.status}</Badge>
                  {manageRow.agreementDocFile ? (
                    <Button variant="outline" size="sm" asChild>
                      <a
                        href={`/api/ioms/entity-allotments/${encodeURIComponent(manageRow.id)}/agreement`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <ExternalLink className="h-3.5 w-3.5 mr-1" />
                        Agreement PDF
                      </a>
                    </Button>
                  ) : (
                    <span className="text-muted-foreground flex items-center gap-1">
                      <FileText className="h-4 w-4" /> No PDF uploaded
                    </span>
                  )}
                </div>

                {["Draft", "Rejected"].includes(String(manageRow.approvalStatus ?? "")) &&
                (tiers.has("DO") || tiers.has("ADMIN")) ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 border-t pt-3">
                    <div className="md:col-span-2 space-y-1">
                      <Label>Allottee name</Label>
                      <Input value={mAllottee} onChange={(e) => setMAllottee(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label>Agreement from</Label>
                      <Input type="date" value={mFrom} onChange={(e) => setMFrom(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label>Agreement to</Label>
                      <Input type="date" value={mTo} onChange={(e) => setMTo(e.target.value)} />
                    </div>
                    <div className="space-y-1 md:col-span-2">
                      <Label>Monthly rent</Label>
                      <Input value={mRent} onChange={(e) => setMRent(e.target.value)} inputMode="decimal" />
                    </div>
                    <div className="space-y-1 md:col-span-2">
                      <Label>Rent revision mode</Label>
                      <Select value={mRevMode} onValueChange={setMRevMode}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {RENT_REVISION_MODES.map((m) => (
                            <SelectItem key={m} value={m}>
                              {m === "StandardConsecutiveRenewal" ? "Standard consecutive renewal" : "PWD certificate basis"}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {entity?.subType === "AdHocOccupant" ? (
                      <div className="md:col-span-2 flex items-start gap-3">
                        <Checkbox id="gst-m" checked={mGst} onCheckedChange={(c) => setMGst(c === true)} />
                        <Label htmlFor="gst-m" className="cursor-pointer">
                          GST applicable
                        </Label>
                      </div>
                    ) : null}
                    <div className="md:col-span-2">
                      <Button
                        type="button"
                        size="sm"
                        disabled={
                          patchAllotMutation.isPending ||
                          !Number.isFinite(Number(mRent)) ||
                          Number(mRent) <= 0 ||
                          !mAllottee.trim()
                        }
                        onClick={() =>
                          patchAllotMutation.mutate({
                            allocId: manageRow.id,
                            body: {
                              allotteeName: mAllottee.trim(),
                              fromDate: mFrom,
                              toDate: mTo,
                              monthlyRent: Number(mRent),
                              rentRevisionMode: mRevMode,
                              ...(entity?.subType === "AdHocOccupant" ? { gstApplicable: mGst } : {}),
                            },
                          })
                        }
                      >
                        {patchAllotMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save draft fields"}
                      </Button>
                    </div>
                  </div>
                ) : null}

                {["Draft", "Rejected"].includes(String(manageRow.approvalStatus ?? "")) &&
                (tiers.has("DO") || tiers.has("ADMIN")) ? (
                  <div className="border-t pt-3 space-y-2">
                    <Label>Upload notarised agreement (PDF)</Label>
                    <Input
                      type="file"
                      accept="application/pdf"
                      onChange={(e) => setAgreementFile(e.target.files?.[0] ?? null)}
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={uploadAgreementMutation.isPending || !agreementFile}
                      onClick={() => agreementFile && uploadAgreementMutation.mutate({ allocId: manageRow.id, file: agreementFile })}
                    >
                      {uploadAgreementMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Upload PDF"}
                    </Button>
                  </div>
                ) : null}

                {String(manageRow.approvalStatus ?? "") === "Draft" &&
                manageRow.agreementDocFile &&
                (tiers.has("DV") || tiers.has("ADMIN")) ? (
                  <div className="border-t pt-3">
                    <Button
                      type="button"
                      size="sm"
                      disabled={patchAllotMutation.isPending}
                      onClick={() =>
                        patchAllotMutation.mutate({
                          allocId: manageRow.id,
                          body: { approvalStatus: "Verified" },
                        })
                      }
                    >
                      Mark verified (DV)
                    </Button>
                  </div>
                ) : null}

                {String(manageRow.approvalStatus ?? "") === "Verified" && (tiers.has("DV") || tiers.has("ADMIN")) ? (
                  <div className="border-t pt-3 space-y-2">
                    <Label>Return to draft (DV)</Label>
                    <Textarea value={mDvReturn} onChange={(e) => setMDvReturn(e.target.value)} rows={2} placeholder="Minimum 5 characters" />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={patchAllotMutation.isPending || mDvReturn.trim().length < 5}
                      onClick={() =>
                        patchAllotMutation.mutate({
                          allocId: manageRow.id,
                          body: { approvalStatus: "Draft", dvReturnRemarks: mDvReturn.trim() },
                        })
                      }
                    >
                      Return to DO
                    </Button>
                  </div>
                ) : null}

                {String(manageRow.approvalStatus ?? "") === "Verified" && (tiers.has("DA") || tiers.has("ADMIN")) ? (
                  <div className="border-t pt-3 space-y-3">
                    <div className="flex items-start gap-3">
                      <Checkbox id="gap-ov" checked={mGapOv} onCheckedChange={(c) => setMGapOv(c === true)} />
                      <Label htmlFor="gap-ov" className="cursor-pointer text-xs leading-snug">
                        I acknowledge overriding the calendar-gap rule versus the prior vacated agreement (DA only).
                      </Label>
                    </div>
                    {entity?.subType === "AdHocOccupant" ? (
                      <div className="flex items-start gap-3">
                        <Checkbox id="gst-da" checked={mGstDaOv} onCheckedChange={(c) => setMGstDaOv(c === true)} />
                        <div>
                          <Label htmlFor="gst-da" className="cursor-pointer text-xs leading-snug">
                            Override GST applicability at approval
                          </Label>
                          <p className="text-xs text-muted-foreground mt-1">
                            If checked, the value below is applied when you approve. If unchecked, the draft value stays.
                          </p>
                          <div className="mt-2 flex items-start gap-2">
                            <Checkbox id="gst-final" checked={mGst} onCheckedChange={(c) => setMGst(c === true)} />
                            <Label htmlFor="gst-final" className="cursor-pointer">
                              GST applicable on invoice
                            </Label>
                          </div>
                        </div>
                      </div>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        disabled={patchAllotMutation.isPending}
                        onClick={() => {
                          const body: Record<string, unknown> = {
                            approvalStatus: "Approved",
                            agreementGapDaOverride: mGapOv,
                          };
                          if (entity?.subType === "AdHocOccupant" && mGstDaOv) body.gstApplicableDaOverride = mGst;
                          patchAllotMutation.mutate({ allocId: manageRow.id, body });
                        }}
                      >
                        Approve allocation
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        disabled={patchAllotMutation.isPending || mReject.trim().length < 3}
                        onClick={() =>
                          patchAllotMutation.mutate({
                            allocId: manageRow.id,
                            body: { approvalStatus: "Rejected", rejectionRemarks: mReject.trim() },
                          })
                        }
                      >
                        Reject
                      </Button>
                    </div>
                    <div className="space-y-1">
                      <Label>Rejection remarks (for Reject)</Label>
                      <Textarea value={mReject} onChange={(e) => setMReject(e.target.value)} rows={2} />
                    </div>
                  </div>
                ) : null}

                {String(manageRow.approvalStatus ?? "") === "Rejected" && (tiers.has("DO") || tiers.has("ADMIN")) ? (
                  <div className="border-t pt-3">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={patchAllotMutation.isPending}
                      onClick={() =>
                        patchAllotMutation.mutate({
                          allocId: manageRow.id,
                          body: { approvalStatus: "Draft" },
                        })
                      }
                    >
                      Re-open as draft for correction
                    </Button>
                  </div>
                ) : null}

                {String(manageRow.approvalStatus ?? "") === "Approved" &&
                ["Active", "Vacating"].includes(manageRow.status) &&
                canUpdate ? (
                  <div className="border-t pt-3 space-y-2">
                    <div className="space-y-1">
                      <Label>Vacated on</Label>
                      <Input
                        type="date"
                        max={localCalendarYmd()}
                        value={tenancyVacateOn}
                        onChange={(e) => setTenancyVacateOn(e.target.value)}
                      />
                    </div>
                    <Label>Tenancy status</Label>
                    <Select
                      value={manageRow.status}
                      onValueChange={(v) => {
                        const cur = manageRow.status;
                        if (v === cur) return;
                        const ok =
                          (cur === "Active" && (v === "Vacating" || v === "Vacated")) || (cur === "Vacating" && v === "Vacated");
                        if (!ok) return;
                        if (v === "Vacated") {
                          const today = localCalendarYmd();
                          if (tenancyVacateOn > today) {
                            toast({
                              title: "Invalid vacated date",
                              description: "Vacated on must be today or an earlier date.",
                              variant: "destructive",
                            });
                            return;
                          }
                          patchAllotMutation.mutate({
                            allocId: manageRow.id,
                            body: { status: v, toDate: tenancyVacateOn },
                          });
                        } else {
                          patchAllotMutation.mutate({ allocId: manageRow.id, body: { status: v } });
                        }
                      }}
                    >
                      <SelectTrigger className="max-w-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {manageRow.status === "Active" ? (
                          <>
                            <SelectItem value="Active">Active</SelectItem>
                            <SelectItem value="Vacating">Vacating</SelectItem>
                            <SelectItem value="Vacated">Vacated</SelectItem>
                          </>
                        ) : (
                          <>
                            <SelectItem value="Vacating">Vacating</SelectItem>
                            <SelectItem value="Vacated">Vacated</SelectItem>
                          </>
                        )}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Move to Vacating or Vacated when the entity leaves; the premises appears in the vacant list again after
                      Vacated. Vacated on must be today or an earlier date.
                    </p>
                  </div>
                ) : null}
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setManageRow(null)}>
                  Close
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

