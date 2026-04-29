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
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/context/AuthContext";
import { Ruler, Plus, Pencil, Trash2, AlertCircle } from "lucide-react";

interface MeasurementUnitRow {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  createdAt?: string | null;
}

export default function AdminMeasurementUnits() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { can } = useAuth();
  const canCreate = can("M-10", "Create");
  const canUpdate = can("M-10", "Update");
  const canDelete = can("M-10", "Delete");

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [sortOrder, setSortOrder] = useState("0");
  const [isActive, setIsActive] = useState(true);

  const { data: list = [], isLoading, isError } = useQuery<MeasurementUnitRow[]>({
    queryKey: ["/api/admin/measurement-units"],
  });

  const invalidateUnits = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/admin/measurement-units"] });
    queryClient.invalidateQueries({ queryKey: ["/api/ioms/measurement-units"] });
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/measurement-units", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: name.trim(),
          sortOrder: Number(sortOrder) || 0,
          isActive,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText);
      return data;
    },
    onSuccess: () => {
      invalidateUnits();
      toast({ title: "Unit created" });
      setOpen(false);
      resetForm();
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/admin/measurement-units/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: name.trim(),
          sortOrder: Number(sortOrder) || 0,
          isActive,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText);
      return data;
    },
    onSuccess: () => {
      invalidateUnits();
      toast({ title: "Unit updated" });
      setOpen(false);
      setEditingId(null);
      resetForm();
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/admin/measurement-units/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? res.statusText);
      }
    },
    onSuccess: () => {
      invalidateUnits();
      toast({ title: "Unit removed" });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const resetForm = () => {
    setName("");
    setSortOrder("0");
    setIsActive(true);
    setEditingId(null);
  };

  const openAdd = () => {
    resetForm();
    setEditingId(null);
    setOpen(true);
  };

  const openEdit = useCallback((u: MeasurementUnitRow) => {
    setEditingId(u.id);
    setName(u.name);
    setSortOrder(String(u.sortOrder ?? 0));
    setIsActive(u.isActive !== false);
    setOpen(true);
  }, []);

  const columns = useMemo((): ReportTableColumn[] => {
    const base: ReportTableColumn[] = [
      { key: "name", header: "Name" },
      { key: "sortOrder", header: "Sort order" },
      { key: "_status", header: "Status", sortField: "statusSort" },
    ];
    if (canUpdate || canDelete) base.push({ key: "_actions", header: "Actions" });
    return base;
  }, [canUpdate, canDelete]);

  const sourceRows = useMemo((): Record<string, unknown>[] => {
    return list.map((u) => {
      const active = u.isActive !== false;
      const row: Record<string, unknown> = {
        id: u.id,
        name: u.name,
        sortOrder: u.sortOrder ?? 0,
        statusSort: active ? "Active" : "Inactive",
        _status: <Badge variant={active ? "default" : "secondary"}>{active ? "Active" : "Inactive"}</Badge>,
      };
      if (canUpdate || canDelete) {
        row._actions = (
          <div className="flex gap-1">
            {canUpdate && (
              <Button size="sm" variant="outline" onClick={() => openEdit(u)}>
                <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
              </Button>
            )}
            {canDelete && (
              <Button
                size="sm"
                variant="outline"
                className="text-destructive"
                onClick={() => {
                  if (!window.confirm(`Remove unit “${u.name}”? In-use units cannot be deleted.`)) return;
                  deleteMutation.mutate(u.id);
                }}
                disabled={deleteMutation.isPending}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        );
      }
      return row;
    });
  }, [list, canUpdate, canDelete, openEdit, deleteMutation.isPending]);

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "Admin", href: "/admin/locations" }, { label: "Units master" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">
              Failed to load units. Run <code className="text-xs bg-muted px-1 rounded">npm run db:apply-m04-measurement-units</code> if the
              table is missing.
            </span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Admin", href: "/admin/locations" }, { label: "Units master" }]}>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Ruler className="h-5 w-5" />
              Units master (M-04)
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Quantity units for commodities (e.g. Kilogram, Nos, Liter). Commodity forms use this list as a dropdown.
            </p>
          </div>
          {canCreate && (
            <Button size="sm" onClick={openAdd}>
              <Plus className="h-4 w-4 mr-1" /> Add unit
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <ClientDataGrid
              columns={columns}
              sourceRows={sourceRows}
              searchKeys={["name", "sortOrder", "statusSort"]}
              searchPlaceholder="Search units…"
              defaultSortKey="sortOrder"
              defaultSortDir="asc"
              emptyMessage="No units defined."
            />
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit unit" : "Add unit"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Display name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Kilogram" />
            </div>
            <div className="space-y-1">
              <Label>Sort order</Label>
              <Input value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} type="number" />
              <p className="text-xs text-muted-foreground">Lower numbers appear first in dropdowns.</p>
            </div>
            <div className="flex items-center gap-2">
              <input id="unit-active" type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
              <Label htmlFor="unit-active">Active</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!name.trim() || createMutation.isPending || updateMutation.isPending}
              onClick={() => {
                if (editingId) updateMutation.mutate(editingId);
                else createMutation.mutate();
              }}
            >
              {editingId ? (updateMutation.isPending ? "Saving…" : "Save") : createMutation.isPending ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
