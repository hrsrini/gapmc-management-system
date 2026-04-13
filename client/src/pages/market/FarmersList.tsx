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
import { Users, AlertCircle, Plus, Pencil } from "lucide-react";
import { isStrictAadhaar12Digits, parseIndianMobile10Digits, sanitizeMobile10Input } from "@shared/india-validation";

interface Farmer {
  id: string;
  name: string;
  yardId: string;
  village?: string | null;
  taluk?: string | null;
  district?: string | null;
  mobile?: string | null;
  aadhaarToken?: string | null;
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
  /** Optional capture; on edit, empty = keep stored Aadhaar. */
  const [aadhaarInput, setAadhaarInput] = useState("");

  const { data: list, isLoading, isError } = useQuery<Farmer[]>({
    queryKey: ["/api/ioms/farmers"],
  });
  const { data: yards = [] } = useQuery<Array<{ id: string; name: string; code: string }>>({
    queryKey: ["/api/yards"],
  });
  const yardById = useMemo(() => new Map(yards.map((y) => [y.id, y])), [yards]);
  const yardIds = useMemo(() => new Set(yards.map((y) => y.id)), [yards]);
  const editingFarmer = useMemo(() => list?.find((f) => f.id === editId), [list, editId]);
  const formError = useMemo(() => {
    if (!name.trim()) return "Name is required.";
    if (!yardId.trim()) return "Yard ID is required.";
    if (!yardIds.has(yardId.trim())) return "Yard ID is invalid or out of scope.";
    return null;
  }, [name, yardId, yardIds]);

  const createMutation = useMutation({
    mutationFn: async () => {
      if (formError) throw new Error(formError);
      const mobileNorm = parseIndianMobile10Digits(mobile);
      if (mobile.trim() && !mobileNorm) {
        throw new Error("Mobile must be a valid 10-digit number (digits 0–9 only, starting with 6–9).");
      }
      const aTrim = aadhaarInput.trim();
      if (aTrim && !isStrictAadhaar12Digits(aTrim)) {
        throw new Error("Aadhaar must be exactly 12 digits when entered.");
      }
      const body: Record<string, unknown> = {
        name,
        yardId,
        village,
        taluk,
        district,
        mobile: mobileNorm ?? null,
      };
      if (aTrim) body.aadhaarToken = aTrim;
      const res = await fetch("/api/ioms/farmers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/farmers"] });
      toast({ title: "Farmer created" });
      setCreateOpen(false);
      setName(""); setYardId(""); setVillage(""); setTaluk(""); setDistrict(""); setMobile(""); setAadhaarInput("");
    },
    onError: (e: Error) => toast({ title: "Create failed", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (formError) throw new Error(formError);
      const mobileNorm = parseIndianMobile10Digits(mobile);
      if (mobile.trim() && !mobileNorm) {
        throw new Error("Mobile must be a valid 10-digit number (digits 0–9 only, starting with 6–9).");
      }
      const aTrim = aadhaarInput.trim();
      if (aTrim && !isStrictAadhaar12Digits(aTrim)) {
        throw new Error("Aadhaar must be exactly 12 digits when entered.");
      }
      const body: Record<string, unknown> = {
        name,
        yardId,
        village,
        taluk,
        district,
        mobile: mobileNorm ?? null,
      };
      if (aTrim) body.aadhaarToken = aTrim;
      const res = await fetch(`/api/ioms/farmers/${editId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
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

  const openEdit = useCallback((f: Farmer) => {
    setEditId(f.id);
    setName(f.name ?? "");
    setYardId(f.yardId ?? "");
    setVillage(f.village ?? "");
    setTaluk(f.taluk ?? "");
    setDistrict(f.district ?? "");
    setMobile(sanitizeMobile10Input(f.mobile ?? ""));
    setAadhaarInput("");
    setEditOpen(true);
  }, []);

  const columns = useMemo((): ReportTableColumn[] => {
    const base: ReportTableColumn[] = [
      { key: "name", header: "Name" },
      { key: "yardName", header: "Yard" },
      { key: "village", header: "Village" },
      { key: "taluk", header: "Taluk" },
      { key: "district", header: "District" },
      { key: "mobile", header: "Mobile" },
      { key: "aadhaarToken", header: "Aadhaar (masked)" },
    ];
    if (canUpdate) base.push({ key: "_actions", header: "Actions" });
    return base;
  }, [canUpdate]);

  const sourceRows = useMemo((): Record<string, unknown>[] => {
    return (list ?? []).map((f) => {
      const row: Record<string, unknown> = {
        id: f.id,
        name: f.name,
        yardName: yardById.get(f.yardId)?.name ?? f.yardId,
        village: f.village ?? "—",
        taluk: f.taluk ?? "—",
        district: f.district ?? "—",
        mobile: f.mobile ?? "—",
        aadhaarToken: f.aadhaarToken ?? "—",
      };
      if (canUpdate) {
        row._actions = (
          <Button size="sm" variant="outline" onClick={() => openEdit(f)}>
            <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
          </Button>
        );
      }
      return row;
    });
  }, [list, yardById, canUpdate, openEdit]);

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
                    <div className="space-y-1">
                      <Label>Mobile</Label>
                      <Input
                        value={mobile}
                        onChange={(e) => setMobile(sanitizeMobile10Input(e.target.value))}
                        inputMode="numeric"
                        maxLength={10}
                        placeholder="10-digit mobile (optional)"
                        autoComplete="tel-national"
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label>Aadhaar</Label>
                    <Input
                      value={aadhaarInput}
                      onChange={(e) => setAadhaarInput(e.target.value.replace(/\D/g, "").slice(0, 12))}
                      placeholder="Optional — 12 digits"
                      inputMode="numeric"
                      maxLength={12}
                    />
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
            <ClientDataGrid
              columns={columns}
              sourceRows={sourceRows}
              searchKeys={["name", "yardName", "village", "taluk", "district", "mobile", "aadhaarToken"]}
              searchPlaceholder="Search farmers…"
              defaultSortKey="name"
              defaultSortDir="asc"
              emptyMessage="No farmers."
            />
          )}
        </CardContent>
      </Card>
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit farmer</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {formError && <p className="text-sm text-destructive">{formError}</p>}
            {editingFarmer?.aadhaarToken ? (
              <p className="text-sm text-muted-foreground rounded-md border bg-muted/40 px-3 py-2">
                Aadhaar on file (masked):{" "}
                <span className="font-mono tabular-nums text-foreground">{editingFarmer.aadhaarToken}</span>. Leave the
                field below empty to keep it; enter 12 digits only to replace.
              </p>
            ) : null}
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
              <div className="space-y-1">
                <Label>Mobile</Label>
                <Input
                  value={mobile}
                  onChange={(e) => setMobile(sanitizeMobile10Input(e.target.value))}
                  inputMode="numeric"
                  maxLength={10}
                  placeholder="10-digit mobile (optional)"
                  autoComplete="tel-national"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Aadhaar</Label>
              <Input
                value={aadhaarInput}
                onChange={(e) => setAadhaarInput(e.target.value.replace(/\D/g, "").slice(0, 12))}
                placeholder="Optional — 12 digits to replace stored Aadhaar"
                inputMode="numeric"
                maxLength={12}
              />
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
