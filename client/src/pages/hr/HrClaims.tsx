import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Wallet, Plane, Car, AlertCircle, CheckCircle, XCircle, ShieldCheck, SendHorizontal, Plus } from "lucide-react";
import { REJECTION_REASON_CODES, MIN_WORKFLOW_REMARKS_LENGTH } from "@shared/workflow-rejection";
import { ClientDataGrid } from "@/components/reports/ClientDataGrid";
import type { ReportTableColumn } from "@/components/reports/ReportDataTable";

interface LtcClaim {
  id: string;
  employeeId: string;
  claimDate: string;
  amount: number;
  period?: string | null;
  blockPeriod?: string | null;
  ltcType?: string | null;
  estimatedEntitlement?: number | null;
  advanceAmount?: number | null;
  actualClaimAmount?: number | null;
  netPayable?: number | null;
  status: string;
  doUser?: string | null;
  dvUser?: string | null;
  approvedBy?: string | null;
  rejectionReasonCode?: string | null;
  rejectionRemarks?: string | null;
  workflowRevisionCount?: number | null;
  dvReturnRemarks?: string | null;
}
interface TaDaClaim {
  id: string;
  employeeId: string;
  tourProgrammeId?: string | null;
  travelDate: string;
  returnDate?: string | null;
  purpose: string;
  amount: number;
  cityCategory?: string | null;
  days?: number | null;
  hotelAmount?: number | null;
  payLevelSnapshot?: number | null;
  entitledTrainClass?: string | null;
  entitledDaPerDay?: number | null;
  entitledHotelPerDay?: number | null;
  entitledTotal?: number | null;
  status: string;
  doUser?: string | null;
  dvUser?: string | null;
  approvedBy?: string | null;
  rejectionReasonCode?: string | null;
  rejectionRemarks?: string | null;
  workflowRevisionCount?: number | null;
  dvReturnRemarks?: string | null;
}
interface Employee {
  id: string;
  empId?: string | null;
  firstName: string;
  surname: string;
}

interface TourProgramme {
  id: string;
  tourNo: string;
  employeeId: string;
  destination: string;
  fromDate: string;
  toDate: string;
  status: string;
}

export default function HrClaims() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const roles = user?.roles?.map((r) => r.tier) ?? [];
  const canVerify = roles.includes("DV") || roles.includes("ADMIN");
  const canApprove = roles.includes("DA") || roles.includes("ADMIN");
  const canSubmitNew = roles.includes("DO") || roles.includes("ADMIN");
  const [ltcPendingOnly, setLtcPendingOnly] = useState(false);
  const [ltcRejectId, setLtcRejectId] = useState<string | null>(null);
  const [ltcRejectCode, setLtcRejectCode] = useState<string>(REJECTION_REASON_CODES[0]);
  const [ltcRejectRemarks, setLtcRejectRemarks] = useState("");
  const [ltcReturnId, setLtcReturnId] = useState<string | null>(null);
  const [ltcReturnRemarks, setLtcReturnRemarks] = useState("");
  const [tadaNewOpen, setTadaNewOpen] = useState(false);
  const [ltcNewOpen, setLtcNewOpen] = useState(false);
  const [tadaNewEmployeeId, setTadaNewEmployeeId] = useState("");
  const [tadaNewTravel, setTadaNewTravel] = useState("");
  const [tadaNewReturn, setTadaNewReturn] = useState("");
  const [tadaNewPurpose, setTadaNewPurpose] = useState("");
  const [tadaNewAmount, setTadaNewAmount] = useState("");
  const [tadaCityCategory, setTadaCityCategory] = useState<"A" | "B">("A");
  const [tadaDays, setTadaDays] = useState("1");
  const [tadaHotelAmount, setTadaHotelAmount] = useState("");
  const [tadaTourProgrammeId, setTadaTourProgrammeId] = useState("");
  const [ltcNewEmployeeId, setLtcNewEmployeeId] = useState("");
  const [ltcNewDate, setLtcNewDate] = useState("");
  const [ltcNewAmount, setLtcNewAmount] = useState("");
  const [ltcNewPeriod, setLtcNewPeriod] = useState("");
  const [ltcNewBlockPeriod, setLtcNewBlockPeriod] = useState("");
  const [ltcNewType, setLtcNewType] = useState<"HomeTown" | "AllIndia">("HomeTown");
  const [ltcNewEstimated, setLtcNewEstimated] = useState("");
  const [ltcNewAdvance, setLtcNewAdvance] = useState("");
  const [tadaPendingOnly, setTadaPendingOnly] = useState(false);
  const [tadaRejectId, setTadaRejectId] = useState<string | null>(null);
  const [tadaRejectCode, setTadaRejectCode] = useState<string>(REJECTION_REASON_CODES[0]);
  const [tadaRejectRemarks, setTadaRejectRemarks] = useState("");
  const [tadaReturnId, setTadaReturnId] = useState<string | null>(null);
  const [tadaReturnRemarks, setTadaReturnRemarks] = useState("");
  const [ltcReportFrom, setLtcReportFrom] = useState("");
  const [ltcReportTo, setLtcReportTo] = useState("");

  const tadaListUrl = tadaPendingOnly ? "/api/hr/claims/tada?pendingMyAction=1" : "/api/hr/claims/tada";
  const ltcListUrl = ltcPendingOnly ? "/api/hr/claims/ltc?pendingMyAction=1" : "/api/hr/claims/ltc";

  const { data: sysConfig } = useQuery<Record<string, string>>({
    queryKey: ["/api/system/config"],
  });
  const entitlementRows = useMemo(() => {
    const raw = sysConfig?.ta_da_entitlement_json ?? "";
    try {
      const v = JSON.parse(raw) as unknown;
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  }, [sysConfig?.ta_da_entitlement_json]);

  const ltcReportQuery = useMemo(() => {
    const qs = new URLSearchParams();
    if (ltcReportFrom) qs.set("from", ltcReportFrom);
    if (ltcReportTo) qs.set("to", ltcReportTo);
    return qs.toString();
  }, [ltcReportFrom, ltcReportTo]);

  const { data: ltcList = [], isLoading: ltcLoading, isError: ltcError } = useQuery<LtcClaim[]>({
    queryKey: [ltcListUrl],
  });
  const { data: tadaList = [], isLoading: tadaLoading, isError: tadaError } = useQuery<TaDaClaim[]>({
    queryKey: [tadaListUrl],
  });
  const { data: employees = [] } = useQuery<Employee[]>({
    queryKey: ["/api/hr/employees"],
  });
  const tadaEmployeeForTours = roles.includes("ADMIN") ? tadaNewEmployeeId : user?.employeeId ?? "";
  const { data: tours = [] } = useQuery<TourProgramme[]>({
    queryKey: [`/api/hr/tours?employeeId=${encodeURIComponent(tadaEmployeeForTours)}`],
    enabled: Boolean(tadaEmployeeForTours),
  });
  const approvedTours = useMemo(() => tours.filter((t) => t.status === "Approved"), [tours]);
  const employeeLabelById = Object.fromEntries(
    employees.map((e) => [e.id, `${e.empId ?? e.id} — ${e.firstName} ${e.surname}`]),
  );

  const createTadaMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch("/api/hr/claims/tada", {
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
      queryClient.invalidateQueries({ queryKey: ["/api/hr/claims/tada"] });
      queryClient.invalidateQueries({ queryKey: ["/api/hr/claims/tada?pendingMyAction=1"] });
      toast({ title: "TA/DA claim created", description: "Pending DV verification." });
      setTadaNewOpen(false);
    },
    onError: (e: Error) => toast({ title: "Create failed", description: e.message, variant: "destructive" }),
  });

  const createLtcMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch("/api/hr/claims/ltc", {
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
      queryClient.invalidateQueries({ queryKey: ["/api/hr/claims/ltc"] });
      queryClient.invalidateQueries({ queryKey: ["/api/hr/claims/ltc?pendingMyAction=1"] });
      toast({ title: "LTC claim created", description: "Pending DV verification." });
      setLtcNewOpen(false);
    },
    onError: (e: Error) => toast({ title: "Create failed", description: e.message, variant: "destructive" }),
  });

  const ltcStatusMutation = useMutation({
    mutationFn: async (vars: { id: string; status: string } & Record<string, unknown>) => {
      const { id, ...body } = vars;
      const res = await fetch(`/api/hr/claims/ltc/${id}`, {
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
      queryClient.invalidateQueries({ queryKey: ["/api/hr/claims/ltc"] });
      queryClient.invalidateQueries({ queryKey: ["/api/hr/claims/ltc?pendingMyAction=1"] });
      toast({ title: "LTC updated", description: `Claim set to ${vars.status}.` });
      setLtcRejectId(null);
      setLtcRejectRemarks("");
      setLtcReturnId(null);
      setLtcReturnRemarks("");
    },
    onError: (e: Error) => {
      toast({ title: "Update failed", description: e.message, variant: "destructive" });
    },
  });

  const tadaStatusMutation = useMutation({
    mutationFn: async (vars: { id: string; status: string } & Record<string, unknown>) => {
      const { id, ...body } = vars;
      const res = await fetch(`/api/hr/claims/tada/${id}`, {
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
      queryClient.invalidateQueries({ queryKey: ["/api/hr/claims/tada"] });
      queryClient.invalidateQueries({ queryKey: ["/api/hr/claims/tada?pendingMyAction=1"] });
      toast({ title: "TA/DA updated", description: `Claim set to ${vars.status}.` });
      setTadaRejectId(null);
      setTadaRejectRemarks("");
      setTadaReturnId(null);
      setTadaReturnRemarks("");
    },
    onError: (e: Error) => {
      toast({ title: "Update failed", description: e.message, variant: "destructive" });
    },
  });

  const isError = ltcError || tadaError;
  const showTadaActions = canVerify || canApprove;
  const showLtcActions = canVerify || canApprove;

  const ltcColumns = useMemo((): ReportTableColumn[] => {
    const base: ReportTableColumn[] = [
      { key: "employeeLabel", header: "Employee" },
      { key: "claimDate", header: "Claim date" },
      { key: "period", header: "Period" },
      { key: "amount", header: "Amount", sortField: "amountNum" },
      { key: "netPayable", header: "Net", sortField: "netPayableNum" },
      { key: "_statusBlock", header: "Status", sortField: "status" },
    ];
    if (showLtcActions) base.push({ key: "_actions", header: "Actions" });
    return base;
  }, [showLtcActions]);

  const tadaColumns = useMemo((): ReportTableColumn[] => {
    const base: ReportTableColumn[] = [
      { key: "employeeLabel", header: "Employee" },
      { key: "travelDate", header: "Travel date" },
      { key: "purpose", header: "Purpose" },
      { key: "amount", header: "Amount", sortField: "amountNum" },
      { key: "entitledTotal", header: "Entitled", sortField: "entitledTotalNum" },
      { key: "_statusBlock", header: "Status", sortField: "status" },
    ];
    if (showTadaActions) base.push({ key: "_actions", header: "Actions" });
    return base;
  }, [showTadaActions]);

  const ltcRows = useMemo((): Record<string, unknown>[] => {
    return ltcList.map((c) => ({
      id: c.id,
      employeeLabel: employeeLabelById[c.employeeId] ?? c.employeeId,
      claimDate: c.claimDate,
      period: c.period ?? "—",
      amount: `₹${c.amount.toLocaleString()}`,
      amountNum: c.amount,
      netPayableNum: c.netPayable ?? 0,
      netPayable: c.netPayable != null ? `₹${Number(c.netPayable).toLocaleString()}` : "—",
      status: c.status,
      rejectionSnippet:
        c.status === "Rejected" && c.rejectionRemarks
          ? `${c.rejectionReasonCode ?? ""}: ${c.rejectionRemarks}`
          : "",
      dvReturnSnippet: c.dvReturnRemarks ? `DV return: ${c.dvReturnRemarks}` : "",
      _statusBlock: (
        <div className="flex flex-col gap-1">
          <Badge variant="secondary">{c.status}</Badge>
          {c.status === "Rejected" && c.rejectionRemarks && (
            <span className="text-xs text-muted-foreground line-clamp-2" title={c.rejectionRemarks}>
              {c.rejectionReasonCode}: {c.rejectionRemarks}
            </span>
          )}
          {c.dvReturnRemarks && (
            <span className="text-xs text-muted-foreground line-clamp-2" title={c.dvReturnRemarks}>
              DV return: {c.dvReturnRemarks}
            </span>
          )}
        </div>
      ),
      _actions: showLtcActions ? (
        <div className="flex flex-wrap gap-1">
          {canVerify && c.status === "Pending" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => ltcStatusMutation.mutate({ id: c.id, status: "Verified" })}
              disabled={ltcStatusMutation.isPending}
            >
              <ShieldCheck className="h-3.5 w-3.5 mr-1" />
              Verify
            </Button>
          )}
          {canVerify && c.status === "Verified" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setLtcReturnId(c.id);
                setLtcReturnRemarks("");
              }}
              disabled={ltcStatusMutation.isPending}
            >
              <SendHorizontal className="h-3.5 w-3.5 mr-1" />
              Send back
            </Button>
          )}
          {canApprove && c.status === "Verified" && (
            <>
              <Button
                size="sm"
                variant="default"
                onClick={() => ltcStatusMutation.mutate({ id: c.id, status: "Approved" })}
                disabled={ltcStatusMutation.isPending}
              >
                <CheckCircle className="h-3.5 w-3.5 mr-1" />
                Approve
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => {
                  setLtcRejectId(c.id);
                  setLtcRejectCode(REJECTION_REASON_CODES[0]);
                  setLtcRejectRemarks("");
                }}
                disabled={ltcStatusMutation.isPending}
              >
                <XCircle className="h-3.5 w-3.5 mr-1" />
                Reject
              </Button>
            </>
          )}
        </div>
      ) : null,
    }));
  }, [ltcList, employeeLabelById, showLtcActions, canVerify, canApprove, ltcStatusMutation.isPending]);

  const tadaRows = useMemo((): Record<string, unknown>[] => {
    return tadaList.map((c) => ({
      id: c.id,
      employeeLabel: employeeLabelById[c.employeeId] ?? c.employeeId,
      travelDate: c.travelDate,
      purpose: c.purpose,
      amount: `₹${c.amount.toLocaleString()}`,
      amountNum: c.amount,
      entitledTotalNum: c.entitledTotal ?? 0,
      entitledTotal: c.entitledTotal != null ? `₹${Number(c.entitledTotal).toLocaleString()}` : "—",
      status: c.status,
      rejectionSnippet:
        c.status === "Rejected" && c.rejectionRemarks
          ? `${c.rejectionReasonCode ?? ""}: ${c.rejectionRemarks}`
          : "",
      dvReturnSnippet: c.dvReturnRemarks ? `DV return: ${c.dvReturnRemarks}` : "",
      _statusBlock: (
        <div className="flex flex-col gap-1">
          <Badge variant="secondary">{c.status}</Badge>
          {c.entitledTrainClass ? (
            <span className="text-xs text-muted-foreground">Entitled: {c.entitledTrainClass}</span>
          ) : null}
          {c.status === "Rejected" && c.rejectionRemarks && (
            <span className="text-xs text-muted-foreground line-clamp-2" title={c.rejectionRemarks}>
              {c.rejectionReasonCode}: {c.rejectionRemarks}
            </span>
          )}
          {c.dvReturnRemarks && (
            <span className="text-xs text-muted-foreground line-clamp-2" title={c.dvReturnRemarks}>
              DV return: {c.dvReturnRemarks}
            </span>
          )}
        </div>
      ),
      _actions: showTadaActions ? (
        <div className="flex flex-wrap gap-1">
          {canVerify && c.status === "Pending" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => tadaStatusMutation.mutate({ id: c.id, status: "Verified" })}
              disabled={tadaStatusMutation.isPending}
            >
              <ShieldCheck className="h-3.5 w-3.5 mr-1" />
              Verify
            </Button>
          )}
          {canVerify && c.status === "Verified" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setTadaReturnId(c.id);
                setTadaReturnRemarks("");
              }}
              disabled={tadaStatusMutation.isPending}
            >
              <SendHorizontal className="h-3.5 w-3.5 mr-1" />
              Send back
            </Button>
          )}
          {canApprove && c.status === "Verified" && (
            <>
              <Button
                size="sm"
                variant="default"
                onClick={() => tadaStatusMutation.mutate({ id: c.id, status: "Approved" })}
                disabled={tadaStatusMutation.isPending}
              >
                <CheckCircle className="h-3.5 w-3.5 mr-1" />
                Approve
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => {
                  setTadaRejectId(c.id);
                  setTadaRejectCode(REJECTION_REASON_CODES[0]);
                  setTadaRejectRemarks("");
                }}
                disabled={tadaStatusMutation.isPending}
              >
                <XCircle className="h-3.5 w-3.5 mr-1" />
                Reject
              </Button>
            </>
          )}
        </div>
      ) : null,
    }));
  }, [tadaList, employeeLabelById, showTadaActions, canVerify, canApprove, tadaStatusMutation.isPending]);

  const tadaSearchKeys = useMemo(() => {
    const keys = ["employeeLabel", "travelDate", "purpose", "status", "rejectionSnippet", "dvReturnSnippet"];
    return keys;
  }, []);

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "HR", href: "/hr/employees" }, { label: "Claims" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Failed to load claims.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "HR", href: "/hr/employees" }, { label: "Claims (M-01)" }]}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5" />
            LTC / TA-DA claims
          </CardTitle>
          <p className="text-sm text-muted-foreground">Leave Travel Concession and Travel / Daily Allowance claims.</p>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="rounded-md border p-3">
            <p className="font-medium mb-2">LTC reports</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label>From (claim date)</Label>
                <Input type="date" value={ltcReportFrom} onChange={(e) => setLtcReportFrom(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>To (claim date)</Label>
                <Input type="date" value={ltcReportTo} onChange={(e) => setLtcReportTo(e.target.value)} />
              </div>
            </div>
            <div className="flex flex-wrap gap-2 mt-3">
              <Button asChild variant="outline" size="sm">
                <a href={`/api/hr/reports/ltc-block-register?${ltcReportQuery}&format=csv`} target="_blank" rel="noreferrer">
                  Download block register (CSV)
                </a>
              </Button>
              <Button asChild variant="outline" size="sm">
                <a href={`/api/hr/reports/ltc-utilization?${ltcReportQuery}&format=csv`} target="_blank" rel="noreferrer">
                  Download utilization (CSV)
                </a>
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Reports include only <span className="font-medium">Approved</span> LTC claims.
            </p>
          </div>
          {entitlementRows.length > 0 && (
            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              <p className="font-medium mb-2">TA/DA entitlement matrix (reference, from Admin → Config)</p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-1 pr-2">Pay level</th>
                      <th className="text-left py-1 pr-2">Train</th>
                      <th className="text-right py-1 pr-2">DA A</th>
                      <th className="text-right py-1 pr-2">DA B</th>
                      <th className="text-right py-1 pr-2">Hotel A</th>
                      <th className="text-right py-1">Hotel B</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entitlementRows.map((row: Record<string, unknown>, i: number) => (
                      <tr key={i} className="border-b border-muted">
                        <td className="py-1 pr-2">{String(row.payLevel ?? "")}</td>
                        <td className="py-1 pr-2">{String(row.trainClass ?? "")}</td>
                        <td className="text-right py-1 pr-2">{String(row.daA ?? "")}</td>
                        <td className="text-right py-1 pr-2">{String(row.daB ?? "")}</td>
                        <td className="text-right py-1 pr-2">{String(row.hotelA ?? "")}</td>
                        <td className="text-right py-1">{String(row.hotelB ?? "")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <div>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-2">
              <h3 className="font-medium flex items-center gap-2">
                <Plane className="h-4 w-4" />
                LTC claims
              </h3>
              {canSubmitNew && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setLtcNewEmployeeId(user?.employeeId ?? "");
                    setLtcNewOpen(true);
                  }}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  New LTC
                </Button>
              )}
            </div>
            <p className="text-sm text-muted-foreground mb-2">
              Workflow: Pending (DO) → Verified (DV) → Approved or Rejected (DA). DV may return Verified → Pending with
              remarks.
            </p>
            <div className="flex items-center gap-2 mb-3">
              <Checkbox
                id="ltc-pending-me"
                checked={ltcPendingOnly}
                onCheckedChange={(c) => setLtcPendingOnly(c === true)}
              />
              <Label htmlFor="ltc-pending-me" className="text-sm font-normal cursor-pointer">
                Pending my action (DV/DA queue)
              </Label>
            </div>
            {ltcLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : (
              <ClientDataGrid
                columns={ltcColumns}
                sourceRows={ltcRows}
                searchKeys={["employeeLabel", "claimDate", "period", "status", "rejectionSnippet", "dvReturnSnippet"]}
                searchPlaceholder="Search LTC claims…"
                defaultSortKey="claimDate"
                defaultSortDir="desc"
                resetPageDependency={ltcListUrl}
                emptyMessage="No LTC claims."
              />
            )}
          </div>
          <div>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-2">
              <h3 className="font-medium flex items-center gap-2">
                <Car className="h-4 w-4" />
                TA/DA claims
              </h3>
              {canSubmitNew && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setTadaNewEmployeeId(user?.employeeId ?? "");
                    setTadaNewOpen(true);
                  }}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  New TA/DA
                </Button>
              )}
            </div>
            <p className="text-sm text-muted-foreground mb-2">
              Workflow: Pending (DO) → Verified (DV) → Approved or Rejected (DA). DV may return Verified → Pending with
              remarks.
            </p>
            <div className="flex items-center gap-2 mb-3">
              <Checkbox
                id="tada-pending-me"
                checked={tadaPendingOnly}
                onCheckedChange={(c) => setTadaPendingOnly(c === true)}
              />
              <Label htmlFor="tada-pending-me" className="text-sm font-normal cursor-pointer">
                Pending my action (DV/DA queue)
              </Label>
            </div>
            {tadaLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : (
              <ClientDataGrid
                columns={tadaColumns}
                sourceRows={tadaRows}
                searchKeys={tadaSearchKeys}
                searchPlaceholder="Search TA/DA claims…"
                defaultSortKey="travelDate"
                defaultSortDir="desc"
                resetPageDependency={tadaListUrl}
                emptyMessage="No TA/DA claims."
              />
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={tadaRejectId != null} onOpenChange={(o) => !o && setTadaRejectId(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reject TA/DA claim</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Reason code</Label>
              <Select value={tadaRejectCode} onValueChange={setTadaRejectCode}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REJECTION_REASON_CODES.map((code) => (
                    <SelectItem key={code} value={code}>
                      {code.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="tada-reject-remarks">Remarks (min {MIN_WORKFLOW_REMARKS_LENGTH} characters)</Label>
              <Textarea
                id="tada-reject-remarks"
                value={tadaRejectRemarks}
                onChange={(e) => setTadaRejectRemarks(e.target.value)}
                rows={4}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setTadaRejectId(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={
                tadaRejectId == null ||
                tadaRejectRemarks.trim().length < MIN_WORKFLOW_REMARKS_LENGTH ||
                tadaStatusMutation.isPending
              }
              onClick={() => {
                if (!tadaRejectId) return;
                tadaStatusMutation.mutate({
                  id: tadaRejectId,
                  status: "Rejected",
                  rejectionReasonCode: tadaRejectCode,
                  rejectionRemarks: tadaRejectRemarks.trim(),
                });
              }}
            >
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={tadaReturnId != null} onOpenChange={(o) => !o && setTadaReturnId(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Return TA/DA claim to Pending</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Remarks are required (min {MIN_WORKFLOW_REMARKS_LENGTH} characters).
          </p>
          <div className="space-y-2">
            <Label htmlFor="tada-return-remarks">Return remarks</Label>
            <Textarea
              id="tada-return-remarks"
              value={tadaReturnRemarks}
              onChange={(e) => setTadaReturnRemarks(e.target.value)}
              rows={4}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setTadaReturnId(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={
                tadaReturnId == null ||
                tadaReturnRemarks.trim().length < MIN_WORKFLOW_REMARKS_LENGTH ||
                tadaStatusMutation.isPending
              }
              onClick={() => {
                if (!tadaReturnId) return;
                tadaStatusMutation.mutate({
                  id: tadaReturnId,
                  status: "Pending",
                  returnRemarks: tadaReturnRemarks.trim(),
                });
              }}
            >
              Send back to Pending
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={ltcRejectId != null} onOpenChange={(o) => !o && setLtcRejectId(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reject LTC claim</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Reason code</Label>
              <Select value={ltcRejectCode} onValueChange={setLtcRejectCode}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REJECTION_REASON_CODES.map((code) => (
                    <SelectItem key={code} value={code}>
                      {code.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ltc-reject-remarks">Remarks (min {MIN_WORKFLOW_REMARKS_LENGTH} characters)</Label>
              <Textarea
                id="ltc-reject-remarks"
                value={ltcRejectRemarks}
                onChange={(e) => setLtcRejectRemarks(e.target.value)}
                rows={4}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setLtcRejectId(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={
                ltcRejectId == null ||
                ltcRejectRemarks.trim().length < MIN_WORKFLOW_REMARKS_LENGTH ||
                ltcStatusMutation.isPending
              }
              onClick={() => {
                if (!ltcRejectId) return;
                ltcStatusMutation.mutate({
                  id: ltcRejectId,
                  status: "Rejected",
                  rejectionReasonCode: ltcRejectCode,
                  rejectionRemarks: ltcRejectRemarks.trim(),
                });
              }}
            >
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={ltcReturnId != null} onOpenChange={(o) => !o && setLtcReturnId(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Return LTC claim to Pending</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Remarks are required (min {MIN_WORKFLOW_REMARKS_LENGTH} characters).
          </p>
          <div className="space-y-2">
            <Label htmlFor="ltc-return-remarks">Return remarks</Label>
            <Textarea
              id="ltc-return-remarks"
              value={ltcReturnRemarks}
              onChange={(e) => setLtcReturnRemarks(e.target.value)}
              rows={4}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setLtcReturnId(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={
                ltcReturnId == null ||
                ltcReturnRemarks.trim().length < MIN_WORKFLOW_REMARKS_LENGTH ||
                ltcStatusMutation.isPending
              }
              onClick={() => {
                if (!ltcReturnId) return;
                ltcStatusMutation.mutate({
                  id: ltcReturnId,
                  status: "Pending",
                  returnRemarks: ltcReturnRemarks.trim(),
                });
              }}
            >
              Send back to Pending
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={tadaNewOpen} onOpenChange={(o) => !o && setTadaNewOpen(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New TA/DA claim</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {roles.includes("ADMIN") && (
              <div className="space-y-1">
                <Label>Employee</Label>
                <Select value={tadaNewEmployeeId} onValueChange={setTadaNewEmployeeId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Employee" />
                  </SelectTrigger>
                  <SelectContent>
                    {employees.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {(e.empId ?? e.id) + " — " + e.firstName + " " + e.surname}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1">
              <Label>Travel date</Label>
              <Input type="date" value={tadaNewTravel} onChange={(e) => setTadaNewTravel(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Return date</Label>
              <Input type="date" value={tadaNewReturn} onChange={(e) => setTadaNewReturn(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Approved tour programme</Label>
              <Select value={tadaTourProgrammeId} onValueChange={setTadaTourProgrammeId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select approved tour" />
                </SelectTrigger>
                <SelectContent>
                  {approvedTours.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.tourNo} — {t.destination} ({t.fromDate}→{t.toDate})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {tadaEmployeeForTours && approvedTours.length === 0 ? (
                <p className="text-xs text-muted-foreground">No approved tours found for this employee yet.</p>
              ) : null}
            </div>
            <div className="space-y-1">
              <Label>Purpose</Label>
              <Input value={tadaNewPurpose} onChange={(e) => setTadaNewPurpose(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label>City category</Label>
                <Select value={tadaCityCategory} onValueChange={(v) => setTadaCityCategory((v as "A" | "B") ?? "A")}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="A">A</SelectItem>
                    <SelectItem value="B">B</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Days</Label>
                <Input type="number" min={1} max={60} step={1} value={tadaDays} onChange={(e) => setTadaDays(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Hotel amount (optional, INR)</Label>
              <Input type="number" min={0} step={1} value={tadaHotelAmount} onChange={(e) => setTadaHotelAmount(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Amount (INR)</Label>
              <Input type="number" min={0} step={1} value={tadaNewAmount} onChange={(e) => setTadaNewAmount(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setTadaNewOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={createTadaMutation.isPending}
              onClick={() => {
                const employeeId = roles.includes("ADMIN") ? tadaNewEmployeeId : user?.employeeId ?? "";
                const amt = Number(tadaNewAmount);
                const days = Number(tadaDays);
                const hotelAmount = tadaHotelAmount.trim() === "" ? null : Number(tadaHotelAmount);
                if (!employeeId || !tadaNewTravel || !tadaNewReturn || !tadaTourProgrammeId || !tadaNewPurpose.trim() || !Number.isFinite(amt) || !Number.isFinite(days) || days < 1) {
                  toast({
                    title: "Missing fields",
                    description: "Employee, travel/return dates, approved tour, purpose, city category, days, and amount are required.",
                    variant: "destructive",
                  });
                  return;
                }
                createTadaMutation.mutate({
                  employeeId,
                  travelDate: tadaNewTravel,
                  returnDate: tadaNewReturn,
                  purpose: tadaNewPurpose.trim(),
                  amount: amt,
                  cityCategory: tadaCityCategory,
                  days,
                  hotelAmount,
                  tourProgrammeId: tadaTourProgrammeId,
                });
              }}
            >
              Submit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={ltcNewOpen} onOpenChange={(o) => !o && setLtcNewOpen(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New LTC claim</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {roles.includes("ADMIN") && (
              <div className="space-y-1">
                <Label>Employee</Label>
                <Select value={ltcNewEmployeeId} onValueChange={setLtcNewEmployeeId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Employee" />
                  </SelectTrigger>
                  <SelectContent>
                    {employees.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {(e.empId ?? e.id) + " — " + e.firstName + " " + e.surname}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1">
              <Label>Claim date</Label>
              <Input type="date" value={ltcNewDate} onChange={(e) => setLtcNewDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Period (optional)</Label>
              <Input value={ltcNewPeriod} onChange={(e) => setLtcNewPeriod(e.target.value)} placeholder="e.g. FY 2025-26" />
            </div>
            <div className="space-y-1">
              <Label>Block period (optional)</Label>
              <Input value={ltcNewBlockPeriod} onChange={(e) => setLtcNewBlockPeriod(e.target.value)} placeholder="e.g. 2024-2028" />
            </div>
            <div className="space-y-1">
              <Label>LTC type</Label>
              <Select value={ltcNewType} onValueChange={(v) => setLtcNewType((v as "HomeTown" | "AllIndia") ?? "HomeTown")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="HomeTown">Home Town</SelectItem>
                  <SelectItem value="AllIndia">All India</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label>Estimated entitlement (INR)</Label>
                <Input type="number" min={0} step={1} value={ltcNewEstimated} onChange={(e) => setLtcNewEstimated(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Advance amount (INR)</Label>
                <Input type="number" min={0} step={1} value={ltcNewAdvance} onChange={(e) => setLtcNewAdvance(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Amount (INR)</Label>
              <Input type="number" min={0} step={1} value={ltcNewAmount} onChange={(e) => setLtcNewAmount(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setLtcNewOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={createLtcMutation.isPending}
              onClick={() => {
                const employeeId = roles.includes("ADMIN") ? ltcNewEmployeeId : user?.employeeId ?? "";
                const amt = Number(ltcNewAmount);
                const est = ltcNewEstimated.trim() === "" ? null : Number(ltcNewEstimated);
                const adv = ltcNewAdvance.trim() === "" ? null : Number(ltcNewAdvance);
                if (!employeeId || !ltcNewDate || !Number.isFinite(amt)) {
                  toast({
                    title: "Missing fields",
                    description: "Employee, claim date, and amount are required.",
                    variant: "destructive",
                  });
                  return;
                }
                createLtcMutation.mutate({
                  employeeId,
                  claimDate: ltcNewDate,
                  amount: amt,
                  period: ltcNewPeriod.trim() || null,
                  blockPeriod: ltcNewBlockPeriod.trim() || null,
                  ltcType: ltcNewType,
                  estimatedEntitlement: est,
                  advanceAmount: adv,
                });
              }}
            >
              Submit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
