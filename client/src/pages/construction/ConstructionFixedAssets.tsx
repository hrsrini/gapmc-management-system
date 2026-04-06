import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Yard</TableHead>
                  <TableHead>Acquisition date</TableHead>
                  <TableHead className="text-right">Acquisition value</TableHead>
                  <TableHead className="text-right">Book value</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Disposal</TableHead>
                  <TableHead>Description</TableHead>
                  {canDispose && <TableHead className="w-[120px]">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={canDispose ? 9 : 8} className="text-muted-foreground text-center py-6">No fixed assets.</TableCell>
                  </TableRow>
                ) : (
                  list.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="font-medium">{a.assetType}</TableCell>
                      <TableCell>{a.yardId}</TableCell>
                      <TableCell>{a.acquisitionDate}</TableCell>
                      <TableCell className="text-right">₹{a.acquisitionValue.toLocaleString()}</TableCell>
                      <TableCell className="text-right">{a.currentBookValue != null ? `₹${a.currentBookValue.toLocaleString()}` : "—"}</TableCell>
                      <TableCell><Badge variant="secondary">{a.status}</Badge></TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {a.disposalDate ? `${a.disposalDate}${a.disposalValue != null ? ` · ₹${a.disposalValue.toLocaleString()}` : ""}` : "—"}
                      </TableCell>
                      <TableCell className="max-w-[180px] truncate text-muted-foreground">{a.description ?? "—"}</TableCell>
                      {canDispose && (
                        <TableCell>
                          {a.status !== "Disposed" && !a.disposalDate && (
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
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
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
