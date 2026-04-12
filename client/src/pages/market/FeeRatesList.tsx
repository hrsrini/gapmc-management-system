import { useMemo, useState, useEffect } from "react";
import { ClientDataGrid } from "@/components/reports/ClientDataGrid";
import type { ReportTableColumn } from "@/components/reports/ReportDataTable";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Percent, AlertCircle, Plus } from "lucide-react";
import { SYSTEM_CONFIG_DEFAULTS } from "@shared/system-config-defaults";

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
  const [feePercent, setFeePercent] = useState<string>(SYSTEM_CONFIG_DEFAULTS.market_fee_percent);
  const [yardId, setYardId] = useState("");

  const { data: sysCfg } = useQuery<Record<string, string>>({
    queryKey: ["/api/system/config"],
  });
  useEffect(() => {
    const p = sysCfg?.market_fee_percent;
    if (p != null && p !== "") setFeePercent(p);
  }, [sysCfg?.market_fee_percent]);

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
      const cfg = queryClient.getQueryData<Record<string, string>>(["/api/system/config"]);
      setFeePercent(cfg?.market_fee_percent ?? SYSTEM_CONFIG_DEFAULTS.market_fee_percent);
      setYardId("");
    },
    onError: (e: Error) => toast({ title: "Create failed", description: e.message, variant: "destructive" }),
  });

  const columns = useMemo((): ReportTableColumn[] => {
    return [
      { key: "commodityName", header: "Commodity" },
      { key: "validFrom", header: "Valid from" },
      { key: "validTo", header: "Valid to" },
      { key: "_feePct", header: "Fee %", sortField: "feePercent" },
      { key: "yardName", header: "Yard" },
    ];
  }, []);

  const sourceRows = useMemo((): Record<string, unknown>[] => {
    return (list ?? []).map((r) => ({
      id: r.id,
      commodityName: commodityMap[r.commodityId] ?? r.commodityId,
      validFrom: r.validFrom.slice(0, 10),
      validTo: r.validTo ? r.validTo.slice(0, 10) : null,
      feePercent: r.feePercent,
      _feePct: `${r.feePercent}%`,
      yardName: r.yardId ? (yardById.get(r.yardId)?.name ?? r.yardId) : "—",
    }));
  }, [list, commodityMap, yardById]);

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
            <ClientDataGrid
              columns={columns}
              sourceRows={sourceRows}
              searchKeys={["commodityName", "validFrom", "validTo", "feePercent", "yardName", "_feePct"]}
              searchPlaceholder="Search commodity, dates, fee %, yard…"
              defaultSortKey="validFrom"
              defaultSortDir="desc"
              emptyMessage="No fee rates."
            />
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
