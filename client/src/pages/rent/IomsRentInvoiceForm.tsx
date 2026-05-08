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
}

type Selection = "" | `trader:${string}` | `entity:${string}`;

export default function IomsRentInvoiceForm() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [yardId, setYardId] = useState("");
  /** Composite key so trader vs entity rows never collide in the picker. */
  const [selection, setSelection] = useState<Selection>("");
  const [periodMonth, setPeriodMonth] = useState("");
  const [rentAmount, setRentAmount] = useState("");
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

  useEffect(() => {
    if (!selectedEntity) return;
    const mr = selectedEntity.monthlyRent;
    if (mr == null || !Number.isFinite(Number(mr)) || Number(mr) <= 0) return;
    setRentAmount((prev) => (String(prev).trim() === "" ? String(mr) : prev));
  }, [selectedEntity?.id]);

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

  const pickerLoading = allotmentsLoading || entityAllotmentsLoading;
  const pickerEmpty = traderOptions.length === 0 && entityOptions.length === 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selection || (!selectedTrader && !selectedEntity) || !resolvedYardId || !periodMonth.trim()) {
      toast({
        title: "Missing fields",
        description: "Select an allotment (trader or Track B premises) and period; ensure yard is set.",
        variant: "destructive",
      });
      return;
    }
    if (rentNum < 0 || totalAmount < 0) {
      toast({ title: "Invalid amounts", description: "Rent and total must be non-negative.", variant: "destructive" });
      return;
    }
    if (nonGstNum > 0 && !nonGstLabel.trim()) {
      toast({ title: "Non-GST label missing", description: "Enter a label for non-GST charge line.", variant: "destructive" });
      return;
    }

    const base: Record<string, unknown> = {
      yardId: resolvedYardId,
      periodMonth: periodMonth.trim(),
      rentAmount: rentNum,
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

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Period (YYYY-MM) *</Label>
                <Input
                  value={periodMonth}
                  onChange={(e) => setPeriodMonth(e.target.value)}
                  placeholder="e.g. 2025-04"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Rent amount (₹) *</Label>
                <Input
                  type="number"
                  min={0}
                  step={0.01}
                  value={rentAmount}
                  onChange={(e) => setRentAmount(e.target.value)}
                  required
                />
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
