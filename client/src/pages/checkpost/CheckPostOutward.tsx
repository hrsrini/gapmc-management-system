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
import { Truck, AlertCircle, Plus, Pencil } from "lucide-react";
interface OutwardEntry {
  id: string;
  checkPostId: string;
  inwardRefId: string;
  entryDate: string;
  vehicleNumber?: string | null;
  receiptNumber?: string | null;
}

export default function CheckPostOutward() {
  const { can } = useAuth();
  const canCreate = can("M-04", "Create");
  const canUpdate = can("M-04", "Update");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState("");
  const [checkPostId, setCheckPostId] = useState("");
  const [inwardRefId, setInwardRefId] = useState("");
  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [vehicleNumber, setVehicleNumber] = useState("");
  const [receiptNumber, setReceiptNumber] = useState("");

  const { data: list, isLoading, isError } = useQuery<OutwardEntry[]>({
    queryKey: ["/api/ioms/checkpost/outward"],
  });
  const { data: checkposts = [] } = useQuery<Array<{ id: string; name: string; code: string }>>({
    queryKey: ["/api/yards"],
  });
  const { data: inwards = [] } = useQuery<Array<{ id: string; entryNo?: string | null }>>({
    queryKey: ["/api/ioms/checkpost/inward"],
  });
  const checkPostIds = useMemo(() => new Set(checkposts.map((c) => c.id)), [checkposts]);
  const checkPostById = useMemo(() => new Map(checkposts.map((c) => [c.id, c])), [checkposts]);
  const inwardIds = useMemo(() => new Set(inwards.map((i) => i.id)), [inwards]);
  const inwardById = useMemo(() => new Map(inwards.map((i) => [i.id, i])), [inwards]);
  const formError = useMemo(() => {
    if (!checkPostId.trim()) return "Check post ID is required.";
    if (!checkPostIds.has(checkPostId.trim())) return "Check post ID is invalid or out of scope.";
    if (!inwardRefId.trim()) return "Inward ref ID is required.";
    if (!inwardIds.has(inwardRefId.trim())) return "Inward ref ID is invalid.";
    if (!entryDate.trim()) return "Entry date is required.";
    return null;
  }, [checkPostId, checkPostIds, inwardRefId, inwardIds, entryDate]);

  const createMutation = useMutation({
    mutationFn: async () => {
      if (formError) throw new Error(formError);
      const res = await fetch("/api/ioms/checkpost/outward", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ checkPostId, inwardRefId, entryDate, vehicleNumber, receiptNumber }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/checkpost/outward"] });
      toast({ title: "Outward entry created" });
      setOpen(false);
      setCheckPostId("");
      setInwardRefId("");
      setEntryDate(new Date().toISOString().slice(0, 10));
      setVehicleNumber("");
      setReceiptNumber("");
    },
    onError: (e: Error) => toast({ title: "Create failed", description: e.message, variant: "destructive" }),
  });
  const updateMutation = useMutation({
    mutationFn: async () => {
      if (formError) throw new Error(formError);
      const res = await fetch(`/api/ioms/checkpost/outward/${editId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ checkPostId, inwardRefId, entryDate, vehicleNumber, receiptNumber }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/checkpost/outward"] });
      toast({ title: "Outward entry updated" });
      setEditOpen(false);
      setEditId("");
    },
    onError: (e: Error) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });
  const openEdit = useCallback((r: OutwardEntry) => {
    setEditId(r.id);
    setCheckPostId(r.checkPostId ?? "");
    setInwardRefId(r.inwardRefId ?? "");
    setEntryDate(r.entryDate ?? "");
    setVehicleNumber(r.vehicleNumber ?? "");
    setReceiptNumber(r.receiptNumber ?? "");
    setEditOpen(true);
  }, []);

  const columns = useMemo((): ReportTableColumn[] => {
    const base: ReportTableColumn[] = [
      { key: "entryDate", header: "Entry date" },
      { key: "checkPostName", header: "Check post" },
      { key: "inwardLabel", header: "Inward ref" },
      { key: "vehicleNumber", header: "Vehicle" },
      { key: "receiptNumber", header: "Receipt no" },
    ];
    if (canUpdate) base.push({ key: "_actions", header: "Actions" });
    return base;
  }, [canUpdate]);

  const sourceRows = useMemo((): Record<string, unknown>[] => {
    return (list ?? []).map((r) => ({
      id: r.id,
      entryDate: r.entryDate.slice(0, 10),
      checkPostName: checkPostById.get(r.checkPostId)?.name ?? r.checkPostId,
      inwardLabel: inwardById.get(r.inwardRefId)?.entryNo ?? r.inwardRefId,
      vehicleNumber: r.vehicleNumber ?? "—",
      receiptNumber: r.receiptNumber ?? "—",
      _actions: canUpdate ? (
        <Button size="sm" variant="outline" onClick={() => openEdit(r)}>
          <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
        </Button>
      ) : null,
    }));
  }, [list, checkPostById, inwardById, canUpdate, openEdit]);

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "Check post (M-04)", href: "/checkpost/inward" }, { label: "Outward" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Failed to load outward entries.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Check post (M-04)", href: "/checkpost/inward" }, { label: "Outward" }]}>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Truck className="h-5 w-5" />
              Check post outward (M-04)
            </CardTitle>
            <p className="text-sm text-muted-foreground">Outward entries linked to inward ref.</p>
          </div>
          {canCreate && (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Add outward</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Create outward entry</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  {formError && <p className="text-sm text-destructive">{formError}</p>}
                  <div className="space-y-1">
                    <Label>Check post</Label>
                    <Select value={checkPostId || undefined} onValueChange={setCheckPostId}>
                      <SelectTrigger><SelectValue placeholder="Select check post" /></SelectTrigger>
                      <SelectContent>
                        {checkposts.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {`${c.name} (${c.code})`.slice(0, 64)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label>Inward ref</Label>
                    <Select value={inwardRefId || undefined} onValueChange={setInwardRefId}>
                      <SelectTrigger><SelectValue placeholder="Select inward reference" /></SelectTrigger>
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
                    <div className="space-y-1"><Label>Entry date</Label><Input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} /></div>
                    <div className="space-y-1"><Label>Vehicle</Label><Input value={vehicleNumber} onChange={(e) => setVehicleNumber(e.target.value)} /></div>
                  </div>
                  <div className="space-y-1"><Label>Receipt no</Label><Input value={receiptNumber} onChange={(e) => setReceiptNumber(e.target.value)} /></div>
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
              searchKeys={["entryDate", "checkPostName", "inwardLabel", "vehicleNumber", "receiptNumber"]}
              defaultSortKey="entryDate"
              defaultSortDir="desc"
              emptyMessage="No outward entries."
            />
          )}
        </CardContent>
      </Card>
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit outward entry</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {formError && <p className="text-sm text-destructive">{formError}</p>}
            <div className="space-y-1">
              <Label>Check post</Label>
              <Select value={checkPostId || undefined} onValueChange={setCheckPostId}>
                <SelectTrigger><SelectValue placeholder="Select check post" /></SelectTrigger>
                <SelectContent>
                  {checkposts.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {`${c.name} (${c.code})`.slice(0, 64)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Inward ref</Label>
              <Select value={inwardRefId || undefined} onValueChange={setInwardRefId}>
                <SelectTrigger><SelectValue placeholder="Select inward reference" /></SelectTrigger>
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
              <div className="space-y-1"><Label>Entry date</Label><Input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} /></div>
              <div className="space-y-1"><Label>Vehicle</Label><Input value={vehicleNumber} onChange={(e) => setVehicleNumber(e.target.value)} /></div>
            </div>
            <div className="space-y-1"><Label>Receipt no</Label><Input value={receiptNumber} onChange={(e) => setReceiptNumber(e.target.value)} /></div>
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
