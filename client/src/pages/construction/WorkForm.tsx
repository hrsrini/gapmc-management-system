import { useState, useEffect, useMemo } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { HardHat, Loader2, AlertCircle } from "lucide-react";
import { Link } from "wouter";

interface Yard {
  id: string;
  code?: string | null;
  name?: string | null;
}
interface Vendor {
  id: string;
  name: string;
  status: string;
}
interface Work {
  id: string;
  workNo?: string | null;
  yardId: string;
  workType: string;
  status: string;
  description?: string | null;
  location?: string | null;
  vendorId?: string | null;
  contractorName?: string | null;
  estimateAmount?: number | null;
  tenderValue?: number | null;
  woAmountExclGst?: number | null;
  workOrderNo?: string | null;
  workOrderDate?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  scopeText?: string | null;
  termsConditions?: string | null;
  dlpMonths?: number | null;
  penaltyText?: string | null;
  retentionPercent?: number | null;
  remarks?: string | null;
}

const WORK_TYPES = ["Civil", "Electrical", "Plumbing", "AMC", "Other"];

export default function WorkForm() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isEdit = !!id;

  const [yardId, setYardId] = useState("");
  const [workType, setWorkType] = useState("Civil");
  const [description, setDescription] = useState("");
  const [location, setLocationField] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [estimateAmount, setEstimateAmount] = useState("");
  const [tenderValue, setTenderValue] = useState("");
  const [woAmountExclGst, setWoAmountExclGst] = useState("");
  const [workOrderNo, setWorkOrderNo] = useState("");
  const [workOrderDate, setWorkOrderDate] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [scopeText, setScopeText] = useState("");
  const [termsConditions, setTermsConditions] = useState("");
  const [dlpMonths, setDlpMonths] = useState("");
  const [penaltyText, setPenaltyText] = useState("");
  const [retentionPercent, setRetentionPercent] = useState("");
  const [remarks, setRemarks] = useState("");

  const { data: yards = [] } = useQuery<Yard[]>({ queryKey: ["/api/yards"] });
  const { data: vendors = [] } = useQuery<Vendor[]>({ queryKey: ["/api/ioms/vendors"] });
  const activeVendors = useMemo(() => vendors.filter((v) => v.status === "Active"), [vendors]);
  const { data: work, isError: workError } = useQuery<Work>({
    queryKey: ["/api/ioms/works", id],
    enabled: isEdit,
  });

  const locked = isEdit && work != null && !["Draft", "Verified"].includes(work.status);

  useEffect(() => {
    if (!work) return;
    setYardId(work.yardId ?? "");
    setWorkType(work.workType ?? "Civil");
    setDescription(work.description ?? "");
    setLocationField(work.location ?? "");
    setVendorId(work.vendorId ?? "");
    setEstimateAmount(work.estimateAmount != null ? String(work.estimateAmount) : "");
    setTenderValue(work.tenderValue != null ? String(work.tenderValue) : "");
    setWoAmountExclGst(work.woAmountExclGst != null ? String(work.woAmountExclGst) : "");
    setWorkOrderNo(work.workOrderNo ?? "");
    setWorkOrderDate(work.workOrderDate ?? "");
    setStartDate(work.startDate ?? "");
    setEndDate(work.endDate ?? "");
    setScopeText(work.scopeText ?? "");
    setTermsConditions(work.termsConditions ?? "");
    setDlpMonths(work.dlpMonths != null ? String(work.dlpMonths) : "");
    setPenaltyText(work.penaltyText ?? "");
    setRetentionPercent(work.retentionPercent != null ? String(work.retentionPercent) : "");
    setRemarks(work.remarks ?? "");
  }, [work]);

  const createMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch("/api/ioms/works", {
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
    onSuccess: (row) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/works"] });
      toast({ title: "Work Order created (Draft)" });
      setLocation(`/construction/works/${row.id}`);
    },
    onError: (e: Error) => toast({ title: "Create failed", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch(`/api/ioms/works/${id}`, {
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/works"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/works", id] });
      toast({ title: "Work Order updated" });
      setLocation(`/construction/works/${id}`);
    },
    onError: (e: Error) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!workOrderNo.trim() || !workOrderDate || !vendorId || !yardId) {
      toast({
        title: "Missing required fields",
        description: "Yard, Work Order No., Work Order date, and Vendor are required.",
        variant: "destructive",
      });
      return;
    }
    const payload = {
      yardId,
      workType,
      workOrderNo: workOrderNo.trim(),
      workOrderDate,
      vendorId,
      description: description || undefined,
      location: location || undefined,
      estimateAmount: estimateAmount ? Number(estimateAmount) : undefined,
      tenderValue: tenderValue ? Number(tenderValue) : undefined,
      woAmountExclGst: woAmountExclGst ? Number(woAmountExclGst) : undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      scopeText: scopeText || undefined,
      termsConditions: termsConditions || undefined,
      dlpMonths: dlpMonths ? Number(dlpMonths) : undefined,
      penaltyText: penaltyText || undefined,
      retentionPercent: retentionPercent ? Number(retentionPercent) : undefined,
      remarks: remarks || undefined,
    };
    if (isEdit) updateMutation.mutate(payload);
    else createMutation.mutate(payload);
  };

  const loading = isEdit && work === undefined && !workError;
  const saving = createMutation.isPending || updateMutation.isPending;

  if (isEdit && workError) {
    return (
      <AppShell breadcrumbs={[{ label: "Construction", href: "/construction" }, { label: "Edit" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Work not found.</span>
            <Button variant="outline" size="sm" onClick={() => setLocation("/construction")}>
              Back
            </Button>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  if (loading) {
    return (
      <AppShell breadcrumbs={[{ label: "Construction", href: "/construction" }, { label: "Edit" }]}>
        <Card>
          <CardContent className="p-6 flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>Loading work…</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Construction", href: "/construction" }, { label: isEdit ? "Edit work" : "Add work" }]}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HardHat className="h-5 w-5" />
            {isEdit ? "Edit Work Order" : "New Work Order"}
          </CardTitle>
          {locked ? (
            <p className="text-sm text-amber-700">This Work Order is {work?.status} and cannot be amended (v1).</p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Creates as <span className="font-medium">Draft</span>. Vendor is mandatory. WO No. is user-entered.
              {" "}
              <Link href="/construction/vendors" className="underline">
                Manage vendors
              </Link>
            </p>
          )}
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Work Order No. *</Label>
              <Input value={workOrderNo} onChange={(e) => setWorkOrderNo(e.target.value)} disabled={locked} required />
            </div>
            <div className="space-y-1">
              <Label>Work Order date *</Label>
              <Input type="date" value={workOrderDate} onChange={(e) => setWorkOrderDate(e.target.value)} disabled={locked} required />
            </div>
            <div className="space-y-1">
              <Label>Yard *</Label>
              <Select value={yardId || undefined} onValueChange={setYardId} disabled={locked}>
                <SelectTrigger>
                  <SelectValue placeholder="Select yard" />
                </SelectTrigger>
                <SelectContent>
                  {yards.map((y) => (
                    <SelectItem key={y.id} value={y.id}>
                      {(y.code ?? "") + " — " + (y.name ?? y.id)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Vendor *</Label>
              <Select value={vendorId || undefined} onValueChange={setVendorId} disabled={locked}>
                <SelectTrigger>
                  <SelectValue placeholder="Select vendor" />
                </SelectTrigger>
                <SelectContent>
                  {activeVendors.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Work type *</Label>
              <Select value={workType} onValueChange={setWorkType} disabled={locked}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WORK_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>WO amount excl. GST (₹)</Label>
              <Input
                type="number"
                step="0.01"
                value={woAmountExclGst}
                onChange={(e) => setWoAmountExclGst(e.target.value)}
                disabled={locked}
                placeholder="Base for 10% advance cap"
              />
            </div>
            <div className="space-y-1">
              <Label>Estimate (₹)</Label>
              <Input type="number" step="0.01" value={estimateAmount} onChange={(e) => setEstimateAmount(e.target.value)} disabled={locked} />
            </div>
            <div className="space-y-1">
              <Label>Tender value (₹)</Label>
              <Input type="number" step="0.01" value={tenderValue} onChange={(e) => setTenderValue(e.target.value)} disabled={locked} />
            </div>
            <div className="space-y-1">
              <Label>Start date</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} disabled={locked} />
            </div>
            <div className="space-y-1">
              <Label>End date</Label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} disabled={locked} />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label>Location</Label>
              <Input value={location} onChange={(e) => setLocationField(e.target.value)} disabled={locked} />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label>Description</Label>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} disabled={locked} rows={2} />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label>Scope (optional)</Label>
              <Textarea value={scopeText} onChange={(e) => setScopeText(e.target.value)} disabled={locked} rows={2} />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label>Terms &amp; conditions (optional)</Label>
              <Textarea value={termsConditions} onChange={(e) => setTermsConditions(e.target.value)} disabled={locked} rows={2} />
            </div>
            <div className="space-y-1">
              <Label>DLP months (optional)</Label>
              <Input type="number" value={dlpMonths} onChange={(e) => setDlpMonths(e.target.value)} disabled={locked} />
            </div>
            <div className="space-y-1">
              <Label>Retention % (optional, no auto-deduct)</Label>
              <Input type="number" step="0.01" value={retentionPercent} onChange={(e) => setRetentionPercent(e.target.value)} disabled={locked} />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label>Penalty (optional)</Label>
              <Input value={penaltyText} onChange={(e) => setPenaltyText(e.target.value)} disabled={locked} />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label>Remarks</Label>
              <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} disabled={locked} rows={2} />
            </div>
            <div className="md:col-span-2 flex gap-2">
              <Button type="submit" disabled={saving || locked}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                {isEdit ? "Save" : "Create Draft"}
              </Button>
              <Button type="button" variant="outline" onClick={() => setLocation(isEdit ? `/construction/works/${id}` : "/construction")}>
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </AppShell>
  );
}
