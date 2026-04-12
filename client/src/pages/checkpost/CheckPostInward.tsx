import { useCallback, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ClientDataGrid } from "@/components/reports/ClientDataGrid";
import type { ReportTableColumn } from "@/components/reports/ReportDataTable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { LogIn, AlertCircle, ShieldCheck, Plus } from "lucide-react";
interface InwardEntry {
  id: string;
  entryNo?: string | null;
  checkPostId: string;
  transactionType: string;
  entryDate: string;
  vehicleNumber?: string | null;
  status: string;
  totalCharges?: number | null;
}
interface InwardCommodity {
  id: string;
  inwardId: string;
  commodityId: string;
  unit: string;
  quantity: number;
  value: number;
  marketFeePercent?: number | null;
  marketFeeAmount?: number | null;
}

export default function CheckPostInward() {
  const { user, can } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canCreate = can("M-04", "Create");
  const [open, setOpen] = useState(false);
  const [checkPostId, setCheckPostId] = useState("");
  const [transactionType, setTransactionType] = useState("Permanent");
  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [vehicleNumber, setVehicleNumber] = useState("");
  const [fromFirm, setFromFirm] = useState("");
  const [toFirm, setToFirm] = useState("");
  const [totalCharges, setTotalCharges] = useState("");
  const [filterCheckPostId, setFilterCheckPostId] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [commodityDialogOpen, setCommodityDialogOpen] = useState(false);
  const [selectedInwardId, setSelectedInwardId] = useState("");
  const [commodityId, setCommodityId] = useState("");
  const [commodityUnit, setCommodityUnit] = useState("Quintal");
  const [commodityQty, setCommodityQty] = useState("");
  const [commodityValue, setCommodityValue] = useState("");
  const [commodityFeePercent, setCommodityFeePercent] = useState("");

  const roles = user?.roles?.map((r) => r.tier) ?? [];
  const canVerify = roles.includes("DV") || roles.includes("ADMIN");
  const { data: list, isLoading, isError } = useQuery<InwardEntry[]>({
    queryKey: ["/api/ioms/checkpost/inward"],
  });
  const { data: checkposts = [] } = useQuery<Array<{ id: string; name: string; code: string }>>({
    queryKey: ["/api/yards"],
  });
  const { data: commodities = [] } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ["/api/ioms/commodities"],
  });
  const {
    data: commodityLines = [],
    isLoading: commodityLinesLoading,
  } = useQuery<InwardCommodity[]>({
    queryKey: ["/api/ioms/checkpost/inward", selectedInwardId, "commodities"],
    enabled: commodityDialogOpen && !!selectedInwardId,
    queryFn: async () => {
      const res = await fetch(`/api/ioms/checkpost/inward/${selectedInwardId}/commodities`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load inward commodities");
      return res.json();
    },
  });
  const checkPostIds = useMemo(() => new Set(checkposts.map((c) => c.id)), [checkposts]);
  const checkPostById = useMemo(() => new Map(checkposts.map((c) => [c.id, c])), [checkposts]);
  const commodityIds = useMemo(() => new Set(commodities.map((c) => c.id)), [commodities]);
  const commodityById = useMemo(() => new Map(commodities.map((c) => [c.id, c])), [commodities]);
  const inwardCreateError = useMemo(() => {
    if (!checkPostId.trim()) return "Check post ID is required.";
    if (!entryDate.trim()) return "Entry date is required.";
    if (!checkPostIds.has(checkPostId.trim())) return "Check post ID is invalid or out of scope.";
    const charges = totalCharges === "" ? null : Number(totalCharges);
    if (charges != null && (Number.isNaN(charges) || charges < 0)) return "Total charges must be a non-negative number.";
    return null;
  }, [checkPostId, entryDate, totalCharges, checkPostIds]);
  const commodityAddError = useMemo(() => {
    if (!selectedInwardId) return "Select an inward entry first.";
    if (!commodityId.trim()) return "Commodity ID is required.";
    if (!commodityIds.has(commodityId.trim())) return "Commodity ID is invalid.";
    if (!commodityUnit.trim()) return "Unit is required.";
    const q = Number(commodityQty);
    if (Number.isNaN(q) || q <= 0) return "Quantity must be greater than 0.";
    const v = Number(commodityValue);
    if (Number.isNaN(v) || v < 0) return "Value must be a non-negative number.";
    if (commodityFeePercent.trim() !== "") {
      const p = Number(commodityFeePercent);
      if (Number.isNaN(p) || p < 0 || p > 100) return "Market fee % must be between 0 and 100.";
    }
    return null;
  }, [selectedInwardId, commodityId, commodityIds, commodityUnit, commodityQty, commodityValue, commodityFeePercent]);
  const commodityComputedFee = useMemo(() => {
    const value = Number(commodityValue);
    const percent = Number(commodityFeePercent);
    if (Number.isNaN(value) || Number.isNaN(percent)) return null;
    return Number(((value * percent) / 100).toFixed(2));
  }, [commodityValue, commodityFeePercent]);

  const createMutation = useMutation({
    mutationFn: async () => {
      if (inwardCreateError) throw new Error(inwardCreateError);
      const res = await fetch("/api/ioms/checkpost/inward", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          checkPostId,
          transactionType,
          entryDate,
          vehicleNumber,
          fromFirm,
          toFirm,
          totalCharges: totalCharges === "" ? null : Number(totalCharges),
          status: "Draft",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/checkpost/inward"] });
      toast({ title: "Inward entry created" });
      setOpen(false);
      setCheckPostId("");
      setTransactionType("Permanent");
      setEntryDate(new Date().toISOString().slice(0, 10));
      setVehicleNumber("");
      setFromFirm("");
      setToFirm("");
      setTotalCharges("");
    },
    onError: (e: Error) => toast({ title: "Create failed", description: e.message, variant: "destructive" }),
  });
  const statusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const res = await fetch(`/api/ioms/checkpost/inward/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? res.statusText);
      }
      return res.json();
    },
    onSuccess: (_, { status }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/checkpost/inward"] });
      toast({ title: "Status updated", description: `Inward entry set to ${status}.` });
    },
    onError: (e: Error) => {
      toast({ title: "Update failed", description: e.message, variant: "destructive" });
    },
  });
  const addCommodityMutation = useMutation({
    mutationFn: async () => {
      if (commodityAddError) throw new Error(commodityAddError);
      const res = await fetch(`/api/ioms/checkpost/inward/${selectedInwardId}/commodities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          commodityId,
          unit: commodityUnit,
          quantity: Number(commodityQty || 0),
          value: Number(commodityValue || 0),
          marketFeePercent: commodityFeePercent === "" ? null : Number(commodityFeePercent),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/checkpost/inward", selectedInwardId, "commodities"] });
      toast({ title: "Commodity line added" });
      setCommodityId("");
      setCommodityUnit("Quintal");
      setCommodityQty("");
      setCommodityValue("");
      setCommodityFeePercent("");
    },
    onError: (e: Error) => toast({ title: "Add commodity failed", description: e.message, variant: "destructive" }),
  });

  const openCommodities = useCallback((inwardId: string) => {
    setSelectedInwardId(inwardId);
    setCommodityDialogOpen(true);
  }, []);
  const filteredList = useMemo(() => {
    return (list ?? []).filter((e) => {
      if (filterCheckPostId && e.checkPostId !== filterCheckPostId) return false;
      if (filterStatus && e.status !== filterStatus) return false;
      return true;
    });
  }, [list, filterCheckPostId, filterStatus]);

  const inwardColumns = useMemo(
    (): ReportTableColumn[] => [
      { key: "entryNo", header: "Entry No" },
      { key: "checkPostName", header: "Check Post" },
      { key: "transactionType", header: "Type" },
      { key: "entryDate", header: "Date" },
      { key: "vehicleNumber", header: "Vehicle" },
      { key: "totalCharges", header: "Charges" },
      { key: "_status", header: "Status", sortField: "status" },
      { key: "_actions", header: "Actions" },
    ],
    [],
  );

  const inwardSourceRows = useMemo((): Record<string, unknown>[] => {
    return filteredList.map((e) => ({
      id: e.id,
      entryNo: e.entryNo ?? "—",
      checkPostName: checkPostById.get(e.checkPostId)?.name ?? e.checkPostId,
      transactionType: e.transactionType,
      entryDate: e.entryDate.slice(0, 10),
      vehicleNumber: e.vehicleNumber ?? "—",
      totalCharges: e.totalCharges != null ? e.totalCharges : "—",
      status: e.status,
      _status: <Badge variant="secondary">{e.status}</Badge>,
      _actions: (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => openCommodities(e.id)}>
            Commodities
          </Button>
          {canVerify && e.status === "Draft" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => statusMutation.mutate({ id: e.id, status: "Verified" })}
              disabled={statusMutation.isPending}
            >
              <ShieldCheck className="h-3.5 w-3.5 mr-1" />
              {statusMutation.isPending ? "Verifying..." : "Verify"}
            </Button>
          )}
        </div>
      ),
    }));
  }, [filteredList, checkPostById, canVerify, statusMutation, openCommodities]);

  const commodityLineColumns = useMemo(
    (): ReportTableColumn[] => [
      { key: "commodityName", header: "Commodity" },
      { key: "unit", header: "Unit" },
      { key: "quantity", header: "Qty" },
      { key: "value", header: "Value" },
      { key: "marketFeePercent", header: "Fee %" },
    ],
    [],
  );

  const commodityLineRows = useMemo((): Record<string, unknown>[] => {
    return commodityLines.map((l) => ({
      id: l.id,
      commodityName: commodityById.get(l.commodityId)?.name ?? l.commodityId,
      unit: l.unit,
      quantity: l.quantity,
      value: l.value,
      marketFeePercent: l.marketFeePercent ?? "—",
    }));
  }, [commodityLines, commodityById]);

  const filterKey = `${filterCheckPostId}|${filterStatus}`;

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "Check Post", href: "/checkpost/inward" }, { label: "Inward" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Failed to load inward entries.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Check Post", href: "/checkpost/inward" }, { label: "Inward" }]}>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <LogIn className="h-5 w-5" />
              Check Post Inward (IOMS M-04)
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Inward entries at check posts; commodity line items and exit permits.
              {canVerify && <span className="block mt-1">You can verify Draft → Verified.</span>}
            </p>
          </div>
          {canCreate && (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Add inward</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Create inward entry</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  {inwardCreateError && <p className="text-sm text-destructive">{inwardCreateError}</p>}
                  <div className="space-y-1">
                    <Label>Check post ID</Label>
                    <Input list="checkpost-list-inward" value={checkPostId} onChange={(e) => setCheckPostId(e.target.value)} />
                    <datalist id="checkpost-list-inward">
                      {checkposts.map((c) => (<option key={c.id} value={c.id}>{c.name} ({c.code})</option>))}
                    </datalist>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label>Transaction type</Label>
                      <Select value={transactionType} onValueChange={setTransactionType}>
                        <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Permanent">Permanent</SelectItem>
                          <SelectItem value="Temporary">Temporary</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1"><Label>Entry date</Label><Input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1"><Label>Vehicle number</Label><Input value={vehicleNumber} onChange={(e) => setVehicleNumber(e.target.value)} /></div>
                    <div className="space-y-1"><Label>Total charges</Label><Input type="number" value={totalCharges} onChange={(e) => setTotalCharges(e.target.value)} /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1"><Label>From firm</Label><Input value={fromFirm} onChange={(e) => setFromFirm(e.target.value)} /></div>
                    <div className="space-y-1"><Label>To firm</Label><Input value={toFirm} onChange={(e) => setToFirm(e.target.value)} /></div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => setOpen(false)} disabled={createMutation.isPending}>Cancel</Button>
                    <Button disabled={createMutation.isPending || inwardCreateError !== null} onClick={() => createMutation.mutate()}>
                      {createMutation.isPending ? "Creating..." : "Create"}
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          )}
        </CardHeader>
        <CardContent>
          <div className="mb-4 grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label>Filter check post</Label>
              <Select value={filterCheckPostId || "all-checkposts"} onValueChange={(v) => setFilterCheckPostId(v === "all-checkposts" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="All check posts" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all-checkposts">All check posts</SelectItem>
                  {checkposts.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {`${c.name} (${c.code})`.slice(0, 64)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Filter status</Label>
              <Select value={filterStatus || "all"} onValueChange={(v) => setFilterStatus(v === "all" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="All statuses" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="Draft">Draft</SelectItem>
                  <SelectItem value="Verified">Verified</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button variant="outline" onClick={() => { setFilterCheckPostId(""); setFilterStatus(""); }}>Clear filters</Button>
            </div>
          </div>
          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <ClientDataGrid
              columns={inwardColumns}
              sourceRows={inwardSourceRows}
              searchKeys={["entryNo", "checkPostName", "transactionType", "entryDate", "vehicleNumber", "status"]}
              defaultSortKey="entryDate"
              defaultSortDir="desc"
              emptyMessage="No inward entries."
              resetPageDependency={filterKey}
            />
          )}
        </CardContent>
      </Card>
      <Dialog open={commodityDialogOpen} onOpenChange={setCommodityDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Inward commodities — {selectedInwardId || "entry"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {commodityAddError && <p className="text-sm text-destructive">{commodityAddError}</p>}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label>Commodity ID</Label>
                <Input list="commodities-list-inward-lines" value={commodityId} onChange={(e) => setCommodityId(e.target.value)} />
                <datalist id="commodities-list-inward-lines">
                  {commodities.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
                </datalist>
              </div>
              <div className="space-y-1">
                <Label>Unit</Label>
                <Input value={commodityUnit} onChange={(e) => setCommodityUnit(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <div className="space-y-1"><Label>Quantity</Label><Input type="number" value={commodityQty} onChange={(e) => setCommodityQty(e.target.value)} /></div>
              <div className="space-y-1"><Label>Value</Label><Input type="number" value={commodityValue} onChange={(e) => setCommodityValue(e.target.value)} /></div>
              <div className="space-y-1"><Label>Market fee %</Label><Input type="number" value={commodityFeePercent} onChange={(e) => setCommodityFeePercent(e.target.value)} /></div>
            </div>
            {commodityComputedFee != null && (
              <div className="space-y-1">
                <Label>Computed fee amount</Label>
                <Input readOnly value={commodityComputedFee.toFixed(2)} className="bg-muted" />
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setCommodityDialogOpen(false)} disabled={addCommodityMutation.isPending}>Close</Button>
              <Button
                disabled={addCommodityMutation.isPending || commodityAddError !== null}
                onClick={() => addCommodityMutation.mutate()}
              >
                {addCommodityMutation.isPending ? "Adding..." : "Add line"}
              </Button>
            </div>
            <div className="border rounded-md p-1">
              <ClientDataGrid
                columns={commodityLineColumns}
                sourceRows={commodityLineRows}
                searchKeys={["commodityName", "unit"]}
                defaultSortKey="commodityName"
                defaultSortDir="asc"
                isLoading={commodityLinesLoading}
                emptyMessage="No commodity lines yet."
                resetPageDependency={`${selectedInwardId}|${commodityLines.length}`}
              />
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
