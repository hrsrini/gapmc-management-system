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
import { Percent, AlertCircle, Plus } from "lucide-react";

interface FeeRate {
  id: string;
  commodityId: string;
  validFrom: string;
  validTo?: string | null;
  feePercent: number;
  yardId?: string | null;
}
interface Commodity {
  id: string;
  name?: string | null;
}

export default function FeeRatesList() {
  const { can } = useAuth();
  const canCreate = can("M-04", "Create");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [commodityId, setCommodityId] = useState("");
  const [validFrom, setValidFrom] = useState("");
  const [validTo, setValidTo] = useState("");
  const [feePercent, setFeePercent] = useState("1");
  const [yardId, setYardId] = useState("");

  const { data: list, isLoading, isError } = useQuery<FeeRate[]>({
    queryKey: ["/api/ioms/market/fee-rates"],
  });
  const { data: commodities = [] } = useQuery<Commodity[]>({
    queryKey: ["/api/ioms/commodities"],
  });
  const { data: yards = [] } = useQuery<Array<{ id: string; name: string; code: string }>>({
    queryKey: ["/api/yards"],
  });
  const commodityMap = Object.fromEntries((commodities ?? []).map((c) => [c.id, c.name ?? c.id]));
  const yardById = useMemo(() => new Map(yards.map((y) => [y.id, y])), [yards]);
  const commodityIds = useMemo(() => new Set(commodities.map((c) => c.id)), [commodities]);
  const yardIds = useMemo(() => new Set(yards.map((y) => y.id)), [yards]);
  const createError = useMemo(() => {
    if (!commodityId.trim()) return "Commodity ID is required.";
    if (!commodityIds.has(commodityId.trim())) return "Commodity ID is invalid.";
    if (!validFrom.trim()) return "Valid from date is required.";
    if (validTo.trim() && validTo < validFrom) return "Valid to must be on/after valid from.";
    const fee = Number(feePercent);
    if (Number.isNaN(fee) || fee < 0 || fee > 100) return "Fee % must be between 0 and 100.";
    if (yardId.trim() && !yardIds.has(yardId.trim())) return "Yard ID is invalid.";
    return null;
  }, [commodityId, commodityIds, validFrom, validTo, feePercent, yardId, yardIds]);

  const createMutation = useMutation({
    mutationFn: async () => {
      if (createError) throw new Error(createError);
      const res = await fetch("/api/ioms/market/fee-rates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          commodityId,
          validFrom,
          validTo: validTo || null,
          feePercent: Number(feePercent || 0),
          yardId: yardId || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/market/fee-rates"] });
      toast({ title: "Fee rate created" });
      setCreateOpen(false);
      setCommodityId("");
      setValidFrom("");
      setValidTo("");
      setFeePercent("1");
      setYardId("");
    },
    onError: (e: Error) => toast({ title: "Create failed", description: e.message, variant: "destructive" }),
  });

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "Market (IOMS)", href: "/market/commodities" }, { label: "Fee rates" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Failed to load fee rates.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Market (IOMS)", href: "/market/commodities" }, { label: "Fee rates" }]}>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Percent className="h-5 w-5" />
              Market fee rates (M-04)
            </CardTitle>
            <p className="text-sm text-muted-foreground">Fee % by commodity and validity period.</p>
          </div>
          {canCreate && (
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Add fee rate</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Create fee rate</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  {createError && <p className="text-sm text-destructive">{createError}</p>}
                  <div className="space-y-1">
                    <Label>Commodity ID</Label>
                    <Select value={commodityId || undefined} onValueChange={setCommodityId}>
                      <SelectTrigger><SelectValue placeholder="Select commodity" /></SelectTrigger>
                      <SelectContent>
                        {commodities.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {(c.name ?? c.id).slice(0, 64)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1"><Label>Valid from</Label><Input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} /></div>
                    <div className="space-y-1"><Label>Valid to</Label><Input type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1"><Label>Fee %</Label><Input type="number" value={feePercent} onChange={(e) => setFeePercent(e.target.value)} /></div>
                    <div className="space-y-1">
                      <Label>Yard ID (optional)</Label>
                      <Select value={yardId || "all-yards"} onValueChange={(v) => setYardId(v === "all-yards" ? "" : v)}>
                        <SelectTrigger><SelectValue placeholder="All yards" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all-yards">All yards</SelectItem>
                          {yards.map((y) => (
                            <SelectItem key={y.id} value={y.id}>
                              {`${y.name} (${y.code})`.slice(0, 64)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={createMutation.isPending}>Cancel</Button>
                    <Button disabled={createMutation.isPending || createError !== null} onClick={() => createMutation.mutate()}>
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
                  <TableHead>Commodity</TableHead>
                  <TableHead>Valid from</TableHead>
                  <TableHead>Valid to</TableHead>
                  <TableHead className="text-right">Fee %</TableHead>
                  <TableHead>Yard</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(list ?? []).map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{commodityMap[r.commodityId] ?? r.commodityId}</TableCell>
                    <TableCell>{r.validFrom}</TableCell>
                    <TableCell>{r.validTo ?? "—"}</TableCell>
                    <TableCell className="text-right">{r.feePercent}%</TableCell>
                    <TableCell>{r.yardId ? (yardById.get(r.yardId)?.name ?? r.yardId) : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {!isLoading && (!list || list.length === 0) && (
            <p className="text-sm text-muted-foreground py-4">No fee rates.</p>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
