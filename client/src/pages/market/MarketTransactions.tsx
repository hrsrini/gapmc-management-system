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
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useYardLabels } from "@/hooks/useYardLabels";
import { ApiUserError, readApiErrorEnvelope, fetchApiGet } from "@/lib/queryClient";
import { formatInr } from "@/lib/formatInr";
import { ArrowRightLeft, AlertCircle, Plus } from "lucide-react";
import { Link } from "wouter";
import { localCalendarYmd } from "@shared/premises-allocation";

type ToastInvoker = (props: { title: string; description?: string; variant?: "destructive" }) => void;

/** Maps M-04 market transaction API error codes (POST create/adjustment, PUT update/workflow) to actionable toast copy. */
function toastM04TransactionMutationFailure(
  toast: ToastInvoker,
  code: string | undefined,
  message: string,
  fallbackTitle = "Could not save transaction",
): void {
  switch (code) {
    case "PURCHASE_TX_NOT_FOUND":
      toast({
        title: "Purchase transaction not found",
        description: `${message} Refresh the list, or confirm you still have access to this transaction's yard.`,
        variant: "destructive",
      });
      return;
    case "PURCHASE_TX_STATUS_TRANSITION_DENIED":
      toast({
        title: "Status change not allowed",
        description: `${message} DV verifies Draft → Verified; DA approves Verified → Approved. Use an account with the right role.`,
        variant: "destructive",
      });
      return;
    case "PURCHASE_TX_DO_DV_DA_SEGREGATION":
      toast({
        title: "Workflow segregation",
        description: message,
        variant: "destructive",
      });
      return;
    case "PURCHASE_TX_DV_RETURN_INVALID":
      toast({
        title: "Return to Draft rejected",
        description: `${message} DV must supply valid return remarks when sending Verified → Draft.`,
        variant: "destructive",
      });
      return;
    case "PURCHASE_TX_DRAFT_EDIT_DENIED":
      toast({
        title: "Cannot edit this draft",
        description: `${message} Sign in as Data Originator or Admin to edit draft transactions.`,
        variant: "destructive",
      });
      return;
    case "PURCHASE_TX_QUANTITY_INVALID":
    case "PURCHASE_TX_DECLARED_VALUE_INVALID":
    case "PURCHASE_TX_WEIGHT_INVALID":
    case "PURCHASE_TX_TRANSACTION_DATE_INVALID":
    case "PURCHASE_TX_MARKET_FEE_PERCENT_INVALID":
    case "PURCHASE_TX_MARKET_FEE_AMOUNT_INVALID":
      toast({
        title: "Invalid values",
        description: message,
        variant: "destructive",
      });
      return;
    case "PURCHASE_TX_TRADER_NOT_ACTIVE":
      toast({
        title: "Trader licence not active",
        description: `${message} In Traders → Licences, approve or activate this licence until its status is Active, or choose another trader whose licence is already Active.`,
        variant: "destructive",
      });
      return;
    case "PURCHASE_TX_TRADER_BLOCKED":
      toast({
        title: "Trader licence is blocked",
        description: `${message} Resolve the block in Traders → Licences, or choose another licence.`,
        variant: "destructive",
      });
      return;
    case "PURCHASE_TX_LICENCE_YARD_MISMATCH":
      toast({
        title: "Licence does not match this yard",
        description: `${message} Pick a trader licence registered for the yard you selected.`,
        variant: "destructive",
      });
      return;
    case "PURCHASE_TX_TRADER_OUTSIDE_VALIDITY":
    case "E-AST-002":
      toast({
        title: "Licence date window",
        description: `${message} Change the transaction date or renew/update the licence under Traders → Licences.`,
        variant: "destructive",
      });
      return;
    case "PURCHASE_TX_FUTURE_DATE":
      toast({
        title: "Transaction date not allowed",
        description: message,
        variant: "destructive",
      });
      return;
    case "PURCHASE_TX_YARD_ACCESS_DENIED":
      toast({
        title: "No access to this yard",
        description: message,
        variant: "destructive",
      });
      return;
    case "PURCHASE_TX_LICENCE_NOT_FOUND":
    case "PURCHASE_TX_COMMODITY_NOT_FOUND":
      toast({
        title: code === "PURCHASE_TX_COMMODITY_NOT_FOUND" ? "Commodity not found" : "Trader licence not found",
        description: `${message} Refresh the page and choose a valid ${code === "PURCHASE_TX_COMMODITY_NOT_FOUND" ? "commodity" : "Active trader licence for this yard"}.`,
        variant: "destructive",
      });
      return;
    case "PURCHASE_TX_MARKET_FEE_PERCENT_MISMATCH":
    case "PURCHASE_TX_MARKET_FEE_AMOUNT_MISMATCH":
      toast({
        title: "Market fee does not match current rates",
        description: `${message} For edits, align declared value, fee %, and fee amount with the effective rate for that yard, commodity, and date.`,
        variant: "destructive",
      });
      return;
    default:
      toast({ title: fallbackTitle, description: message, variant: "destructive" });
  }
}
interface Transaction {
  id: string;
  transactionNo?: string | null;
  yardId: string;
  commodityId: string;
  traderLicenceId: string;
  /** Joined from trader_licences for list display (API GET /transactions). */
  traderFirmName?: string | null;
  /** Issued numeric licence, or provisional ref when final number not yet issued. */
  traderLicenceNumber?: string | null;
  traderProvisionalLicenceNo?: string | null;
  quantity: number;
  unit: string;
  declaredValue: number;
  marketFeeAmount: number;
  transactionDate: string;
  isGracePeriod?: boolean | null;
  status: string;
  workflowRevisionCount?: number | null;
  dvReturnRemarks?: string | null;
  parentTransactionId?: string | null;
  entryKind?: string | null;
  /** API list aliases / joined fields */
  traderName?: string | null;
  licenceNo?: string | null;
  traderFirmNameSnapshot?: string | null;
  traderLicenceNoSnapshot?: string | null;
  /** Server canonical display (GET/POST); prefer in UI. */
  displayTraderName?: string | null;
  displayTraderLicence?: string | null;
}

function firstNonEmpty(...vals: unknown[]): string {
  for (const v of vals) {
    if (v == null) continue;
    const s = String(v).trim();
    if (s !== "") return s;
  }
  return "";
}

/** Normalize list payload so the grid always gets trader + txn fields (camel/snake/API variants). */
function normalizeMarketTransactionList(raw: unknown): Transaction[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const r = item as Record<string, unknown>;
    const pick = (...keys: string[]): string | null => {
      for (const k of keys) {
        const v = r[k];
        if (v != null && String(v).trim() !== "") return String(v).trim();
      }
      return null;
    };
    const base = item as Transaction;
    const tf = firstNonEmpty(
      pick("displayTraderName", "display_trader_name"),
      pick("traderName", "traderFirmName", "trader_firm_name", "trader_name"),
      pick("traderFirmNameSnapshot", "trader_firm_name_snapshot"),
      base.traderFirmName,
      base.traderName,
      base.displayTraderName,
    );
    const tl = firstNonEmpty(
      pick("displayTraderLicence", "display_trader_licence"),
      pick("licenceNo", "traderLicenceNumber", "trader_licence_number", "licence_no"),
      pick("traderLicenceNoSnapshot", "trader_licence_no_snapshot"),
      base.traderLicenceNumber,
      base.licenceNo,
      base.displayTraderLicence,
    );
    const txMerged = firstNonEmpty(
      pick("transactionNo", "transaction_no", "displayTransactionNo", "display_transaction_no"),
      base.transactionNo != null && String(base.transactionNo).trim() !== ""
        ? String(base.transactionNo).trim()
        : null,
    );
    return {
      ...base,
      traderFirmName: tf || null,
      traderLicenceNumber: tl || null,
      transactionNo: txMerged || null,
    };
  });
}

export default function MarketTransactions() {
  const { can } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const canCreate = can("M-04", "Create");

  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustParent, setAdjustParent] = useState<Transaction | null>(null);
  const [adjustFee, setAdjustFee] = useState("");
  const [adjustDeclared, setAdjustDeclared] = useState("");
  const [adjustQty, setAdjustQty] = useState("");
  const [adjustDate, setAdjustDate] = useState(() => localCalendarYmd());

  const { data: list, isLoading, isError } = useQuery<Transaction[]>({
    queryKey: ["/api/ioms/market/transactions"],
    queryFn: async () => {
      const raw = await fetchApiGet<unknown>("/api/ioms/market/transactions");
      return normalizeMarketTransactionList(raw);
    },
    structuralSharing: false,
    staleTime: 0,
    refetchOnMount: "always",
  });

  type WizardTransaction = {
    id: string;
    transactionNo?: string | null;
    caseType: string;
    entryLocationId: string;
    transactionDate: string;
    totalPayable?: number | null;
    totalMarketFee?: number | null;
    status: string;
    receiptId?: string | null;
    traderManualName?: string | null;
  };
  const { data: wizardList = [], isLoading: wizardLoading } = useQuery<WizardTransaction[]>({
    queryKey: ["/api/ioms/market/transaction-wizard"],
    queryFn: () => fetchApiGet<WizardTransaction[]>("/api/ioms/market/transaction-wizard"),
    staleTime: 0,
    refetchOnMount: "always",
  });

  type LicenceRow = {
    id: string;
    firmName: string;
    licenceNo?: string | null;
    provisionalLicenceNo?: string | null;
    entityPublicCode?: string | null;
  };
  const { data: licenceListForGrid = [] } = useQuery<LicenceRow[]>({
    queryKey: ["m04-market-tx-licence-lookup"],
    queryFn: () => fetchApiGet<LicenceRow[]>("/api/ioms/traders/licences"),
    staleTime: 0,
    refetchOnMount: "always",
  });

  const licenceDisplayById = useMemo(() => {
    const m = new Map<string, { firm: string; lic: string }>();
    for (const l of licenceListForGrid) {
      const lic =
        firstNonEmpty(l.licenceNo, l.provisionalLicenceNo, l.entityPublicCode) || "";
      const firm = firstNonEmpty(l.firmName) || "";
      m.set(String(l.id).trim(), { firm, lic });
    }
    return m;
  }, [licenceListForGrid]);

  const { data: commodities = [] } = useQuery<Array<{ id: string; name: string; unit?: string | null }>>({
    queryKey: ["/api/ioms/commodities"],
  });
  const { getYardName } = useYardLabels();
  const commodityById = useMemo(() => new Map(commodities.map((c) => [c.id, c])), [commodities]);

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
        const { message, code } = await readApiErrorEnvelope(res);
        throw new ApiUserError(message, code);
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
    onError: (e: unknown) => {
      const message = e instanceof Error ? e.message : String(e);
      const code = e instanceof ApiUserError ? e.code : undefined;
      toastM04TransactionMutationFailure(toast, code, message, "Adjustment failed");
    },
  });

  function openAdjust(t: Transaction) {
    setAdjustParent(t);
    setAdjustFee(t.marketFeeAmount > 0 ? String(-Math.abs(t.marketFeeAmount)) : "-1");
    setAdjustDeclared(String(t.declaredValue));
    setAdjustQty(String(t.quantity));
    setAdjustDate(localCalendarYmd());
    setAdjustOpen(true);
  }

  const showTxnActions = canCreate;

  const txnColumns = useMemo((): ReportTableColumn[] => {
    const base: ReportTableColumn[] = [
      { key: "transactionNo", header: "Txn No" },
      { key: "transactionDate", header: "Date" },
      { key: "yardName", header: "Yard" },
      { key: "traderName", header: "Trader name" },
      { key: "traderLicenceNo", header: "Licence No." },
      { key: "commodityName", header: "Commodity" },
      { key: "qtyLabel", header: "Qty" },
      { key: "_value", header: "Value (₹)", sortField: "declaredValue" },
      { key: "_fee", header: "Fee (₹)", sortField: "marketFeeAmount" },
      { key: "_entryKind", header: "Kind", sortField: "entryKind" },
      { key: "_status", header: "Status", sortField: "status" },
    ];
    if (showTxnActions) base.push({ key: "_actions", header: "Actions" });
    return base;
  }, [showTxnActions]);

  const wizardColumns = useMemo(
    (): ReportTableColumn[] => [
      { key: "transactionNo", header: "Txn No" },
      { key: "caseType", header: "Case" },
      { key: "transactionDate", header: "Date" },
      { key: "yardName", header: "Yard" },
      { key: "_payable", header: "Payable (₹)", sortField: "totalPayable" },
      { key: "_status", header: "Status", sortField: "status" },
      { key: "_receipt", header: "Receipt" },
    ],
    [],
  );

  const wizardRows = useMemo((): Record<string, unknown>[] => {
    return wizardList.map((t) => ({
      id: t.id,
      transactionNo: t.transactionNo ?? "—",
      caseType: t.caseType,
      transactionDate: t.transactionDate,
      yardName: getYardName(t.entryLocationId),
      totalPayable: Number(t.totalPayable ?? 0),
      _payable: formatInr(Number(t.totalPayable ?? 0)),
      status: t.status,
      _status: <Badge variant={t.status === "Finalized" ? "default" : "secondary"}>{t.status}</Badge>,
      _receipt:
        t.receiptId && t.status === "Finalized" ? (
          <Link href="/receipts/ioms" className="text-primary hover:underline text-sm">
            View receipts
          </Link>
        ) : (
          "—"
        ),
    }));
  }, [wizardList, getYardName]);

  const txnRows = useMemo((): Record<string, unknown>[] => {
    return (list ?? []).map((t) => {
      const yardName = getYardName(t.yardId);
      const commodityName = commodityById.get(t.commodityId)?.name ?? t.commodityId;
      const raw = t as unknown as Record<string, unknown>;
      const master = licenceDisplayById.get(String(t.traderLicenceId ?? "").trim());
      const firm = firstNonEmpty(
        t.displayTraderName,
        raw["display_trader_name"],
        t.traderName,
        t.traderFirmName,
        raw["trader_name"],
        raw["trader_firm_name"],
        raw["traderFirmNameSnapshot"],
        raw["trader_firm_name_snapshot"],
        master?.firm,
      );
      const licNo = firstNonEmpty(
        t.displayTraderLicence,
        raw["display_trader_licence"],
        t.licenceNo,
        t.traderLicenceNumber,
        raw["licence_no"],
        raw["trader_licence_number"],
        raw["traderLicenceNoSnapshot"],
        raw["trader_licence_no_snapshot"],
        master?.lic,
      );
      const provOnly = firstNonEmpty(t.traderProvisionalLicenceNo, raw["trader_provisional_licence_no"]);
      const refForLabel = firstNonEmpty(licNo, provOnly);
      const traderName = firm;
      const traderLicenceNo = refForLabel;
      const kind = t.entryKind ?? "Original";
      return {
        id: t.id,
        transactionNo:
          firstNonEmpty(
            t.transactionNo,
            raw["transaction_no"],
            raw["displayTransactionNo"],
            raw["display_transaction_no"],
          ) || "—",
        transactionDate: t.transactionDate,
        yardName,
        traderName,
        traderLicenceNo,
        commodityName,
        qtyLabel: `${t.quantity} ${t.unit}`,
        declaredValue: t.declaredValue,
        marketFeeAmount: t.marketFeeAmount,
        _value: formatInr(t.declaredValue),
        _fee: formatInr(t.marketFeeAmount),
        entryKind: kind,
        status: t.status,
        _entryKind: (
          <Badge variant={t.entryKind === "Adjustment" ? "outline" : "secondary"}>{kind}</Badge>
        ),
        _status: (
          <div className="flex flex-col gap-1">
            <Badge variant="secondary">{t.status}</Badge>
            {t.isGracePeriod ? (
              <span className="text-[11px] text-amber-700 dark:text-amber-400">
                Grace period (renewal pending)
              </span>
            ) : null}
          </div>
        ),
        _actions: showTxnActions ? (
          <div className="flex flex-wrap gap-1">
            {canCreate && t.status === "Approved" && t.entryKind !== "Adjustment" && (
              <Button size="sm" variant="secondary" onClick={() => openAdjust(t)}>
                Adjust
              </Button>
            )}
          </div>
        ) : null,
      };
    });
  }, [
    list,
    getYardName,
    commodityById,
    licenceDisplayById,
    showTxnActions,
    canCreate,
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
            Legacy purchase entries and adjustments. New Cases A–G entries are created only through the Transaction Wizard.
          </p>
          </div>
          {canCreate && (
            <Button size="sm" asChild>
              <Link href="/market/transactions/new">
                <Plus className="h-4 w-4 mr-2" />
                Transaction wizard
              </Link>
            </Button>
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
                "traderName",
                "traderFirmName",
                "displayTraderName",
                "traderLicenceNo",
                "licenceNo",
                "traderLicenceNumber",
                "displayTraderLicence",
                "commodityName",
                "qtyLabel",
                "_value",
                "_fee",
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

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Wizard transactions (cases A–G)</CardTitle>
          <p className="text-sm text-muted-foreground">
            Counter entries from the unified transaction wizard — effective immediately on submit (no verification or approval).
          </p>
        </CardHeader>
        <CardContent>
          {wizardLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : (
            <ClientDataGrid
              columns={wizardColumns}
              sourceRows={wizardRows}
              searchKeys={["transactionNo", "caseType", "transactionDate", "yardName", "status"]}
              searchPlaceholder="Search wizard transactions…"
              defaultSortKey="transactionDate"
              defaultSortDir="desc"
              emptyMessage="No wizard transactions yet. Use Transaction wizard to create one."
            />
          )}
        </CardContent>
      </Card>

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
              <Label>Market fee amount (₹, negative)</Label>
              <Input type="number" value={adjustFee} onChange={(e) => setAdjustFee(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Declared value (₹, non-negative)</Label>
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
