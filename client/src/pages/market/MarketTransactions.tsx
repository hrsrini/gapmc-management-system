import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ClientDataGrid } from "@/components/reports/ClientDataGrid";
import type { ReportTableColumn } from "@/components/reports/ReportDataTable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { ArrowRightLeft, AlertCircle, ShieldCheck, CheckCircle, Plus, SendHorizontal } from "lucide-react";
import { MIN_WORKFLOW_REMARKS_LENGTH } from "@shared/workflow-rejection";
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
  workflowRevisionCount?: number | null;
  dvReturnRemarks?: string | null;
  parentTransactionId?: string | null;
  entryKind?: string | null;
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
  const [purchaseType, setPurchaseType] = useState("TraderPurchase");
  const [transactionDate, setTransactionDate] = useState(() => new Date().toISOString().slice(0, 10));

  const roles = user?.roles?.map((r) => r.tier) ?? [];
  const canUpdate = can("M-04", "Update");
  const canVerify = (roles.includes("DV") || roles.includes("ADMIN")) && canUpdate;
  const canApprove = (roles.includes("DA") || roles.includes("ADMIN")) && canUpdate;
  const canCreate = can("M-04", "Create");

  const [returnDraftTxnId, setReturnDraftTxnId] = useState<string | null>(null);
  const [returnDraftRemarks, setReturnDraftRemarks] = useState("");
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustParent, setAdjustParent] = useState<Transaction | null>(null);
  const [adjustFee, setAdjustFee] = useState("");
  const [adjustDeclared, setAdjustDeclared] = useState("");
  const [adjustQty, setAdjustQty] = useState("");
  const [adjustDate, setAdjustDate] = useState(() => new Date().toISOString().slice(0, 10));

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

  const feePreviewParamsReady =
    Boolean(yardId.trim() && commodityId.trim()) && /^\d{4}-\d{2}-\d{2}$/.test(transactionDate.trim());

  const {
    data: feePreview,
    isPending: feePreviewPending,
    isError: feePreviewIsError,
    error: feePreviewError,
  } = useQuery<{ marketFeePercent: number; source: string; rateId: string | null }>({
    queryKey: ["/api/ioms/market/fee-preview", yardId.trim(), commodityId.trim(), transactionDate.trim()],
    queryFn: async ({ queryKey }) => {
      const [, y, c, d] = queryKey as [string, string, string, string];
      const u = new URL("/api/ioms/market/fee-preview", window.location.origin);
      u.searchParams.set("yardId", y);
      u.searchParams.set("commodityId", c);
      u.searchParams.set("transactionDate", d);
      const r = await fetch(u.toString(), { credentials: "include" });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? r.statusText);
      }
      return r.json();
    },
    enabled: feePreviewParamsReady,
  });

  const resolvedFeePercent = feePreview?.marketFeePercent ?? null;

  const marketFeeAmount = useMemo(() => {
    const dv = Number(declaredValue) || 0;
    const mfp = resolvedFeePercent ?? 0;
    return Number(((dv * mfp) / 100).toFixed(2));
  }, [declaredValue, resolvedFeePercent]);
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
    if (feePreviewParamsReady) {
      if (feePreviewPending) return "Resolving market fee rate…";
      if (feePreviewIsError) {
        return feePreviewError instanceof Error ? feePreviewError.message : "Could not resolve market fee rate.";
      }
      if (resolvedFeePercent == null || Number.isNaN(resolvedFeePercent)) return "Could not resolve market fee rate.";
    }
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
    feePreviewParamsReady,
    feePreviewPending,
    feePreviewIsError,
    feePreviewError,
    resolvedFeePercent,
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
        marketFeePercent: resolvedFeePercent ?? 0,
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
      setPurchaseType("TraderPurchase");
      setTransactionDate(new Date().toISOString().slice(0, 10));
    },
    onError: (e: Error) => toast({ title: "Create failed", description: e.message, variant: "destructive" }),
  });

  const statusMutation = useMutation({
    mutationFn: async (vars: { id: string } & Record<string, unknown>) => {
      const { id, ...body } = vars;
      const res = await fetch(`/api/ioms/market/transactions/${id}`, {
        method: "PUT",
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
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/market/transactions"] });
      toast({ title: "Status updated", description: `Transaction set to ${String(vars.status)}.` });
      if (vars.status === "Draft" && "returnRemarks" in vars) {
        setReturnDraftTxnId(null);
        setReturnDraftRemarks("");
      }
    },
    onError: (e: Error) => {
      toast({ title: "Update failed", description: e.message, variant: "destructive" });
    },
  });

  const adjustmentMutation = useMutation({
    mutationFn: async () => {
      if (!adjustParent) throw new Error("No parent transaction");
      const fee = Number(adjustFee);
      if (Number.isNaN(fee) || fee >= 0) throw new Error("Adjustment fee must be a negative number (credit).");
      const dv = adjustDeclared.trim() === "" ? 0 : Number(adjustDeclared);
      if (Number.isNaN(dv) || dv < 0) throw new Error("Declared value must be non-negative.");
      const q = adjustQty.trim() === "" ? adjustParent.quantity : Number(adjustQty);
      if (Number.isNaN(q) || q <= 0) throw new Error("Quantity must be greater than 0.");
      const res = await fetch("/api/ioms/market/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          parentTransactionId: adjustParent.id,
          marketFeeAmount: fee,
          declaredValue: dv,
          quantity: q,
          transactionDate: adjustDate,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? res.statusText);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/market/transactions"] });
      toast({ title: "Adjustment created", description: "Draft adjustment row linked to the original purchase." });
      setAdjustOpen(false);
      setAdjustParent(null);
      setAdjustFee("");
      setAdjustDeclared("");
      setAdjustQty("");
    },
    onError: (e: Error) => toast({ title: "Adjustment failed", description: e.message, variant: "destructive" }),
  });

  function openAdjust(t: Transaction) {
    setAdjustParent(t);
    setAdjustFee(t.marketFeeAmount > 0 ? String(-Math.abs(t.marketFeeAmount)) : "-1");
    setAdjustDeclared(String(t.declaredValue));
    setAdjustQty(String(t.quantity));
    setAdjustDate(new Date().toISOString().slice(0, 10));
    setAdjustOpen(true);
  }

  const showTxnActions = canVerify || canApprove || canCreate;

  const txnColumns = useMemo((): ReportTableColumn[] => {
    const base: ReportTableColumn[] = [
      { key: "transactionNo", header: "Txn No" },
      { key: "transactionDate", header: "Date" },
      { key: "yardName", header: "Yard" },
      { key: "commodityName", header: "Commodity" },
      { key: "qtyLabel", header: "Qty" },
      { key: "declaredValue", header: "Value" },
      { key: "marketFeeAmount", header: "Fee" },
      { key: "_entryKind", header: "Kind", sortField: "entryKind" },
      { key: "_status", header: "Status", sortField: "status" },
    ];
    if (showTxnActions) base.push({ key: "_actions", header: "Actions" });
    return base;
  }, [showTxnActions]);

  const txnRows = useMemo((): Record<string, unknown>[] => {
    return (list ?? []).map((t) => {
      const yardName = yardById.get(t.yardId)?.name ?? t.yardId;
      const commodityName = commodityById.get(t.commodityId)?.name ?? t.commodityId;
      const kind = t.entryKind ?? "Original";
      return {
        id: t.id,
        transactionNo: t.transactionNo ?? "—",
        transactionDate: t.transactionDate,
        yardName,
        commodityName,
        qtyLabel: `${t.quantity} ${t.unit}`,
        declaredValue: t.declaredValue,
        marketFeeAmount: t.marketFeeAmount,
        entryKind: kind,
        status: t.status,
        _entryKind: (
          <Badge variant={t.entryKind === "Adjustment" ? "outline" : "secondary"}>{kind}</Badge>
        ),
        _status: <Badge variant="secondary">{t.status}</Badge>,
        _actions: showTxnActions ? (
          <div className="flex flex-wrap gap-1">
            {canCreate && t.status === "Approved" && t.entryKind !== "Adjustment" && (
              <Button size="sm" variant="secondary" onClick={() => openAdjust(t)}>
                Adjust
              </Button>
            )}
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
            {canVerify && t.status === "Verified" && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setReturnDraftTxnId(t.id);
                  setReturnDraftRemarks("");
                }}
                disabled={statusMutation.isPending}
              >
                <SendHorizontal className="h-3.5 w-3.5 mr-1" />
                Send back
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
          </div>
        ) : null,
      };
    });
  }, [
    list,
    yardById,
    commodityById,
    showTxnActions,
    canCreate,
    canVerify,
    canApprove,
    statusMutation.isPending,
  ]);

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
            {canVerify && (
              <span className="block mt-1">You can verify Draft → Verified, or return Verified → Draft with remarks.</span>
            )}
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
                      <Input
                        readOnly
                        className="bg-muted font-mono"
                        value={
                          feePreviewPending && feePreviewParamsReady
                            ? "…"
                            : resolvedFeePercent != null && !Number.isNaN(resolvedFeePercent)
                              ? String(resolvedFeePercent)
                              : "—"
                        }
                      />
                      {feePreview?.source ? (
                        <p className="text-xs text-muted-foreground">
                          From {feePreview.source === "matrix_yard" ? "yard matrix" : feePreview.source === "matrix_global" ? "global matrix" : "system default"}.
                        </p>
                      ) : null}
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
            <ClientDataGrid
              columns={txnColumns}
              sourceRows={txnRows}
              searchKeys={[
                "transactionNo",
                "transactionDate",
                "yardName",
                "commodityName",
                "qtyLabel",
                "declaredValue",
                "marketFeeAmount",
                "entryKind",
                "status",
              ]}
              searchPlaceholder="Search transactions…"
              defaultSortKey="transactionDate"
              defaultSortDir="desc"
              emptyMessage="No purchase transactions. Fee Collection uses existing market fee entries."
            />
          )}
        </CardContent>
      </Card>

      <Dialog
        open={returnDraftTxnId !== null}
        onOpenChange={(open) => {
          if (!open) setReturnDraftTxnId(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Send back to Draft</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            DV must record why the transaction is returned (min {MIN_WORKFLOW_REMARKS_LENGTH} characters).
          </p>
          <div className="space-y-2">
            <Label htmlFor="m04-return-remarks">Return remarks</Label>
            <Textarea
              id="m04-return-remarks"
              value={returnDraftRemarks}
              onChange={(e) => setReturnDraftRemarks(e.target.value)}
              rows={4}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setReturnDraftTxnId(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={
                !returnDraftTxnId ||
                returnDraftRemarks.trim().length < MIN_WORKFLOW_REMARKS_LENGTH ||
                statusMutation.isPending
              }
              onClick={() => {
                if (!returnDraftTxnId) return;
                statusMutation.mutate({
                  id: returnDraftTxnId,
                  status: "Draft",
                  returnRemarks: returnDraftRemarks.trim(),
                });
              }}
            >
              Send back
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={adjustOpen} onOpenChange={(o) => !o && setAdjustOpen(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Adjusted return (fee credit)</DialogTitle>
          </DialogHeader>
          {adjustParent && (
            <p className="text-sm text-muted-foreground">
              Links to Approved purchase <span className="font-mono">{adjustParent.transactionNo ?? adjustParent.id}</span>.
              Market fee amount must be negative.
            </p>
          )}
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Market fee amount (negative)</Label>
              <Input type="number" value={adjustFee} onChange={(e) => setAdjustFee(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Declared value (non-negative)</Label>
              <Input type="number" value={adjustDeclared} onChange={(e) => setAdjustDeclared(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Quantity</Label>
              <Input type="number" value={adjustQty} onChange={(e) => setAdjustQty(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Transaction date</Label>
              <Input type="date" value={adjustDate} onChange={(e) => setAdjustDate(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjustOpen(false)} disabled={adjustmentMutation.isPending}>
              Cancel
            </Button>
            <Button onClick={() => adjustmentMutation.mutate()} disabled={adjustmentMutation.isPending}>
              {adjustmentMutation.isPending ? "Creating..." : "Create draft adjustment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
