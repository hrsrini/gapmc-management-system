import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ClientDataGrid } from "@/components/reports/ClientDataGrid";
import type { ReportTableColumn } from "@/components/reports/ReportDataTable";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Building2, AlertCircle } from "lucide-react";
import { formatYmdToDisplay } from "@/lib/dateFormat";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";

interface FixedAsset {
  id: string;
  yardId: string;
  assetType: string;
  description?: string | null;
  acquisitionDate: string;
  acquisitionValue: number;
  usefulLifeYears?: number | null;
  currentBookValue?: number | null;
  status: string;
  disposalDate?: string | null;
  disposalValue?: number | null;
  disposalApprovedBy?: string | null;
  worksId?: string | null;
}
interface Yard {
  id: string;
  code?: string | null;
  name?: string | null;
}

export default function ConstructionFixedAssets() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [yardId, setYardId] = useState("all");
  const [disposeAsset, setDisposeAsset] = useState<FixedAsset | null>(null);
  const [disposalDate, setDisposalDate] = useState("");
  const [disposalValue, setDisposalValue] = useState("");
  const roles = user?.roles?.map((r) => r.tier) ?? [];
  const canDispose = roles.includes("DA") || roles.includes("ADMIN");

  const params = new URLSearchParams();
  if (yardId && yardId !== "all") params.set("yardId", yardId);
  const url = params.toString() ? `/api/ioms/fixed-assets?${params.toString()}` : "/api/ioms/fixed-assets";

  const { data: list = [], isLoading, isError } = useQuery<FixedAsset[]>({ queryKey: [url] });
  const { data: yards = [] } = useQuery<Yard[]>({ queryKey: ["/api/yards"] });
  const yardById = useMemo(() => new Map(yards.map((y) => [y.id, y.name ?? y.code ?? y.id])), [yards]);

  const columns = useMemo((): ReportTableColumn[] => {
    const base: ReportTableColumn[] = [
      { key: "assetType", header: "Type" },
      { key: "yardName", header: "Yard" },
      { key: "acquisitionDate", header: "Acquisition date" },
      { key: "_acquisitionValue", header: "Acquisition value", sortField: "acquisitionValue" },
      { key: "_bookValue", header: "Book value", sortField: "bookValueSort" },
      { key: "_status", header: "Status", sortField: "status" },
      { key: "disposalSummary", header: "Disposal" },
      { key: "description", header: "Description" },
    ];
    if (canDispose) base.push({ key: "_actions", header: "Actions" });
    return base;
  }, [canDispose]);

  const sourceRows = useMemo((): Record<string, unknown>[] => {
    return list.map((a) => ({
      id: a.id,
      assetType: a.assetType,
      yardName: yardById.get(a.yardId) ?? a.yardId,
      acquisitionDate: a.acquisitionDate.slice(0, 10),
      acquisitionValue: a.acquisitionValue,
      _acquisitionValue: `₹${a.acquisitionValue.toLocaleString()}`,
      bookValueSort: a.currentBookValue ?? null,
      _bookValue: a.currentBookValue != null ? `₹${a.currentBookValue.toLocaleString()}` : "—",
      status: a.status,
      _status: (
        <Badge variant="secondary">{a.status}</Badge>
      ),
      disposalSummary: a.disposalDate
        ? `${formatYmdToDisplay(a.disposalDate)}${a.disposalValue != null ? ` · ₹${a.disposalValue.toLocaleString()}` : ""}`
        : "—",
      description: a.description ?? "—",
      _actions: canDispose && a.status !== "Disposed" && !a.disposalDate ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setDisposeAsset(a);
            setDisposalDate(new Date().toISOString().slice(0, 10));
            setDisposalValue(a.currentBookValue != null ? String(a.currentBookValue) : "");
          }}
        >
          Dispose
        </Button>
      ) : null,
    }));
  }, [list, yardById, canDispose]);

  const disposeMutation = useMutation({
    mutationFn: async () => {
      if (!disposeAsset || !user?.id) throw new Error("Missing asset or user");
      if (!disposalDate.trim()) throw new Error("Disposal date required");
      const dv = disposalValue.trim() === "" ? null : Number(disposalValue);
      if (dv != null && Number.isNaN(dv)) throw new Error("Invalid disposal value");
      const res = await fetch(`/api/ioms/fixed-assets/${disposeAsset.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          disposalDate: disposalDate.trim(),
          disposalValue: dv,
          disposalApprovedBy: user.id,
          status: "Disposed",
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? res.statusText);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [url] });
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/fixed-assets"] });
      toast({ title: "Disposal recorded" });
      setDisposeAsset(null);
    },
    onError: (e: Error) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "Construction (M-08)", href: "/construction" }, { label: "Fixed assets" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Failed to load fixed assets.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Construction (M-08)", href: "/construction" }, { label: "Fixed assets" }]}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Fixed assets
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Asset register — type, acquisition, book value, disposal. Disposal fields require DA or Admin.
          </p>
          <div className="pt-2">
            <Label>Yard</Label>
            <Select value={yardId} onValueChange={setYardId}>
              <SelectTrigger className="w-[200px] mt-1">
                <SelectValue placeholder="All yards" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All yards</SelectItem>
                {yards.map((y) => (
                  <SelectItem key={y.id} value={y.id}>{y.name ?? y.code ?? y.id}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <ClientDataGrid
              columns={columns}
              sourceRows={sourceRows}
              searchKeys={[
                "assetType",
                "yardName",
                "acquisitionDate",
                "disposalSummary",
                "description",
                "status",
              ]}
              defaultSortKey="acquisitionDate"
              defaultSortDir="desc"
              isLoading={false}
              emptyMessage="No fixed assets."
              resetPageDependency={url}
            />
          )}
        </CardContent>
      </Card>

      <Dialog open={disposeAsset != null} onOpenChange={(o) => !o && setDisposeAsset(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record disposal (DA)</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Disposal date</Label>
              <Input type="date" value={disposalDate} onChange={(e) => setDisposalDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Disposal value (optional)</Label>
              <Input type="number" value={disposalValue} onChange={(e) => setDisposalValue(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDisposeAsset(null)} disabled={disposeMutation.isPending}>
              Cancel
            </Button>
            <Button onClick={() => disposeMutation.mutate()} disabled={disposeMutation.isPending}>
              {disposeMutation.isPending ? "Saving..." : "Save disposal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
