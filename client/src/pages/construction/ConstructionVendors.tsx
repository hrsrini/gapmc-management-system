import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ClientDataGrid } from "@/components/reports/ClientDataGrid";
import type { ReportTableColumn } from "@/components/reports/ReportDataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { Building2, Plus, AlertCircle } from "lucide-react";

interface Vendor {
  id: string;
  name: string;
  code?: string | null;
  gstin?: string | null;
  pan?: string | null;
  phone?: string | null;
  email?: string | null;
  status: string;
}

export default function ConstructionVendors() {
  const { can } = useAuth();
  const canCreate = can("M-08", "Create");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [gstin, setGstin] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");

  const { data: list, isLoading, isError } = useQuery<Vendor[]>({
    queryKey: ["/api/ioms/vendors"],
  });

  const createMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch("/api/ioms/vendors", {
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
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/vendors"] });
      toast({ title: "Vendor created" });
      setOpen(false);
      setName("");
      setCode("");
      setGstin("");
      setPhone("");
      setEmail("");
    },
    onError: (e: Error) => toast({ title: "Create failed", description: e.message, variant: "destructive" }),
  });

  const columns = useMemo(
    (): ReportTableColumn[] => [
      { key: "name", header: "Name" },
      { key: "code", header: "Code" },
      { key: "gstin", header: "GSTIN" },
      { key: "phone", header: "Phone" },
      { key: "_status", header: "Status", sortField: "status" },
    ],
    [],
  );

  const rows = useMemo(
    () =>
      (list ?? []).map((v) => ({
        id: v.id,
        name: v.name,
        code: v.code ?? "—",
        gstin: v.gstin ?? "—",
        phone: v.phone ?? "—",
        status: v.status,
        _status: <Badge variant={v.status === "Active" ? "default" : "secondary"}>{v.status}</Badge>,
      })),
    [list],
  );

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "Construction", href: "/construction" }, { label: "Vendors" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Failed to load vendors.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Construction", href: "/construction" }, { label: "Vendors" }]}>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              Vendor master
            </CardTitle>
            <p className="text-sm text-muted-foreground">Shared vendor list for Work Orders (AMC can use later).</p>
          </div>
          {canCreate && (
            <Button size="sm" onClick={() => setOpen(true)}>
              <Plus className="h-4 w-4 mr-1" /> Add vendor
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <ClientDataGrid
              columns={columns}
              sourceRows={rows}
              searchKeys={["name", "code", "gstin", "phone", "status"]}
              defaultSortKey="name"
              defaultSortDir="asc"
              emptyMessage="No vendors yet."
            />
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add vendor</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Name *</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <Label>Code</Label>
              <Input value={code} onChange={(e) => setCode(e.target.value)} />
            </div>
            <div>
              <Label>GSTIN</Label>
              <Input value={gstin} onChange={(e) => setGstin(e.target.value)} />
            </div>
            <div>
              <Label>Phone</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div>
              <Label>Email</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!name.trim() || createMutation.isPending}
              onClick={() =>
                createMutation.mutate({
                  name: name.trim(),
                  code: code || undefined,
                  gstin: gstin || undefined,
                  phone: phone || undefined,
                  email: email || undefined,
                })
              }
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
