import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Package, AlertCircle, Plus, Pencil } from "lucide-react";

interface Commodity {
  id: string;
  name: string;
  variety?: string | null;
  unit?: string | null;
  gradeType?: string | null;
  isActive?: boolean;
}

export default function CommoditiesList() {
  const { can } = useAuth();
  const canCreate = can("M-04", "Create");
  const canUpdate = can("M-04", "Update");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState<string>("");
  const [name, setName] = useState("");
  const [variety, setVariety] = useState("");
  const [unit, setUnit] = useState("");
  const [gradeType, setGradeType] = useState("");
  const [isActive, setIsActive] = useState(true);

  const { data: list, isLoading, isError } = useQuery<Commodity[]>({
    queryKey: ["/api/ioms/commodities"],
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/ioms/commodities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name, variety, unit, gradeType, isActive }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/commodities"] });
      toast({ title: "Commodity created" });
      setCreateOpen(false);
      setName("");
      setVariety("");
      setUnit("");
      setGradeType("");
      setIsActive(true);
    },
    onError: (e: Error) => toast({ title: "Create failed", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/ioms/commodities/${editId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name, variety, unit, gradeType, isActive }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/commodities"] });
      toast({ title: "Commodity updated" });
      setEditOpen(false);
      setEditId("");
    },
    onError: (e: Error) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  const openEdit = (c: Commodity) => {
    setEditId(c.id);
    setName(c.name ?? "");
    setVariety(c.variety ?? "");
    setUnit(c.unit ?? "");
    setGradeType(c.gradeType ?? "");
    setIsActive(c.isActive !== false);
    setEditOpen(true);
  };

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "Market (IOMS)", href: "/market/commodities" }, { label: "Commodities" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Failed to load commodities.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Market (IOMS)", href: "/market/commodities" }, { label: "Commodities" }]}>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              Commodities (IOMS M-04)
            </CardTitle>
            <p className="text-sm text-muted-foreground">Commodity master for market fee and check post.</p>
          </div>
          {canCreate && (
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Add commodity</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Create commodity</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div className="space-y-1"><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
                  <div className="space-y-1"><Label>Variety</Label><Input value={variety} onChange={(e) => setVariety(e.target.value)} /></div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1"><Label>Unit</Label><Input value={unit} onChange={(e) => setUnit(e.target.value)} /></div>
                    <div className="space-y-1"><Label>Grade type</Label><Input value={gradeType} onChange={(e) => setGradeType(e.target.value)} /></div>
                  </div>
                  <div className="flex items-center gap-2">
                    <input id="commodity-active-new" type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
                    <Label htmlFor="commodity-active-new">Active</Label>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={createMutation.isPending}>Cancel</Button>
                    <Button disabled={!name.trim() || createMutation.isPending} onClick={() => createMutation.mutate()}>
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
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Variety</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead>Grade</TableHead>
                  <TableHead>Status</TableHead>
                  {canUpdate && <TableHead className="w-[100px]">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {(list ?? []).map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell>{c.variety ?? "—"}</TableCell>
                    <TableCell>{c.unit ?? "—"}</TableCell>
                    <TableCell>{c.gradeType ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={c.isActive !== false ? "default" : "secondary"}>
                        {c.isActive !== false ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    {canUpdate && (
                      <TableCell>
                        <Button size="sm" variant="outline" onClick={() => openEdit(c)}>
                          <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {!isLoading && (!list || list.length === 0) && (
            <p className="text-sm text-muted-foreground py-4">No commodities. Fee Collection uses existing market fee entries.</p>
          )}
        </CardContent>
      </Card>
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit commodity</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1"><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div className="space-y-1"><Label>Variety</Label><Input value={variety} onChange={(e) => setVariety(e.target.value)} /></div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1"><Label>Unit</Label><Input value={unit} onChange={(e) => setUnit(e.target.value)} /></div>
              <div className="space-y-1"><Label>Grade type</Label><Input value={gradeType} onChange={(e) => setGradeType(e.target.value)} /></div>
            </div>
            <div className="flex items-center gap-2">
              <input id="commodity-active-edit" type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
              <Label htmlFor="commodity-active-edit">Active</Label>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditOpen(false)} disabled={updateMutation.isPending}>Cancel</Button>
              <Button disabled={!name.trim() || updateMutation.isPending} onClick={() => updateMutation.mutate()}>
                {updateMutation.isPending ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
