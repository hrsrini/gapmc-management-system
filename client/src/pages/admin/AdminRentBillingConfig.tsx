import { useCallback, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ClientDataGrid } from "@/components/reports/ClientDataGrid";
import type { ReportTableColumn } from "@/components/reports/ReportDataTable";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/context/AuthContext";
import { Calculator, Plus, Pencil, AlertCircle, Loader2, ArrowLeft } from "lucide-react";
import { formatYmdToDisplay } from "@/lib/dateFormat";

interface RentBillingConfigRow {
  id: string;
  effectiveFrom: string;
  prorataFactor: number;
  prorataDaysBasis: string;
  prorataFixedDays?: number | null;
  overstayFactor: number;
  overstayDaysBasis: string;
  overstayFixedDays?: number | null;
}

export default function AdminRentBillingConfig() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { can } = useAuth();
  const canCreate = can("M-10", "Create");
  const canUpdate = can("M-10", "Update");

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [prorataFactor, setProrataFactor] = useState("1");
  const [prorataDaysBasis, setProrataDaysBasis] = useState("Calendar");
  const [prorataFixedDays, setProrataFixedDays] = useState("30");
  const [overstayFactor, setOverstayFactor] = useState("2");
  const [overstayDaysBasis, setOverstayDaysBasis] = useState("Calendar");
  const [overstayFixedDays, setOverstayFixedDays] = useState("30");

  const { data: list = [], isLoading, isError } = useQuery<RentBillingConfigRow[]>({
    queryKey: ["/api/admin/rent-billing-config"],
  });

  const resetForm = () => {
    setEffectiveFrom("");
    setProrataFactor("1");
    setProrataDaysBasis("Calendar");
    setProrataFixedDays("30");
    setOverstayFactor("2");
    setOverstayDaysBasis("Calendar");
    setOverstayFixedDays("30");
  };

  const createMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch("/api/admin/rent-billing-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).message ?? (err as { error?: string }).error ?? res.statusText);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/rent-billing-config"] });
      toast({ title: "Rent billing config added" });
      setOpen(false);
      resetForm();
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: Record<string, unknown> }) => {
      const res = await fetch(`/api/admin/rent-billing-config/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).message ?? (err as { error?: string }).error ?? res.statusText);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/rent-billing-config"] });
      toast({ title: "Rent billing config updated" });
      setEditingId(null);
      setOpen(false);
      resetForm();
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const handleEdit = useCallback((row: RentBillingConfigRow) => {
    setEditingId(row.id);
    setEffectiveFrom(row.effectiveFrom.slice(0, 10));
    setProrataFactor(String(row.prorataFactor));
    setProrataDaysBasis(row.prorataDaysBasis === "Fixed" ? "Fixed" : "Calendar");
    setProrataFixedDays(row.prorataFixedDays != null ? String(row.prorataFixedDays) : "30");
    setOverstayFactor(String(row.overstayFactor));
    setOverstayDaysBasis(row.overstayDaysBasis === "Fixed" ? "Fixed" : "Calendar");
    setOverstayFixedDays(row.overstayFixedDays != null ? String(row.overstayFixedDays) : "30");
    setOpen(true);
  }, []);

  const columns = useMemo((): ReportTableColumn[] => {
    const base: ReportTableColumn[] = [
      { key: "effectiveFromDisplay", header: "Effective from", sortField: "effectiveFrom" },
      { key: "prorataFactor", header: "Prorata factor" },
      { key: "prorataDays", header: "Prorata days" },
      { key: "overstayFactor", header: "Overstay factor" },
      { key: "overstayDays", header: "Overstay days" },
    ];
    if (canUpdate) base.push({ key: "_actions", header: "Actions" });
    return base;
  }, [canUpdate]);

  const sourceRows = useMemo(
    () =>
      list.map((r) => ({
        id: r.id,
        effectiveFrom: r.effectiveFrom,
        effectiveFromDisplay: formatYmdToDisplay(r.effectiveFrom),
        prorataFactor: String(r.prorataFactor),
        prorataDays:
          r.prorataDaysBasis === "Fixed"
            ? `Fixed (${r.prorataFixedDays ?? "—"})`
            : "Calendar",
        overstayFactor: String(r.overstayFactor),
        overstayDays:
          r.overstayDaysBasis === "Fixed"
            ? `Fixed (${r.overstayFixedDays ?? "—"})`
            : "Calendar",
        _actions: canUpdate ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => handleEdit(r)}>
            <Pencil className="h-4 w-4" />
          </Button>
        ) : null,
      })),
    [list, canUpdate, handleEdit],
  );

  const submitBody = (): Record<string, unknown> => ({
    effectiveFrom,
    prorataFactor: Number(prorataFactor),
    prorataDaysBasis,
    prorataFixedDays: prorataDaysBasis === "Fixed" ? Number(prorataFixedDays) : null,
    overstayFactor: Number(overstayFactor),
    overstayDaysBasis,
    overstayFixedDays: overstayDaysBasis === "Fixed" ? Number(overstayFixedDays) : null,
  });

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "Admin", href: "/admin/locations" }, { label: "Rent billing config" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive text-sm">
              Failed to load config. Run{" "}
              <code className="text-xs bg-muted px-1 rounded">npm run db:apply-m03-rent-invoice-billing-types</code> if the
              table is missing.
            </span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Admin", href: "/admin/locations" }, { label: "Rent billing config" }]}>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Calculator className="h-5 w-5" />
              M-03 rent billing config
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Prorata and overstay factors by effective date. Invoices snapshot the active row at issue time.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href="/admin/config">
                <ArrowLeft className="h-4 w-4 mr-1" /> Default values
              </Link>
            </Button>
            {canCreate && (
              <Button
                size="sm"
                onClick={() => {
                  setEditingId(null);
                  resetForm();
                  setOpen(true);
                }}
              >
                <Plus className="h-4 w-4 mr-1" /> Add row
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <ClientDataGrid
              columns={columns}
              sourceRows={sourceRows}
              searchKeys={["effectiveFromDisplay", "prorataFactor", "overstayFactor"]}
              searchPlaceholder="Search config…"
              defaultSortKey="effectiveFrom"
              defaultSortDir="desc"
              emptyMessage="No rent billing config rows."
            />
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit rent billing config" : "Add rent billing config"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Effective from *</Label>
              <Input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Prorata factor</Label>
                <Input value={prorataFactor} onChange={(e) => setProrataFactor(e.target.value)} inputMode="decimal" />
              </div>
              <div className="space-y-1">
                <Label>Prorata days basis</Label>
                <Select value={prorataDaysBasis} onValueChange={setProrataDaysBasis}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Calendar">Calendar days</SelectItem>
                    <SelectItem value="Fixed">Fixed days</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {prorataDaysBasis === "Fixed" && (
              <div className="space-y-1">
                <Label>Prorata fixed days</Label>
                <Input value={prorataFixedDays} onChange={(e) => setProrataFixedDays(e.target.value)} inputMode="numeric" />
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Overstay factor</Label>
                <Input value={overstayFactor} onChange={(e) => setOverstayFactor(e.target.value)} inputMode="decimal" />
              </div>
              <div className="space-y-1">
                <Label>Overstay days basis</Label>
                <Select value={overstayDaysBasis} onValueChange={setOverstayDaysBasis}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Calendar">Calendar days</SelectItem>
                    <SelectItem value="Fixed">Fixed days</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {overstayDaysBasis === "Fixed" && (
              <div className="space-y-1">
                <Label>Overstay fixed days</Label>
                <Input value={overstayFixedDays} onChange={(e) => setOverstayFixedDays(e.target.value)} inputMode="numeric" />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={createMutation.isPending || updateMutation.isPending || !effectiveFrom}
              onClick={() => {
                const body = submitBody();
                if (editingId) updateMutation.mutate({ id: editingId, body });
                else createMutation.mutate(body);
              }}
            >
              {(createMutation.isPending || updateMutation.isPending) && (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              )}
              {editingId ? "Save" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
