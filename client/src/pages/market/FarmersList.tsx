import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Users, AlertCircle, Plus, Pencil } from "lucide-react";

interface Farmer {
  id: string;
  name: string;
  yardId: string;
  village?: string | null;
  taluk?: string | null;
  district?: string | null;
  mobile?: string | null;
}

export default function FarmersList() {
  const { can } = useAuth();
  const canCreate = can("M-04", "Create");
  const canUpdate = can("M-04", "Update");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState("");
  const [name, setName] = useState("");
  const [yardId, setYardId] = useState("");
  const [village, setVillage] = useState("");
  const [taluk, setTaluk] = useState("");
  const [district, setDistrict] = useState("");
  const [mobile, setMobile] = useState("");

  const { data: list, isLoading, isError } = useQuery<Farmer[]>({
    queryKey: ["/api/ioms/farmers"],
  });
  const { data: yards = [] } = useQuery<Array<{ id: string; name: string; code: string }>>({
    queryKey: ["/api/yards"],
  });
  const yardById = useMemo(() => new Map(yards.map((y) => [y.id, y])), [yards]);
  const yardIds = useMemo(() => new Set(yards.map((y) => y.id)), [yards]);
  const formError = useMemo(() => {
    if (!name.trim()) return "Name is required.";
    if (!yardId.trim()) return "Yard ID is required.";
    if (!yardIds.has(yardId.trim())) return "Yard ID is invalid or out of scope.";
    return null;
  }, [name, yardId, yardIds]);

  const createMutation = useMutation({
    mutationFn: async () => {
      if (formError) throw new Error(formError);
      const res = await fetch("/api/ioms/farmers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name, yardId, village, taluk, district, mobile }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/farmers"] });
      toast({ title: "Farmer created" });
      setCreateOpen(false);
      setName(""); setYardId(""); setVillage(""); setTaluk(""); setDistrict(""); setMobile("");
    },
    onError: (e: Error) => toast({ title: "Create failed", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (formError) throw new Error(formError);
      const res = await fetch(`/api/ioms/farmers/${editId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name, yardId, village, taluk, district, mobile }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/farmers"] });
      toast({ title: "Farmer updated" });
      setEditOpen(false);
      setEditId("");
    },
    onError: (e: Error) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  const openEdit = (f: Farmer) => {
    setEditId(f.id);
    setName(f.name ?? "");
    setYardId(f.yardId ?? "");
    setVillage(f.village ?? "");
    setTaluk(f.taluk ?? "");
    setDistrict(f.district ?? "");
    setMobile(f.mobile ?? "");
    setEditOpen(true);
  };

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "Market (IOMS)", href: "/market/commodities" }, { label: "Farmers" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Failed to load farmers.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Market (IOMS)", href: "/market/commodities" }, { label: "Farmers" }]}>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Farmer registry (M-04)
            </CardTitle>
            <p className="text-sm text-muted-foreground">Registered farmers by yard.</p>
          </div>
          {canCreate && (
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Add farmer</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Create farmer</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  {formError && <p className="text-sm text-destructive">{formError}</p>}
                  <div className="space-y-1"><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
                  <div className="space-y-1">
                    <Label>Yard ID</Label>
                    <Select value={yardId || undefined} onValueChange={setYardId}>
                      <SelectTrigger><SelectValue placeholder="Select yard" /></SelectTrigger>
                      <SelectContent>
                        {yards.map((y) => (
                          <SelectItem key={y.id} value={y.id}>
                            {`${y.name} (${y.code})`.slice(0, 64)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1"><Label>Village</Label><Input value={village} onChange={(e) => setVillage(e.target.value)} /></div>
                    <div className="space-y-1"><Label>Taluk</Label><Input value={taluk} onChange={(e) => setTaluk(e.target.value)} /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1"><Label>District</Label><Input value={district} onChange={(e) => setDistrict(e.target.value)} /></div>
                    <div className="space-y-1"><Label>Mobile</Label><Input value={mobile} onChange={(e) => setMobile(e.target.value)} /></div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={createMutation.isPending}>Cancel</Button>
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
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Yard</TableHead>
                  <TableHead>Village</TableHead>
                  <TableHead>Taluk</TableHead>
                  <TableHead>District</TableHead>
                  <TableHead>Mobile</TableHead>
                  {canUpdate && <TableHead className="w-[100px]">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {(list ?? []).map((f) => (
                  <TableRow key={f.id}>
                    <TableCell className="font-medium">{f.name}</TableCell>
                    <TableCell>{yardById.get(f.yardId)?.name ?? f.yardId}</TableCell>
                    <TableCell>{f.village ?? "—"}</TableCell>
                    <TableCell>{f.taluk ?? "—"}</TableCell>
                    <TableCell>{f.district ?? "—"}</TableCell>
                    <TableCell>{f.mobile ?? "—"}</TableCell>
                    {canUpdate && (
                      <TableCell>
                        <Button size="sm" variant="outline" onClick={() => openEdit(f)}>
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
            <p className="text-sm text-muted-foreground py-4">No farmers.</p>
          )}
        </CardContent>
      </Card>
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit farmer</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {formError && <p className="text-sm text-destructive">{formError}</p>}
            <div className="space-y-1"><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div className="space-y-1">
              <Label>Yard ID</Label>
              <Select value={yardId || undefined} onValueChange={setYardId}>
                <SelectTrigger><SelectValue placeholder="Select yard" /></SelectTrigger>
                <SelectContent>
                  {yards.map((y) => (
                    <SelectItem key={y.id} value={y.id}>
                      {`${y.name} (${y.code})`.slice(0, 64)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1"><Label>Village</Label><Input value={village} onChange={(e) => setVillage(e.target.value)} /></div>
              <div className="space-y-1"><Label>Taluk</Label><Input value={taluk} onChange={(e) => setTaluk(e.target.value)} /></div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1"><Label>District</Label><Input value={district} onChange={(e) => setDistrict(e.target.value)} /></div>
              <div className="space-y-1"><Label>Mobile</Label><Input value={mobile} onChange={(e) => setMobile(e.target.value)} /></div>
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
