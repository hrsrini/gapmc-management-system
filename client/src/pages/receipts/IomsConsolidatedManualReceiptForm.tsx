import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useSearchParams } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
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
import { useYardLabels } from "@/hooks/useYardLabels";
import { PaymentPreferenceForm } from "@/components/payments/PaymentPreferenceForm";
import {
  buildCounterDuesPaymentApiBody,
  defaultPaymentPreferenceValue,
  validatePaymentPreference,
  type PaymentPreferenceValue,
} from "@/lib/duesCounterPayment";
import { formatInr } from "@/lib/formatInr";
import { SYSTEM_CONFIG_DEFAULTS } from "@shared/system-config-defaults";
import {
  gstForManualLine,
  isRentLedgerName,
  sumConsolidatedTotals,
} from "@shared/manual-consolidated-receipt";
import type { ManualReceiptPartyType } from "@shared/manual-receipt-types";
import { partyTypesForPayeeRule, type ManualReceiptPayeeRule } from "@shared/manual-receipt-types";
import { Printer, ArrowLeft, Plus, Search } from "lucide-react";
import { cn } from "@/lib/utils";

type ManualType = {
  id: string;
  ledgerName: string;
  requiresPremises: boolean;
  payeeRule: string;
  showInDropdown: boolean;
  isActive: boolean;
  allowedPartyTypes?: ManualReceiptPartyType[];
};

type PremisesRow = {
  allotmentId: string;
  premisesAssetId: string;
  premisesId: string;
  premisesLabel: string;
  yardId: string;
  assetType: string | null;
  location: string | null;
  monthlyRent: number | null;
  tenancyStatus: string | null;
};

type LicenceRef = {
  id: string;
  licenceNo?: string | null;
  firmName?: string | null;
  yardId: string;
  govtGstExemptCategoryId?: string | null;
  isNonGstEntity?: boolean | null;
};

type LineDraft = {
  key: string;
  typeId: string;
  premisesAssetIds: string[];
  amount: string;
  remarks: string;
};

function newLineKey() {
  return `L-${Math.random().toString(36).slice(2, 9)}`;
}

export default function IomsConsolidatedManualReceiptForm() {
  const [, setLocation] = useLocation();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const { user } = useAuth();
  const { data: yards = [] } = useScopedActiveYards();
  const { getYardName } = useYardLabels();

  const unifiedFromUrl = searchParams.get("unifiedEntityId")?.trim() ?? "";
  const yardFromUrl = searchParams.get("yardId")?.trim() ?? "";
  const licenceIdFromUrl = unifiedFromUrl.startsWith("TA:")
    ? unifiedFromUrl.slice(3)
    : searchParams.get("traderLicenceId")?.trim() ?? "";

  const [yardId, setYardId] = useState(yardFromUrl);
  const [receiptDate, setReceiptDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [headSearch, setHeadSearch] = useState("");
  const [selectedTypeIds, setSelectedTypeIds] = useState<string[]>([]);
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [narration, setNarration] = useState("");
  const [paymentPref, setPaymentPref] = useState<PaymentPreferenceValue>(() =>
    defaultPaymentPreferenceValue(),
  );

  const { data: licence, isLoading: licLoading } = useQuery<LicenceRef>({
    queryKey: [`/api/ioms/traders/licences/${licenceIdFromUrl}`],
    enabled: Boolean(licenceIdFromUrl),
  });

  const { data: types = [], isLoading: typesLoading } = useQuery<ManualType[]>({
    queryKey: ["/api/ioms/manual-receipt-types"],
    queryFn: async () => {
      const res = await fetch("/api/ioms/manual-receipt-types", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load Tally heads");
      return res.json();
    },
  });

  const { data: premisesPayload } = useQuery<{ rows: PremisesRow[] }>({
    queryKey: [
      `/api/ioms/receipts/manual/premises-for-licence?traderLicenceId=${encodeURIComponent(licenceIdFromUrl)}`,
    ],
    enabled: Boolean(licenceIdFromUrl),
  });

  const { data: sysCfg } = useQuery<Record<string, string>>({
    queryKey: ["/api/system/config"],
  });

  useEffect(() => {
    if (yardFromUrl) setYardId(yardFromUrl);
    else if (licence?.yardId) setYardId(licence.yardId);
  }, [yardFromUrl, licence?.yardId]);

  const traderTypes = useMemo(() => {
    return types.filter((t) => {
      if (!t.isActive) return false;
      const allowed =
        t.allowedPartyTypes ??
        partyTypesForPayeeRule(t.payeeRule as ManualReceiptPayeeRule);
      return allowed.includes("Trader");
    });
  }, [types]);

  const filteredHeads = useMemo(() => {
    const q = headSearch.trim().toLowerCase();
    if (!q) return traderTypes;
    return traderTypes.filter((t) => t.ledgerName.toLowerCase().includes(q));
  }, [traderTypes, headSearch]);

  const premises = useMemo(() => {
    const rows = premisesPayload?.rows ?? [];
    if (!yardId) return rows;
    return rows.filter((p) => p.yardId === yardId);
  }, [premisesPayload, yardId]);

  const typeById = useMemo(() => new Map(traderTypes.map((t) => [t.id, t])), [traderTypes]);

  const cgstPercent = useMemo(() => {
    const n = parseFloat(String(sysCfg?.rent_invoice_cgst_percent ?? ""));
    return Number.isFinite(n) && n >= 0 ? n : parseFloat(SYSTEM_CONFIG_DEFAULTS.rent_invoice_cgst_percent);
  }, [sysCfg?.rent_invoice_cgst_percent]);

  const sgstPercent = useMemo(() => {
    const n = parseFloat(String(sysCfg?.rent_invoice_sgst_percent ?? ""));
    return Number.isFinite(n) && n >= 0 ? n : parseFloat(SYSTEM_CONFIG_DEFAULTS.rent_invoice_sgst_percent);
  }, [sysCfg?.rent_invoice_sgst_percent]);

  const gstExempt = Boolean(licence?.govtGstExemptCategoryId) || Boolean(licence?.isNonGstEntity);

  const computedLines = useMemo(() => {
    return lines.map((l) => {
      const t = typeById.get(l.typeId);
      const amount = Number(l.amount) || 0;
      const tax = t
        ? gstForManualLine({
            ledgerName: t.ledgerName,
            amount,
            gstExempt,
            cgstPercent,
            sgstPercent,
          })
        : { cgst: 0, sgst: 0 };
      return { ...l, type: t, amount, ...tax };
    });
  }, [lines, typeById, gstExempt, cgstPercent, sgstPercent]);

  const totals = useMemo(
    () =>
      sumConsolidatedTotals(
        computedLines
          .filter((l) => l.type && l.amount > 0)
          .map((l) => ({
            manualReceiptTypeId: l.typeId,
            ledgerName: l.type!.ledgerName,
            premisesAssetIds: l.premisesAssetIds,
            amount: l.amount,
            cgst: l.cgst,
            sgst: l.sgst,
            remarks: l.remarks,
          })),
      ),
    [computedLines],
  );

  function toggleHead(typeId: string, on: boolean) {
    setSelectedTypeIds((prev) => {
      if (on) return prev.includes(typeId) ? prev : [...prev, typeId];
      return prev.filter((id) => id !== typeId);
    });
    setLines((prev) => {
      if (on) {
        if (prev.some((l) => l.typeId === typeId)) return prev;
        return [
          ...prev,
          { key: newLineKey(), typeId, premisesAssetIds: [], amount: "", remarks: "" },
        ];
      }
      return prev.filter((l) => l.typeId !== typeId);
    });
  }

  function addAnotherLine() {
    const unused = traderTypes.find((t) => !selectedTypeIds.includes(t.id));
    if (!unused) {
      toast({ title: "All Tally heads already added", variant: "destructive" });
      return;
    }
    toggleHead(unused.id, true);
  }

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!licenceIdFromUrl || !yardId) throw new Error("Licence and yard are required.");
      const payloadLines = computedLines
        .filter((l) => l.type && l.amount > 0)
        .map((l) => {
          if (l.type!.requiresPremises && l.premisesAssetIds.length === 0) {
            throw new Error(`Select premises for ${l.type!.ledgerName}.`);
          }
          return {
            manualReceiptTypeId: l.typeId,
            premisesAssetIds: l.premisesAssetIds,
            amount: l.amount,
            remarks: l.remarks.trim() || undefined,
          };
        });
      if (!payloadLines.length) throw new Error("Add at least one Tally head with amount.");

      const paid = String(totals.totalAmount);
      const prefErr = validatePaymentPreference({ ...paymentPref, paidAmount: paymentPref.paidAmount || paid });
      if (prefErr) throw new Error(prefErr);
      // Align payment preference date with the receipt date field (YYYY-MM-DD → DD-MM-YYYY).
      const receiptDmy = (() => {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(receiptDate);
        return m ? `${m[3]}-${m[2]}-${m[1]}` : paymentPref.paymentDate;
      })();
      const payBody = buildCounterDuesPaymentApiBody(
        { ...paymentPref, paidAmount: paid, paymentDate: receiptDmy, chequeDate: receiptDmy, transactionDate: receiptDmy },
        totals.totalAmount,
      );

      const res = await fetch("/api/ioms/receipts/manual/consolidated", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          yardId,
          partyType: "Trader",
          unifiedEntityId: `TA:${licenceIdFromUrl}`,
          traderLicenceId: licenceIdFromUrl,
          narration: narration.trim() || undefined,
          lines: payloadLines,
          ...payBody,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { message?: string; error?: string }).message ??
            (data as { error?: string }).error ??
            res.statusText,
        );
      }
      return data as { receiptId: string; receiptNo: string };
    },
    onSuccess: (data) => {
      toast({
        title: "Consolidated receipt generated",
        description: data.receiptNo ? `Receipt ${data.receiptNo}` : "Saved.",
      });
      if (data.receiptId) {
        setLocation(`/receipts/ioms/${encodeURIComponent(data.receiptId)}?print=1`);
      }
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const yardName = getYardName(yardId);
  const holderLabel = licence
    ? `${yardName} — ${licence.firmName ?? licence.licenceNo ?? licence.id}`
    : "—";

  if (!licenceIdFromUrl) {
    return (
      <AppShell breadcrumbs={[{ label: "Receipts", href: "/receipts/ioms" }, { label: "Create receipt" }]}>
        <Card>
          <CardContent className="pt-6 space-y-3">
            <p className="text-sm text-muted-foreground">
              Open Create Manual Receipt from a Licence page to generate a consolidated multi–Tally-head receipt.
            </p>
            <Button asChild variant="outline">
              <Link href="/receipts/ioms/new">Single Tally head form</Link>
            </Button>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell
      breadcrumbs={[
        { label: "Licences", href: "/traders/licences" },
        {
          label: licence?.licenceNo ?? licenceIdFromUrl,
          href: `/traders/licences/${licenceIdFromUrl}`,
        },
        { label: "Create Receipt" },
      ]}
    >
      <div className="space-y-4 max-w-6xl">
        <div>
          <h1 className="text-2xl font-semibold">Create Receipt</h1>
          <p className="text-sm text-muted-foreground">
            Multiple Tally heads in one consolidated receipt. Only Rent includes GST (CGST/SGST).
          </p>
        </div>

        {(licLoading || typesLoading) && <Skeleton className="h-40 w-full" />}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">1. Licence &amp; payment details</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1 sm:col-span-1">
              <Label>Trader Licence Holder</Label>
              <Input readOnly value={holderLabel} />
            </div>
            <div className="space-y-1">
              <Label>Receipt date</Label>
              <Input type="date" value={receiptDate} onChange={(e) => setReceiptDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Yard</Label>
              <Select value={yardId || "__none__"} onValueChange={(v) => setYardId(v === "__none__" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Yard" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Select yard</SelectItem>
                  {yards.map((y) => (
                    <SelectItem key={y.id} value={y.id}>
                      {y.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">2. Select Tally heads &amp; allocation details</CardTitle>
            <CardDescription>
              Tick heads on the left, then allocate premises and amounts on the right.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
              <div className="space-y-2 border rounded-md p-3">
                <div className="relative">
                  <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    className="pl-8"
                    placeholder="Search Tally heads…"
                    value={headSearch}
                    onChange={(e) => setHeadSearch(e.target.value)}
                  />
                </div>
                <div className="max-h-80 overflow-auto space-y-1">
                  {filteredHeads.map((t) => {
                    const checked = selectedTypeIds.includes(t.id);
                    return (
                      <label
                        key={t.id}
                        className={cn(
                          "flex items-start gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer",
                          checked ? "bg-primary/5" : "hover:bg-muted/50",
                        )}
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(c) => toggleHead(t.id, Boolean(c))}
                        />
                        <span>
                          {t.ledgerName}
                          {isRentLedgerName(t.ledgerName) && (
                            <Badge variant="outline" className="ml-1 text-[10px]">
                              GST
                            </Badge>
                          )}
                          {t.requiresPremises && (
                            <span className="block text-[11px] text-muted-foreground">Premises required</span>
                          )}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-3 overflow-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left border-b">
                      <th className="py-2 pr-2 w-8">#</th>
                      <th className="py-2 pr-2">Tally Head</th>
                      <th className="py-2 pr-2">Premises</th>
                      <th className="py-2 pr-2">Amount (₹)</th>
                      <th className="py-2">Remarks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {computedLines.map((l, idx) => (
                      <tr key={l.key} className="border-b border-border/50 align-top">
                        <td className="py-2 pr-2">{idx + 1}</td>
                        <td className="py-2 pr-2">
                          <div className="font-medium">{l.type?.ledgerName ?? "—"}</div>
                          {l.type && isRentLedgerName(l.type.ledgerName) && l.amount > 0 && (
                            <div className="text-xs text-muted-foreground">
                              + CGST {formatInr(l.cgst)} · SGST {formatInr(l.sgst)}
                            </div>
                          )}
                        </td>
                        <td className="py-2 pr-2 min-w-[180px]">
                          {l.type?.requiresPremises ? (
                            <div className="space-y-1 max-h-28 overflow-auto">
                              {premises.length === 0 && (
                                <p className="text-xs text-muted-foreground">No active premises for this licence/yard.</p>
                              )}
                              {premises.map((p) => {
                                const on = l.premisesAssetIds.includes(p.premisesAssetId);
                                return (
                                  <label key={p.premisesAssetId} className="flex items-center gap-2 text-xs">
                                    <Checkbox
                                      checked={on}
                                      onCheckedChange={(c) => {
                                        setLines((prev) =>
                                          prev.map((row) => {
                                            if (row.key !== l.key) return row;
                                            const set = new Set(row.premisesAssetIds);
                                            if (c) set.add(p.premisesAssetId);
                                            else set.delete(p.premisesAssetId);
                                            return { ...row, premisesAssetIds: [...set] };
                                          }),
                                        );
                                      }}
                                    />
                                    <span>
                                      {p.premisesLabel}
                                      {p.assetType ? ` · ${p.assetType}` : ""}
                                    </span>
                                  </label>
                                );
                              })}
                            </div>
                          ) : (
                            <span className="text-muted-foreground text-xs">Not premises-linked</span>
                          )}
                        </td>
                        <td className="py-2 pr-2">
                          <Input
                            className="w-28"
                            inputMode="decimal"
                            value={l.amount === 0 && !lines.find((x) => x.key === l.key)?.amount ? "" : String(lines.find((x) => x.key === l.key)?.amount ?? "")}
                            onChange={(e) =>
                              setLines((prev) =>
                                prev.map((row) => (row.key === l.key ? { ...row, amount: e.target.value } : row)),
                              )
                            }
                          />
                        </td>
                        <td className="py-2">
                          <Input
                            value={l.remarks}
                            onChange={(e) =>
                              setLines((prev) =>
                                prev.map((row) => (row.key === l.key ? { ...row, remarks: e.target.value } : row)),
                              )
                            }
                            placeholder="Optional"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {lines.length === 0 && (
                  <p className="text-sm text-muted-foreground">Select one or more Tally heads to begin.</p>
                )}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={addAnotherLine}>
                    <Plus className="h-4 w-4 mr-1" />
                    Add another Tally head
                  </Button>
                  <div className="text-sm font-semibold">
                    Consolidated total: {formatInr(totals.totalAmount)}
                    {totals.cgst + totals.sgst > 0 && (
                      <span className="font-normal text-muted-foreground ml-2">
                        (base {formatInr(totals.amount)} + GST {formatInr(totals.cgst + totals.sgst)})
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">3. Payment &amp; receipt summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <PaymentPreferenceForm
                value={paymentPref}
                onChange={setPaymentPref}
                receivedByLabel={user?.name ? `${user.name} (Logged in user)` : "Logged in user"}
                receivedAtLabel={yardName || "—"}
                summaryAmount={totals.totalAmount > 0 ? String(totals.totalAmount) : undefined}
              />
              <div className="space-y-1">
                <Label>Narration / remarks</Label>
                <Textarea
                  value={narration}
                  onChange={(e) => setNarration(e.target.value)}
                  placeholder="Consolidated payment for various charges"
                  maxLength={500}
                />
              </div>
            </CardContent>
          </Card>

          <Card className="border-primary/30">
            <CardHeader>
              <CardTitle className="text-base">Receipt summary</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-2">
              <div>
                <span className="text-muted-foreground">Licence holder: </span>
                {licence?.firmName ?? "—"} ({yardName || "—"})
              </div>
              <div>
                <span className="text-muted-foreground">Tally heads: </span>
                {computedLines
                  .filter((l) => l.type)
                  .map((l) => l.type!.ledgerName)
                  .join(", ") || "—"}
              </div>
              <div className="text-lg font-semibold pt-2">Total amount: {formatInr(totals.totalAmount)}</div>
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-wrap justify-between gap-2 border-t pt-3">
          <Button asChild variant="outline">
            <Link href={`/traders/licences/${licenceIdFromUrl}`}>
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back
            </Link>
          </Button>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending || totals.totalAmount <= 0}
          >
            <Printer className="h-4 w-4 mr-1" />
            Generate Consolidated Receipt
          </Button>
        </div>
      </div>
    </AppShell>
  );
}
