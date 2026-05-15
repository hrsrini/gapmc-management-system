import { useState, useMemo, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { FileText, ArrowLeft, Loader2 } from "lucide-react";
import { formatYmdToDisplay } from "@/lib/dateFormat";
import type { AssetAllotmentRow, EntityAllotmentRow } from "./rent-allotments-ui";
import {
  activeAssetAllotmentsInYard,
  billableEntityAllotmentsInYard,
} from "./rent-allotments-ui";
import { SYSTEM_CONFIG_DEFAULTS } from "@shared/system-config-defaults";
import { computeRentInvoiceGstInr, rentInvoiceTotalInr } from "@shared/rent-invoice-gst";
import { MIN_RENT_INVOICE_AMOUNT_INR } from "@shared/rent-invoice-amount-validation";

interface Yard {
  id: string;
  name: string;
  code: string;
}
interface Asset {
  id: string;
  assetId: string;
  yardId: string;
  assetType: string;
  premisesRefNo?: string | null;
}

/** GET rent-context when `periodMonth` is supplied (M-03 create invoice). */
interface InvoiceRentContextResponse {
  allotmentId: string;
  periodMonth: string;
  resolvedRent: number;
  source: "revision" | "invoice" | "none";
  matchedRevisionId: string | null;
  matchedInvoiceId: string | null;
}

type Selection = "" | `trader:${string}` | `entity:${string}`;

function isValidInvoicePeriodYm(s: string): boolean {
  const t = s.trim();
  const m = /^(\d{4})-(\d{2})$/.exec(t);
  if (!m) return false;
  const mo = Number(m[2]);
  return mo >= 1 && mo <= 12;
}

function billingCalendarBoundsYm(ym: string): { from: string; to: string } | null {
  if (!isValidInvoicePeriodYm(ym)) return null;
  const [yStr, moStr] = ym.trim().split("-");
  const y = Number(yStr);
  const mo = Number(moStr);
  const last = new Date(y, mo, 0).getDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    from: `${y}-${pad(mo)}-01`,
    to: `${y}-${pad(mo)}-${pad(last)}`,
  };
}

function formatResolvedRentInput(n: number): string {
  if (!Number.isFinite(n)) return "";
  const rounded = Math.round(n * 100) / 100;
  return String(rounded);
}

function rentResolvedSourceHint(source: InvoiceRentContextResponse["source"]): string {
  switch (source) {
    case "revision":
      return "Approved rent revision effective for this billing month.";
    case "invoice":
      return "Rent carried from the latest prior invoice for this allotment.";
    default:
      return "Monthly rent configured on the allotment.";
  }
}

export default function IomsRentInvoiceForm() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [yardId, setYardId] = useState("");
  /** Composite key so trader vs entity rows never collide in the picker. */
  const [selection, setSelection] = useState<Selection>("");
  const [periodMonth, setPeriodMonth] = useState("");
  const [rentAmount, setRentAmount] = useState("");
  /** When false, UI/server prefer resolver output for allotment + period; true uses typed rent. */
  const [rentOverride, setRentOverride] = useState(false);
  const [nonGstLabel, setNonGstLabel] = useState("Garbage / Premises");
  const [nonGstAmount, setNonGstAmount] = useState("");
  const [isGovtEntity, setIsGovtEntity] = useState(false);

  const { data: yards = [] } = useQuery<Yard[]>({ queryKey: ["/api/yards"] });
  const { data: sysCfg } = useQuery<Record<string, string>>({
    queryKey: ["/api/system/config"],
  });
  const { data: allotments = [], isLoading: allotmentsLoading } = useQuery<AssetAllotmentRow[]>({
    queryKey: ["/api/ioms/asset-allotments"],
    queryFn: async () => {
      const res = await fetch("/api/ioms/asset-allotments", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch allotments");
      return res.json();
    },
  });
  const { data: entityAllotments = [], isLoading: entityAllotmentsLoading } = useQuery<EntityAllotmentRow[]>({
    queryKey: ["/api/ioms/entity-allotments"],
    queryFn: async () => {
      const res = await fetch("/api/ioms/entity-allotments", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch entity allotments");
      return res.json();
    },
  });
  const { data: assets = [] } = useQuery<Asset[]>({
    queryKey: ["/api/ioms/assets"],
    queryFn: async () => {
      const res = await fetch("/api/ioms/assets", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch assets");
      return res.json();
    },
  });

  const assetByAssetId = useMemo(() => {
    const m: Record<string, Asset> = {};
    assets.forEach((a) => {
      m[a.assetId] = a;
      m[a.id] = a;
    });
    return m;
  }, [assets]);

  const yardAssetIdSet = useMemo(() => {
    if (!yardId) return null as Set<string> | null;
    return new Set(assets.filter((a) => a.yardId === yardId).map((a) => a.assetId));
  }, [assets, yardId]);

  const traderOptions = useMemo(() => {
    if (!yardAssetIdSet) return allotments.filter((a) => a.status === "Active");
    return activeAssetAllotmentsInYard(allotments, yardAssetIdSet);
  }, [allotments, yardAssetIdSet]);

  const entityOptions = useMemo(() => {
    if (!yardAssetIdSet) {
      return entityAllotments.filter(
        (e) => String(e.approvalStatus ?? "") === "Approved" && e.status === "Active",
      );
    }
    return billableEntityAllotmentsInYard(entityAllotments, yardAssetIdSet);
  }, [entityAllotments, yardAssetIdSet]);

  const selectedTrader = useMemo(() => {
    if (!selection.startsWith("trader:")) return null;
    const id = selection.slice("trader:".length);
    return allotments.find((a) => a.id === id) ?? null;
  }, [selection, allotments]);

  const selectedEntity = useMemo(() => {
    if (!selection.startsWith("entity:")) return null;
    const id = selection.slice("entity:".length);
    return entityAllotments.find((e) => e.id === id) ?? null;
  }, [selection, entityAllotments]);

  const selectedAsset = selectedTrader
    ? assetByAssetId[selectedTrader.assetId] ?? null
    : selectedEntity
      ? assetByAssetId[selectedEntity.assetId] ?? null
      : null;
  const resolvedYardId = selectedAsset?.yardId ?? yardId;
  const isEntitySelection = Boolean(selectedEntity);

  const selectedAllotmentId = selectedTrader?.id ?? selectedEntity?.id ?? "";
  const periodYmTrim = periodMonth.trim();
  const billingBounds = billingCalendarBoundsYm(periodYmTrim);

  useEffect(() => {
    setRentOverride(false);
    setRentAmount("");
  }, [selection]);

  useEffect(() => {
    setRentOverride(false);
  }, [periodYmTrim]);

  const {
    data: rentResolve,
    isFetching: rentResolveFetching,
    isError: rentResolveIsError,
  } = useQuery<InvoiceRentContextResponse>({
    queryKey: ["/api/ioms/rent/allotments/rent-context", selectedAllotmentId, periodYmTrim],
    enabled: Boolean(selectedAllotmentId) && isValidInvoicePeriodYm(periodYmTrim),
    queryFn: async () => {
      const u = `/api/ioms/rent/allotments/${encodeURIComponent(selectedAllotmentId)}/rent-context?periodMonth=${encodeURIComponent(periodYmTrim)}`;
      const res = await fetch(u, { credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { message?: string }).message ?? res.statusText);
      return data as InvoiceRentContextResponse;
    },
  });

  const hasResolvedRent =
    rentResolve != null &&
    Number.isFinite(rentResolve.resolvedRent) &&
    rentResolve.resolvedRent > MIN_RENT_INVOICE_AMOUNT_INR;

  useEffect(() => {
    if (rentOverride) return;
    if (!hasResolvedRent || !rentResolve) return;
    setRentAmount(formatResolvedRentInput(rentResolve.resolvedRent));
  }, [rentResolve, hasResolvedRent, rentOverride, selectedAllotmentId, periodYmTrim]);

  const rentLocked = hasResolvedRent && !rentOverride;

  const rentNum = Number(rentAmount) || 0;
  const nonGstNum = Number(nonGstAmount) || 0;

  const gstExemptPreview =
    (selectedEntity != null && selectedEntity.gstApplicable === false) || (!isEntitySelection && isGovtEntity);

  const rentCgstPct = (() => {
    const n = parseFloat(String(sysCfg?.rent_invoice_cgst_percent ?? ""));
    return Number.isFinite(n) && n >= 0 ? n : parseFloat(SYSTEM_CONFIG_DEFAULTS.rent_invoice_cgst_percent);
  })();
  const rentSgstPct = (() => {
    const n = parseFloat(String(sysCfg?.rent_invoice_sgst_percent ?? ""));
    return Number.isFinite(n) && n >= 0 ? n : parseFloat(SYSTEM_CONFIG_DEFAULTS.rent_invoice_sgst_percent);
  })();

  const { cgst: cgstNum, sgst: sgstNum } = useMemo(
    () => computeRentInvoiceGstInr(rentNum, gstExemptPreview, rentCgstPct, rentSgstPct),
    [rentNum, gstExemptPreview, rentCgstPct, rentSgstPct],
  );
  const totalAmount = rentInvoiceTotalInr(rentNum, nonGstNum, cgstNum, sgstNum);

  const createMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch("/api/ioms/rent/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText);
      return data as { id: string };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/rent/invoices"] });
      toast({ title: "Rent invoice created", description: "Draft invoice created. Send for verification." });
      setLocation(`/rent/ioms/invoices/${data.id}`);
    },
    onError: (e: Error) => toast({ title: "Create failed", description: e.message, variant: "destructive" }),
  });

  const yardLabel = useMemo(() => {
    const yid = selectedAsset?.yardId;
    if (!yid) return null;
    const y = yards.find((row) => row.id === yid);
    return y ? `${y.name} (${y.code})` : null;
  }, [selectedAsset?.yardId, yards]);

  const premisesDetailsLine = useMemo(() => {
    if (!selectedTrader && !selectedEntity) return "";
    const ref = selectedAsset?.premisesRefNo?.trim();
    const type = selectedAsset?.assetType?.trim();
    const aid = selectedTrader?.assetId ?? selectedEntity?.assetId ?? "";
    const bits: string[] = [];
    if (ref) bits.push(ref);
    if (type) bits.push(type);
    bits.push(aid);
    if (yardLabel) bits.push(`Yard: ${yardLabel}`);
    return bits.filter(Boolean).join(" · ") || aid || "—";
  }, [selectedAsset, selectedTrader, selectedEntity, yardLabel]);

  const pickerLoading = allotmentsLoading || entityAllotmentsLoading;
  const pickerEmpty = traderOptions.length === 0 && entityOptions.length === 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selection || (!selectedTrader && !selectedEntity) || !resolvedYardId || !periodYmTrim) {
      toast({
        title: "Missing fields",
        description: "Select an allotment and enter the billing period (YYYY-MM). Yard is inferred from the premises.",
        variant: "destructive",
      });
      return;
    }
    if (!isValidInvoicePeriodYm(periodYmTrim)) {
      toast({
        title: "Invalid period",
        description: "Period must be a calendar month as YYYY-MM (e.g. 2026-05).",
        variant: "destructive",
      });
      return;
    }
    if (!Number.isFinite(rentNum) || rentNum <= MIN_RENT_INVOICE_AMOUNT_INR) {
      toast({
        title: "Rent amount required",
        description:
          rentResolveFetching && !rentOverride
            ? "Still loading resolved rent for this allotment and month — wait a moment or enter the amount manually."
            : "Enter a positive rent amount for this invoice.",
        variant: "destructive",
      });
      return;
    }
    if (nonGstNum > 0 && !nonGstLabel.trim()) {
      toast({ title: "Non-GST label missing", description: "Enter a label for non-GST charge line.", variant: "destructive" });
      return;
    }
    if (totalAmount <= 0) {
      toast({
        title: "Invalid total",
        description: "Invoice total must be greater than zero.",
        variant: "destructive",
      });
      return;
    }

    const useManualRentAmount = rentOverride || !hasResolvedRent;

    const base: Record<string, unknown> = {
      yardId: resolvedYardId,
      periodMonth: periodYmTrim,
      rentAmount: rentNum,
      useManualRentAmount,
      nonGstCharges: nonGstNum > 0 ? [{ label: nonGstLabel.trim(), amount: nonGstNum }] : [],
      cgst: cgstNum,
      sgst: sgstNum,
      totalAmount,
    };

    if (selectedTrader) {
      createMutation.mutate({
        ...base,
        allotmentId: selectedTrader.id,
        tenantLicenceId: selectedTrader.traderLicenceId,
        assetId: selectedTrader.assetId,
        isGovtEntity,
      });
      return;
    }

    createMutation.mutate({
      ...base,
      allotmentId: selectedEntity!.id,
      tenantLicenceId: "",
      assetId: selectedEntity!.assetId,
      /** Server derives GST / govt flags from the approved premises allocation row. */
      isGovtEntity: false,
    });
  };

  return (
    <AppShell breadcrumbs={[{ label: "Rent (IOMS)", href: "/rent/ioms" }, { label: "Create invoice" }]}>
      <Card>
        <CardHeader className="flex flex-row items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setLocation("/rent/ioms")}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Create rent invoice (M-03)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4 max-w-xl">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Yard (filter)</Label>
                <Select
                  value={yardId || "all"}
                  onValueChange={(v) => {
                    setYardId(v === "all" ? "" : v);
                    setSelection("");
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="All yards" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All yards</SelectItem>
                    {yards.map((y) => (
                      <SelectItem key={y.id} value={y.id}>
                        {y.name} ({y.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Allotment *</Label>
                <Select
                  value={selection || undefined}
                  onValueChange={(v) => setSelection(v as Selection)}
                  disabled={pickerLoading}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={pickerLoading ? "Loading…" : "Select allotment"} />
                  </SelectTrigger>
                  <SelectContent>
                    {pickerEmpty ? (
                      <div className="px-2 py-3 text-sm text-muted-foreground">No billable allotments for this filter.</div>
                    ) : (
                      <>
                        {traderOptions.length > 0 ? (
                          <SelectGroup>
                            <SelectLabel>Trader licence (Track A)</SelectLabel>
                            {traderOptions.map((a) => (
                              <SelectItem key={`trader:${a.id}`} value={`trader:${a.id}`}>
                                {a.allotteeName} — {a.assetId} ({formatYmdToDisplay(a.fromDate)} to {formatYmdToDisplay(a.toDate)})
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        ) : null}
                        {entityOptions.length > 0 ? (
                          <SelectGroup>
                            <SelectLabel>Track B premises (approved)</SelectLabel>
                            {entityOptions.map((e) => (
                              <SelectItem key={`entity:${e.id}`} value={`entity:${e.id}`}>
                                {e.allotteeName} — {e.premisesRefNo?.trim() || e.assetId} (
                                {formatYmdToDisplay(e.fromDate)} to {formatYmdToDisplay(e.toDate)})
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        ) : null}
                      </>
                    )}
                  </SelectContent>
                </Select>
                {isEntitySelection ? (
                  <p className="text-xs text-muted-foreground">
                    Tenant id, GST profile, and agreement checks follow the approved premises allocation on the server.
                  </p>
                ) : null}
              </div>
            </div>

            {(selectedTrader || selectedEntity) && (
              <div className="rounded-lg border bg-muted/40 px-3 py-3 text-sm space-y-2">
                <div className="font-medium text-foreground">Premises & agreement</div>
                <div>
                  <div className="text-muted-foreground text-xs uppercase tracking-wide">Premises details</div>
                  <div className="font-medium mt-0.5">{premisesDetailsLine}</div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <div className="text-muted-foreground text-xs uppercase tracking-wide">Agreement period from</div>
                    <div className="font-medium mt-0.5">
                      {formatYmdToDisplay(selectedTrader?.fromDate ?? selectedEntity?.fromDate)}
                    </div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-xs uppercase tracking-wide">Agreement period to</div>
                    <div className="font-medium mt-0.5">
                      {formatYmdToDisplay(selectedTrader?.toDate ?? selectedEntity?.toDate)}
                    </div>
                  </div>
                </div>
                {billingBounds ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-border/60">
                    <div>
                      <div className="text-muted-foreground text-xs uppercase tracking-wide">Period from</div>
                      <div className="font-medium mt-0.5">{formatYmdToDisplay(billingBounds.from)}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground text-xs uppercase tracking-wide">Period to</div>
                      <div className="font-medium mt-0.5">{formatYmdToDisplay(billingBounds.to)}</div>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground pt-1 border-t border-border/60">
                    Enter the billing month (YYYY-MM) below to show this invoice&apos;s calendar period (period from / period to).
                  </p>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Period (YYYY-MM) *</Label>
                <Input
                  value={periodMonth}
                  onChange={(e) => setPeriodMonth(e.target.value)}
                  placeholder="e.g. 2025-04"
                  required
                  autoComplete="off"
                />
              </div>
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label>Rent amount (₹){!rentLocked ? " *" : ""}</Label>
                  <div className="flex items-center gap-2 shrink-0">
                    {rentResolveFetching && isValidInvoicePeriodYm(periodYmTrim) && selectedAllotmentId ? (
                      <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Resolving…
                      </span>
                    ) : null}
                    {rentLocked ? (
                      <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => setRentOverride(true)}>
                        Override amount
                      </Button>
                    ) : null}
                    {rentOverride && hasResolvedRent ? (
                      <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => setRentOverride(false)}>
                        Use resolved rent
                      </Button>
                    ) : null}
                  </div>
                </div>
                {rentLocked ? (
                  <>
                    <Input type="text" readOnly className="bg-muted font-medium" value={rentAmount} />
                    {rentResolve ? (
                      <p className="text-xs text-muted-foreground">{rentResolvedSourceHint(rentResolve.source)}</p>
                    ) : null}
                  </>
                ) : (
                  <>
                    <Input
                      type="number"
                      min={0}
                      step={0.01}
                      value={rentAmount}
                      onChange={(e) => setRentAmount(e.target.value)}
                      required
                      placeholder="Enter monthly rent (₹)"
                    />
                    {rentResolveIsError ? (
                      <p className="text-xs text-destructive">
                        Could not resolve rent automatically — enter the amount manually or retry after fixing access/network issues.
                      </p>
                    ) : null}
                    {rentResolve &&
                    !hasResolvedRent &&
                    !rentResolveFetching &&
                    isValidInvoicePeriodYm(periodYmTrim) &&
                    selectedAllotmentId ? (
                      <p className="text-xs text-muted-foreground">
                        No approved revision or prior-invoice rent was resolved — enter rent from the allotment if billing manually.
                      </p>
                    ) : null}
                  </>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>CGST (₹) @ {rentCgstPct}%</Label>
                <Input type="text" readOnly className="bg-muted" value={cgstNum.toFixed(2)} />
              </div>
              <div className="space-y-2">
                <Label>SGST (₹) @ {rentSgstPct}%</Label>
                <Input type="text" readOnly className="bg-muted" value={sgstNum.toFixed(2)} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              CGST and SGST are calculated from the rent amount using the M-03 rent invoice CGST/SGST percentages under
              Admin → Config & PDF logo.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Non-GST charge label (optional)</Label>
                <Input
                  value={nonGstLabel}
                  onChange={(e) => setNonGstLabel(e.target.value)}
                  placeholder="e.g. Garbage / Verandah / Open space"
                />
              </div>
              <div className="space-y-2">
                <Label>Non-GST charge amount (₹) (optional)</Label>
                <Input
                  type="number"
                  min={0}
                  step={0.01}
                  value={nonGstAmount}
                  onChange={(e) => setNonGstAmount(e.target.value)}
                  placeholder="0"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Total (₹)</Label>
              <Input type="text" readOnly value={totalAmount.toFixed(2)} className="bg-muted" />
            </div>

            <div className="flex items-center gap-2">
              <Switch
                id="govt"
                checked={isGovtEntity}
                onCheckedChange={setIsGovtEntity}
                disabled={isEntitySelection}
              />
              <Label htmlFor="govt" className={isEntitySelection ? "text-muted-foreground" : undefined}>
                Govt entity / pre-receipt-style exempt rent (Track A traders only)
              </Label>
            </div>

            <div className="flex gap-2 pt-2">
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Create draft invoice
              </Button>
              <Button type="button" variant="outline" onClick={() => setLocation("/rent/ioms")}>
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </AppShell>
  );
}
