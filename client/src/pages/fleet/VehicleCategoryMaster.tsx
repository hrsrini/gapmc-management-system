import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ClientDataGrid } from "@/components/reports/ClientDataGrid";
import type { ReportTableColumn } from "@/components/reports/ReportDataTable";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { Truck, Plus, Pencil, AlertCircle } from "lucide-react";

interface VehicleCategoryRow {
  id: string;
  name: string;
  capacityKg?: number | null;
  manufacturerCompany?: string | null;
  status: string;
}

export default function VehicleCategoryMaster() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { can } = useAuth();
  const canRead = can("M-07", "Read");
  const canCreate = can("M-07", "Create");
  const canUpdate = can("M-07", "Update");

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [capacityKg, setCapacityKg] = useState("");
  const [manufacturerCompany, setManufacturerCompany] = useState("");
  const [status, setStatus] = useState("Active");

  const listUrl = "/api/ioms/fleet/vehicle-categories?includeInactive=1";
  const { data: list = [], isLoading, isError } = useQuery<VehicleCategoryRow[]>({
    queryKey: [listUrl],
    enabled: canRead,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: [listUrl] });
    queryClient.invalidateQueries({ queryKey: ["/api/ioms/fleet/vehicle-categories"] });
    queryClient.invalidateQueries({ queryKey: ["/api/ioms/reference/vehicle-categories"] });
  };

  const resetForm = () => {
    setEditingId(null);
    setName("");
    setCapacityKg("");
    setManufacturerCompany("");
    setStatus("Active");
  };

  const formError = useMemo(() => {
    if (!name.trim()) return "Vehicle Category (Make/Model) is required.";
    if (capacityKg.trim()) {
      const n = Number(capacityKg);
      if (!Number.isFinite(n) || n < 0) return "Capacity (Kg) must be a non-negative number.";
    }
    return null;
  }, [name, capacityKg]);

  const createMutation = useMutation({
    mutationFn: async () => {
      if (formError) throw new Error(formError);
      const res = await fetch("/api/ioms/fleet/vehicle-categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: name.trim(),
          capacityKg: capacityKg.trim() ? Number(capacityKg) : null,
          manufacturerCompany: manufacturerCompany.trim() || null,
          status,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText);
      return data;
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "Vehicle category created" });
      setOpen(false);
      resetForm();
    },
    onError: (e: Error) => toast({ title: "Create failed", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async (id: string) => {
      if (formError) throw new Error(formError);
      const res = await fetch(`/api/ioms/fleet/vehicle-categories/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: name.trim(),
          capacityKg: capacityKg.trim() ? Number(capacityKg) : null,
          manufacturerCompany: manufacturerCompany.trim() || null,
          status,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText);
      return data;
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "Vehicle category updated" });
      setOpen(false);
      resetForm();
    },
    onError: (e: Error) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  const openCreate = () => {
    resetForm();
    setOpen(true);
  };

  const openEdit = useCallback((row: VehicleCategoryRow) => {
    setEditingId(row.id);
    setName(row.name ?? "");
    setCapacityKg(row.capacityKg != null && Number.isFinite(Number(row.capacityKg)) ? String(row.capacityKg) : "");
    setManufacturerCompany(row.manufacturerCompany ?? "");
    setStatus(row.status === "Inactive" ? "Inactive" : "Active");
    setOpen(true);
  }, []);

  const columns = useMemo((): ReportTableColumn[] => {
    const base: ReportTableColumn[] = [
      { key: "name", header: "Vehicle Category (Make/Model)" },
      { key: "capacityKg", header: "Capacity (Kg)" },
      { key: "manufacturerCompany", header: "Manufacturer Company" },
      { key: "_status", header: "Status", sortField: "status" },
    ];
    if (canUpdate) base.push({ key: "_actions", header: "Actions" });
    return base;
  }, [canUpdate]);

  const sourceRows = useMemo((): Record<string, unknown>[] => {
    return list.map((row) => {
      const out: Record<string, unknown> = {
        id: row.id,
        name: row.name,
        capacityKg: row.capacityKg != null ? row.capacityKg : "—",
        manufacturerCompany: row.manufacturerCompany?.trim() || "—",
        status: row.status,
        _status: (
          <Badge variant={row.status === "Active" ? "default" : "secondary"}>{row.status}</Badge>
        ),
      };
      if (canUpdate) {
        out._actions = (
          <Button size="sm" variant="outline" onClick={() => openEdit(row)}>
            <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
          </Button>
        );
      }
      return out;
    });
  }, [list, canUpdate, openEdit]);

  if (!canRead) {
    return (
      <AppShell breadcrumbs={[{ label: "Fleet", href: "/fleet" }, { label: "Vehicle categories" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">You do not have permission to view vehicle categories.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "Fleet", href: "/fleet" }, { label: "Vehicle categories" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Failed to load vehicle categories.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  const saving = createMutation.isPending || updateMutation.isPending;

  return (
    <AppShell breadcrumbs={[{ label: "Fleet", href: "/fleet" }, { label: "Vehicle categories" }]}>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Truck className="h-5 w-5" />
              Vehicle Category (Make/Model) Master
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Maintain Make/Model entries for dropdowns (capacity and manufacturer). Inactive rows are hidden from
              selection lists.
            </p>
          </div>
          {canCreate && (
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4 mr-1" /> Add category
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
              searchKeys={["name", "capacityKg", "manufacturerCompany", "status"]}
              searchPlaceholder="Search vehicle categories…"
              defaultSortKey="name"
              defaultSortDir="asc"
              emptyMessage="No vehicle categories yet."
            />
          )}
        </CardContent>
      </Card>

      <Dialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) resetForm();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit vehicle category" : "Add vehicle category"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {formError && <p className="text-sm text-destructive">{formError}</p>}
            <div className="space-y-1">
              <Label>Vehicle Category (Make/Model) *</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Tata Ace Gold"
              />
            </div>
            <div className="space-y-1">
              <Label>Capacity (Kg)</Label>
              <Input
                type="number"
                min={0}
                step={1}
                value={capacityKg}
                onChange={(e) => setCapacityKg(e.target.value)}
                placeholder="e.g. 750"
              />
            </div>
            <div className="space-y-1">
              <Label>Manufacturer Company</Label>
              <Input
                value={manufacturerCompany}
                onChange={(e) => setManufacturerCompany(e.target.value)}
                placeholder="e.g. Tata Motors"
              />
            </div>
            <div className="space-y-1">
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Active">Active</SelectItem>
                  <SelectItem value="Inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button
              disabled={saving || formError !== null}
              onClick={() => {
                if (editingId) updateMutation.mutate(editingId);
                else createMutation.mutate();
              }}
            >
              {saving ? "Saving…" : editingId ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
