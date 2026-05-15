import { useCallback, useMemo, useState } from "react";
import { Link } from "wouter";
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
import { Briefcase, Plus, Pencil, AlertCircle } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface DesignationRow {
  id: string;
  code: string;
  name: string;
  hierarchyLevel: number;
  status: string;
  remarks?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export default function HrDesignationMaster() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { can } = useAuth();
  const canRead = can("M-01", "Read");
  const canUpdate = can("M-01", "Update");

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [hierarchyLevel, setHierarchyLevel] = useState("0");
  const [status, setStatus] = useState("Active");
  const [remarks, setRemarks] = useState("");

  const listUrl = "/api/hr/designations?includeInactive=1";
  const { data: list = [], isLoading, isError } = useQuery<DesignationRow[]>({
    queryKey: [listUrl],
    enabled: canRead,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: [listUrl] });
    queryClient.invalidateQueries({ queryKey: ["/api/hr/designations"] });
  };

  const resetForm = () => {
    setEditingId(null);
    setCode("");
    setName("");
    setHierarchyLevel("0");
    setStatus("Active");
    setRemarks("");
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/hr/designations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          code: code.trim(),
          name: name.trim(),
          hierarchyLevel: Number(hierarchyLevel) || 0,
          status,
          remarks: remarks.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText);
      return data;
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "Designation created" });
      setOpen(false);
      resetForm();
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/hr/designations/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          code: code.trim(),
          name: name.trim(),
          hierarchyLevel: Number(hierarchyLevel) || 0,
          status,
          remarks: remarks.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText);
      return data;
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "Designation updated" });
      setOpen(false);
      resetForm();
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const openAdd = () => {
    resetForm();
    setOpen(true);
  };

  const openEdit = useCallback((r: DesignationRow) => {
    setEditingId(r.id);
    setCode(r.code);
    setName(r.name);
    setHierarchyLevel(String(r.hierarchyLevel ?? 0));
    setStatus(r.status === "Inactive" ? "Inactive" : "Active");
    setRemarks(r.remarks ?? "");
    setOpen(true);
  }, []);

  const columns = useMemo((): ReportTableColumn[] => {
    const c: ReportTableColumn[] = [
      { key: "code", header: "Code" },
      { key: "name", header: "Title" },
      { key: "hierarchyLevel", header: "Hierarchy level", sortField: "hierarchyLevel" },
      { key: "_status", header: "Status", sortField: "statusSort" },
      { key: "remarks", header: "Remarks" },
    ];
    if (canUpdate) c.push({ key: "_actions", header: "Actions" });
    return c;
  }, [canUpdate]);

  const sourceRows = useMemo((): Record<string, unknown>[] => {
    return list.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      hierarchyLevel: r.hierarchyLevel,
      statusSort: r.status === "Active" ? 1 : 0,
      remarks: r.remarks?.trim() ? r.remarks : "—",
      _status: (
        <Badge variant="outline" className={r.status === "Active" ? "border-green-600/40 text-green-800" : ""}>
          {r.status}
        </Badge>
      ),
      _actions: canUpdate ? (
        <Button type="button" size="sm" variant="secondary" onClick={() => openEdit(r)}>
          <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
        </Button>
      ) : null,
    }));
  }, [list, canUpdate, openEdit]);

  if (!canRead) {
    return (
      <AppShell breadcrumbs={[{ label: "HR", href: "/hr/employees" }, { label: "Designation master" }]}>
        <Card className="border-destructive/30">
          <CardContent className="p-6 text-destructive">You do not have permission to view designation master (M-01 Read).</CardContent>
        </Card>
      </AppShell>
    );
  }

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "HR", href: "/hr/employees" }, { label: "Designation master" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Failed to load designations.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "HR", href: "/hr/employees" }, { label: "Designation master" }]}>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Briefcase className="h-5 w-5" />
              Designation master (M-01)
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
              Central reference for official designation titles, hierarchy level (higher = more senior for ordering and
              routing), and active/inactive status. Changes are audit-logged. Employees can be linked to a designation from
              the employee form; deactivation is blocked while any employee still references the row.
            </p>
          </div>
          {canUpdate ? (
            <Button onClick={openAdd}>
              <Plus className="h-4 w-4 mr-1" /> Add designation
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
              searchKeys={["code", "name", "hierarchyLevel", "remarks"]}
              searchPlaceholder="Search code, title, level, remarks…"
              defaultSortKey="hierarchyLevel"
              defaultSortDir="desc"
            />
          )}
          <p className="text-xs text-muted-foreground mt-4">
            Manage employee assignments under{" "}
            <Link href="/hr/employees" className="text-primary underline">
              HR → Employees
            </Link>
            .
          </p>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={(o) => {
        if (!o) {
          setOpen(false);
          resetForm();
        }
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit designation" : "Add designation"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 text-sm">
            <div className="grid gap-1">
              <Label htmlFor="dm-code">Code *</Label>
              <Input
                id="dm-code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="e.g. ASST_MGR"
                disabled={Boolean(editingId)}
              />
              <p className="text-xs text-muted-foreground">2–32 chars: A–Z, 0–9, underscore. Unique; cannot change after create.</p>
            </div>
            <div className="grid gap-1">
              <Label htmlFor="dm-name">Title *</Label>
              <Input id="dm-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Official designation title" />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="dm-level">Hierarchy level *</Label>
              <Input
                id="dm-level"
                type="number"
                min={0}
                max={9999}
                value={hierarchyLevel}
                onChange={(e) => setHierarchyLevel(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Higher number = more senior (reports and routing).</p>
            </div>
            <div className="grid gap-1">
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
            <div className="grid gap-1">
              <Label htmlFor="dm-remarks">Remarks</Label>
              <Input id="dm-remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Optional" />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => { setOpen(false); resetForm(); }}>
              Cancel
            </Button>
            {canUpdate ? (
              <Button
                disabled={createMutation.isPending || updateMutation.isPending}
                onClick={() => {
                  if (editingId) updateMutation.mutate(editingId);
                  else createMutation.mutate();
                }}
              >
                {editingId ? "Save changes" : "Create"}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
