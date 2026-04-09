import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/context/AuthContext";
import { Clock, Plus, Pencil, AlertCircle, Loader2 } from "lucide-react";

interface SlaRow {
  id: string;
  workflow: string;
  hours: number;
  alertRole?: string | null;
}

export default function AdminSlaConfig() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [workflow, setWorkflow] = useState("");
  const [hours, setHours] = useState("24");
  const [alertRole, setAlertRole] = useState("");

  const { data: list = [], isLoading, isError } = useQuery<SlaRow[]>({
    queryKey: ["/api/admin/sla-config"],
  });

  const { can } = useAuth();
  const canCreate = can("M-10", "Create");
  const canUpdate = can("M-10", "Update");

  const createMutation = useMutation({
    mutationFn: async (body: { workflow: string; hours: number; alertRole?: string }) => {
      const res = await fetch("/api/admin/sla-config", {
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
      queryClient.invalidateQueries({ queryKey: ["/api/admin/sla-config"] });
      toast({ title: "SLA config added" });
      setOpen(false);
      resetForm();
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: { workflow?: string; hours?: number; alertRole?: string | null } }) => {
      const res = await fetch(`/api/admin/sla-config/${id}`, {
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
      queryClient.invalidateQueries({ queryKey: ["/api/admin/sla-config"] });
      toast({ title: "SLA config updated" });
      setEditingId(null);
      resetForm();
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const resetForm = () => {
    setWorkflow("");
    setHours("24");
    setAlertRole("");
  };

  const handleOpenAdd = () => {
    setEditingId(null);
    resetForm();
    setOpen(true);
  };

  const handleEdit = (row: SlaRow) => {
    setEditingId(row.id);
    setWorkflow(row.workflow);
    setHours(String(row.hours));
    setAlertRole(row.alertRole ?? "");
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const h = parseInt(hours, 10);
    if (editingId) {
      updateMutation.mutate({
        id: editingId,
        body: { workflow: workflow || undefined, hours: isNaN(h) ? undefined : h, alertRole: alertRole || null },
      });
    } else {
      createMutation.mutate({
        workflow: workflow || "Default",
        hours: isNaN(h) ? 24 : h,
        alertRole: alertRole || undefined,
      });
    }
  };

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "Admin", href: "/admin/locations" }, { label: "SLA config" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Failed to load SLA config.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Admin", href: "/admin/locations" }, { label: "SLA config" }]}>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              SLA config (M-10)
            </CardTitle>
            <p className="text-sm text-muted-foreground">Per-workflow SLA hours and alert recipient role.</p>
          </div>
          {canCreate && (
            <Button size="sm" onClick={handleOpenAdd}><Plus className="h-4 w-4 mr-1" /> Add</Button>
          )}
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editingId ? "Edit SLA" : "Add SLA config"}</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <Label>Workflow</Label>
                  <Input value={workflow} onChange={(e) => setWorkflow(e.target.value)} placeholder="e.g. VoucherApproval" required />
                </div>
                <div>
                  <Label>Hours</Label>
                  <Input type="number" min={1} value={hours} onChange={(e) => setHours(e.target.value)} required />
                </div>
                <div>
                  <Label>Alert role</Label>
                  <Input value={alertRole} onChange={(e) => setAlertRole(e.target.value)} placeholder="e.g. DV" />
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                    {(createMutation.isPending || updateMutation.isPending) && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    {editingId ? "Update" : "Create"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Workflow</TableHead>
                  <TableHead className="text-right">Hours</TableHead>
                  <TableHead>Alert role</TableHead>
                  <TableHead className="w-[80px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-muted-foreground text-center py-6">No SLA config. Add one above.</TableCell>
                  </TableRow>
                ) : (
                  list.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium">{row.workflow}</TableCell>
                      <TableCell className="text-right">{row.hours}</TableCell>
                      <TableCell>{row.alertRole ?? "—"}</TableCell>
                      <TableCell>
                        {canUpdate && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              handleEdit(row);
                              setOpen(true);
                            }}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
