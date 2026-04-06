import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { MapPin, AlertCircle, Pencil, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";

interface Yard {
  id: string;
  name: string;
  code: string;
  type: string;
  phone?: string | null;
  mobile?: string | null;
  address?: string | null;
  isActive: boolean;
}

export default function AdminLocations() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { can } = useAuth();
  const canCreate = can("M-10", "Create");
  const canUpdate = can("M-10", "Update");

  const { data: yards, isLoading, isError } = useQuery<Yard[]>({
    queryKey: ["/api/admin/yards"],
  });

  const [open, setOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<"create" | "edit">("edit");
  const [editing, setEditing] = useState<Yard | null>(null);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [type, setType] = useState("Yard");
  const [phone, setPhone] = useState("");
  const [mobile, setMobile] = useState("");
  const [address, setAddress] = useState("");
  const [isActive, setIsActive] = useState(true);

  const openCreate = () => {
    setDialogMode("create");
    setEditing(null);
    setName("");
    setCode("");
    setType("Yard");
    setPhone("");
    setMobile("");
    setAddress("");
    setIsActive(true);
    setOpen(true);
  };

  const openEdit = (y: Yard) => {
    setDialogMode("edit");
    setEditing(y);
    setName(y.name);
    setCode(y.code);
    setType(y.type || "Yard");
    setPhone(y.phone ?? "");
    setMobile(y.mobile ?? "");
    setAddress(y.address ?? "");
    setIsActive(y.isActive);
    setOpen(true);
  };

  const createMutation = useMutation({
    mutationFn: async (body: {
      name: string;
      code: string;
      type: string;
      phone: string | null;
      mobile: string | null;
      address: string | null;
    }) => {
      const res = await fetch("/api/admin/yards", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? res.statusText);
      }
      return res.json() as Promise<Yard>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/yards"] });
      queryClient.invalidateQueries({ queryKey: ["/api/yards"] });
      toast({ title: "Location created" });
      setOpen(false);
    },
    onError: (e: Error) => toast({ title: "Create failed", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({
      id,
      body,
    }: {
      id: string;
      body: {
        name: string;
        code: string;
        type: string;
        phone: string | null;
        mobile: string | null;
        address: string | null;
        isActive: boolean;
      };
    }) => {
      const res = await fetch(`/api/admin/yards/${id}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? res.statusText);
      }
      return res.json() as Promise<Yard>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/yards"] });
      queryClient.invalidateQueries({ queryKey: ["/api/yards"] });
      toast({ title: "Location updated" });
      setOpen(false);
      setEditing(null);
    },
    onError: (e: Error) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  const submitDialog = () => {
    if (dialogMode === "create") {
      createMutation.mutate({
        name: name.trim(),
        code: code.trim(),
        type,
        phone: phone.trim() || null,
        mobile: mobile.trim() || null,
        address: address.trim() || null,
      });
      return;
    }
    if (!editing) return;
    updateMutation.mutate({
      id: editing.id,
      body: {
        name: name.trim(),
        code: code.trim(),
        type,
        phone: phone.trim() || null,
        mobile: mobile.trim() || null,
        address: address.trim() || null,
        isActive,
      },
    });
  };

  const dialogPending = createMutation.isPending || updateMutation.isPending;

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "Admin", href: "/admin/users" }, { label: "Locations" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Failed to load locations. Ensure IOMS M-10 schema is seeded.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Admin", href: "/admin/users" }, { label: "Locations (Yards & Check Posts)" }]}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5" />
            Locations
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            IOMS M-10: Yards and check posts. Seed with <code className="text-xs bg-muted px-1 rounded">npx tsx scripts/seed-ioms-m10.ts</code> if empty.
          </p>
          {canCreate && (
            <div className="pt-2">
              <Button type="button" size="sm" onClick={openCreate}>
                <Plus className="h-4 w-4 mr-2" />
                Add location
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Status</TableHead>
                  {canUpdate ? <TableHead className="w-[100px]" /> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {(yards ?? []).map((y) => (
                  <TableRow key={y.id}>
                    <TableCell className="font-mono">{y.code}</TableCell>
                    <TableCell>{y.name}</TableCell>
                    <TableCell>
                      <Badge variant={y.type === "Yard" ? "default" : y.type === "HO" ? "outline" : "secondary"}>{y.type}</Badge>
                    </TableCell>
                    <TableCell>{y.phone ?? y.mobile ?? "—"}</TableCell>
                    <TableCell>{y.isActive ? "Active" : "Inactive"}</TableCell>
                    {canUpdate ? (
                      <TableCell>
                        <Button type="button" variant="ghost" size="sm" onClick={() => openEdit(y)}>
                          <Pencil className="h-4 w-4 mr-1" />
                          Edit
                        </Button>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {!isLoading && (!yards || yards.length === 0) && (
            <p className="text-sm text-muted-foreground py-4">No locations. Run the M-10 seed script.</p>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{dialogMode === "create" ? "Add location" : "Edit location"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label htmlFor="loc-name">Name</Label>
              <Input id="loc-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="loc-code">Code</Label>
              <Input id="loc-code" value={code} onChange={(e) => setCode(e.target.value)} className="font-mono" />
            </div>
            <div className="space-y-1">
              <Label>Type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Yard">Yard</SelectItem>
                  <SelectItem value="CheckPost">CheckPost</SelectItem>
                  <SelectItem value="HO">HO</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="loc-phone">Phone</Label>
              <Input id="loc-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="loc-mobile">Mobile</Label>
              <Input id="loc-mobile" value={mobile} onChange={(e) => setMobile(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="loc-address">Address</Label>
              <Input id="loc-address" value={address} onChange={(e) => setAddress(e.target.value)} />
            </div>
            {dialogMode === "edit" ? (
              <div className="flex items-center gap-2 pt-1">
                <Checkbox id="loc-active" checked={isActive} onCheckedChange={(c) => setIsActive(c === true)} />
                <Label htmlFor="loc-active" className="font-normal cursor-pointer">
                  Active
                </Label>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground pt-1">New locations are created as active.</p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={submitDialog} disabled={dialogPending || !name.trim() || !code.trim()}>
              {dialogPending ? <Loader2 className="h-4 w-4 animate-spin" /> : dialogMode === "create" ? "Create" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
