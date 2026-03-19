import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { ArrowRightLeft, AlertCircle, ShieldCheck, CheckCircle, Plus } from "lucide-react";

interface Transaction {
  id: string;
  transactionNo?: string | null;
  yardId: string;
  commodityId: string;
  traderLicenceId: string;
  quantity: number;
  unit: string;
  declaredValue: number;
  marketFeeAmount: number;
  transactionDate: string;
  status: string;
}

export default function MarketTransactions() {
  const { user, can } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [yardId, setYardId] = useState("");
  const [commodityId, setCommodityId] = useState("");
  const [traderLicenceId, setTraderLicenceId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("Quintal");
  const [declaredValue, setDeclaredValue] = useState("");
  const [marketFeePercent, setMarketFeePercent] = useState("1");
  const [purchaseType, setPurchaseType] = useState("TraderPurchase");
  const [transactionDate, setTransactionDate] = useState(() => new Date().toISOString().slice(0, 10));

  const roles = user?.roles?.map((r) => r.tier) ?? [];
  const canVerify = roles.includes("DV") || roles.includes("ADMIN");
  const canApprove = roles.includes("DA") || roles.includes("ADMIN");
  const canCreate = can("M-04", "Create");

  const { data: list, isLoading, isError } = useQuery<Transaction[]>({
    queryKey: ["/api/ioms/market/transactions"],
  });
  const { data: commodities = [] } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ["/api/ioms/commodities"],
  });
  const { data: licences = [] } = useQuery<Array<{ id: string; firmName: string; licenceNo?: string | null }>>({
    queryKey: ["/api/ioms/traders/licences"],
  });
  const { data: yards = [] } = useQuery<Array<{ id: string; name: string; code: string }>>({
    queryKey: ["/api/yards"],
  });
  const yardById = useMemo(() => new Map(yards.map((y) => [y.id, y])), [yards]);
  const commodityById = useMemo(() => new Map(commodities.map((c) => [c.id, c])), [commodities]);
  const licenceById = useMemo(() => new Map(licences.map((l) => [l.id, l])), [licences]);

  const marketFeeAmount = useMemo(() => {
    const dv = Number(declaredValue) || 0;
    const mfp = Number(marketFeePercent) || 0;
    return Number(((dv * mfp) / 100).toFixed(2));
  }, [declaredValue, marketFeePercent]);
  const createValidationError = useMemo(() => {
    if (!yardId.trim()) return "Yard ID is required.";
    if (!commodityId.trim()) return "Commodity ID is required.";
    if (!traderLicenceId.trim()) return "Trader licence ID is required.";
    if (!unit.trim()) return "Unit is required.";
    if (!purchaseType.trim()) return "Purchase type is required.";
    if (!transactionDate.trim()) return "Transaction date is required.";
    if (!yardById.has(yardId.trim())) return "Yard ID is invalid or out of scope.";
    if (!commodityById.has(commodityId.trim())) return "Commodity ID is invalid.";
    if (!licenceById.has(traderLicenceId.trim())) return "Trader licence ID is invalid.";
    const q = Number(quantity);
    if (Number.isNaN(q) || q <= 0) return "Quantity must be greater than 0.";
    const dv = Number(declaredValue);
    if (Number.isNaN(dv) || dv < 0) return "Declared value must be a non-negative number.";
    const mfp = Number(marketFeePercent);
    if (Number.isNaN(mfp) || mfp < 0 || mfp > 100) return "Market fee % must be between 0 and 100.";
    return null;
  }, [
    yardId,
    commodityId,
    traderLicenceId,
    unit,
    purchaseType,
    transactionDate,
    yardById,
    commodityById,
    licenceById,
    quantity,
    declaredValue,
    marketFeePercent,
  ]);

  const createMutation = useMutation({
    mutationFn: async () => {
      if (createValidationError) {
        throw new Error(createValidationError);
      }
      const body = {
        yardId: yardId.trim(),
        commodityId: commodityId.trim(),
        traderLicenceId: traderLicenceId.trim(),
        quantity: Number(quantity || 0),
        unit: unit.trim(),
        declaredValue: Number(declaredValue || 0),
        marketFeePercent: Number(marketFeePercent || 0),
        marketFeeAmount: Number(marketFeeAmount || 0),
        purchaseType: purchaseType.trim(),
        transactionDate: transactionDate.trim(),
      };
      const res = await fetch("/api/ioms/market/transactions", {
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
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/market/transactions"] });
      toast({ title: "Transaction created", description: "Draft market transaction created." });
      setCreateOpen(false);
      setYardId("");
      setCommodityId("");
      setTraderLicenceId("");
      setQuantity("");
      setUnit("Quintal");
      setDeclaredValue("");
      setMarketFeePercent("1");
      setPurchaseType("TraderPurchase");
      setTransactionDate(new Date().toISOString().slice(0, 10));
    },
    onError: (e: Error) => toast({ title: "Create failed", description: e.message, variant: "destructive" }),
  });

  const statusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const res = await fetch(`/api/ioms/market/transactions/${id}`, {
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
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/market/transactions"] });
      toast({ title: "Status updated", description: `Transaction set to ${status}.` });
    },
    onError: (e: Error) => {
      toast({ title: "Update failed", description: e.message, variant: "destructive" });
    },
  });

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "Market (IOMS)", href: "/market/transactions" }, { label: "Transactions" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Failed to load transactions.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Market (IOMS)", href: "/market/transactions" }, { label: "Transactions" }]}>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
          <CardTitle className="flex items-center gap-2">
            <ArrowRightLeft className="h-5 w-5" />
            Purchase Transactions (IOMS M-04)
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Purchase/transaction entries at yards; market fee computation.
            {canVerify && <span className="block mt-1">You can verify Draft → Verified.</span>}
            {canApprove && <span className="block mt-1">You can approve Verified → Approved.</span>}
          </p>
          </div>
          {canCreate && (
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="h-4 w-4 mr-2" />
                  Add transaction
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create market transaction</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                  {createValidationError && (
                    <p className="text-sm text-destructive">{createValidationError}</p>
                  )}
                  <div className="space-y-1">
                    <Label>Yard</Label>
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
                  <div className="space-y-1">
                    <Label>Commodity</Label>
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
                  <div className="space-y-1">
                    <Label>Trader licence</Label>
                    <Select value={traderLicenceId || undefined} onValueChange={setTraderLicenceId}>
                      <SelectTrigger><SelectValue placeholder="Select trader licence" /></SelectTrigger>
                      <SelectContent>
                        {licences.map((l) => (
                          <SelectItem key={l.id} value={l.id}>
                            {`${l.licenceNo ?? l.id} - ${l.firmName}`.slice(0, 64)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label>Quantity</Label>
                      <Input type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label>Unit</Label>
                      <Input value={unit} onChange={(e) => setUnit(e.target.value)} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label>Declared value</Label>
                      <Input type="number" value={declaredValue} onChange={(e) => setDeclaredValue(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label>Market fee %</Label>
                      <Input type="number" value={marketFeePercent} onChange={(e) => setMarketFeePercent(e.target.value)} />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label>Market fee amount</Label>
                    <Input readOnly value={marketFeeAmount.toFixed(2)} className="bg-muted" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label>Purchase type</Label>
                      <Input value={purchaseType} onChange={(e) => setPurchaseType(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label>Transaction date</Label>
                      <Input type="date" value={transactionDate} onChange={(e) => setTransactionDate(e.target.value)} />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 pt-1">
                    <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={createMutation.isPending}>Cancel</Button>
                    <Button
                      onClick={() => createMutation.mutate()}
                      disabled={createMutation.isPending || createValidationError !== null}
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
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Txn No</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Yard</TableHead>
                  <TableHead>Commodity</TableHead>
                  <TableHead>Qty</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>Fee</TableHead>
                  <TableHead>Status</TableHead>
                  {(canVerify || canApprove) && <TableHead className="w-[180px]">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {(list ?? []).map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-mono text-sm">{t.transactionNo ?? "—"}</TableCell>
                    <TableCell>{t.transactionDate}</TableCell>
                    <TableCell>{yardById.get(t.yardId)?.name ?? t.yardId}</TableCell>
                    <TableCell>{commodityById.get(t.commodityId)?.name ?? t.commodityId}</TableCell>
                    <TableCell>{t.quantity} {t.unit}</TableCell>
                    <TableCell>{t.declaredValue}</TableCell>
                    <TableCell>{t.marketFeeAmount}</TableCell>
                    <TableCell><Badge variant="secondary">{t.status}</Badge></TableCell>
                    {(canVerify || canApprove) && (
                      <TableCell className="space-x-2">
                        {canVerify && t.status === "Draft" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => statusMutation.mutate({ id: t.id, status: "Verified" })}
                            disabled={statusMutation.isPending}
                          >
                            <ShieldCheck className="h-3.5 w-3.5 mr-1" />
                            {statusMutation.isPending ? "Updating..." : "Verify"}
                          </Button>
                        )}
                        {canApprove && t.status === "Verified" && (
                          <Button
                            size="sm"
                            variant="default"
                            onClick={() => statusMutation.mutate({ id: t.id, status: "Approved" })}
                            disabled={statusMutation.isPending}
                          >
                            <CheckCircle className="h-3.5 w-3.5 mr-1" />
                            {statusMutation.isPending ? "Updating..." : "Approve"}
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {!isLoading && (!list || list.length === 0) && (
            <p className="text-sm text-muted-foreground py-4">No purchase transactions. Fee Collection uses existing market fee entries.</p>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
