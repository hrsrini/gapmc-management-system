import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { readApiErrorEnvelope } from "@/lib/queryClient";
import { formatInr } from "@/lib/formatInr";
import {
  MARKET_TRANSACTION_CASES,
  type MarketTransactionCalculation,
  type MarketTransactionCaseId,
  type MarketTransactionWizardInput,
} from "@shared/market-transaction-cases";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  Package,
  Receipt,
  Truck,
  User,
} from "lucide-react";

const CASE_IDS: MarketTransactionCaseId[] = ["A", "B", "C", "D", "E", "F", "G"];

type CommodityLineDraft = {
  key: string;
  commodityId: string;
  quantity: string;
  unit: string;
  ratePerUnit: string;
};

type WizardStep = "case" | "party" | "commodities" | "payment";

function emptyLine(): CommodityLineDraft {
  return { key: crypto.randomUUID(), commodityId: "", quantity: "", unit: "Kg", ratePerUnit: "" };
}

function buildPayload(args: {
  caseType: MarketTransactionCaseId;
  entryLocationId: string;
  transactionDate: string;
  transactionTime: string;
  captureMode: string;
  captureLocationText: string;
  vehicleNumber: string;
  vehicleMake: string;
  vehicleCapacityKg: string;
  traderLicenceId: string;
  traderManualName: string;
  traderManualContact: string;
  traderManualAddress: string;
  receiverTraderLicenceId: string;
  feePayer: string;
  sellerType: string;
  farmerType: string;
  farmerName: string;
  farmerKrishiCard: string;
  farmerContact: string;
  farmerAddress: string;
  commoditySource: string;
  placeOfOrigin: string;
  originatingState: string;
  destinationState: string;
  fineAmount: string;
  securityDepositAmount: string;
  adminChargesAmount: string;
  collectFine: boolean;
  lines: CommodityLineDraft[];
}): MarketTransactionWizardInput {
  const meta = MARKET_TRANSACTION_CASES[args.caseType];
  return {
    caseType: args.caseType,
    entryLocationId: args.entryLocationId.trim(),
    transactionDate: args.transactionDate.trim(),
    transactionTime: args.transactionTime.trim() || null,
    captureMode: args.captureMode as MarketTransactionWizardInput["captureMode"],
    captureLocationText: args.captureLocationText.trim() || null,
    vehicleNumber: args.vehicleNumber.trim() || null,
    vehicleMake: args.vehicleMake.trim() || null,
    vehicleCapacityKg: args.vehicleCapacityKg.trim() ? Number(args.vehicleCapacityKg) : null,
    traderLicenceId: args.traderLicenceId.trim() || null,
    traderManualName: args.traderManualName.trim() || null,
    traderManualContact: args.traderManualContact.trim() || null,
    traderManualAddress: args.traderManualAddress.trim() || null,
    receiverTraderLicenceId: args.receiverTraderLicenceId.trim() || null,
    feePayer: (args.feePayer as MarketTransactionWizardInput["feePayer"]) || null,
    sellerType: (args.sellerType as MarketTransactionWizardInput["sellerType"]) || null,
    farmerType: (args.farmerType as MarketTransactionWizardInput["farmerType"]) || null,
    farmerName: args.farmerName.trim() || null,
    farmerKrishiCard: args.farmerKrishiCard.trim() || null,
    farmerContact: args.farmerContact.trim() || null,
    farmerAddress: args.farmerAddress.trim() || null,
    commoditySource: (args.commoditySource as MarketTransactionWizardInput["commoditySource"]) || null,
    placeOfOrigin: args.placeOfOrigin.trim() || null,
    originatingState: args.originatingState.trim() || null,
    destinationState: args.destinationState.trim() || null,
    fineAmount: args.fineAmount.trim() ? Number(args.fineAmount) : undefined,
    securityDepositAmount: args.securityDepositAmount.trim()
      ? Number(args.securityDepositAmount)
      : meta.defaultSecurityDeposit,
    adminChargesAmount: args.adminChargesAmount.trim() ? Number(args.adminChargesAmount) : meta.defaultAdminCharges,
    collectFine: args.collectFine,
    commodities: args.lines
      .filter((l) => l.commodityId.trim() && Number(l.quantity) > 0)
      .map((l) => ({
        commodityId: l.commodityId.trim(),
        quantity: Number(l.quantity),
        unit: l.unit.trim() || "Kg",
        ratePerUnit: Number(l.ratePerUnit || 0),
      })),
  };
}

const STEPS: { id: WizardStep; label: string; icon: typeof User }[] = [
  { id: "case", label: "Case", icon: ClipboardList },
  { id: "party", label: "Party", icon: User },
  { id: "commodities", label: "Commodities", icon: Package },
  { id: "payment", label: "Payment", icon: Receipt },
];

export default function MarketTransactionWizard() {
  const { can } = useAuth();
  const canCreate = can("M-04", "Create");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<WizardStep>("case");
  const [caseType, setCaseType] = useState<MarketTransactionCaseId>("A");
  const [entryLocationId, setEntryLocationId] = useState("");
  const [transactionDate, setTransactionDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [transactionTime, setTransactionTime] = useState("");
  const [captureMode, setCaptureMode] = useState("Normal");
  const [captureLocationText, setCaptureLocationText] = useState("");
  const [vehicleNumber, setVehicleNumber] = useState("");
  const [vehicleMake, setVehicleMake] = useState("");
  const [vehicleCapacityKg, setVehicleCapacityKg] = useState("");
  const [traderLicenceId, setTraderLicenceId] = useState("");
  const [traderManualName, setTraderManualName] = useState("");
  const [traderManualContact, setTraderManualContact] = useState("");
  const [traderManualAddress, setTraderManualAddress] = useState("");
  const [receiverTraderLicenceId, setReceiverTraderLicenceId] = useState("");
  const [feePayer, setFeePayer] = useState("Originator");
  const [sellerType, setSellerType] = useState("Farmer");
  const [farmerType, setFarmerType] = useState("Local");
  const [farmerName, setFarmerName] = useState("");
  const [farmerKrishiCard, setFarmerKrishiCard] = useState("");
  const [farmerContact, setFarmerContact] = useState("");
  const [farmerAddress, setFarmerAddress] = useState("");
  const [commoditySource, setCommoditySource] = useState("Local");
  const [placeOfOrigin, setPlaceOfOrigin] = useState("");
  const [originatingState, setOriginatingState] = useState("");
  const [destinationState, setDestinationState] = useState("");
  const [fineAmount, setFineAmount] = useState("");
  const [securityDepositAmount, setSecurityDepositAmount] = useState("");
  const [adminChargesAmount, setAdminChargesAmount] = useState("");
  const [collectFine, setCollectFine] = useState(false);
  const [lines, setLines] = useState<CommodityLineDraft[]>([emptyLine()]);
  const [paymentMode, setPaymentMode] = useState("Cash");
  const [chequeNo, setChequeNo] = useState("");
  const [bankName, setBankName] = useState("");
  const [chequeDate, setChequeDate] = useState("");
  const [utrNo, setUtrNo] = useState("");
  const [transactionNo, setTransactionNo] = useState<string | null>(null);
  const [calculation, setCalculation] = useState<MarketTransactionCalculation | null>(null);
  const [receiptResult, setReceiptResult] = useState<{ receiptId: string; receiptNo: string } | null>(null);

  const meta = MARKET_TRANSACTION_CASES[caseType];

  useEffect(() => {
    if (caseType === "G") setCaptureMode("FlyingSquad");
    else if (captureMode === "FlyingSquad" || captureMode === "YardInspection") setCaptureMode("Normal");
  }, [caseType, captureMode]);

  useEffect(() => {
    if (caseType === "B" || caseType === "C") setCollectFine(true);
    if (caseType === "E") {
      if (!securityDepositAmount) setSecurityDepositAmount(String(meta.defaultSecurityDeposit));
      if (!adminChargesAmount) setAdminChargesAmount(String(meta.defaultAdminCharges));
    }
  }, [caseType, meta.defaultAdminCharges, meta.defaultSecurityDeposit, securityDepositAmount, adminChargesAmount]);

  const { data: yards = [] } = useQuery<Array<{ id: string; name: string; code: string }>>({
    queryKey: ["/api/yards"],
  });
  const { data: commodities = [] } = useQuery<Array<{ id: string; name: string; unit?: string | null }>>({
    queryKey: ["/api/ioms/commodities"],
  });
  const commodityById = useMemo(() => new Map(commodities.map((c) => [c.id, c])), [commodities]);

  const licenceStatusFilter = caseType === "B" ? undefined : "Active";
  const { data: licences = [] } = useQuery<Array<{ id: string; firmName: string; licenceNo?: string | null }>>({
    queryKey: ["wizard-licences", entryLocationId, licenceStatusFilter],
    queryFn: async () => {
      const u = new URL("/api/ioms/traders/licences", window.location.origin);
      u.searchParams.set("yardId", entryLocationId);
      if (licenceStatusFilter) u.searchParams.set("status", licenceStatusFilter);
      const r = await fetch(u.toString(), { credentials: "include" });
      if (!r.ok) {
        const { message } = await readApiErrorEnvelope(r);
        throw new Error(message);
      }
      return r.json();
    },
    enabled: Boolean(entryLocationId.trim()),
  });

  const payload = useMemo(
    () =>
      buildPayload({
        caseType,
        entryLocationId,
        transactionDate,
        transactionTime,
        captureMode,
        captureLocationText,
        vehicleNumber,
        vehicleMake,
        vehicleCapacityKg,
        traderLicenceId,
        traderManualName,
        traderManualContact,
        traderManualAddress,
        receiverTraderLicenceId,
        feePayer,
        sellerType,
        farmerType,
        farmerName,
        farmerKrishiCard,
        farmerContact,
        farmerAddress,
        commoditySource,
        placeOfOrigin,
        originatingState,
        destinationState,
        fineAmount,
        securityDepositAmount,
        adminChargesAmount,
        collectFine,
        lines,
      }),
    [
      caseType,
      entryLocationId,
      transactionDate,
      transactionTime,
      captureMode,
      captureLocationText,
      vehicleNumber,
      vehicleMake,
      vehicleCapacityKg,
      traderLicenceId,
      traderManualName,
      traderManualContact,
      traderManualAddress,
      receiverTraderLicenceId,
      feePayer,
      sellerType,
      farmerType,
      farmerName,
      farmerKrishiCard,
      farmerContact,
      farmerAddress,
      commoditySource,
      placeOfOrigin,
      originatingState,
      destinationState,
      fineAmount,
      securityDepositAmount,
      adminChargesAmount,
      collectFine,
      lines,
    ],
  );

  const partyValidation = useMemo(() => {
    if (!entryLocationId.trim()) return "Select entry location (yard).";
    if (!transactionDate.trim()) return "Transaction date is required.";
    if (meta.requiresTraderLicence && !traderLicenceId.trim()) return "Trader licence is required.";
    if (meta.requiresManualTrader && !traderManualName.trim()) return "Trader name is required.";
    if (meta.requiresReceiverTrader && !receiverTraderLicenceId.trim()) return "Receiver trader is required.";
    if (meta.requiresFeePayer && feePayer !== "Originator" && feePayer !== "Receiver") return "Select fee payer.";
    if (meta.requiresTransitFields && (!originatingState.trim() || !destinationState.trim())) {
      return "Originating and destination state are required.";
    }
    if (meta.requiresFarmer && sellerType === "Farmer" && !farmerName.trim()) return "Farmer name is required.";
    if (meta.allowsFine && (caseType === "B" || caseType === "C") && !(Number(fineAmount) > 0)) {
      return "Fine amount is required.";
    }
    return null;
  }, [
    entryLocationId,
    transactionDate,
    meta,
    traderLicenceId,
    traderManualName,
    receiverTraderLicenceId,
    feePayer,
    originatingState,
    destinationState,
    sellerType,
    farmerName,
    fineAmount,
    caseType,
  ]);

  const commoditiesValidation = useMemo(() => {
    if (payload.commodities.length === 0) return "Add at least one commodity line.";
    for (const l of payload.commodities) {
      if (!Number.isFinite(l.ratePerUnit) || l.ratePerUnit < 0) return "Rate per unit must be valid.";
    }
    return null;
  }, [payload.commodities]);

  const calculateMutation = useMutation({
    mutationFn: async (body: MarketTransactionWizardInput) => {
      const res = await fetch("/api/ioms/market/transaction-wizard/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const { message } = await readApiErrorEnvelope(res);
        throw new Error(message);
      }
      return res.json() as Promise<MarketTransactionCalculation>;
    },
    onSuccess: (data) => setCalculation(data),
    onError: (e: Error) => toast({ title: "Calculation failed", description: e.message, variant: "destructive" }),
  });

  const payloadKey = useMemo(() => JSON.stringify(payload), [payload]);

  useEffect(() => {
    if (step !== "payment" && step !== "commodities") return;
    if (!entryLocationId.trim() || payload.commodities.length === 0) return;
    if (partyValidation) return;
    if (step === "commodities" && commoditiesValidation) return;

    const timer = window.setTimeout(() => {
      calculateMutation.mutate(payload);
    }, 400);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- debounce on payloadKey only
  }, [step, entryLocationId, payloadKey, partyValidation, commoditiesValidation]);

  const finalizeMutation = useMutation({
    mutationFn: async () => {
      if (partyValidation) throw new Error(partyValidation);
      if (commoditiesValidation) throw new Error(commoditiesValidation);
      if (paymentMode === "Cheque" && (!chequeNo.trim() || !bankName.trim() || !chequeDate.trim())) {
        throw new Error("Cheque number, bank, and cheque date are required.");
      }
      if (paymentMode === "Online" && !utrNo.trim()) {
        throw new Error("UTR / reference is required for online payment.");
      }
      if (!calculation) {
        throw new Error("Could not determine totals. Go back and review commodity lines.");
      }

      const paymentDetail: Record<string, string> = {};
      if (paymentMode === "Cheque") {
        paymentDetail.chequeNo = chequeNo;
        paymentDetail.bankName = bankName;
        paymentDetail.chequeDate = chequeDate;
      }
      if (paymentMode === "Online") paymentDetail.utrNo = utrNo;

      const res = await fetch("/api/ioms/market/transaction-wizard/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          ...payload,
          paymentMode,
          paymentDetail: Object.keys(paymentDetail).length ? paymentDetail : undefined,
          paidAmount: calculation.totalPayable,
        }),
      });
      if (!res.ok) {
        const { message } = await readApiErrorEnvelope(res);
        throw new Error(message);
      }
      return res.json() as Promise<{
        id: string;
        transactionNo: string;
        receiptId: string;
        receiptNo: string;
        calculation: MarketTransactionCalculation;
      }>;
    },
    onSuccess: (data) => {
      setTransactionNo(data.transactionNo);
      setCalculation(data.calculation);
      setReceiptResult({ receiptId: data.receiptId, receiptNo: data.receiptNo });
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/market/transaction-wizard"] });
      toast({ title: "Transaction submitted", description: `Recorded with receipt ${data.receiptNo}` });
    },
    onError: (e: Error) => toast({ title: "Submit failed", description: e.message, variant: "destructive" }),
  });

  const stepIndex = STEPS.findIndex((s) => s.id === step);

  function updateLine(key: string, patch: Partial<CommodityLineDraft>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function onCommodityPick(key: string, commodityId: string) {
    const c = commodityById.get(commodityId);
    const unit = c?.unit != null && String(c.unit).trim() !== "" ? String(c.unit).trim() : "Kg";
    updateLine(key, { commodityId, unit });
  }

  if (!canCreate) {
    return (
      <AppShell breadcrumbs={[{ label: "Market (M-04)", href: "/market/transactions" }, { label: "New transaction" }]}>
        <Card>
          <CardContent className="p-6 text-muted-foreground">
            You need M-04 Create permission to use the transaction wizard.
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  if (receiptResult) {
    return (
      <AppShell breadcrumbs={[{ label: "Market (M-04)", href: "/market/transactions" }, { label: "New transaction" }]}>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-green-700">
              <CheckCircle2 className="h-5 w-5" />
              Transaction complete
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {transactionNo && <p className="font-mono text-sm">Transaction: {transactionNo}</p>}
            <p className="font-mono text-sm">Receipt: {receiptResult.receiptNo}</p>
            <p className="text-sm text-muted-foreground">Total paid: {formatInr(calculation?.totalPayable ?? 0)}</p>
            <div className="flex gap-2 pt-2">
              <Button asChild variant="outline">
                <Link href="/market/transactions">Back to transactions</Link>
              </Button>
              <Button asChild>
                <Link href={`/receipts/ioms?receiptNo=${encodeURIComponent(receiptResult.receiptNo)}`}>View receipt</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Market (M-04)", href: "/market/transactions" }, { label: "New transaction" }]}>
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Market transaction wizard</h1>
          <p className="text-sm text-muted-foreground">
            Cases A–G — submit once at the counter; no verification or approval step.
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href="/market/transactions">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Cancel
          </Link>
        </Button>
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        {STEPS.map((s, i) => (
          <Badge key={s.id} variant={s.id === step ? "default" : i < stepIndex ? "secondary" : "outline"}>
            {i + 1}. {s.label}
          </Badge>
        ))}
      </div>

      {step === "case" && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {CASE_IDS.map((id) => {
            const c = MARKET_TRANSACTION_CASES[id];
            const selected = caseType === id;
            return (
              <Card
                key={id}
                className={`cursor-pointer transition-colors ${selected ? "border-primary ring-1 ring-primary" : "hover:border-muted-foreground/40"}`}
                onClick={() => setCaseType(id)}
              >
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <span className="font-mono text-primary">{id}</span>
                    {c.title}
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground space-y-1">
                  <p>{c.subtitle}</p>
                  <p className="text-xs font-medium text-foreground">Receipt: {c.receiptSummary}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {step === "party" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="h-5 w-5" />
              Party &amp; entry — Case {caseType}: {meta.title}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1 sm:col-span-2">
              <Label>Entry location (yard)</Label>
              <Select value={entryLocationId || undefined} onValueChange={(v) => { setEntryLocationId(v); setTraderLicenceId(""); setReceiverTraderLicenceId(""); }}>
                <SelectTrigger><SelectValue placeholder="Select yard" /></SelectTrigger>
                <SelectContent>
                  {yards.map((y) => (
                    <SelectItem key={y.id} value={y.id}>{y.name} ({y.code})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Transaction date</Label>
              <Input type="date" value={transactionDate} onChange={(e) => setTransactionDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Time (optional)</Label>
              <Input type="time" value={transactionTime} onChange={(e) => setTransactionTime(e.target.value)} />
            </div>

            {caseType === "G" && (
              <>
                <div className="space-y-1">
                  <Label>Capture mode</Label>
                  <Select value={captureMode} onValueChange={setCaptureMode}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="FlyingSquad">Flying squad</SelectItem>
                      <SelectItem value="YardInspection">Yard inspection</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Capture location</Label>
                  <Input value={captureLocationText} onChange={(e) => setCaptureLocationText(e.target.value)} />
                </div>
              </>
            )}

            <div className="space-y-1 sm:col-span-2 border-t pt-4">
              <Label className="flex items-center gap-1"><Truck className="h-4 w-4" /> Vehicle</Label>
            </div>
            <div className="space-y-1">
              <Label>Vehicle number</Label>
              <Input value={vehicleNumber} onChange={(e) => setVehicleNumber(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Make / model</Label>
              <Input value={vehicleMake} onChange={(e) => setVehicleMake(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Capacity (kg)</Label>
              <Input type="number" value={vehicleCapacityKg} onChange={(e) => setVehicleCapacityKg(e.target.value)} />
            </div>

            {meta.requiresTraderLicence && (
              <div className="space-y-1 sm:col-span-2 border-t pt-4">
                <Label>Trader licence {caseType === "B" ? "(expired)" : ""}</Label>
                <Select value={traderLicenceId || undefined} onValueChange={setTraderLicenceId} disabled={!entryLocationId}>
                  <SelectTrigger><SelectValue placeholder={entryLocationId ? "Select trader" : "Select yard first"} /></SelectTrigger>
                  <SelectContent>
                    {licences.map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        {(l.firmName ?? l.id).slice(0, 48)}{l.licenceNo ? ` — ${l.licenceNo}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {meta.requiresManualTrader && (
              <>
                <div className="space-y-1 sm:col-span-2 border-t pt-4"><Label>Unregistered trader</Label></div>
                <div className="space-y-1"><Label>Name</Label><Input value={traderManualName} onChange={(e) => setTraderManualName(e.target.value)} /></div>
                <div className="space-y-1"><Label>Contact</Label><Input value={traderManualContact} onChange={(e) => setTraderManualContact(e.target.value)} /></div>
                <div className="space-y-1 sm:col-span-2"><Label>Address</Label><Textarea value={traderManualAddress} onChange={(e) => setTraderManualAddress(e.target.value)} rows={2} /></div>
              </>
            )}

            {meta.requiresReceiverTrader && (
              <>
                <div className="space-y-1 sm:col-span-2 border-t pt-4"><Label>Receiver trader (within Goa)</Label></div>
                <div className="space-y-1 sm:col-span-2">
                  <Select value={receiverTraderLicenceId || undefined} onValueChange={setReceiverTraderLicenceId} disabled={!entryLocationId}>
                    <SelectTrigger><SelectValue placeholder="Select receiver" /></SelectTrigger>
                    <SelectContent>
                      {licences.filter((l) => l.id !== traderLicenceId).map((l) => (
                        <SelectItem key={l.id} value={l.id}>{l.firmName}{l.licenceNo ? ` — ${l.licenceNo}` : ""}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label>Market fee paid by</Label>
                  <Select value={feePayer} onValueChange={setFeePayer}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Originator">Originator trader</SelectItem>
                      <SelectItem value="Receiver">Receiver trader</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}

            {meta.requiresFarmer && (
              <>
                <div className="space-y-1 sm:col-span-2 border-t pt-4"><Label>Seller / source</Label></div>
                <div className="space-y-1">
                  <Label>Seller type</Label>
                  <Select value={sellerType} onValueChange={setSellerType}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Farmer">Farmer</SelectItem>
                      <SelectItem value="Trader">Trader (outside)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Commodity source</Label>
                  <Select value={commoditySource} onValueChange={setCommoditySource}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Local">Local (Goa)</SelectItem>
                      <SelectItem value="OutsideState">Outside state</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {sellerType === "Farmer" && (
                  <>
                    <div className="space-y-1">
                      <Label>Farmer type</Label>
                      <Select value={farmerType} onValueChange={setFarmerType}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Local">Local farmer</SelectItem>
                          <SelectItem value="OutsideState">Outside state farmer</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1"><Label>Farmer name</Label><Input value={farmerName} onChange={(e) => setFarmerName(e.target.value)} /></div>
                    <div className="space-y-1"><Label>Krishi card</Label><Input value={farmerKrishiCard} onChange={(e) => setFarmerKrishiCard(e.target.value)} /></div>
                    <div className="space-y-1"><Label>Contact</Label><Input value={farmerContact} onChange={(e) => setFarmerContact(e.target.value)} /></div>
                    <div className="space-y-1 sm:col-span-2"><Label>Address</Label><Textarea value={farmerAddress} onChange={(e) => setFarmerAddress(e.target.value)} rows={2} /></div>
                  </>
                )}
                <div className="space-y-1 sm:col-span-2"><Label>Place of origin</Label><Input value={placeOfOrigin} onChange={(e) => setPlaceOfOrigin(e.target.value)} /></div>
              </>
            )}

            {meta.requiresTransitFields && (
              <>
                <div className="space-y-1 sm:col-span-2 border-t pt-4"><Label>Transit (Case E)</Label></div>
                <div className="space-y-1"><Label>Originating state</Label><Input value={originatingState} onChange={(e) => setOriginatingState(e.target.value)} /></div>
                <div className="space-y-1"><Label>Destination state</Label><Input value={destinationState} onChange={(e) => setDestinationState(e.target.value)} /></div>
                <div className="space-y-1"><Label>Security deposit (₹)</Label><Input type="number" value={securityDepositAmount} onChange={(e) => setSecurityDepositAmount(e.target.value)} /></div>
                <div className="space-y-1"><Label>Admin charges (₹)</Label><Input type="number" value={adminChargesAmount} onChange={(e) => setAdminChargesAmount(e.target.value)} /></div>
              </>
            )}

            {meta.allowsFine && caseType !== "E" && (
              <div className="space-y-2 sm:col-span-2 border-t pt-4">
                <div className="flex items-center gap-2">
                  <Checkbox id="collectFine" checked={collectFine} onCheckedChange={(v) => setCollectFine(Boolean(v))} disabled={caseType === "B" || caseType === "C"} />
                  <Label htmlFor="collectFine">Collect fine</Label>
                </div>
                {collectFine && (
                  <div className="space-y-1 max-w-xs">
                    <Label>Fine amount (₹)</Label>
                    <Input type="number" value={fineAmount} onChange={(e) => setFineAmount(e.target.value)} />
                  </div>
                )}
              </div>
            )}

            {partyValidation && <p className="text-sm text-destructive sm:col-span-2">{partyValidation}</p>}
          </CardContent>
        </Card>
      )}

      {step === "commodities" && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              Commodities
            </CardTitle>
            <Button type="button" size="sm" variant="outline" onClick={() => setLines((p) => [...p, emptyLine()])}>
              Add line
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {lines.map((line, idx) => (
              <div key={line.key} className="grid gap-3 sm:grid-cols-6 border rounded-md p-3">
                <div className="space-y-1 sm:col-span-2">
                  <Label>Commodity {idx + 1}</Label>
                  <Select value={line.commodityId || undefined} onValueChange={(v) => onCommodityPick(line.key, v)}>
                    <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>
                      {commodities.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Qty</Label>
                  <Input type="number" value={line.quantity} onChange={(e) => updateLine(line.key, { quantity: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label>Unit</Label>
                  <Input value={line.unit} readOnly className="bg-muted" />
                </div>
                <div className="space-y-1">
                  <Label>Rate/unit (₹)</Label>
                  <Input type="number" value={line.ratePerUnit} onChange={(e) => updateLine(line.key, { ratePerUnit: e.target.value })} />
                </div>
                <div className="flex items-end">
                  {lines.length > 1 && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => setLines((p) => p.filter((l) => l.key !== line.key))}>
                      Remove
                    </Button>
                  )}
                </div>
              </div>
            ))}
            {commoditiesValidation && <p className="text-sm text-destructive">{commoditiesValidation}</p>}
            {calculation && (
              <div className="rounded-md bg-muted p-3 text-sm space-y-1">
                <p>Commodity value: {formatInr(calculation.totalCommodityValue)}</p>
                {!meta.usesSecurityDeposit && <p>Market fee: {formatInr(calculation.totalMarketFee)}</p>}
                {calculation.fineAmount > 0 && <p>Fine: {formatInr(calculation.fineAmount)}</p>}
                {meta.usesSecurityDeposit && (
                  <>
                    <p>Security deposit: {formatInr(calculation.securityDepositAmount)}</p>
                    <p>Admin charges: {formatInr(calculation.adminChargesAmount)}</p>
                  </>
                )}
                <p className="font-semibold">Total payable: {formatInr(calculation.totalPayable)}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {step === "payment" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Receipt className="h-5 w-5" />
                Payment
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <Label>Payment mode</Label>
                <Select value={paymentMode} onValueChange={setPaymentMode}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Cash">Cash</SelectItem>
                    <SelectItem value="Cheque">Cheque</SelectItem>
                    <SelectItem value="Online">Online (UTR)</SelectItem>
                    <SelectItem value="AdvanceDeposit">Advance deposit</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {paymentMode === "Cheque" && (
                <>
                  <div className="space-y-1"><Label>Cheque no.</Label><Input value={chequeNo} onChange={(e) => setChequeNo(e.target.value)} /></div>
                  <div className="space-y-1"><Label>Bank</Label><Input value={bankName} onChange={(e) => setBankName(e.target.value)} /></div>
                  <div className="space-y-1"><Label>Cheque date</Label><Input type="date" value={chequeDate} onChange={(e) => setChequeDate(e.target.value)} /></div>
                </>
              )}
              {paymentMode === "Online" && (
                <div className="space-y-1"><Label>UTR / reference</Label><Input value={utrNo} onChange={(e) => setUtrNo(e.target.value)} /></div>
              )}
              {transactionNo && <p className="text-sm font-mono text-muted-foreground">Txn: {transactionNo}</p>}
              <Button
                className="w-full"
                disabled={finalizeMutation.isPending || !calculation}
                onClick={() => finalizeMutation.mutate()}
              >
                {finalizeMutation.isPending ? "Submitting…" : `Submit & issue receipt (${formatInr(calculation?.totalPayable ?? 0)})`}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Receipt preview</CardTitle></CardHeader>
            <CardContent className="text-sm space-y-2">
              <p><span className="text-muted-foreground">Case:</span> {caseType} — {meta.title}</p>
              <p><span className="text-muted-foreground">Revenue head:</span> {calculation?.receiptRevenueHead ?? meta.receiptSummary}</p>
              {calculation?.lines.map((l, i) => {
                const name = commodityById.get(l.commodityId)?.name ?? l.commodityId;
                return (
                  <p key={i}>
                    {name}: {l.quantity} {l.unit} @ {formatInr(l.ratePerUnit)} → fee {formatInr(l.marketFeeAmount)}
                  </p>
                );
              })}
              <div className="border-t pt-2 font-semibold">
                Total payable: {formatInr(calculation?.totalPayable ?? 0)}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="mt-6 flex justify-between">
        <Button
          variant="outline"
          disabled={step === "case"}
          onClick={() => {
            const prev = STEPS[stepIndex - 1];
            if (prev) setStep(prev.id);
          }}
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back
        </Button>
        {step !== "payment" ? (
          <Button
            onClick={() => {
              if (step === "party" && partyValidation) {
                toast({ title: "Complete party details", description: partyValidation, variant: "destructive" });
                return;
              }
              if (step === "commodities" && commoditiesValidation) {
                toast({ title: "Commodities incomplete", description: commoditiesValidation, variant: "destructive" });
                return;
              }
              const next = STEPS[stepIndex + 1];
              if (next) setStep(next.id);
            }}
          >
            Next
            <ArrowRight className="h-4 w-4 ml-1" />
          </Button>
        ) : null}
      </div>
    </AppShell>
  );
}
