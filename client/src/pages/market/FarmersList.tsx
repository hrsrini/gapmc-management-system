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
import { useYardLabels } from "@/hooks/useYardLabels";
import { Users, AlertCircle, Plus, Pencil } from "lucide-react";
import { isStrictAadhaar12Digits, parseIndianMobile10Digits, sanitizeMobile10Input } from "@shared/india-validation";

interface Farmer {
  id: string;
  name: string;
  yardId: string;
  farmerCode?: string | null;
  krishiCardNo?: string | null;
  address?: string | null;
  village?: string | null;
  taluk?: string | null;
  district?: string | null;
  state?: string | null;
  mobile?: string | null;
  aadhaarToken?: string | null;
}

const emptyForm = () => ({
  name: "",
  yardId: "",
  farmerCode: "",
  krishiCardNo: "",
  address: "",
  village: "",
  taluk: "",
  district: "",
  state: "Goa",
  mobile: "",
  aadhaarInput: "",
});

export default function FarmersList() {
  const { can } = useAuth();
  const canCreate = can("M-04", "Create");
  const canUpdate = can("M-04", "Update");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState("");
  const [form, setForm] = useState(emptyForm);

  const setField = <K extends keyof ReturnType<typeof emptyForm>>(key: K, value: ReturnType<typeof emptyForm>[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const { data: list, isLoading, isError } = useQuery<Farmer[]>({
    queryKey: ["/api/ioms/farmers"],
  });
  const { data: yards = [] } = useQuery<Array<{ id: string; name: string; code: string }>>({
    queryKey: ["/api/yards"],
  });
  const { getYardName } = useYardLabels();
  const yardIds = useMemo(() => new Set(yards.map((y) => y.id)), [yards]);
  const editingFarmer = useMemo(() => list?.find((f) => f.id === editId), [list, editId]);

  const formError = useMemo(() => {
    if (!form.name.trim()) return "Farmer Name is required.";
    if (!form.mobile.trim()) return "Mobile No. is required.";
    if (!parseIndianMobile10Digits(form.mobile)) {
      return "Mobile No. must be a valid 10-digit number (digits 0–9 only, starting with 6–9).";
    }
    if (!form.krishiCardNo.trim()) return "Krishi Card No. is required.";
    if (!form.farmerCode.trim()) return "Farmer ID is required.";
    if (!form.address.trim()) return "Address is required.";
    if (!form.village.trim()) return "Village/Town is required.";
    if (!form.taluk.trim()) return "Taluka is required.";
    if (!form.district.trim()) return "District is required.";
    if (!form.state.trim()) return "State is required.";
    if (!form.yardId.trim()) return "Yard is required.";
    if (!yardIds.has(form.yardId.trim())) return "Yard is invalid or out of scope.";
    return null;
  }, [form, yardIds]);

  const buildBody = () => {
    const mobileNorm = parseIndianMobile10Digits(form.mobile);
    if (!mobileNorm) throw new Error("Mobile No. must be a valid 10-digit number.");
    const aTrim = form.aadhaarInput.trim();
    if (aTrim && !isStrictAadhaar12Digits(aTrim)) {
      throw new Error("Aadhaar must be exactly 12 digits when entered.");
    }
    const body: Record<string, unknown> = {
      name: form.name.trim(),
      yardId: form.yardId.trim(),
      farmerCode: form.farmerCode.trim(),
      krishiCardNo: form.krishiCardNo.trim(),
      address: form.address.trim(),
      village: form.village.trim(),
      taluk: form.taluk.trim(),
      district: form.district.trim(),
      state: form.state.trim(),
      mobile: mobileNorm,
      requireFullMaster: true,
    };
    if (aTrim) body.aadhaarToken = aTrim;
    return body;
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      if (formError) throw new Error(formError);
      const body = buildBody();
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
      setForm(emptyForm());
    },
    onError: (e: Error) => toast({ title: "Create failed", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (formError) throw new Error(formError);
      const body = buildBody();
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
    setForm({
      name: f.name ?? "",
      yardId: f.yardId ?? "",
      farmerCode: f.farmerCode ?? "",
      krishiCardNo: f.krishiCardNo ?? "",
      address: f.address ?? "",
      village: f.village ?? "",
      taluk: f.taluk ?? "",
      district: f.district ?? "",
      state: f.state ?? "Goa",
      mobile: sanitizeMobile10Input(f.mobile ?? ""),
      aadhaarInput: "",
    });
    setEditOpen(true);
  }, []);

  const columns = useMemo((): ReportTableColumn[] => {
    const base: ReportTableColumn[] = [
      { key: "name", header: "Farmer Name" },
      { key: "farmerCode", header: "Farmer ID" },
      { key: "krishiCardNo", header: "Krishi Card No." },
      { key: "mobile", header: "Mobile No." },
      { key: "village", header: "Village/Town" },
      { key: "taluk", header: "Taluka" },
      { key: "district", header: "District" },
      { key: "state", header: "State" },
      { key: "yardName", header: "Yard" },
    ];
    if (canUpdate) base.push({ key: "_actions", header: "Actions" });
    return base;
  }, [canUpdate]);

  const sourceRows = useMemo((): Record<string, unknown>[] => {
    return (list ?? []).map((f) => {
      const row: Record<string, unknown> = {
        id: f.id,
        name: f.name,
        farmerCode: f.farmerCode ?? "—",
        krishiCardNo: f.krishiCardNo ?? "—",
        mobile: f.mobile ?? "—",
        village: f.village ?? "—",
        taluk: f.taluk ?? "—",
        district: f.district ?? "—",
        state: f.state ?? "—",
        yardName: getYardName(f.yardId),
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
  }, [list, getYardName, canUpdate, openEdit]);

  const farmerFields = (
    <>
      {formError && <p className="text-sm text-destructive">{formError}</p>}
      <div className="space-y-1">
        <Label>Farmer Name *</Label>
        <Input value={form.name} onChange={(e) => setField("name", e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label>Mobile No. *</Label>
          <Input
            value={form.mobile}
            onChange={(e) => setField("mobile", sanitizeMobile10Input(e.target.value))}
            inputMode="numeric"
            maxLength={10}
            placeholder="10-digit mobile"
            autoComplete="tel-national"
          />
        </div>
        <div className="space-y-1">
          <Label>Krishi Card No. *</Label>
          <Input value={form.krishiCardNo} onChange={(e) => setField("krishiCardNo", e.target.value)} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label>Farmer ID *</Label>
          <Input value={form.farmerCode} onChange={(e) => setField("farmerCode", e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>Yard *</Label>
          <Select value={form.yardId || undefined} onValueChange={(v) => setField("yardId", v)}>
            <SelectTrigger>
              <SelectValue placeholder="Select yard" />
            </SelectTrigger>
            <SelectContent>
              {yards.map((y) => (
                <SelectItem key={y.id} value={y.id}>
                  {`${y.name} (${y.code})`.slice(0, 64)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1">
        <Label>Address *</Label>
        <Input value={form.address} onChange={(e) => setField("address", e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label>Village/Town *</Label>
          <Input value={form.village} onChange={(e) => setField("village", e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>Taluka *</Label>
          <Input value={form.taluk} onChange={(e) => setField("taluk", e.target.value)} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label>District *</Label>
          <Input value={form.district} onChange={(e) => setField("district", e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>State *</Label>
          <Input value={form.state} onChange={(e) => setField("state", e.target.value)} />
        </div>
      </div>
      <div className="space-y-1">
        <Label>Aadhaar (optional)</Label>
        <Input
          value={form.aadhaarInput}
          onChange={(e) => setField("aadhaarInput", e.target.value.replace(/\D/g, "").slice(0, 12))}
          placeholder="Optional — 12 digits"
          inputMode="numeric"
          maxLength={12}
        />
      </div>
    </>
  );

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
              Farmer Master (M-04)
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Farmer Name, Mobile, Krishi Card, Farmer ID, Address, Village/Town, Taluka, District, State.
            </p>
          </div>
          {canCreate && (
            <Dialog
              open={createOpen}
              onOpenChange={(v) => {
                setCreateOpen(v);
                if (v) setForm(emptyForm());
              }}
            >
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="h-4 w-4 mr-1" /> Add farmer
                </Button>
              </DialogTrigger>
              <DialogContent className="max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Create farmer</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                  {farmerFields}
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={createMutation.isPending}>
                      Cancel
                    </Button>
                    <Button
                      disabled={createMutation.isPending || formError !== null}
                      onClick={() => createMutation.mutate()}
                    >
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
              searchKeys={["name", "farmerCode", "krishiCardNo", "mobile", "village", "taluk", "district", "state", "yardName"]}
              searchPlaceholder="Search farmers…"
              defaultSortKey="name"
              defaultSortDir="asc"
              emptyMessage="No farmers."
            />
          )}
        </CardContent>
      </Card>
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit farmer</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {editingFarmer?.aadhaarToken ? (
              <p className="text-sm text-muted-foreground rounded-md border bg-muted/40 px-3 py-2">
                Aadhaar on file (masked):{" "}
                <span className="font-mono tabular-nums text-foreground">{editingFarmer.aadhaarToken}</span>. Leave
                Aadhaar empty to keep it; enter 12 digits only to replace.
              </p>
            ) : null}
            {farmerFields}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditOpen(false)} disabled={updateMutation.isPending}>
                Cancel
              </Button>
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
