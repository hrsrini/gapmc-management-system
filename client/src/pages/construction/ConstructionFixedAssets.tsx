import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ClientDataGrid } from "@/components/reports/ClientDataGrid";
import type { ReportTableColumn } from "@/components/reports/ReportDataTable";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Building2, AlertCircle, PlusCircle } from "lucide-react";
import { formatYmdToDisplay } from "@/lib/dateFormat";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/context/AuthContext";
import { formatInr } from "@/lib/formatInr";
import { useToast } from "@/hooks/use-toast";
import { useScopedActiveYards } from "@/hooks/useScopedActiveYards";

interface FixedAsset {
  id: string;
  yardId: string;
  assetType: string;
  description?: string | null;
  acquisitionDate: string;
  acquisitionValue: number;
  usefulLifeYears?: number | null;
  currentBookValue?: number | null;
  status: string;
  disposalDate?: string | null;
  disposalValue?: number | null;
  disposalApprovedBy?: string | null;
  worksId?: string | null;
}

const ASSET_TYPES = ["Equipment", "Furniture", "Electronics", "Vehicle", "Building", "Other"] as const;

export default function ConstructionFixedAssets() {
  const { user, can } = useAuth();
  const canCreate = can("M-08", "Create");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [yardId, setYardId] = useState("all");
  const [disposeAsset, setDisposeAsset] = useState<FixedAsset | null>(null);
  const [disposalDate, setDisposalDate] = useState("");
  const [disposalValue, setDisposalValue] = useState("");
  const roles = user?.roles?.map((r) => r.tier) ?? [];
  const canDispose = roles.includes("DA") || roles.includes("ADMIN");

  const [createOpen, setCreateOpen] = useState(false);
  const [formYardId, setFormYardId] = useState("");
  const [assetType, setAssetType] = useState<string>("Equipment");
  const [description, setDescription] = useState("");
  const [acquisitionDate, setAcquisitionDate] = useState("");
  const [acquisitionValue, setAcquisitionValue] = useState("");
  const [usefulLifeYears, setUsefulLifeYears] = useState("");
  const [currentBookValue, setCurrentBookValue] = useState("");

  const params = new URLSearchParams();
  if (yardId && yardId !== "all") params.set("yardId", yardId);
  const url = params.toString() ? `/api/ioms/fixed-assets?${params.toString()}` : "/api/ioms/fixed-assets";

  const { data: list = [], isLoading, isError } = useQuery<FixedAsset[]>({ queryKey: [url] });
  const { data: yards = [] } = useScopedActiveYards();
  const yardById = useMemo(() => new Map(yards.map((y) => [y.id, y.name ?? y.code ?? y.id])), [yards]);

  const columns = useMemo((): ReportTableColumn[] => {
    const base: ReportTableColumn[] = [
      { key: "assetType", header: "Type" },
      { key: "yardName", header: "Yard" },
      { key: "acquisitionDate", header: "Acquisition date" },
      { key: "_acquisitionValue", header: "Acquisition value", sortField: "acquisitionValue" },
      { key: "_bookValue", header: "Book value", sortField: "bookValueSort" },
      { key: "_status", header: "Status", sortField: "status" },
      { key: "disposalSummary", header: "Disposal" },
      { key: "description", header: "Description" },
    ];
    if (canDispose) base.push({ key: "_actions", header: "Actions" });
    return base;
  }, [canDispose]);

  const sourceRows = useMemo((): Record<string, unknown>[] => {
    return list.map((a) => ({
      id: a.id,
      assetType: a.assetType,
      yardName: yardById.get(a.yardId) ?? a.yardId,
      acquisitionDate: a.acquisitionDate.slice(0, 10),
      acquisitionValue: a.acquisitionValue,
      _acquisitionValue: `${formatInr(a.acquisitionValue)}`,
      bookValueSort: a.currentBookValue ?? null,
      _bookValue: a.currentBookValue != null ? `${formatInr(a.currentBookValue)}` : "—",
      status: a.status,
      _status: <Badge variant="secondary">{a.status}</Badge>,
      disposalSummary: a.disposalDate
        ? `${formatYmdToDisplay(a.disposalDate)}${a.disposalValue != null ? ` · ${formatInr(a.disposalValue)}` : ""}`
        : "—",
      description: a.description ?? "—",
      _actions:
        canDispose && a.status !== "Disposed" && !a.disposalDate ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setDisposeAsset(a);
              setDisposalDate(new Date().toISOString().slice(0, 10));
              setDisposalValue(a.currentBookValue != null ? String(a.currentBookValue) : "");
            }}
          >
            Dispose
          </Button>
        ) : null,
    }));
  }, [list, yardById, canDispose]);

  const resetCreateForm = () => {
    setFormYardId("");
    setAssetType("Equipment");
    setDescription("");
    setAcquisitionDate("");
    setAcquisitionValue("");
    setUsefulLifeYears("");
    setCurrentBookValue("");
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!formYardId) throw new Error("Yard is required");
      if (!assetType.trim()) throw new Error("Asset type is required");
      if (!acquisitionDate.trim()) throw new Error("Acquisition date is required");
      const acq = Number(acquisitionValue);
      if (!Number.isFinite(acq) || acq < 0) throw new Error("Acquisition value must be a valid amount");
      const life = usefulLifeYears.trim() === "" ? null : Number(usefulLifeYears);
      if (life != null && (!Number.isFinite(life) || life <= 0)) throw new Error("Useful life must be a positive number");
      const book = currentBookValue.trim() === "" ? acq : Number(currentBookValue);
      if (!Number.isFinite(book) || book < 0) throw new Error("Book value must be a valid amount");
      const res = await fetch("/api/ioms/fixed-assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          yardId: formYardId,
          assetType: assetType.trim(),
          description: description.trim() || null,
          acquisitionDate: acquisitionDate.trim(),
          acquisitionValue: acq,
          usefulLifeYears: life,
          currentBookValue: book,
          status: "Active",
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? res.statusText);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [url] });
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/fixed-assets"] });
      toast({ title: "Fixed asset added" });
      setCreateOpen(false);
      resetCreateForm();
    },
    onError: (e: Error) => toast({ title: "Create failed", description: e.message, variant: "destructive" }),
  });

  const disposeMutation = useMutation({
    mutationFn: async () => {
      if (!disposeAsset || !user?.id) throw new Error("Missing asset or user");
      if (!disposalDate.trim()) throw new Error("Disposal date required");
      const dv = disposalValue.trim() === "" ? null : Number(disposalValue);
      if (dv != null && Number.isNaN(dv)) throw new Error("Invalid disposal value");
      const res = await fetch(`/api/ioms/fixed-assets/${disposeAsset.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          disposalDate: disposalDate.trim(),
          disposalValue: dv,
          disposalApprovedBy: user.id,
          status: "Disposed",
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? res.statusText);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [url] });
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/fixed-assets"] });
      toast({ title: "Disposal recorded" });
      setDisposeAsset(null);
    },
    onError: (e: Error) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "Construction (M-08)", href: "/construction" }, { label: "Fixed assets" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Failed to load fixed assets.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Construction (M-08)", href: "/construction" }, { label: "Fixed assets" }]}>
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              Fixed assets
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Asset register — type, acquisition, book value, disposal. Disposal fields require DA or Admin.
            </p>
            <div className="pt-2">
              <Label>Yard</Label>
              <Select value={yardId} onValueChange={setYardId}>
                <SelectTrigger className="w-[200px] mt-1">
                  <SelectValue placeholder="All yards" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All yards</SelectItem>
                  {yards.map((y) => (
                    <SelectItem key={y.id} value={y.id}>
                      {y.name ?? y.code ?? y.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {canCreate ? (
            <Button
              type="button"
              className="shrink-0"
              onClick={() => {
                resetCreateForm();
                if (yardId !== "all") setFormYardId(yardId);
                setCreateOpen(true);
              }}
            >
              <PlusCircle className="h-4 w-4 mr-2" />
              Add asset
            </Button>
          ) : null}
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <ClientDataGrid
              columns={columns}
              sourceRows={sourceRows}
              searchKeys={["assetType", "yardName", "acquisitionDate", "disposalSummary", "description", "status"]}
              defaultSortKey="acquisitionDate"
              defaultSortDir="desc"
              isLoading={false}
              emptyMessage="No fixed assets."
              resetPageDependency={url}
            />
          )}
        </CardContent>
      </Card>

      <Dialog
        open={createOpen}
        onOpenChange={(o) => {
          setCreateOpen(o);
          if (!o) resetCreateForm();
        }}
      >
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add fixed asset</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Yard *</Label>
              <Select value={formYardId || undefined} onValueChange={setFormYardId}>
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
            <div className="space-y-1">
              <Label>Asset category / type *</Label>
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
            <div className="space-y-1">
              <Label>Name / description</Label>
              <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Acquisition date *</Label>
                <Input type="date" value={acquisitionDate} onChange={(e) => setAcquisitionDate(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Acquisition value (₹) *</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={acquisitionValue}
                  onChange={(e) => {
                    setAcquisitionValue(e.target.value);
                    if (!currentBookValue) setCurrentBookValue(e.target.value);
                  }}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Useful life (years)</Label>
                <Input
                  type="number"
                  min={1}
                  step="1"
                  value={usefulLifeYears}
                  onChange={(e) => setUsefulLifeYears(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>Current book value (₹)</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={currentBookValue}
                  onChange={(e) => setCurrentBookValue(e.target.value)}
                  placeholder="Defaults to acquisition value"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)} disabled={createMutation.isPending}>
              Cancel
            </Button>
            <Button type="button" onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
              {createMutation.isPending ? "Saving…" : "Save asset"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={disposeAsset != null} onOpenChange={(o) => !o && setDisposeAsset(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record disposal (DA)</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Disposal date</Label>
              <Input type="date" value={disposalDate} onChange={(e) => setDisposalDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Disposal value (optional)</Label>
              <Input type="number" value={disposalValue} onChange={(e) => setDisposalValue(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDisposeAsset(null)} disabled={disposeMutation.isPending}>
              Cancel
            </Button>
            <Button onClick={() => disposeMutation.mutate()} disabled={disposeMutation.isPending}>
              {disposeMutation.isPending ? "Saving..." : "Save disposal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
