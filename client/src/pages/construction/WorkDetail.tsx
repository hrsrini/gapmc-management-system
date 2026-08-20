import { useMemo, useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ClientDataGrid } from "@/components/reports/ClientDataGrid";
import type { ReportTableColumn } from "@/components/reports/ReportDataTable";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { HardHat, ArrowLeft, Pencil, FileText, AlertCircle, Plus, Loader2, Shield } from "lucide-react";
import { formatInr } from "@/lib/formatInr";
import { formatYmdToDisplay } from "@/lib/dateFormat";

interface Work {
  id: string;
  workNo?: string | null;
  yardId: string;
  workType: string;
  status: string;
  description?: string | null;
  location?: string | null;
  contractorName?: string | null;
  estimateAmount?: number | null;
  tenderValue?: number | null;
  woAmountExclGst?: number | null;
  workOrderNo?: string | null;
  workOrderDate?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  completionDate?: string | null;
}
interface WorkBill {
  id: string;
  workId: string;
  billNo?: string | null;
  billDate: string;
  amount: number;
  taxableAmount?: number | null;
  gstPercent?: number | null;
  gstAmount?: number | null;
  cumulativePaid?: number | null;
  voucherId?: string | null;
  status: string;
}
interface AdvancePayload {
  advance: { id: string; amount: number; status: string } | null;
  adjustedTotal: number;
  remaining: number;
  maxAllowed: number;
}
interface SdPbg {
  id: string;
  instrumentType: string;
  amount: number;
  mode: string;
  status: string;
  releaseStatus?: string | null;
  instrumentNo?: string | null;
}
interface YardRef {
  id: string;
  name: string;
}

export default function WorkDetail() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { can, user } = useAuth();
  const roles = user?.roles?.map((r) => r.tier) ?? [];
  const canUpdate = can("M-08", "Update");
  const canCreate = can("M-08", "Create");
  const canVerify = roles.includes("DV") || roles.includes("ADMIN");
  const canApprove = roles.includes("DA") || roles.includes("ADMIN");

  const [billOpen, setBillOpen] = useState(false);
  const [billNo, setBillNo] = useState("");
  const [billDate, setBillDate] = useState("");
  const [taxableAmount, setTaxableAmount] = useState("");
  const [gstPercent, setGstPercent] = useState("18");
  const [overRemark, setOverRemark] = useState("");
  const [advOpen, setAdvOpen] = useState(false);
  const [advAmount, setAdvAmount] = useState("");
  const [sdOpen, setSdOpen] = useState(false);
  const [sdType, setSdType] = useState("SD");
  const [sdMode, setSdMode] = useState("DD");
  const [sdAmount, setSdAmount] = useState("");
  const [sdInstrumentNo, setSdInstrumentNo] = useState("");
  const [sdBankName, setSdBankName] = useState("");
  const [sdValidFrom, setSdValidFrom] = useState("");
  const [sdValidTo, setSdValidTo] = useState("");
  const [sdVoucherId, setSdVoucherId] = useState("");
  const [payOpen, setPayOpen] = useState(false);
  const [payLines, setPayLines] = useState<Record<string, { selected: boolean; amount: string; advanceAdjusted: string }>>({});
  const [expenditureHeadId, setExpenditureHeadId] = useState("");
  const [tdsApplicable, setTdsApplicable] = useState(false);
  const [tdsSection, setTdsSection] = useState("194C");
  const [tdsRatePercent, setTdsRatePercent] = useState("2");

  const { data: work, isLoading, isError } = useQuery<Work>({
    queryKey: ["/api/ioms/works", id],
  });
  const { data: bills = [], isLoading: billsLoading } = useQuery<WorkBill[]>({
    queryKey: [`/api/ioms/works/${id}/bills`],
    enabled: !!id,
  });
  const { data: advanceInfo } = useQuery<AdvancePayload>({
    queryKey: [`/api/ioms/works/${id}/advance`],
    enabled: !!id,
  });
  const { data: sdList = [] } = useQuery<SdPbg[]>({
    queryKey: [`/api/ioms/works/${id}/sd-pbg`],
    enabled: !!id,
  });
  const { data: allocations = [] } = useQuery<
    { id: string; voucherId: string; billId: string; amount: number; advanceAdjusted: number; createdAt?: string | null }[]
  >({
    queryKey: [`/api/ioms/works/${id}/payment-allocations`],
    enabled: !!id,
  });
  const { data: expenditureHeads = [] } = useQuery<{ id: string; code: string; description: string }[]>({
    queryKey: ["/api/ioms/expenditure-heads"],
  });
  const { data: yards = [] } = useQuery<YardRef[]>({ queryKey: ["/api/yards"] });
  const yardById = Object.fromEntries(yards.map((y) => [y.id, y.name]));
  const { data: vouchers = [] } = useQuery<{ id: string; voucherNo?: string | null }[]>({
    queryKey: ["/api/ioms/vouchers"],
  });
  const voucherNoById = Object.fromEntries(vouchers.map((v) => [v.id, v.voucherNo ?? v.id]));

  const gstPreview = useMemo(() => {
    const t = Number(taxableAmount) || 0;
    const p = Number(gstPercent) || 0;
    const g = Math.round(t * p) / 100;
    return { gst: g, total: Math.round((t + g) * 100) / 100 };
  }, [taxableAmount, gstPercent]);

  const statusMutation = useMutation({
    mutationFn: async (status: string) => {
      const res = await fetch(`/api/ioms/works/${id}`, {
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/works", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/works"] });
      toast({ title: "Work Order status updated" });
    },
    onError: (e: Error) => toast({ title: "Status update failed", description: e.message, variant: "destructive" }),
  });

  const billStatusMutation = useMutation({
    mutationFn: async (vars: { billId: string; status: string }) => {
      const res = await fetch(`/api/ioms/works/bills/${vars.billId}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: vars.status }),
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? res.statusText);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/ioms/works/${id}/bills`] });
      toast({ title: "Bill status updated" });
    },
    onError: (e: Error) => toast({ title: "Bill status failed", description: e.message, variant: "destructive" }),
  });

  const addBillMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch("/api/ioms/works/bills", {
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
      queryClient.invalidateQueries({ queryKey: [`/api/ioms/works/${id}/bills`] });
      toast({ title: "Bill added (Draft)" });
      setBillOpen(false);
      setBillNo("");
      setBillDate("");
      setTaxableAmount("");
      setGstPercent("18");
      setOverRemark("");
    },
    onError: (e: Error) => toast({ title: "Failed to add bill", description: e.message, variant: "destructive" }),
  });

  const advanceMutation = useMutation({
    mutationFn: async (amount: number) => {
      const res = await fetch(`/api/ioms/works/${id}/advance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount }),
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? res.statusText);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/ioms/works/${id}/advance`] });
      toast({ title: "Advance created (Draft)" });
      setAdvOpen(false);
      setAdvAmount("");
    },
    onError: (e: Error) => toast({ title: "Advance failed", description: e.message, variant: "destructive" }),
  });

  const advanceStatusMutation = useMutation({
    mutationFn: async (vars: { advanceId: string; status: string }) => {
      const res = await fetch(`/api/ioms/works/advances/${vars.advanceId}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: vars.status }),
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? res.statusText);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/ioms/works/${id}/advance`] });
      toast({ title: "Advance status updated" });
    },
    onError: (e: Error) => toast({ title: "Advance status failed", description: e.message, variant: "destructive" }),
  });

  const sdMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch(`/api/ioms/works/${id}/sd-pbg`, {
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
      queryClient.invalidateQueries({ queryKey: [`/api/ioms/works/${id}/sd-pbg`] });
      toast({ title: "SD/PBG recorded" });
      setSdOpen(false);
      setSdAmount("");
      setSdInstrumentNo("");
      setSdBankName("");
      setSdValidFrom("");
      setSdValidTo("");
      setSdVoucherId("");
    },
    onError: (e: Error) => toast({ title: "SD/PBG failed", description: e.message, variant: "destructive" }),
  });

  const sdReleaseMutation = useMutation({
    mutationFn: async (vars: { id: string; action: "request" | "status"; status?: string }) => {
      const url =
        vars.action === "request"
          ? `/api/ioms/works/sd-pbg/${vars.id}/request-release`
          : `/api/ioms/works/sd-pbg/${vars.id}/release-status`;
      const res = await fetch(url, {
        method: vars.action === "request" ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(vars.status ? { status: vars.status } : {}),
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? res.statusText);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/ioms/works/${id}/sd-pbg`] });
      toast({ title: "SD/PBG release updated" });
    },
    onError: (e: Error) => toast({ title: "Release failed", description: e.message, variant: "destructive" }),
  });

  const payMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch(`/api/ioms/works/${id}/pay-bills`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? res.statusText);
      }
      return res.json() as Promise<{ voucherId: string }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [`/api/ioms/works/${id}/bills`] });
      queryClient.invalidateQueries({ queryKey: [`/api/ioms/works/${id}/payment-allocations`] });
      queryClient.invalidateQueries({ queryKey: [`/api/ioms/works/${id}/advance`] });
      toast({ title: "Payment voucher created", description: "Complete DO→DV→DA on the voucher; bills lock on Approve." });
      setPayOpen(false);
      setLocation(`/vouchers/${data.voucherId}`);
    },
    onError: (e: Error) => toast({ title: "Payment failed", description: e.message, variant: "destructive" }),
  });

  const openPayDialog = () => {
    const next: Record<string, { selected: boolean; amount: string; advanceAdjusted: string }> = {};
    for (const b of bills.filter((x) => x.status === "Approved")) {
      const remaining = Math.max(0, Number(b.amount) - Number(b.cumulativePaid ?? 0));
      next[b.id] = { selected: remaining > 0, amount: remaining > 0 ? String(remaining) : "", advanceAdjusted: "0" };
    }
    setPayLines(next);
    setPayOpen(true);
  };

  const billColumns = useMemo(
    (): ReportTableColumn[] => [
      { key: "billNo", header: "Bill No" },
      { key: "billDate", header: "Date" },
      { key: "_taxable", header: "Taxable", sortField: "taxableAmount" },
      { key: "_gst", header: "GST", sortField: "gstAmount" },
      { key: "_amount", header: "Total", sortField: "amount" },
      { key: "_status", header: "Status", sortField: "status" },
      { key: "_actions", header: "Actions" },
    ],
    [],
  );

  const billRows = useMemo((): Record<string, unknown>[] => {
    return bills.map((b) => ({
      id: b.id,
      billNo: b.billNo ?? "—",
      billDate: b.billDate.slice(0, 10),
      taxableAmount: b.taxableAmount ?? b.amount,
      _taxable: formatInr(b.taxableAmount ?? b.amount),
      gstAmount: b.gstAmount ?? 0,
      _gst: `${formatInr(b.gstAmount ?? 0)} (${b.gstPercent ?? 0}%)`,
      amount: b.amount,
      _amount: formatInr(b.amount),
      status: b.status,
      _status: <Badge variant="outline">{b.status}</Badge>,
      _actions: (
        <div className="flex flex-wrap gap-1">
          {b.status === "Draft" && canVerify && (
            <Button size="sm" variant="outline" onClick={() => billStatusMutation.mutate({ billId: b.id, status: "Verified" })}>
              Verify
            </Button>
          )}
          {b.status === "Verified" && canApprove && (
            <Button size="sm" onClick={() => billStatusMutation.mutate({ billId: b.id, status: "Approved" })}>
              Approve
            </Button>
          )}
        </div>
      ),
    }));
  }, [bills, canVerify, canApprove, billStatusMutation]);

  const overdue =
    work?.endDate &&
    ["Approved"].includes(work.status) &&
    work.endDate < new Date().toISOString().slice(0, 10);

  if (isLoading || work === undefined) {
    return (
      <AppShell breadcrumbs={[{ label: "Construction", href: "/construction" }, { label: "Work" }]}>
        <Card>
          <CardContent className="p-6">
            <Skeleton className="h-8 w-48 mb-4" />
            <Skeleton className="h-32 w-full" />
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  if (isError || !work) {
    return (
      <AppShell breadcrumbs={[{ label: "Construction", href: "/construction" }, { label: "Work" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Work not found.</span>
            <Button variant="outline" size="sm" onClick={() => setLocation("/construction")}>
              Back to list
            </Button>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  const woApproved = ["Approved", "Completed", "Closed"].includes(work.status);

  return (
    <AppShell breadcrumbs={[{ label: "Construction", href: "/construction" }, { label: work.workOrderNo ?? work.workNo ?? work.id }]}>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              <HardHat className="h-5 w-5" />
              {work.workOrderNo ?? work.workNo ?? work.id}
            </CardTitle>
            <div className="flex flex-wrap gap-2 mt-2">
              <Badge variant="secondary">{work.status}</Badge>
              {overdue ? <Badge variant="destructive">Overdue</Badge> : null}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 justify-end">
            <Button variant="ghost" size="sm" onClick={() => setLocation("/construction")}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Back
            </Button>
            {canUpdate && ["Draft", "Verified"].includes(work.status) && (
              <Button variant="outline" size="sm" asChild>
                <Link href={`/construction/works/${id}/edit`}>
                  <Pencil className="h-4 w-4 mr-1" /> Edit
                </Link>
              </Button>
            )}
            {work.status === "Draft" && canVerify && (
              <Button size="sm" disabled={statusMutation.isPending} onClick={() => statusMutation.mutate("Verified")}>
                Verify (DV)
              </Button>
            )}
            {work.status === "Verified" && canApprove && (
              <Button size="sm" disabled={statusMutation.isPending} onClick={() => statusMutation.mutate("Approved")}>
                Approve (DA)
              </Button>
            )}
            {work.status === "Approved" && canApprove && (
              <Button size="sm" variant="secondary" disabled={statusMutation.isPending} onClick={() => statusMutation.mutate("Completed")}>
                Mark completed
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Yard</span>
              <br />
              {yardById[work.yardId] ?? work.yardId}
            </div>
            <div>
              <span className="text-muted-foreground">Type</span>
              <br />
              {work.workType}
            </div>
            <div>
              <span className="text-muted-foreground">Vendor / contractor</span>
              <br />
              {work.contractorName ?? "—"}
            </div>
            <div>
              <span className="text-muted-foreground">WO date</span>
              <br />
              {work.workOrderDate ? formatYmdToDisplay(work.workOrderDate) : "—"}
            </div>
            <div>
              <span className="text-muted-foreground">WO amount excl. GST</span>
              <br />
              {work.woAmountExclGst != null ? formatInr(work.woAmountExclGst) : "—"}
            </div>
            <div>
              <span className="text-muted-foreground">Estimate / Tender</span>
              <br />
              {work.estimateAmount != null ? formatInr(work.estimateAmount) : "—"} /{" "}
              {work.tenderValue != null ? formatInr(work.tenderValue) : "—"}
            </div>
            <div>
              <span className="text-muted-foreground">Start / End</span>
              <br />
              {work.startDate ? formatYmdToDisplay(work.startDate) : "—"} / {work.endDate ? formatYmdToDisplay(work.endDate) : "—"}
            </div>
            <div>
              <span className="text-muted-foreground">Completion</span>
              <br />
              {work.completionDate ? formatYmdToDisplay(work.completionDate) : "—"}
            </div>
          </div>

          <Tabs defaultValue="bills">
            <TabsList>
              <TabsTrigger value="bills">
                <FileText className="h-4 w-4 mr-1" /> Bills ({bills.length})
              </TabsTrigger>
              <TabsTrigger value="advance">Advance</TabsTrigger>
              <TabsTrigger value="sd">
                <Shield className="h-4 w-4 mr-1" /> SD / PBG ({sdList.length})
              </TabsTrigger>
              <TabsTrigger value="payments">Payments ({allocations.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="bills" className="pt-2 space-y-2">
              {canCreate && woApproved && (
                <div className="flex justify-end">
                  <Dialog open={billOpen} onOpenChange={setBillOpen}>
                    <DialogTrigger asChild>
                      <Button size="sm">
                        <Plus className="h-4 w-4 mr-1" /> Add bill
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Add contractor bill (GST)</DialogTitle>
                      </DialogHeader>
                      <form
                        className="space-y-3"
                        onSubmit={(e) => {
                          e.preventDefault();
                          addBillMutation.mutate({
                            workId: id,
                            billNo: billNo || undefined,
                            billDate,
                            taxableAmount: Number(taxableAmount),
                            gstPercent: Number(gstPercent),
                            overbillingOverrideRemark: overRemark || undefined,
                          });
                        }}
                      >
                        <div>
                          <Label>Bill no</Label>
                          <Input value={billNo} onChange={(e) => setBillNo(e.target.value)} />
                        </div>
                        <div>
                          <Label>Bill date *</Label>
                          <Input type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} required />
                        </div>
                        <div>
                          <Label>Taxable amount (₹) *</Label>
                          <Input type="number" step="0.01" value={taxableAmount} onChange={(e) => setTaxableAmount(e.target.value)} required />
                        </div>
                        <div>
                          <Label>GST %</Label>
                          <Input type="number" step="0.01" value={gstPercent} onChange={(e) => setGstPercent(e.target.value)} />
                        </div>
                        <p className="text-sm text-muted-foreground">
                          GST {formatInr(gstPreview.gst)} · Total {formatInr(gstPreview.total)}
                        </p>
                        <div>
                          <Label>Over-billing DA remark (if bills+advance &gt; WO)</Label>
                          <Input value={overRemark} onChange={(e) => setOverRemark(e.target.value)} />
                        </div>
                        <DialogFooter>
                          <Button type="button" variant="outline" onClick={() => setBillOpen(false)}>
                            Cancel
                          </Button>
                          <Button type="submit" disabled={addBillMutation.isPending}>
                            {addBillMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                            Add bill
                          </Button>
                        </DialogFooter>
                      </form>
                    </DialogContent>
                  </Dialog>
                </div>
              )}
              {!woApproved && <p className="text-sm text-muted-foreground">Approve the Work Order before adding bills.</p>}
              {billsLoading ? (
                <Skeleton className="h-32 w-full" />
              ) : (
                <ClientDataGrid
                  columns={billColumns}
                  sourceRows={billRows}
                  searchKeys={["billNo", "billDate", "status"]}
                  defaultSortKey="billDate"
                  defaultSortDir="desc"
                  emptyMessage="No bills for this work."
                  resetPageDependency={id}
                />
              )}
            </TabsContent>

            <TabsContent value="advance" className="pt-2 space-y-3">
              <p className="text-sm text-muted-foreground">
                One mobilization advance per WO · cap 10% of WO amount excl. GST (max {formatInr(advanceInfo?.maxAllowed ?? 0)}).
              </p>
              {advanceInfo?.advance ? (
                <div className="rounded-md border p-3 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge>{advanceInfo.advance.status}</Badge>
                    <span className="font-medium">{formatInr(advanceInfo.advance.amount)}</span>
                    <span className="text-sm text-muted-foreground">
                      Adjusted {formatInr(advanceInfo.adjustedTotal)} · Remaining {formatInr(advanceInfo.remaining)}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    {advanceInfo.advance.status === "Draft" && canVerify && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => advanceStatusMutation.mutate({ advanceId: advanceInfo.advance!.id, status: "Verified" })}
                      >
                        Verify
                      </Button>
                    )}
                    {advanceInfo.advance.status === "Verified" && canApprove && (
                      <Button
                        size="sm"
                        onClick={() => advanceStatusMutation.mutate({ advanceId: advanceInfo.advance!.id, status: "Approved" })}
                      >
                        Approve
                      </Button>
                    )}
                  </div>
                </div>
              ) : canCreate && woApproved ? (
                <Dialog open={advOpen} onOpenChange={setAdvOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm">
                      <Plus className="h-4 w-4 mr-1" /> Create advance
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Mobilization advance</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3">
                      <div>
                        <Label>Amount (₹)</Label>
                        <Input type="number" step="0.01" value={advAmount} onChange={(e) => setAdvAmount(e.target.value)} />
                      </div>
                      <DialogFooter>
                        <Button
                          onClick={() => advanceMutation.mutate(Number(advAmount))}
                          disabled={advanceMutation.isPending || !(Number(advAmount) > 0)}
                        >
                          Create Draft
                        </Button>
                      </DialogFooter>
                    </div>
                  </DialogContent>
                </Dialog>
              ) : (
                <p className="text-sm text-muted-foreground">No advance yet.</p>
              )}
            </TabsContent>

            <TabsContent value="sd" className="pt-2 space-y-3">
              {canCreate && woApproved && (
                <div className="flex justify-end">
                  <Dialog open={sdOpen} onOpenChange={setSdOpen}>
                    <DialogTrigger asChild>
                      <Button size="sm">
                        <Plus className="h-4 w-4 mr-1" /> Add SD/PBG
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Record SD / PBG</DialogTitle>
                      </DialogHeader>
                      <div className="space-y-3">
                        <div>
                          <Label>Type</Label>
                          <Select value={sdType} onValueChange={setSdType}>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="SD">Security Deposit</SelectItem>
                              <SelectItem value="PBG">Performance Bank Guarantee</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label>Mode</Label>
                          <Select value={sdMode} onValueChange={setSdMode}>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {["Cash", "DD", "BG", "Other"].map((m) => (
                                <SelectItem key={m} value={m}>
                                  {m}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label>Amount (₹)</Label>
                          <Input type="number" step="0.01" value={sdAmount} onChange={(e) => setSdAmount(e.target.value)} />
                        </div>
                        <div>
                          <Label>Instrument no.</Label>
                          <Input value={sdInstrumentNo} onChange={(e) => setSdInstrumentNo(e.target.value)} />
                        </div>
                        {(sdMode === "DD" || sdMode === "BG" || sdMode === "Other") && (
                          <>
                            <div>
                              <Label>Bank name</Label>
                              <Input value={sdBankName} onChange={(e) => setSdBankName(e.target.value)} />
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <Label>Valid from</Label>
                                <Input type="date" value={sdValidFrom} onChange={(e) => setSdValidFrom(e.target.value)} />
                              </div>
                              <div>
                                <Label>Valid to</Label>
                                <Input type="date" value={sdValidTo} onChange={(e) => setSdValidTo(e.target.value)} />
                              </div>
                            </div>
                          </>
                        )}
                        {(sdMode === "Cash" || sdMode === "DD") && (
                          <div>
                            <Label>Linked M-06 voucher id (optional)</Label>
                            <Input
                              value={sdVoucherId}
                              onChange={(e) => setSdVoucherId(e.target.value)}
                              placeholder="If Cash/DD already vouchered"
                            />
                          </div>
                        )}
                        <DialogFooter>
                          <Button
                            onClick={() =>
                              sdMutation.mutate({
                                instrumentType: sdType,
                                mode: sdMode,
                                amount: Number(sdAmount),
                                instrumentNo: sdInstrumentNo || undefined,
                                bankName: sdBankName || undefined,
                                validFrom: sdValidFrom || undefined,
                                validTo: sdValidTo || undefined,
                                voucherId: sdVoucherId || undefined,
                              })
                            }
                            disabled={sdMutation.isPending || !(Number(sdAmount) > 0)}
                          >
                            Save
                          </Button>
                        </DialogFooter>
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
              )}
              <div className="space-y-2">
                {sdList.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No SD/PBG records.</p>
                ) : (
                  sdList.map((s) => (
                    <div key={s.id} className="rounded-md border p-3 flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm">
                        <span className="font-medium">
                          {s.instrumentType} · {formatInr(s.amount)}
                        </span>
                        <span className="text-muted-foreground"> · {s.mode}</span>
                        {s.instrumentNo ? <span className="text-muted-foreground"> · {s.instrumentNo}</span> : null}
                        <div className="flex gap-2 mt-1">
                          <Badge variant="outline">{s.status}</Badge>
                          {s.releaseStatus ? <Badge variant="secondary">Release: {s.releaseStatus}</Badge> : null}
                        </div>
                      </div>
                      <div className="flex gap-1">
                        {s.status === "Active" && canCreate && (
                          <Button size="sm" variant="outline" onClick={() => sdReleaseMutation.mutate({ id: s.id, action: "request" })}>
                            Request release
                          </Button>
                        )}
                        {s.status === "ReleaseRequested" && s.releaseStatus === "Draft" && canVerify && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => sdReleaseMutation.mutate({ id: s.id, action: "status", status: "Verified" })}
                          >
                            Verify release
                          </Button>
                        )}
                        {s.status === "ReleaseRequested" && s.releaseStatus === "Verified" && canApprove && (
                          <Button size="sm" onClick={() => sdReleaseMutation.mutate({ id: s.id, action: "status", status: "Approved" })}>
                            Approve release
                          </Button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </TabsContent>

            <TabsContent value="payments" className="pt-2 space-y-3">
              <p className="text-sm text-muted-foreground">
                Pay one or more Approved bills via an M-06 ContractorBill voucher. Bills lock when that voucher is Approved.
                Remaining advance available: {formatInr(advanceInfo?.remaining ?? 0)}.
              </p>
              {canCreate && woApproved && bills.some((b) => b.status === "Approved") && (
                <div className="flex justify-end">
                  <Button size="sm" onClick={openPayDialog}>
                    <Plus className="h-4 w-4 mr-1" /> Pay approved bills
                  </Button>
                </div>
              )}
              <Dialog open={payOpen} onOpenChange={setPayOpen}>
                <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>Pay bills (create M-06 voucher)</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-3">
                    {Object.keys(payLines).length === 0 ? (
                      <p className="text-sm text-muted-foreground">No Approved unpaid bills.</p>
                    ) : (
                      Object.entries(payLines).map(([billId, line]) => {
                        const bill = bills.find((b) => b.id === billId);
                        return (
                          <div key={billId} className="rounded border p-2 space-y-2">
                            <label className="flex items-center gap-2 text-sm font-medium">
                              <input
                                type="checkbox"
                                checked={line.selected}
                                onChange={(e) =>
                                  setPayLines((prev) => ({
                                    ...prev,
                                    [billId]: { ...prev[billId], selected: e.target.checked },
                                  }))
                                }
                              />
                              {bill?.billNo ?? billId} · {formatInr(bill?.amount ?? 0)}
                            </label>
                            {line.selected && (
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <Label>Pay amount</Label>
                                  <Input
                                    type="number"
                                    step="0.01"
                                    value={line.amount}
                                    onChange={(e) =>
                                      setPayLines((prev) => ({
                                        ...prev,
                                        [billId]: { ...prev[billId], amount: e.target.value },
                                      }))
                                    }
                                  />
                                </div>
                                <div>
                                  <Label>Advance adjusted</Label>
                                  <Input
                                    type="number"
                                    step="0.01"
                                    value={line.advanceAdjusted}
                                    onChange={(e) =>
                                      setPayLines((prev) => ({
                                        ...prev,
                                        [billId]: { ...prev[billId], advanceAdjusted: e.target.value },
                                      }))
                                    }
                                  />
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                    <div>
                      <Label>Expenditure head *</Label>
                      <Select value={expenditureHeadId || undefined} onValueChange={setExpenditureHeadId}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select head" />
                        </SelectTrigger>
                        <SelectContent>
                          {expenditureHeads.map((h) => (
                            <SelectItem key={h.id} value={h.id}>
                              {h.code} — {h.description}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={tdsApplicable} onChange={(e) => setTdsApplicable(e.target.checked)} />
                      TDS applicable
                    </label>
                    {tdsApplicable && (
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <Label>Section</Label>
                          <Input value={tdsSection} onChange={(e) => setTdsSection(e.target.value)} />
                        </div>
                        <div>
                          <Label>Rate %</Label>
                          <Input type="number" step="0.01" value={tdsRatePercent} onChange={(e) => setTdsRatePercent(e.target.value)} />
                        </div>
                      </div>
                    )}
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setPayOpen(false)}>
                      Cancel
                    </Button>
                    <Button
                      disabled={payMutation.isPending || !expenditureHeadId}
                      onClick={() => {
                        const lines = Object.entries(payLines)
                          .filter(([, l]) => l.selected && Number(l.amount) > 0)
                          .map(([billId, l]) => ({
                            billId,
                            amount: Number(l.amount),
                            advanceAdjusted: Number(l.advanceAdjusted) || 0,
                          }));
                        if (!lines.length) {
                          toast({ title: "Select bills", description: "Choose at least one bill with amount.", variant: "destructive" });
                          return;
                        }
                        payMutation.mutate({
                          expenditureHeadId,
                          payeeName: work.contractorName,
                          lines,
                          tdsApplicable,
                          tdsSection: tdsApplicable ? tdsSection : undefined,
                          tdsRatePercent: tdsApplicable ? Number(tdsRatePercent) : undefined,
                        });
                      }}
                    >
                      {payMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                      Create voucher &amp; allocate
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
              {allocations.length === 0 ? (
                <p className="text-sm text-muted-foreground">No payment allocations yet.</p>
              ) : (
                <div className="space-y-2">
                  {allocations.map((a) => (
                    <div key={a.id} className="rounded-md border p-3 text-sm flex flex-wrap justify-between gap-2">
                      <div>
                        <span className="font-medium">{formatInr(a.amount)}</span>
                        {a.advanceAdjusted > 0 ? (
                          <span className="text-muted-foreground"> · adv adj {formatInr(a.advanceAdjusted)}</span>
                        ) : null}
                        <div className="text-muted-foreground">Bill {a.billId.slice(0, 8)}…</div>
                      </div>
                      <Button variant="outline" size="sm" asChild>
                        <Link href={`/vouchers/${a.voucherId}`}>{voucherNoById[a.voucherId] ?? "Open voucher"}</Link>
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </AppShell>
  );
}
