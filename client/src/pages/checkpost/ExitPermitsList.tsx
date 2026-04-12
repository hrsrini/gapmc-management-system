import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ClientDataGrid } from "@/components/reports/ClientDataGrid";
import type { ReportTableColumn } from "@/components/reports/ReportDataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { FileCheck, AlertCircle, Plus, Pencil } from "lucide-react";

interface ExitPermit {
  id: string;
  permitNo: string;
  inwardId: string;
  issuedDate: string;
  officerId: string;
}

export default function ExitPermitsList() {
  const { can } = useAuth();
  const canCreate = can("M-04", "Create");
  const canUpdate = can("M-04", "Update");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState("");
  const [permitNo, setPermitNo] = useState("");
  const [inwardId, setInwardId] = useState("");
  const [issuedDate, setIssuedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [officerId, setOfficerId] = useState("");

  const { data: list, isLoading, isError } = useQuery<ExitPermit[]>({
    queryKey: ["/api/ioms/checkpost/exit-permits"],
  });
  const { data: inwards = [] } = useQuery<Array<{ id: string; entryNo?: string | null }>>({
    queryKey: ["/api/ioms/checkpost/inward"],
  });
  const inwardIds = useMemo(() => new Set(inwards.map((i) => i.id)), [inwards]);
  const inwardById = useMemo(() => new Map(inwards.map((i) => [i.id, i])), [inwards]);
  const formError = useMemo(() => {
    if (!permitNo.trim()) return "Permit no is required.";
    if (!inwardId.trim()) return "Inward ID is required.";
    if (!inwardIds.has(inwardId.trim())) return "Inward ID is invalid.";
    if (!issuedDate.trim()) return "Issued date is required.";
    if (!officerId.trim()) return "Officer ID is required.";
    return null;
  }, [permitNo, inwardId, inwardIds, issuedDate, officerId]);

  const createMutation = useMutation({
    mutationFn: async () => {
      if (formError) throw new Error(formError);
      const res = await fetch("/api/ioms/checkpost/exit-permits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ permitNo, inwardId, issuedDate, officerId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/checkpost/exit-permits"] });
      toast({ title: "Exit permit created" });
      setOpen(false);
      setPermitNo("");
      setInwardId("");
      setIssuedDate(new Date().toISOString().slice(0, 10));
      setOfficerId("");
    },
    onError: (e: Error) => toast({ title: "Create failed", description: e.message, variant: "destructive" }),
  });
  const updateMutation = useMutation({
    mutationFn: async () => {
      if (formError) throw new Error(formError);
      const res = await fetch(`/api/ioms/checkpost/exit-permits/${editId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ permitNo, inwardId, issuedDate, officerId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/checkpost/exit-permits"] });
      toast({ title: "Exit permit updated" });
      setEditOpen(false);
      setEditId("");
    },
    onError: (e: Error) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });
  const openEdit = useCallback((p: ExitPermit) => {
    setEditId(p.id);
    setPermitNo(p.permitNo ?? "");
    setInwardId(p.inwardId ?? "");
    setIssuedDate(p.issuedDate ?? "");
    setOfficerId(p.officerId ?? "");
    setEditOpen(true);
  }, []);

  const columns = useMemo((): ReportTableColumn[] => {
    const base: ReportTableColumn[] = [
      { key: "permitNo", header: "Permit no" },
      { key: "inwardLabel", header: "Inward" },
      { key: "issuedDate", header: "Issued date" },
      { key: "officerId", header: "Officer" },
    ];
    if (canUpdate) base.push({ key: "_actions", header: "Actions" });
    return base;
  }, [canUpdate]);

  const sourceRows = useMemo((): Record<string, unknown>[] => {
    return (list ?? []).map((p) => ({
      id: p.id,
      permitNo: p.permitNo,
      inwardLabel: inwardById.get(p.inwardId)?.entryNo ?? p.inwardId,
      issuedDate: p.issuedDate.slice(0, 10),
      officerId: p.officerId,
      _actions: canUpdate ? (
        <Button size="sm" variant="outline" onClick={() => openEdit(p)}>
          <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
        </Button>
      ) : null,
    }));
  }, [list, inwardById, canUpdate, openEdit]);

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "Check post (M-04)", href: "/checkpost/inward" }, { label: "Exit permits" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Failed to load exit permits.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Check post (M-04)", href: "/checkpost/inward" }, { label: "Exit permits" }]}>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FileCheck className="h-5 w-5" />
              Exit permits (M-04)
            </CardTitle>
            <p className="text-sm text-muted-foreground">Permits issued against inward.</p>
          </div>
          {canCreate && (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Add permit</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Create exit permit</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  {formError && <p className="text-sm text-destructive">{formError}</p>}
                  <div className="space-y-1"><Label>Permit no</Label><Input value={permitNo} onChange={(e) => setPermitNo(e.target.value)} /></div>
                  <div className="space-y-1">
                    <Label>Inward ID</Label>
                    <Select value={inwardId || undefined} onValueChange={setInwardId}>
                      <SelectTrigger><SelectValue placeholder="Select inward entry" /></SelectTrigger>
                      <SelectContent>
                        {inwards.map((i) => (
                          <SelectItem key={i.id} value={i.id}>
                            {(i.entryNo ?? i.id).slice(0, 64)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1"><Label>Issued date</Label><Input type="date" value={issuedDate} onChange={(e) => setIssuedDate(e.target.value)} /></div>
                    <div className="space-y-1"><Label>Officer ID</Label><Input value={officerId} onChange={(e) => setOfficerId(e.target.value)} /></div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => setOpen(false)} disabled={createMutation.isPending}>Cancel</Button>
                    <Button disabled={createMutation.isPending || formError !== null} onClick={() => createMutation.mutate()}>
                      {createMutation.isPending ? "Creating..." : "Create"}
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          )}
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <ClientDataGrid
              columns={columns}
              sourceRows={sourceRows}
              searchKeys={["permitNo", "inwardLabel", "issuedDate", "officerId"]}
              defaultSortKey="issuedDate"
              defaultSortDir="desc"
              emptyMessage="No exit permits."
            />
          )}
        </CardContent>
      </Card>
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit exit permit</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {formError && <p className="text-sm text-destructive">{formError}</p>}
            <div className="space-y-1"><Label>Permit no</Label><Input value={permitNo} onChange={(e) => setPermitNo(e.target.value)} /></div>
            <div className="space-y-1">
              <Label>Inward ID</Label>
              <Select value={inwardId || undefined} onValueChange={setInwardId}>
                <SelectTrigger><SelectValue placeholder="Select inward entry" /></SelectTrigger>
                <SelectContent>
                  {inwards.map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      {(i.entryNo ?? i.id).slice(0, 64)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1"><Label>Issued date</Label><Input type="date" value={issuedDate} onChange={(e) => setIssuedDate(e.target.value)} /></div>
              <div className="space-y-1"><Label>Officer ID</Label><Input value={officerId} onChange={(e) => setOfficerId(e.target.value)} /></div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditOpen(false)} disabled={updateMutation.isPending}>Cancel</Button>
              <Button disabled={updateMutation.isPending || formError !== null} onClick={() => updateMutation.mutate()}>
                {updateMutation.isPending ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
