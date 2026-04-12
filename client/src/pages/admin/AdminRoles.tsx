import { useCallback, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ClientDataGrid } from "@/components/reports/ClientDataGrid";
import type { ReportTableColumn } from "@/components/reports/ReportDataTable";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
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
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/context/AuthContext";
import { Shield, AlertCircle, Plus, Pencil, Trash2, Loader2 } from "lucide-react";
import { ADMIN_403_MESSAGE } from "@/lib/queryClient";

const TIER_OPTIONS = ["DO", "DV", "DA", "READ_ONLY", "ADMIN"];

interface Role {
  id: string;
  name: string;
  tier: string;
  description?: string | null;
}

export default function AdminRoles() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [tier, setTier] = useState("DO");
  const [description, setDescription] = useState("");

  const { data: roles, isLoading, isError, error } = useQuery<Role[]>({
    queryKey: ["/api/admin/roles"],
  });

  const isAccessDenied = isError && (error instanceof Error) && (error.message.includes("403") || error.message.includes("Access denied") || error.message.includes("Insufficient"));

  const { can } = useAuth();
  const canCreate = can("M-10", "Create");
  const canUpdate = can("M-10", "Update");
  const canDelete = can("M-10", "Delete");

  const createMutation = useMutation({
    mutationFn: async (body: { name: string; tier: string; description?: string }) => {
      const res = await fetch("/api/admin/roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText);
      return data as Role;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/roles"] });
      toast({ title: "Role created" });
      setOpen(false);
      resetForm();
    },
    onError: (e: Error) => toast({ title: "Failed to create role", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: { name?: string; tier?: string; description?: string | null } }) => {
      const res = await fetch(`/api/admin/roles/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText);
      return data as Role;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/roles"] });
      toast({ title: "Role updated" });
      setOpen(false);
      setEditingId(null);
      resetForm();
    },
    onError: (e: Error) => toast({ title: "Failed to update role", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/admin/roles/${id}`, { method: "DELETE", credentials: "include" });
      if (res.status === 204) return;
      const data = await res.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error ?? res.statusText);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/roles"] });
      toast({ title: "Role deleted" });
      setDeleteId(null);
    },
    onError: (e: Error) => {
      toast({ title: "Cannot delete role", description: e.message, variant: "destructive" });
      setDeleteId(null);
    },
  });

  const resetForm = () => {
    setName("");
    setTier("DO");
    setDescription("");
  };

  const handleOpenAdd = () => {
    setEditingId(null);
    resetForm();
    setOpen(true);
  };

  const handleEdit = useCallback((r: Role) => {
    setEditingId(r.id);
    setName(r.name);
    setTier(r.tier);
    setDescription(r.description ?? "");
    setOpen(true);
  }, []);

  const roleColumns = useMemo((): ReportTableColumn[] => {
    const base: ReportTableColumn[] = [
      { key: "_tier", header: "Tier", sortField: "tier" },
      { key: "name", header: "Name" },
      { key: "description", header: "Description" },
    ];
    if (canUpdate || canDelete) base.push({ key: "_actions", header: "Actions" });
    return base;
  }, [canUpdate, canDelete]);

  const roleRows = useMemo((): Record<string, unknown>[] => {
    return (roles ?? []).map((r) => ({
      id: r.id,
      tier: r.tier,
      _tier: <Badge variant="outline">{r.tier}</Badge>,
      name: r.name,
      description: r.description ?? "—",
      _actions: (canUpdate || canDelete) ? (
        <div className="flex items-center gap-1">
          {canUpdate && (
            <Button variant="ghost" size="sm" onClick={() => handleEdit(r)} title="Edit">
              <Pencil className="h-4 w-4" />
            </Button>
          )}
          {canDelete && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDeleteId(r.id)}
              title="Delete"
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      ) : null,
    }));
  }, [roles, canUpdate, canDelete, handleEdit]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload = { name: name.trim(), tier: tier.trim(), description: description.trim() || undefined };
    if (editingId) {
      updateMutation.mutate({
        id: editingId,
        body: { ...payload, description: payload.description ?? null },
      });
    } else {
      createMutation.mutate(payload);
    }
  };

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "Admin", href: "/admin/locations" }, { label: "Roles" }]}>
        <Card className={isAccessDenied ? "bg-amber-500/10 border-amber-500/30" : "bg-destructive/10 border-destructive/20"}>
          <CardContent className="p-6 flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <AlertCircle className="h-5 w-5 shrink-0 text-destructive" />
              <span className={isAccessDenied ? "text-amber-700 dark:text-amber-400" : "text-destructive"}>
                {isAccessDenied ? ADMIN_403_MESSAGE : (error instanceof Error ? error.message : "Failed to load roles.")}
              </span>
            </div>
            {isAccessDenied && (
              <p className="text-sm text-muted-foreground">Log out and sign in as admin@gapmc.local to access this section.</p>
            )}
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Admin", href: "/admin/locations" }, { label: "Roles" }]}>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Roles
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Manage roles for RBAC. Tier values (DO, DV, DA, READ_ONLY, ADMIN) are used in workflows.
            </p>
          </div>
          {canCreate && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" onClick={handleOpenAdd}>
                <Plus className="h-4 w-4 mr-1" />
                Add role
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editingId ? "Edit role" : "Add role"}</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <Label>Name</Label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Data Originator"
                    required
                  />
                </div>
                <div>
                  <Label>Tier</Label>
                  <select
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    value={tier}
                    onChange={(e) => setTier(e.target.value)}
                    required
                  >
                    {TIER_OPTIONS.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label>Description (optional)</Label>
                  <Input
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="e.g. Creates and submits records"
                  />
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                    {(createMutation.isPending || updateMutation.isPending) && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    {editingId ? "Update" : "Create"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
          )}
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <ClientDataGrid
              columns={roleColumns}
              sourceRows={roleRows}
              searchKeys={["tier", "name", "description"]}
              defaultSortKey="tier"
              defaultSortDir="asc"
              emptyMessage="No roles. Add one above or run the M-10 seed script."
            />
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete role?</AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone. Roles that are assigned to users cannot be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
              disabled={deleteMutation.isPending}
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
