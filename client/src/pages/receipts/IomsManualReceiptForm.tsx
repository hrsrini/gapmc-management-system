import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { useScopedActiveYards } from "@/hooks/useScopedActiveYards";
import { PaymentPreferenceForm } from "@/components/payments/PaymentPreferenceForm";
import {
  buildCounterDuesPaymentApiBody,
  defaultPaymentPreferenceValue,
  validatePaymentPreference,
  type PaymentPreferenceValue,
} from "@/lib/duesCounterPayment";
import { formatUnifiedEntityOptionLabel } from "@shared/unified-entity-display";
import type { ManualReceiptPartyType } from "@shared/manual-receipt-types";
import { Save, Receipt } from "lucide-react";
import { format } from "@/lib/dateFormat";

interface ManualReceiptTypeRow {
  id: string;
  ledgerName: string;
  revenueHead: string;
  payeeRule: string;
  requiresPremises: boolean;
  tallyLedgerName?: string | null;
  allowedPartyTypes: ManualReceiptPartyType[];
}

interface UnifiedEntityRow {
  id: string;
  kind: "TrackA" | "TrackB" | "AdHoc";
  yardId: string;
  name: string;
  publicEntityCode?: string | null;
}

interface AssetRef {
  id: string;
  assetId: string;
  yardId: string;
}

interface AssistantRow {
  id: string;
  personName: string;
  yardId: string;
  primaryLicenceId: string;
}

const PARTY_LABELS: Record<ManualReceiptPartyType, string> = {
  Trader: "Trader (Track A)",
  Entity: "Entity (Track B / Ad-hoc)",
  Assistant: "Assistant trader",
  NewParty: "New party",
};

export default function IomsManualReceiptForm() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();
  const { data: yards = [] } = useScopedActiveYards();

  const [yardId, setYardId] = useState("");
  const [manualReceiptTypeId, setManualReceiptTypeId] = useState("");
  const [partyType, setPartyType] = useState<ManualReceiptPartyType | "">("");
  const [unifiedEntityId, setUnifiedEntityId] = useState("");
  const [assistantId, setAssistantId] = useState("");
  const [newPartyName, setNewPartyName] = useState("");
  const [newPartyAddress, setNewPartyAddress] = useState("");
  const [newPartyContact, setNewPartyContact] = useState("");
  const [linkNewPartyToEntity, setLinkNewPartyToEntity] = useState(false);
  const [premisesAssetId, setPremisesAssetId] = useState("");
  const [applicationRef, setApplicationRef] = useState("");
  const [amount, setAmount] = useState("");
  const [narration, setNarration] = useState("");
  const [paymentPref, setPaymentPref] = useState<PaymentPreferenceValue>(() => defaultPaymentPreferenceValue());

  const { data: types = [], isLoading: typesLoading } = useQuery<ManualReceiptTypeRow[]>({
    queryKey: ["/api/ioms/manual-receipt-types?dropdown=1"],
    queryFn: async () => {
      const res = await fetch("/api/ioms/manual-receipt-types?dropdown=1", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load receipt types");
      return res.json();
    },
  });

  const { data: unified = [] } = useQuery<UnifiedEntityRow[]>({
    queryKey: ["/api/ioms/unified-entities"],
  });

  const { data: assets = [] } = useQuery<AssetRef[]>({
    queryKey: ["/api/ioms/assets"],
  });

  const { data: assistants = [] } = useQuery<AssistantRow[]>({
    queryKey: ["/api/ioms/traders/assistants", yardId],
    queryFn: async () => {
      const res = await fetch("/api/ioms/traders/assistants", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load assistants");
      return res.json();
    },
    enabled: partyType === "Assistant",
  });

  const selectedType = useMemo(
    () => types.find((t) => t.id === manualReceiptTypeId) ?? null,
    [types, manualReceiptTypeId],
  );

  const allowedPartyTypes = selectedType?.allowedPartyTypes ?? [];

  useEffect(() => {
    if (allowedPartyTypes.length === 0) {
      setPartyType("");
      return;
    }
    if (!partyType || !allowedPartyTypes.includes(partyType)) {
      setPartyType(allowedPartyTypes[0]);
    }
  }, [allowedPartyTypes, partyType]);

  useEffect(() => {
    setUnifiedEntityId("");
    setAssistantId("");
    setNewPartyName("");
    setNewPartyAddress("");
    setNewPartyContact("");
    setLinkNewPartyToEntity(false);
    setPremisesAssetId("");
  }, [partyType, manualReceiptTypeId]);

  const yardOptions = useMemo(
    () =>
      yards
        .filter((y) => String(y.type ?? "").toLowerCase() === "yard")
        .slice()
        .sort((a, b) => (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" })),
    [yards],
  );

  const unifiedForParty = useMemo(() => {
    let list = unified;
    if (yardId) list = list.filter((u) => u.yardId === yardId);
    if (partyType === "Trader") return list.filter((u) => u.kind === "TrackA");
    if (partyType === "Entity") return list.filter((u) => u.kind === "TrackB" || u.kind === "AdHoc");
    if (partyType === "NewParty" && linkNewPartyToEntity) return list;
    return list;
  }, [unified, yardId, partyType, linkNewPartyToEntity]);

  const unifiedLabelById = useMemo(
    () =>
      Object.fromEntries(
        unifiedForParty.map((u) => [
          u.id,
          formatUnifiedEntityOptionLabel({
            kind: u.kind,
            publicEntityCode: u.publicEntityCode,
            name: u.name,
          }),
        ]),
      ),
    [unifiedForParty],
  );

  const premisesOptions = useMemo(() => {
    if (!yardId) return assets;
    return assets.filter((a) => a.yardId === yardId);
  }, [assets, yardId]);

  const assistantOptions = useMemo(() => {
    if (!yardId) return assistants;
    return assistants.filter((a) => a.yardId === yardId);
  }, [assistants, yardId]);

  const receivedByLabel = user?.name ? `${user.name} (Logged in user)` : "Logged in user";
  const receivedAtLabel = useMemo(() => {
    if (!yardId) return "—";
    return yards.find((y) => y.id === yardId)?.name ?? yardId;
  }, [yardId, yards]);

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!manualReceiptTypeId || !yardId || !partyType) {
        throw new Error("Select yard, receipt type, and party type.");
      }
      const amt = Number(amount);
      if (!Number.isFinite(amt) || amt <= 0) throw new Error("Enter a valid amount.");
      if (narration.length > 500) throw new Error("Narration must be at most 500 characters.");
      if (selectedType?.requiresPremises && !premisesAssetId.trim()) {
        throw new Error("Premises is required for this receipt type.");
      }
      if (partyType === "NewParty" && !newPartyName.trim()) {
        throw new Error("Party name is required for New Party.");
      }
      if ((partyType === "Trader" || partyType === "Entity") && !unifiedEntityId.trim()) {
        throw new Error("Select a unified entity.");
      }
      if (partyType === "Assistant" && !assistantId.trim()) {
        throw new Error("Select an assistant trader.");
      }

      const prefErr = validatePaymentPreference({ ...paymentPref, paidAmount: paymentPref.paidAmount || amount });
      if (prefErr) throw new Error(prefErr);

      const payBody = buildCounterDuesPaymentApiBody({ ...paymentPref, paidAmount: String(amt) }, amt);
      const body: Record<string, unknown> = {
        manualReceiptTypeId,
        yardId,
        partyType,
        amount: amt,
        narration: narration.trim() || undefined,
        premisesAssetId: premisesAssetId.trim() || undefined,
        applicationRef: applicationRef.trim() || undefined,
        ...payBody,
      };

      if (partyType === "Trader" || partyType === "Entity") {
        body.unifiedEntityId = unifiedEntityId.trim();
      } else if (partyType === "Assistant") {
        body.assistantId = assistantId.trim();
      } else if (partyType === "NewParty") {
        body.newPartyName = newPartyName.trim();
        body.newPartyAddress = newPartyAddress.trim() || undefined;
        body.newPartyContact = newPartyContact.trim() || undefined;
        if (linkNewPartyToEntity && unifiedEntityId.trim()) {
          body.unifiedEntityId = unifiedEntityId.trim();
        }
      }

      const res = await fetch("/api/ioms/receipts/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = (data as { message?: string; error?: string }).message ?? (data as { error?: string }).error;
        throw new Error(msg ?? res.statusText);
      }
      return data as { receiptId: string; receiptNo: string };
    },
    onSuccess: (data) => {
      toast({
        title: "Receipt created",
        description: data.receiptNo ? `Receipt ${data.receiptNo} saved.` : "Manual receipt saved.",
      });
      if (data.receiptId) {
        setLocation(`/receipts/ioms/${encodeURIComponent(data.receiptId)}?print=1`);
      } else {
        setLocation("/receipts/ioms");
      }
    },
    onError: (e: Error) => toast({ title: "Create failed", description: e.message, variant: "destructive" }),
  });

  return (
    <AppShell
      breadcrumbs={[
        { label: "Receipts", href: "/receipts/ioms" },
        { label: "Create receipt (IOMS)" },
      ]}
    >
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Receipt className="h-7 w-7" />
            Create manual receipt (IOMS)
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Receipt date defaults to payment date ({format(new Date(), "yyyy-MM-dd")}). Legacy form:{" "}
            <a href="/receipts/new" className="text-primary hover:underline">
              /receipts/new
            </a>
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Receipt details</CardTitle>
            <CardDescription>
              Select the Tally ledger scenario from Finance Mapping. Both IOMS and legacy forms run in parallel during UAT.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {typesLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Yard *</Label>
                  <Select value={yardId || "__none__"} onValueChange={(v) => setYardId(v === "__none__" ? "" : v)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select yard" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Select…</SelectItem>
                      {yardOptions.map((y) => (
                        <SelectItem key={y.id} value={y.id}>
                          {y.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Receipt type (Tally ledger) *</Label>
                  <Select
                    value={manualReceiptTypeId || "__none__"}
                    onValueChange={(v) => setManualReceiptTypeId(v === "__none__" ? "" : v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select receipt type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Select…</SelectItem>
                      {types.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.ledgerName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedType?.tallyLedgerName ? (
                    <p className="text-xs text-muted-foreground mt-1">Tally: {selectedType.tallyLedgerName}</p>
                  ) : selectedType ? (
                    <p className="text-xs text-amber-600 mt-1">No Tally ledger linked — run tally + manual type seed.</p>
                  ) : null}
                </div>
              </div>
            )}

            {selectedType ? (
              <>
                <div className="space-y-1">
                  <Label>Party type *</Label>
                  <Select value={partyType || "__none__"} onValueChange={(v) => setPartyType(v as ManualReceiptPartyType)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select party type" />
                    </SelectTrigger>
                    <SelectContent>
                      {allowedPartyTypes.map((pt) => (
                        <SelectItem key={pt} value={pt}>
                          {PARTY_LABELS[pt]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {(partyType === "Trader" || partyType === "Entity") && (
                  <div className="space-y-1">
                    <Label>Unified entity *</Label>
                    <Select
                      value={unifiedEntityId || "__none__"}
                      onValueChange={(v) => setUnifiedEntityId(v === "__none__" ? "" : v)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select entity…" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Select…</SelectItem>
                        {unifiedForParty.map((u) => (
                          <SelectItem key={u.id} value={u.id}>
                            {unifiedLabelById[u.id]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {partyType === "Assistant" && (
                  <div className="space-y-1">
                    <Label>Assistant trader *</Label>
                    <Select value={assistantId || "__none__"} onValueChange={(v) => setAssistantId(v === "__none__" ? "" : v)}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select assistant" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Select…</SelectItem>
                        {assistantOptions.map((a) => (
                          <SelectItem key={a.id} value={a.id}>
                            {a.personName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {partyType === "NewParty" && (
                  <div className="space-y-3 rounded-md border p-3">
                    <div className="space-y-1">
                      <Label>Party name *</Label>
                      <Input value={newPartyName} onChange={(e) => setNewPartyName(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label>Address</Label>
                      <Textarea value={newPartyAddress} onChange={(e) => setNewPartyAddress(e.target.value)} rows={2} />
                    </div>
                    <div className="space-y-1">
                      <Label>Contact</Label>
                      <Input value={newPartyContact} onChange={(e) => setNewPartyContact(e.target.value)} />
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        id="link-new-party"
                        type="checkbox"
                        checked={linkNewPartyToEntity}
                        onChange={(e) => {
                          setLinkNewPartyToEntity(e.target.checked);
                          if (!e.target.checked) setUnifiedEntityId("");
                        }}
                      />
                      <Label htmlFor="link-new-party" className="font-normal cursor-pointer">
                        Link to existing unified entity (optional)
                      </Label>
                    </div>
                    {linkNewPartyToEntity ? (
                      <div className="space-y-1">
                        <Label>Unified entity</Label>
                        <Select
                          value={unifiedEntityId || "__none__"}
                          onValueChange={(v) => setUnifiedEntityId(v === "__none__" ? "" : v)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select entity…" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">Select…</SelectItem>
                            {unifiedForParty.map((u) => (
                              <SelectItem key={u.id} value={u.id}>
                                {unifiedLabelById[u.id]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ) : null}
                  </div>
                )}

                {selectedType.requiresPremises && (
                  <div className="space-y-1">
                    <Label>Premises *</Label>
                    <Select value={premisesAssetId || "__none__"} onValueChange={(v) => setPremisesAssetId(v === "__none__" ? "" : v)}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select premises asset" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Select…</SelectItem>
                        {premisesOptions.map((a) => (
                          <SelectItem key={a.id} value={a.id}>
                            {a.assetId}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Amount (₹) *</Label>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={amount}
                      onChange={(e) => {
                        setAmount(e.target.value);
                        setPaymentPref((p) => ({ ...p, paidAmount: e.target.value }));
                      }}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Application / reference no.</Label>
                    <Input
                      value={applicationRef}
                      onChange={(e) => setApplicationRef(e.target.value)}
                      placeholder="Optional"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <Label>Narration</Label>
                  <Textarea
                    value={narration}
                    onChange={(e) => setNarration(e.target.value.slice(0, 500))}
                    rows={3}
                    placeholder="Optional (max 500 characters)"
                  />
                  <p className="text-xs text-muted-foreground text-right">{narration.length}/500</p>
                </div>
              </>
            ) : null}
          </CardContent>
        </Card>

        {selectedType ? (
          <Card>
            <CardHeader>
              <CardTitle>Payment</CardTitle>
              <CardDescription>Counter payment — same flow as outstanding dues Pay.</CardDescription>
            </CardHeader>
            <CardContent>
              <PaymentPreferenceForm
                value={paymentPref}
                onChange={setPaymentPref}
                receivedByLabel={receivedByLabel}
                receivedAtLabel={receivedAtLabel}
                summaryAmount={amount}
              />
            </CardContent>
          </Card>
        ) : null}

        <div className="flex gap-2 justify-end">
          <Button type="button" variant="outline" onClick={() => setLocation("/receipts/ioms")}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!selectedType || createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            <Save className="h-4 w-4 mr-1" />
            {createMutation.isPending ? "Saving…" : "Save receipt"}
          </Button>
        </div>
      </div>
    </AppShell>
  );
}
