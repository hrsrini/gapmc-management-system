import { useState, useMemo } from "react";
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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { FileText, ArrowLeft, Loader2 } from "lucide-react";
import { formatYmdToDisplay } from "@/lib/dateFormat";

interface Yard {
  id: string;
  name: string;
  code: string;
}
interface Allotment {
  id: string;
  assetId: string;
  traderLicenceId: string;
  allotteeName: string;
  fromDate: string;
  toDate: string;
  status: string;
}
interface Asset {
  id: string;
  assetId: string;
  yardId: string;
  assetType: string;
}

export default function IomsRentInvoiceForm() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [yardId, setYardId] = useState("");
  const [allotmentId, setAllotmentId] = useState("");
  const [periodMonth, setPeriodMonth] = useState("");
  const [rentAmount, setRentAmount] = useState("");
  const [cgst, setCgst] = useState("");
  const [sgst, setSgst] = useState("");
  const [isGovtEntity, setIsGovtEntity] = useState(false);

  const { data: yards = [] } = useQuery<Yard[]>({ queryKey: ["/api/yards"] });
  const { data: allotments = [], isLoading: allotmentsLoading } = useQuery<Allotment[]>({
    queryKey: ["/api/ioms/asset-allotments"],
    queryFn: async () => {
      const res = await fetch("/api/ioms/asset-allotments", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch allotments");
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

  const allotmentsForYard = useMemo(() => {
    if (!yardId) return allotments.filter((a) => a.status === "Active");
    const yardAssetIds = new Set(assets.filter((a) => a.yardId === yardId).map((a) => a.assetId));
    return allotments.filter((a) => a.status === "Active" && yardAssetIds.has(a.assetId));
  }, [allotmentId, allotments, assets, yardId]);

  const selectedAllotment = useMemo(
    () => allotments.find((a) => a.id === allotmentId),
    [allotments, allotmentId]
  );
  const selectedAsset = selectedAllotment ? assetByAssetId[selectedAllotment.assetId] ?? assetByAssetId[selectedAllotment.assetId] : null;
  const resolvedYardId = selectedAsset?.yardId ?? yardId;

  const rentNum = Number(rentAmount) || 0;
  const cgstNum = Number(cgst) || 0;
  const sgstNum = Number(sgst) || 0;
  const totalAmount = rentNum + cgstNum + sgstNum;

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!allotmentId || !selectedAllotment || !resolvedYardId || !periodMonth.trim()) {
      toast({ title: "Missing fields", description: "Select allotment and period, and ensure yard is set.", variant: "destructive" });
      return;
    }
    if (rentNum < 0 || totalAmount < 0) {
      toast({ title: "Invalid amounts", description: "Rent and total must be non-negative.", variant: "destructive" });
      return;
    }
    createMutation.mutate({
      yardId: resolvedYardId,
      allotmentId: selectedAllotment.id,
      tenantLicenceId: selectedAllotment.traderLicenceId,
      assetId: selectedAllotment.assetId,
      periodMonth: periodMonth.trim(),
      rentAmount: rentNum,
      cgst: cgstNum,
      sgst: sgstNum,
      totalAmount,
      isGovtEntity: isGovtEntity,
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
                <Select value={yardId || "all"} onValueChange={(v) => setYardId(v === "all" ? "" : v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="All yards" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All yards</SelectItem>
                    {yards.map((y) => (
                      <SelectItem key={y.id} value={y.id}>{y.name} ({y.code})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Allotment *</Label>
                <Select value={allotmentId} onValueChange={setAllotmentId} disabled={allotmentsLoading}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select active allotment" />
                  </SelectTrigger>
                  <SelectContent>
                    {allotmentsForYard.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.allotteeName} — {a.assetId} ({formatYmdToDisplay(a.fromDate)} to {formatYmdToDisplay(a.toDate)})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
                <Label>CGST (₹)</Label>
                <Input
                  type="number"
                  min={0}
                  step={0.01}
                  value={cgst}
                  onChange={(e) => setCgst(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>SGST (₹)</Label>
                <Input
                  type="number"
                  min={0}
                  step={0.01}
                  value={sgst}
                  onChange={(e) => setSgst(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Total (₹)</Label>
              <Input type="text" readOnly value={totalAmount.toFixed(2)} className="bg-muted" />
            </div>

            <div className="flex items-center gap-2">
              <Switch id="govt" checked={isGovtEntity} onCheckedChange={setIsGovtEntity} />
              <Label htmlFor="govt">Govt entity (Pre-Receipt / Track B)</Label>
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
