import { useEffect, useMemo, useState } from "react";
import { useLocation, useParams } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { invalidatePremisesRegisterQueries } from "@/lib/premisesRegisterCache";
import { Building2, Loader2, AlertCircle } from "lucide-react";
import { PREMISES_STATUS_VALUES, premisesStatusLabel } from "@shared/premises-allocation";
import {
  PREMISES_LOCATION_VALUES,
  PREMISES_TYPE_VALUES,
  PROPERTY_TAX_AUTHORITY_VALUES,
  UTILITY_CONNECTION_VALUES,
  migrateLegacyPremisesType,
} from "@shared/premises-master";

interface Yard {
  id: string;
  code?: string | null;
  name?: string | null;
  type?: string | null;
}

interface Asset {
  id: string;
  assetId: string;
  yardId: string;
  assetType: string;
  premisesLocation?: string | null;
  propertyTaxAuthority?: string | null;
  houseNo?: string | null;
  electricityConnectionType?: string | null;
  contractAccountNo?: string | null;
  waterConnectionType?: string | null;
  consumerId?: string | null;
  area?: string | null;
  value?: number | null;
  fileNumber?: string | null;
  orderNumber?: string | null;
  premisesStatus?: string | null;
  isActive?: boolean | null;
}

/** Allow digits and at most one decimal point with up to two fractional digits. */
function sanitizeAreaSqmInput(raw: string): string {
  let s = raw.replace(/[^\d.]/g, "");
  const firstDot = s.indexOf(".");
  if (firstDot !== -1) {
    s = s.slice(0, firstDot + 1) + s.slice(firstDot + 1).replace(/\./g, "");
    const [intPart, decPart = ""] = s.split(".");
    s = `${intPart}.${decPart.slice(0, 2)}`;
  }
  return s;
}

function isValidAreaSqm(value: string): boolean {
  const t = value.trim();
  if (!t) return true;
  return /^\d+(\.\d{1,2})?$/.test(t);
}

export default function AssetForm() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { can } = useAuth();
  const canUpdate = can("M-02", "Update");
  const canDelete = can("M-02", "Delete");
  const queryClient = useQueryClient();
  const isEdit = !!id;
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [assetId, setAssetId] = useState("");
  const [yardId, setYardId] = useState("");
  const [assetType, setAssetType] = useState<string>("Shop");
  const [premisesLocation, setPremisesLocation] = useState("");
  const [propertyTaxAuthority, setPropertyTaxAuthority] = useState("");
  const [houseNo, setHouseNo] = useState("");
  const [area, setArea] = useState("");
  const [value, setValue] = useState("");
  const [electricityConnectionType, setElectricityConnectionType] = useState("");
  const [contractAccountNo, setContractAccountNo] = useState("");
  const [waterConnectionType, setWaterConnectionType] = useState("");
  const [consumerId, setConsumerId] = useState("");
  const [fileNumber, setFileNumber] = useState("");
  const [orderNumber, setOrderNumber] = useState("");
  const [premisesStatus, setPremisesStatus] = useState<string>("Vacant");

  const { data: yards = [] } = useQuery<Yard[]>({ queryKey: ["/api/yards"] });
  const premiseYardOptions = useMemo(() => {
    const yardRows = yards.filter((y) => y.type === "Yard");
    if (isEdit && yardId && !yardRows.some((y) => y.id === yardId)) {
      const cur = yards.find((y) => y.id === yardId);
      if (cur) return [...yardRows, cur];
    }
    return yardRows;
  }, [yards, isEdit, yardId]);
  const { data: existing, isError: assetError } = useQuery<Asset>({
    queryKey: ["/api/ioms/assets", id],
    enabled: isEdit,
    queryFn: async () => {
      const res = await fetch(`/api/ioms/assets/${id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Asset not found");
      return res.json();
    },
  });

  const { data: deletionCheck } = useQuery<{
    canDelete: boolean;
    links: Record<string, number>;
    isActive?: boolean;
  }>({
    queryKey: ["/api/ioms/assets", id, "deletion-check"],
    queryFn: async () => {
      const res = await fetch(`/api/ioms/assets/${encodeURIComponent(id!)}/deletion-check`, {
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? res.statusText);
      }
      return res.json();
    },
    enabled: isEdit && !!id && (canDelete || canUpdate),
  });

  useEffect(() => {
    if (!existing) return;
    setAssetId(existing.assetId ?? "");
    setYardId(existing.yardId ?? "");
    setAssetType(migrateLegacyPremisesType(existing.assetType));
    setPremisesLocation(existing.premisesLocation ?? "");
    setPropertyTaxAuthority(existing.propertyTaxAuthority ?? "");
    setHouseNo(existing.houseNo ?? "");
    setArea(sanitizeAreaSqmInput(existing.area ?? ""));
    setValue(existing.value != null ? String(existing.value) : "");
    setElectricityConnectionType(existing.electricityConnectionType ?? "");
    setContractAccountNo(existing.contractAccountNo ?? "");
    setWaterConnectionType(existing.waterConnectionType ?? "");
    setConsumerId(existing.consumerId ?? "");
    setFileNumber(existing.fileNumber ?? "");
    setOrderNumber(existing.orderNumber ?? "");
    const ps = String(existing.premisesStatus ?? "").trim();
    if (ps === "Active") setPremisesStatus("Vacant");
    else if (PREMISES_STATUS_VALUES.includes(ps as (typeof PREMISES_STATUS_VALUES)[number])) setPremisesStatus(ps);
    else setPremisesStatus("Vacant");
  }, [existing]);

  const createMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch("/api/ioms/assets", {
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
      invalidatePremisesRegisterQueries(queryClient);
      toast({ title: "Premises registered" });
      setLocation("/assets");
    },
    onError: (e: Error) => toast({ title: "Create failed", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch(`/api/ioms/assets/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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
      return res.json();
    },
    onSuccess: (_row, variables) => {
      invalidatePremisesRegisterQueries(queryClient);
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/assets", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/assets", id, "deletion-check"] });
      const deactivated = variables.isActive === false;
      toast({ title: deactivated ? "Premises deactivated" : "Premises updated" });
      if (deactivated) setLocation("/assets");
      else setLocation("/assets");
    },
    onError: (e: Error) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/ioms/assets/${encodeURIComponent(id!)}`, {
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
      invalidatePremisesRegisterQueries(queryClient);
      toast({ title: "Premises deleted" });
      setConfirmDelete(false);
      setLocation("/assets");
    },
    onError: (e: Error) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  const buildPayload = (): Record<string, unknown> => {
    const payload: Record<string, unknown> = {
      assetId: assetId.trim(),
      yardId,
      assetType,
      premisesLocation: premisesLocation || null,
      propertyTaxAuthority: propertyTaxAuthority || null,
      houseNo: houseNo.trim() || null,
      area: area.trim() || null,
      value: value ? Number(value) : null,
      electricityConnectionType: electricityConnectionType || null,
      contractAccountNo: contractAccountNo.trim() || null,
      waterConnectionType: waterConnectionType || null,
      consumerId: consumerId.trim() || null,
      fileNumber: fileNumber.trim() || null,
      orderNumber: orderNumber.trim() || null,
    };
    if (isEdit) payload.premisesStatus = premisesStatus;
    return payload;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!assetId.trim() || !yardId) {
      toast({ title: "Validation", description: "Premises ID and Yard are required.", variant: "destructive" });
      return;
    }
    if (!isValidAreaSqm(area)) {
      toast({
        title: "Validation",
        description: "Area (sq. meters) must be numeric with up to two decimal places.",
        variant: "destructive",
      });
      return;
    }
    const payload = buildPayload();
    if (isEdit) updateMutation.mutate(payload);
    else createMutation.mutate(payload);
  };

  const saving = createMutation.isPending || updateMutation.isPending;
  const loading = isEdit && existing === undefined && !assetError;

  if (isEdit && assetError) {
    return (
      <AppShell breadcrumbs={[{ label: "Assets", href: "/assets" }, { label: "Edit premises" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Premises not found.</span>
            <Button variant="outline" size="sm" onClick={() => setLocation("/assets")}>
              Back
            </Button>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  if (loading) {
    return (
      <AppShell breadcrumbs={[{ label: "Assets", href: "/assets" }, { label: "Edit premises" }]}>
        <Card>
          <CardContent className="p-6 flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>Loading premises…</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell
      breadcrumbs={[
        { label: "Assets", href: "/assets" },
        { label: isEdit ? "Edit premises" : "Premises master registration" },
      ]}
    >
      <Card className="max-w-4xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            {isEdit ? "Edit Premises (M-02)" : "Premises Master Registration (M-02)"}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Register a physical unit (shop, stall, godown, office, shed, etc.). Premises ID format: [LOC]/[TYPE]-[NNN].
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Premises ID *</Label>
                <Input
                  value={assetId}
                  onChange={(e) => setAssetId(e.target.value)}
                  placeholder="e.g. MGP/SHOP-001"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Yard *</Label>
                <Select value={yardId} onValueChange={setYardId} required>
                  <SelectTrigger>
                    <SelectValue placeholder="Select yard" />
                  </SelectTrigger>
                  <SelectContent>
                    {premiseYardOptions.map((y) => (
                      <SelectItem key={y.id} value={y.id}>
                        {y.name ?? y.code ?? y.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Premises type</Label>
                <Select value={assetType} onValueChange={setAssetType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {PREMISES_TYPE_VALUES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Premises location</Label>
                <Select value={premisesLocation || "__none__"} onValueChange={(v) => setPremisesLocation(v === "__none__" ? "" : v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select location" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">—</SelectItem>
                    {PREMISES_LOCATION_VALUES.map((loc) => (
                      <SelectItem key={loc} value={loc}>
                        {loc}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Premises status</Label>
                {isEdit ? (
                  <Select value={premisesStatus} onValueChange={setPremisesStatus}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PREMISES_STATUS_VALUES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {premisesStatusLabel(s)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input value="Vacant" readOnly disabled className="bg-muted" />
                )}
                <p className="text-xs text-muted-foreground">
                  Only <span className="font-medium text-foreground">Vacant</span> premises are available for new allotment.
                  New entries default to Vacant.
                </p>
              </div>
              <div className="space-y-2">
                <Label>Property Tax Authority</Label>
                <Select
                  value={propertyTaxAuthority || "__none__"}
                  onValueChange={(v) => setPropertyTaxAuthority(v === "__none__" ? "" : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select authority" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">—</SelectItem>
                    {PROPERTY_TAX_AUTHORITY_VALUES.map((a) => (
                      <SelectItem key={a} value={a}>
                        {a}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>House No.</Label>
                <Input value={houseNo} onChange={(e) => setHouseNo(e.target.value)} placeholder="Optional" />
              </div>
              <div className="space-y-2">
                <Label>Area (sq. meters)</Label>
                <Input
                  value={area}
                  onChange={(e) => setArea(sanitizeAreaSqmInput(e.target.value))}
                  inputMode="decimal"
                  placeholder="e.g. 24.50"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Rent as Per Valuation Report (Rs.)</Label>
                <Input type="number" min="0" step="0.01" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Optional" />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Electricity Connection Type</Label>
                <Select
                  value={electricityConnectionType || "__none__"}
                  onValueChange={(v) => setElectricityConnectionType(v === "__none__" ? "" : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">—</SelectItem>
                    {UTILITY_CONNECTION_VALUES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Contract Account No.</Label>
                <Input value={contractAccountNo} onChange={(e) => setContractAccountNo(e.target.value)} placeholder="Optional" />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Water Connection Type</Label>
                <Select
                  value={waterConnectionType || "__none__"}
                  onValueChange={(v) => setWaterConnectionType(v === "__none__" ? "" : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">—</SelectItem>
                    {UTILITY_CONNECTION_VALUES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Consumer ID</Label>
                <Input value={consumerId} onChange={(e) => setConsumerId(e.target.value)} placeholder="Optional" />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Admin. File Number</Label>
                <Input value={fileNumber} onChange={(e) => setFileNumber(e.target.value)} placeholder="Optional" />
              </div>
              <div className="space-y-2">
                <Label>Order number</Label>
                <Input value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} placeholder="Optional" />
              </div>
            </div>

            {isEdit && (canUpdate || canDelete) ? (
              <div className="rounded-md border p-3 space-y-2">
                <p className="text-sm font-medium">Deletion and deactivation</p>
                <p className="text-xs text-muted-foreground">
                  Delete only when no receipt, rent transaction, or allotment is linked. If history must be kept,
                  deactivate the premises so it is hidden from the register.
                </p>
                <div className="flex flex-wrap gap-2">
                  {canUpdate && existing?.isActive !== false ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={updateMutation.isPending}
                      onClick={() => updateMutation.mutate({ ...buildPayload(), isActive: false })}
                    >
                      {updateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Deactivate"}
                    </Button>
                  ) : null}
                  {canUpdate && existing?.isActive === false ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={updateMutation.isPending}
                      onClick={() => updateMutation.mutate({ ...buildPayload(), isActive: true })}
                    >
                      {updateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Reactivate"}
                    </Button>
                  ) : null}
                  {canDelete ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      disabled={deleteMutation.isPending}
                      onClick={() => setConfirmDelete(true)}
                    >
                      Delete premises
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
                    . Use Deactivate instead.
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="flex items-center gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setLocation("/assets")}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {isEdit ? "Save changes" : "Register premises"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete premises permanently?</AlertDialogTitle>
            <AlertDialogDescription>
              {existing
                ? `Delete ${existing.assetId} only if no receipt or other transaction is linked. Prefer Deactivate when history must be kept.`
                : null}
              {deletionCheck && !deletionCheck.canDelete
                ? " Linked transactions were found — delete will be rejected; deactivate instead."
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteMutation.isPending || (deletionCheck != null && !deletionCheck.canDelete)}
              onClick={(e) => {
                e.preventDefault();
                deleteMutation.mutate();
              }}
            >
              {deleteMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
