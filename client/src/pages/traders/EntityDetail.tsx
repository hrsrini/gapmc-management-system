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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { localCalendarYmd, RENT_REVISION_MODES } from "@shared/premises-allocation";
import { buildAssetDisplayByRowId, formatPremisesAssetLabel } from "@/lib/asset-premises-display";
import {
  PREMISES_ALLOCATION_COLUMNS,
  PREMISES_ALLOCATION_SEARCH_KEYS,
  allocationApprovalBadge,
  allocationTenancyBadge,
  formatAllocationMoney,
} from "@/lib/premises-allocation-table";
import {
  TenancyVacateConfirmDialog,
  tenancyStatusChangeNeedsConfirm,
} from "@/components/premises/TenancyVacateConfirmDialog";
import { useScopedActiveYards } from "@/hooks/useScopedActiveYards";
import { useYardLabels } from "@/hooks/useYardLabels";
import { filterYardTypeLocations } from "@/lib/legacyYardMatch";

type MappedYard = {
  mappingId?: string;
  yardId: string;
  yardName?: string | null;
  yardCode?: string | null;
  status: string;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  unmappedReason?: string | null;
};

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
  mappedYards?: MappedYard[];
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
  approvalStatus?: string | null;
  monthlyRent?: number | null;
  premisesRefNo?: string | null;
  allotmentDate?: string | null;
  agreementDocFile?: string | null;
  rentRevisionMode?: string | null;
  agreementType?: string | null;
  gstApplicable?: boolean | null;
  consecutiveRenewalCount?: number | null;
  doUser?: string | null;
}

function userTierSet(user: AuthUser | null): Set<string> {
  return new Set((user?.roles ?? []).map((r) => String(r.tier ?? "").trim()).filter(Boolean));
}


export default function EntityDetail() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { can, user } = useAuth();
  const tiers = useMemo(() => userTierSet(user ?? null), [user]);
  const canCreate = can("M-02", "Create");
  const canUpdate = can("M-02", "Update");
  const canDelete = can("M-02", "Delete");
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data: entity, isLoading, isError } = useQuery<Entity>({
    queryKey: ["/api/ioms/entities", id],
    enabled: !!id,
  });
  const { data: deletionCheck } = useQuery<{
    canDelete: boolean;
    links: Record<string, number>;
  }>({
    queryKey: ["/api/ioms/entities", id, "deletion-check"],
    queryFn: async () => {
      const res = await fetch(`/api/ioms/entities/${encodeURIComponent(id!)}/deletion-check`, {
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? res.statusText);
      }
      return res.json();
    },
    enabled: !!id && canDelete,
  });
  const { data: subtypes } = useQuery<EntitySubtypeRef>({
    queryKey: ["/api/ioms/reference/entity-subtypes"],
  });
  const { data: scopedYards = [] } = useScopedActiveYards();
  const { getYardName } = useYardLabels();
  const yardOptions = useMemo(() => filterYardTypeLocations(scopedYards), [scopedYards]);
  const yardDisplayName = useMemo(() => getYardName(entity?.yardId), [getYardName, entity?.yardId]);

  const activeMappedYards = useMemo(
    () => (entity?.mappedYards ?? []).filter((m) => m.status === "Active"),
    [entity?.mappedYards],
  );
  const inactiveMappedYards = useMemo(
    () => (entity?.mappedYards ?? []).filter((m) => m.status !== "Active"),
    [entity?.mappedYards],
  );
  const addableYards = useMemo(() => {
    const activeIds = new Set(activeMappedYards.map((m) => m.yardId));
    return yardOptions.filter((y) => !activeIds.has(y.id));
  }, [yardOptions, activeMappedYards]);

  const { data: allotments = [] } = useQuery<Allotment[]>({
    queryKey: [id ? `/api/ioms/entity-allotments?entityId=${encodeURIComponent(id)}` : ""],
    enabled: !!id,
    queryFn: async () => {
      const res = await fetch(`/api/ioms/entity-allotments?entityId=${encodeURIComponent(id!)}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load allotments");
      return res.json();
    },
  });

  const [mapYardIds, setMapYardIds] = useState<string[]>([]);
  const [unmapTarget, setUnmapTarget] = useState<MappedYard | null>(null);
  const [unmapReason, setUnmapReason] = useState("");
  const [unmapEffectiveTo, setUnmapEffectiveTo] = useState(() => localCalendarYmd());

  const { data: allPremisesAssets = [] } = useQuery<AssetRef[]>({
    queryKey: ["/api/ioms/assets"],
  });
  const assetDisplayById = useMemo(() => buildAssetDisplayByRowId(allPremisesAssets), [allPremisesAssets]);

  const [manageRow, setManageRow] = useState<Allotment | null>(null);
  const [mAllotmentDate, setMAllotmentDate] = useState("");
  const [mAllotmentRefNo, setMAllotmentRefNo] = useState("");
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
  const [pendingTenancyStatus, setPendingTenancyStatus] = useState<string | null>(null);
  const [tenancyConfirmOpen, setTenancyConfirmOpen] = useState(false);
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
    setMAllotmentDate(r.allotmentDate?.slice(0, 10) ?? localCalendarYmd());
    setMAllotmentRefNo(r.premisesRefNo ?? "");
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

  const mapLocationsMutation = useMutation({
    mutationFn: async (yardIdsToAdd: string[]) => {
      const res = await fetch(`/api/ioms/entities/${encodeURIComponent(id!)}/location-mappings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ yardIds: yardIdsToAdd }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? res.statusText);
      }
      return (await res.json()) as Entity;
    },
    onSuccess: (row) => {
      queryClient.setQueryData(["/api/ioms/entities", id], row);
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/entities"] });
      setMapYardIds([]);
      toast({ title: "Locations mapped" });
    },
    onError: (e: Error) => toast({ title: "Map failed", description: e.message, variant: "destructive" }),
  });

  const unmapLocationMutation = useMutation({
    mutationFn: async (vars: { yardId: string; reason: string; effectiveTo: string }) => {
      const res = await fetch(
        `/api/ioms/entities/${encodeURIComponent(id!)}/location-mappings/${encodeURIComponent(vars.yardId)}/unmap`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ reason: vars.reason, effectiveTo: vars.effectiveTo || null }),
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? res.statusText);
      }
      return (await res.json()) as Entity;
    },
    onSuccess: (row) => {
      queryClient.setQueryData(["/api/ioms/entities", id], row);
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/entities"] });
      setUnmapTarget(null);
      setUnmapReason("");
      toast({ title: "Location unmapped", description: "Existing allotments at that location remain valid." });
    },
    onError: (e: Error) => toast({ title: "Unmap failed", description: e.message, variant: "destructive" }),
  });

  const setEntityStatusMutation = useMutation({
    mutationFn: async (status: string) => {
      const res = await fetch(`/api/ioms/entities/${encodeURIComponent(id!)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          (err as { message?: string; error?: string }).message ??
            (err as { error?: string }).error ??
            res.statusText,
        );
      }
      return (await res.json()) as Entity;
    },
    onSuccess: (row) => {
      queryClient.setQueryData(["/api/ioms/entities", id], row);
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/entities"] });
      setEditStatus(row.status);
      toast({
        title: row.status === "Inactive" ? "Entity marked inactive" : "Entity reactivated",
        description:
          row.status === "Inactive"
            ? "Retained for historical reference; excluded from active operations."
            : undefined,
      });
    },
    onError: (e: Error) => toast({ title: "Status update failed", description: e.message, variant: "destructive" }),
  });

  const deleteEntityMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/ioms/entities/${encodeURIComponent(id!)}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          (err as { message?: string; error?: string }).message ??
            (err as { error?: string }).error ??
            res.statusText,
        );
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/entities"] });
      setConfirmDelete(false);
      toast({ title: "Entity deleted" });
      setLocation("/traders/entities");
    },
    onError: (e: Error) => toast({ title: "Delete not allowed", description: e.message, variant: "destructive" }),
  });

  const invalidateAllocs = () => {
    queryClient.invalidateQueries({ queryKey: [`/api/ioms/entity-allotments?entityId=${encodeURIComponent(id!)}`] });
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

  const allotmentRows = useMemo((): Record<string, unknown>[] => {
    return allotments.map((a) => {
      const appr = String(a.approvalStatus ?? "Draft");
      return {
        id: a.id,
        approvalStatus: appr,
        assetDisplay: formatPremisesAssetLabel(a.assetId, assetDisplayById, a.premisesRefNo),
        allotteeName: a.allotteeName,
        fromDate: a.fromDate,
        toDate: a.toDate,
        status: a.status,
        monthlyRent: formatAllocationMoney(a.monthlyRent),
        securityDeposit: formatAllocationMoney(a.securityDeposit),
        premisesRef: a.premisesRefNo?.trim() ? a.premisesRefNo : "—",
        _approval: allocationApprovalBadge(appr),
        _tenancy: allocationTenancyBadge(a.status),
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
                <div>
                  <span className="text-muted-foreground">Home yard:</span> {yardDisplayName}
                </div>
                <div className="md:col-span-2">
                  <span className="text-muted-foreground">Mapped locations:</span>{" "}
                  {activeMappedYards.length
                    ? activeMappedYards.map((m) => m.yardName || m.yardCode || getYardName(m.yardId)).join(", ")
                    : yardDisplayName}
                </div>
                <div><span className="text-muted-foreground">Mobile:</span> {entity.mobile ?? "—"}</div>
                <div>
                  <span className="text-muted-foreground">Status:</span>{" "}
                  <Badge variant={entity.status === "Active" ? "default" : entity.status === "Blocked" ? "destructive" : "secondary"}>
                    {entity.status}
                  </Badge>
                </div>
                <div><span className="text-muted-foreground">PAN:</span> {entity.pan ?? "—"}</div>
                <div className="md:col-span-2"><span className="text-muted-foreground">GSTIN:</span> {entity.gstin ?? "—"}</div>
                <div className="md:col-span-3 break-all"><span className="text-muted-foreground">Email:</span> {entity.email ?? "—"}</div>
                <div className="md:col-span-3"><span className="text-muted-foreground">Address:</span>{" "}
                  <span className="whitespace-pre-wrap">{entity.address?.trim() ? entity.address : "—"}</span>
                </div>
              </div>
              {(canUpdate || canDelete) && (
                <div className="rounded-md border p-3 space-y-2">
                  <p className="text-sm font-medium">Deletion and deactivation</p>
                  <p className="text-xs text-muted-foreground">
                    Delete only when no receipt or other transaction is linked. If the entity has permanently vacated,
                    mark Inactive to keep history while excluding it from active operations.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {canUpdate && entity.status === "Active" ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={setEntityStatusMutation.isPending}
                        onClick={() => setEntityStatusMutation.mutate("Inactive")}
                      >
                        {setEntityStatusMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Mark inactive"}
                      </Button>
                    ) : null}
                    {canUpdate && entity.status === "Inactive" ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={setEntityStatusMutation.isPending}
                        onClick={() => setEntityStatusMutation.mutate("Active")}
                      >
                        {setEntityStatusMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Reactivate"}
                      </Button>
                    ) : null}
                    {canDelete ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        disabled={deleteEntityMutation.isPending}
                        onClick={() => setConfirmDelete(true)}
                      >
                        Delete entity
                      </Button>
                    ) : null}
                  </div>
                  {canDelete && deletionCheck && !deletionCheck.canDelete ? (
                    <p className="text-xs text-amber-800 dark:text-amber-200">
                      Linked records prevent delete
                      {deletionCheck.links
                        ? `: ${Object.entries(deletionCheck.links)
                            .filter(([, n]) => Number(n) > 0)
                            .map(([k, n]) => `${k}=${n}`)
                            .join(", ")}`
                        : ""}
                      . Use Mark inactive instead.
                    </p>
                  ) : null}
                </div>
              )}
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
                        <Link
                          className="text-primary font-medium hover:underline"
                          href={`/rent/ioms?unifiedEntityId=${encodeURIComponent(unifiedEntityIdFromTrackB(entity.id))}`}
                        >
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
            <CardHeader>
              <CardTitle>Mapped locations</CardTitle>
              <p className="text-sm text-muted-foreground">
                Map this Entity to one or more locations. Premises allotment is available only for Active mappings.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                {activeMappedYards.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No active location mappings.</p>
                ) : (
                  activeMappedYards.map((m) => (
                    <div
                      key={m.yardId}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
                    >
                      <div>
                        <span className="font-medium">{m.yardName || m.yardCode || getYardName(m.yardId)}</span>
                        {m.yardId === entity.yardId ? (
                          <Badge variant="secondary" className="ml-2">
                            Home
                          </Badge>
                        ) : null}
                        <Badge className="ml-2">Active</Badge>
                      </div>
                      {canUpdate && activeMappedYards.length > 1 ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setUnmapTarget(m);
                            setUnmapReason("");
                            setUnmapEffectiveTo(localCalendarYmd());
                          }}
                        >
                          Unmap
                        </Button>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
              {inactiveMappedYards.length > 0 ? (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">Previously unmapped</p>
                  {inactiveMappedYards.map((m) => (
                    <div key={`inact-${m.yardId}`} className="text-xs text-muted-foreground">
                      {m.yardName || m.yardCode || getYardName(m.yardId)}
                      {m.unmappedReason ? ` — ${m.unmappedReason}` : ""}
                      {m.effectiveTo ? ` (to ${m.effectiveTo})` : ""}
                    </div>
                  ))}
                </div>
              ) : null}
              {canUpdate && addableYards.length > 0 ? (
                <div className="rounded-md border p-3 space-y-2">
                  <p className="text-sm font-medium">Add location mapping</p>
                  <div className="max-h-36 overflow-y-auto space-y-2">
                    {addableYards.map((y) => {
                      const checked = mapYardIds.includes(y.id);
                      return (
                        <label key={y.id} className="flex items-center gap-2 text-sm cursor-pointer">
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(c) => {
                              setMapYardIds((prev) =>
                                c === true ? [...prev, y.id] : prev.filter((x) => x !== y.id),
                              );
                            }}
                          />
                          <span>{y.name}</span>
                        </label>
                      );
                    })}
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    disabled={mapLocationsMutation.isPending || mapYardIds.length === 0}
                    onClick={() => mapLocationsMutation.mutate(mapYardIds)}
                  >
                    {mapLocationsMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      "Map selected"
                    )}
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card className="mt-6">
            <CardHeader className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
              <div>
                <CardTitle>Premises allocations ({allotments.length})</CardTitle>
                <p className="text-sm text-muted-foreground">
                  <strong>Add allotment</strong> opens the New Premises Allotment workflow so several vacant premises can
                  share one agreement. DO drafts with rent and dates; DV verifies once the agreement copy (PDF) is
                  uploaded; DA approves and assigns the premises reference.
                </p>
              </div>
              {canCreate && entity.status === "Active" && activeMappedYards.length > 0 && (
                <Button size="sm" variant="outline" asChild>
                  <Link
                    href={`/assets/agreements/new?track=TrackB&refId=${encodeURIComponent(id!)}&yardId=${encodeURIComponent(
                      activeMappedYards.find((m) => m.yardId === entity.yardId)?.yardId ||
                        activeMappedYards[0]?.yardId ||
                        "",
                    )}&returnTo=${encodeURIComponent(`/traders/entities/${id!}`)}`}
                    title="Open New Premises Allotment (multi-premises under one agreement)"
                  >
                    <Plus className="h-4 w-4 mr-1" /> Add allotment
                  </Link>
                </Button>
              )}
            </CardHeader>
            <CardContent>
              <ClientDataGrid
                columns={PREMISES_ALLOCATION_COLUMNS}
                sourceRows={allotmentRows}
                searchKeys={PREMISES_ALLOCATION_SEARCH_KEYS}
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
                  {formatPremisesAssetLabel(manageRow.assetId, assetDisplayById, manageRow.premisesRefNo)}
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
                      <Input value={entity?.name ?? manageRow.allotteeName ?? ""} readOnly className="bg-muted/50" />
                    </div>
                    <div className="space-y-1">
                      <Label>Allotment date</Label>
                      <Input type="date" value={mAllotmentDate} onChange={(e) => setMAllotmentDate(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label>Allotment reference no.</Label>
                      <Input value={mAllotmentRefNo} onChange={(e) => setMAllotmentRefNo(e.target.value)} />
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
                      <Label>Monthly Rent (Rs.)</Label>
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
                          Number(mRent) <= 0
                        }
                        onClick={() =>
                          patchAllotMutation.mutate({
                            allocId: manageRow.id,
                            body: {
                              allotmentDate: mAllotmentDate,
                              premisesRefNo: mAllotmentRefNo.trim() || null,
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
                    <Label>Upload Agreement Copy (PDF)</Label>
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
                        }
                        if (tenancyStatusChangeNeedsConfirm(cur, v)) {
                          setPendingTenancyStatus(v);
                          setTenancyConfirmOpen(true);
                          return;
                        }
                        if (v === "Vacated") {
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

              <TenancyVacateConfirmDialog
                open={tenancyConfirmOpen}
                onOpenChange={(o) => {
                  setTenancyConfirmOpen(o);
                  if (!o) setPendingTenancyStatus(null);
                }}
                allotteeName={entity?.name ?? manageRow.allotteeName ?? ""}
                premisesName={formatPremisesAssetLabel(manageRow.assetId, assetDisplayById, manageRow.premisesRefNo)}
                loading={patchAllotMutation.isPending}
                onConfirm={() => {
                  const v = pendingTenancyStatus;
                  if (!v || !manageRow) return;
                  if (v === "Vacated") {
                    patchAllotMutation.mutate(
                      { allocId: manageRow.id, body: { status: v, toDate: tenancyVacateOn } },
                      {
                        onSettled: () => {
                          setTenancyConfirmOpen(false);
                          setPendingTenancyStatus(null);
                        },
                      },
                    );
                  } else {
                    patchAllotMutation.mutate(
                      { allocId: manageRow.id, body: { status: v } },
                      {
                        onSettled: () => {
                          setTenancyConfirmOpen(false);
                          setPendingTenancyStatus(null);
                        },
                      },
                    );
                  }
                }}
              />
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={unmapTarget != null}
        onOpenChange={(o) => {
          if (!o) setUnmapTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Unmap location</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Unmap{" "}
              <span className="font-medium text-foreground">
                {unmapTarget?.yardName || unmapTarget?.yardCode || getYardName(unmapTarget?.yardId)}
              </span>
              . Existing allotments at this location remain valid; fresh allotment will not be allowed until remapped.
            </p>
            <div className="space-y-1">
              <Label>Effective to</Label>
              <Input
                type="date"
                value={unmapEffectiveTo}
                onChange={(e) => setUnmapEffectiveTo(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Reason *</Label>
              <Textarea
                value={unmapReason}
                onChange={(e) => setUnmapReason(e.target.value)}
                rows={2}
                placeholder="Reason for unmapping"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setUnmapTarget(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={unmapLocationMutation.isPending || !unmapReason.trim() || !unmapTarget}
              onClick={() => {
                if (!unmapTarget) return;
                unmapLocationMutation.mutate({
                  yardId: unmapTarget.yardId,
                  reason: unmapReason.trim(),
                  effectiveTo: unmapEffectiveTo,
                });
              }}
            >
              {unmapLocationMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Unmap"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete entity permanently?</AlertDialogTitle>
            <AlertDialogDescription>
              {entity
                ? `Delete ${entity.entityCode ?? entity.id} (${entity.name}) only if no receipt or other transaction is linked. Prefer Mark inactive when the occupant has vacated but history must be kept.`
                : null}
              {deletionCheck && !deletionCheck.canDelete
                ? " Linked transactions were found — delete will be rejected; mark Inactive instead."
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteEntityMutation.isPending || (deletionCheck != null && !deletionCheck.canDelete)}
              onClick={(e) => {
                e.preventDefault();
                deleteEntityMutation.mutate();
              }}
            >
              {deleteEntityMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}

