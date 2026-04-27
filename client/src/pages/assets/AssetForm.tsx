import { useEffect, useState } from "react";
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
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Building2, Loader2, AlertCircle } from "lucide-react";

interface Yard {
  id: string;
  code?: string | null;
  name?: string | null;
}

interface Asset {
  id: string;
  assetId: string;
  yardId: string;
  assetType: string;
  complexName?: string | null;
  area?: string | null;
  plinthAreaSqft?: number | null;
  value?: number | null;
  fileNumber?: string | null;
  orderNumber?: string | null;
  isActive?: boolean | null;
}

const ASSET_TYPES = ["Shop", "Stall", "Godown", "Office", "Building"];

export default function AssetForm() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isEdit = !!id;

  const [assetId, setAssetId] = useState("");
  const [yardId, setYardId] = useState("");
  const [assetType, setAssetType] = useState("Shop");
  const [complexName, setComplexName] = useState("");
  const [area, setArea] = useState("");
  const [plinthAreaSqft, setPlinthAreaSqft] = useState("");
  const [value, setValue] = useState("");
  const [fileNumber, setFileNumber] = useState("");
  const [orderNumber, setOrderNumber] = useState("");
  const [isActive, setIsActive] = useState(true);

  const { data: yards = [] } = useQuery<Yard[]>({ queryKey: ["/api/yards"] });
  const { data: existing, isError: assetError } = useQuery<Asset>({
    queryKey: ["/api/ioms/assets", id],
    enabled: isEdit,
    queryFn: async () => {
      const res = await fetch(`/api/ioms/assets/${id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Asset not found");
      return res.json();
    },
  });

  useEffect(() => {
    if (!existing) return;
    setAssetId(existing.assetId ?? "");
    setYardId(existing.yardId ?? "");
    setAssetType(existing.assetType ?? "Shop");
    setComplexName(existing.complexName ?? "");
    setArea(existing.area ?? "");
    setPlinthAreaSqft(existing.plinthAreaSqft != null ? String(existing.plinthAreaSqft) : "");
    setValue(existing.value != null ? String(existing.value) : "");
    setFileNumber(existing.fileNumber ?? "");
    setOrderNumber(existing.orderNumber ?? "");
    setIsActive(existing.isActive !== false);
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
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/assets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/assets/vacant"] });
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
        throw new Error((err as { error?: string }).error ?? res.statusText);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/assets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/assets", id] });
      toast({ title: "Premises updated" });
      setLocation("/assets");
    },
    onError: (e: Error) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!assetId.trim() || !yardId) {
      toast({ title: "Validation", description: "Asset ID and Yard are required.", variant: "destructive" });
      return;
    }
    const payload: Record<string, unknown> = {
      assetId: assetId.trim(),
      yardId,
      assetType,
      complexName: complexName.trim() || null,
      area: area.trim() || null,
      plinthAreaSqft: plinthAreaSqft ? Number(plinthAreaSqft) : null,
      value: value ? Number(value) : null,
      fileNumber: fileNumber.trim() || null,
      orderNumber: orderNumber.trim() || null,
      isActive,
    };
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
      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            {isEdit ? "Edit Premises (M-02)" : "Premises Master Registration (M-02)"}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Register a physical unit (shop/stall/godown/office). Asset ID format: [LOC]/[TYPE]-[NNN].
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Asset ID *</Label>
                <Input
                  value={assetId}
                  onChange={(e) => setAssetId(e.target.value)}
                  placeholder="e.g. MGP/SHOP-001"
                  required
                  disabled={isEdit}
                />
              </div>
              <div className="space-y-2">
                <Label>Yard *</Label>
                <Select value={yardId} onValueChange={setYardId} required>
                  <SelectTrigger>
                    <SelectValue placeholder="Select yard" />
                  </SelectTrigger>
                  <SelectContent>
                    {yards.map((y) => (
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
                  <SelectContent>
                    {ASSET_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Complex name</Label>
                <Input value={complexName} onChange={(e) => setComplexName(e.target.value)} placeholder="Optional" />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Area</Label>
                <Input value={area} onChange={(e) => setArea(e.target.value)} placeholder="Optional" />
              </div>
              <div className="space-y-2">
                <Label>Plinth area (sqft)</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={plinthAreaSqft}
                  onChange={(e) => setPlinthAreaSqft(e.target.value)}
                  placeholder="Optional"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Valuation</Label>
                <Input type="number" min="0" step="0.01" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Optional" />
              </div>
              <div className="space-y-2 flex items-end justify-between gap-3 rounded-md border p-3">
                <div>
                  <Label>Status</Label>
                  <div className="text-sm text-muted-foreground">{isActive ? "Active" : "Inactive"}</div>
                </div>
                <Switch checked={isActive} onCheckedChange={setIsActive} />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>File number</Label>
                <Input value={fileNumber} onChange={(e) => setFileNumber(e.target.value)} placeholder="Optional" />
              </div>
              <div className="space-y-2">
                <Label>Order number</Label>
                <Input value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} placeholder="Optional" />
              </div>
            </div>

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
    </AppShell>
  );
}

