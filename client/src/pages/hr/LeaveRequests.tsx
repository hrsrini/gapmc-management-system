import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
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
import { Calendar, AlertCircle, CheckCircle, XCircle, ShieldCheck, SendHorizontal, Plus, Download, Loader2, FileText, Pencil } from "lucide-react";
import { REJECTION_REASON_CODES, MIN_WORKFLOW_REMARKS_LENGTH } from "@shared/workflow-rejection";
import { ClientDataGrid } from "@/components/reports/ClientDataGrid";
import type { ReportTableColumn } from "@/components/reports/ReportDataTable";
import { fetchApiGet } from "@/lib/queryClient";

interface LeaveRequest {
  id: string;
  employeeId: string;
  leaveType: string;
  fromDate: string;
  toDate: string;
  status: string;
  reason?: string | null;
  supportingDocumentUrl?: string | null;
  isRetrospective?: boolean | null;
  cancelledAt?: string | null;
  cancelledBy?: string | null;
  doUser?: string | null;
  dvUser?: string | null;
  approvedBy?: string | null;
  rejectionReasonCode?: string | null;
  rejectionRemarks?: string | null;
  workflowRevisionCount?: number | null;
  dvReturnRemarks?: string | null;
  prefixDays?: number | null;
  suffixDays?: number | null;
  prefixFromDate?: string | null;
  suffixToDate?: string | null;
  debitDays?: number | null;
  substituteEmployeeId?: string | null;
  addressDuringLeave?: string | null;
  ltcProposed?: boolean | null;
  leaveHq?: string | null;
  fileNo?: string | null;
  orderPdfUrl?: string | null;
  isExPostFacto?: boolean | null;
  copyToJson?: string | null;
  halfDay?: string | null;
  dutyDateForSplH?: string | null;
  controllingOfficerRemarks?: string | null;
  prefixSuffixDisallowed?: boolean | null;
  rejoiningDate?: string | null;
  rejoiningReportedAt?: string | null;
  joiningReportPdfUrl?: string | null;
  joiningReportScanUrl?: string | null;
  fitnessCertUrl?: string | null;
  revisedFromLeaveId?: string | null;
  supersededByLeaveId?: string | null;
  joiningReportAckAt?: string | null;
  joiningReportAckBy?: string | null;
  joiningReportAckRemarks?: string | null;
}
interface Employee {
  id: string;
  empId?: string | null;
  firstName: string;
  middleName?: string | null;
  surname: string;
  designation?: string | null;
  locationPosted?: string | null;
  section?: string | null;
  yardId?: string | null;
}

interface LeaveBalanceRow {
  id: string;
  employeeId: string;
  leaveType: string;
  balanceDays: number;
  setOffDays?: number | null;
  setOffExpiryDate?: string | null;
}

interface HolidayRow {
  id: string;
  date: string;
  name: string;
  category: string;
  year: number;
}

interface PrefixSuffixPreview {
  prefixDays: number;
  suffixDays: number;
  prefixFromDate: string | null;
  suffixToDate: string | null;
}

const ALL_LEAVE_TYPES = ["EL", "HPL", "COMMUTED", "CL", "RH", "SPL_H", "ML", "PL", "EOL", "CCL"] as const;
const SHORT_FORM_TYPES = ["CL", "RH", "SPL_H"];
const FORM1_TYPES = ["EL", "HPL", "COMMUTED", "ML", "PL", "EOL", "CCL"];
const LEAVE_TYPE_LABELS: Record<string, string> = {
  EL: "Earned Leave", HPL: "Half Pay Leave", COMMUTED: "Commuted Leave",
  CL: "Casual Leave", RH: "Restricted Holiday", SPL_H: "Special Holiday",
  ML: "Maternity Leave", PL: "Paternity Leave", EOL: "Extraordinary Leave", CCL: "Child Care Leave",
};

function employeeDisplayName(emp: Employee): string {
  return `${emp.firstName} ${emp.middleName ?? ""} ${emp.surname}`.replace(/\s+/g, " ").trim();
}

function parseCopyToJson(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function buildDefaultCopyToRows(emp: Employee | null | undefined): string[] {
  if (!emp) return ["Accounts Section", "Personal File", "Guard File"];
  const name = employeeDisplayName(emp);
  return [
    `${name} (Employee)`,
    emp.section ? `${emp.section}, HO` : (emp.locationPosted ?? emp.yardId ?? "—"),
    "Accounts Section",
    "Personal File",
    "Guard File",
  ];
}

function resolveCopyToList(leave: LeaveRequest, employee: Employee | null | undefined): { list: string[]; usingDefault: boolean } {
  const custom = parseCopyToJson(leave.copyToJson);
  if (custom.length > 0) return { list: custom, usingDefault: false };
  return { list: buildDefaultCopyToRows(employee), usingDefault: true };
}

function leaveBalanceAfterDebit(leave: LeaveRequest, balances: LeaveBalanceRow[], approved: boolean): number | null {
  const balLeaveType = leave.leaveType === "COMMUTED" ? "HPL" : leave.leaveType;
  const bal = balances.find(
    (b) =>
      b.employeeId === leave.employeeId &&
      String(b.leaveType).trim().toUpperCase() === String(balLeaveType).trim().toUpperCase(),
  );
  if (!bal) return null;
  if (approved) return Number(bal.balanceDays ?? 0);
  const debit = Number(leave.debitDays ?? 0);
  if (debit <= 0) return Math.max(0, Number(bal.balanceDays ?? 0));

  // Server-side debit logic: EL consumes non-expired set-off days first, then balanceDays.
  if (String(balLeaveType).trim().toUpperCase() === "EL") {
    const asOf = new Date().toISOString().slice(0, 10);
    const setOffDays = Number(bal.setOffDays ?? 0);
    const setOffExpiry = bal.setOffExpiryDate ? String(bal.setOffExpiryDate).trim() : "";
    const setOffAvailable = setOffDays > 0 && (!setOffExpiry || setOffExpiry >= asOf) ? setOffDays : 0;
    const debitFromBalance = Math.max(0, debit - setOffAvailable);
    return Math.max(0, Number(bal.balanceDays ?? 0) - debitFromBalance);
  }

  return Math.max(0, Number(bal.balanceDays ?? 0) - debit);
}

function SanctionOrderPreviewPanel({
  leave,
  employee,
  employeeLabel,
  copyToList,
  balanceAfter,
  prefixSuffixNil,
  fileNo,
  usingDefaultCopyTo,
  pendingFileNo,
}: {
  leave: LeaveRequest;
  employee: Employee | null;
  employeeLabel: string;
  copyToList: string[];
  balanceAfter: number | null;
  prefixSuffixNil: boolean;
  fileNo?: string | null;
  usingDefaultCopyTo?: boolean;
  pendingFileNo?: boolean;
}) {
  return (
    <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-2">
      <div className="font-medium">Sanction order preview</div>
      {fileNo ? (
        <p className="text-muted-foreground">
          File No. <span className="text-foreground font-medium">{fileNo}</span>
        </p>
      ) : null}
      <p className="text-muted-foreground">
        READ: Leave application of Shri/Smt.{" "}
        <span className="text-foreground font-medium">
          {employee ? employeeDisplayName(employee) : employeeLabel}
        </span>
        {employee?.designation ? `, ${employee.designation}` : ""}, dated {leave.fromDate}.
      </p>
      <p className="text-muted-foreground">
        {leave.isExPostFacto ? "Ex-post facto sanction" : "Sanction"} for{" "}
        {LEAVE_TYPE_LABELS[leave.leaveType] ?? leave.leaveType} —{" "}
        <span className="text-foreground font-medium">{Number(leave.debitDays ?? 0)} day(s)</span> from {leave.fromDate}{" "}
        to {leave.toDate}
        {!prefixSuffixNil && Number(leave.prefixDays ?? 0) > 0
          ? ` with prefix ${Number(leave.prefixDays ?? 0)} day(s) from ${leave.prefixFromDate}`
          : ""}
        {!prefixSuffixNil && Number(leave.suffixDays ?? 0) > 0
          ? ` and suffix ${Number(leave.suffixDays ?? 0)} day(s) up to ${leave.suffixToDate}`
          : ""}
        {prefixSuffixNil ? " (Prefix/Suffix: Nil)" : ""}
        .
      </p>
      {leave.leaveHq ? <p className="text-muted-foreground">Leave headquarters: {leave.leaveHq}</p> : null}
      <p className="text-muted-foreground">
        Balance certificate: {LEAVE_TYPE_LABELS[leave.leaveType] ?? leave.leaveType} balance{" "}
        {pendingFileNo ? "after debit" : "as on date of this Order"}:{" "}
        <span className="text-foreground font-medium">
          {balanceAfter != null ? `${balanceAfter} day(s)` : "N/A"}
        </span>
        .
      </p>
      <div>
        <div className="font-medium text-foreground">Copy to:</div>
        <ol className="mt-1 list-decimal list-inside text-muted-foreground">
          {copyToList.map((item, i) => (
            <li key={`sanction-copy-preview-${i}`}>{item}</li>
          ))}
        </ol>
        {usingDefaultCopyTo ? (
          <p className="mt-1 text-xs text-muted-foreground">Default copy-to list (no custom rows saved).</p>
        ) : null}
      </div>
      {pendingFileNo ? (
        <p className="text-xs text-muted-foreground">File number is assigned when the order PDF is generated.</p>
      ) : null}
    </div>
  );
}

function calculateClientDebitDays(leaveType: string, fromDate: string, toDate: string, halfDay?: string): number {
  const days = inclusiveCalendarDays(fromDate, toDate);
  const upper = leaveType.trim().toUpperCase();
  if (days <= 0) return 0;
  if (upper === "COMMUTED") return days * 2;
  if (upper === "CL" && halfDay && days === 1) return 0.5;
  return days;
}

function inclusiveCalendarDays(fromIso: string, toIso: string): number {
  const [fy, fm, fd] = String(fromIso).slice(0, 10).split("-").map((x) => Number(x));
  const [ty, tm, td] = String(toIso).slice(0, 10).split("-").map((x) => Number(x));
  if (![fy, fm, fd, ty, tm, td].every((n) => Number.isFinite(n))) return 0;
  const d0 = Date.UTC(fy, fm - 1, fd);
  const d1 = Date.UTC(ty, tm - 1, td);
  if (d1 < d0) return 0;
  return Math.round((d1 - d0) / 86400000) + 1;
}

export default function LeaveRequests() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const roles = user?.roles?.map((r) => r.tier) ?? [];
  const canVerify = roles.includes("DV") || roles.includes("ADMIN");
  const canApprove = roles.includes("DA") || roles.includes("ADMIN");
  const canSubmitNew = roles.includes("DO") || roles.includes("ADMIN");
  const canSeeAllLeaves = roles.includes("ADMIN") || roles.includes("DV") || roles.includes("DA");
  const [pendingOnly, setPendingOnly] = useState(false);
  const [mineOnly, setMineOnly] = useState(!canSeeAllLeaves);
  const [newOpen, setNewOpen] = useState(false);
  const [newEmployeeId, setNewEmployeeId] = useState("");
  const [newLeaveType, setNewLeaveType] = useState("EL");
  const [newFrom, setNewFrom] = useState("");
  const [newTo, setNewTo] = useState("");
  const [newReason, setNewReason] = useState("");
  const [newDocUrl, setNewDocUrl] = useState("");
  const [newDocFileName, setNewDocFileName] = useState<string>("");
  const [newDocUploading, setNewDocUploading] = useState(false);
  const [newRetrospective, setNewRetrospective] = useState(false);
  const [newHalfDay, setNewHalfDay] = useState("");
  const [newSubstituteId, setNewSubstituteId] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [newLtc, setNewLtc] = useState(false);
  const [newLeaveHq, setNewLeaveHq] = useState("");
  const [newDutyDate, setNewDutyDate] = useState("");
  const [newExPostFacto, setNewExPostFacto] = useState(false);
  const [newCopyToRows, setNewCopyToRows] = useState<string[]>([""]);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectCode, setRejectCode] = useState<string>(REJECTION_REASON_CODES[0]);
  const [rejectRemarks, setRejectRemarks] = useState("");
  const [returnLeaveId, setReturnLeaveId] = useState<string | null>(null);
  const [returnRemarks, setReturnRemarks] = useState("");
  const [verifyLeaveId, setVerifyLeaveId] = useState<string | null>(null);
  const [verifyRemarks, setVerifyRemarks] = useState("");
  const [approveLeaveId, setApproveLeaveId] = useState<string | null>(null);
  const [approvePrefixSuffixNil, setApprovePrefixSuffixNil] = useState(false);
  const [approveCopyToRows, setApproveCopyToRows] = useState<string[]>([]);
  const [previewOrderLeaveId, setPreviewOrderLeaveId] = useState<string | null>(null);
  const [editLeaveId, setEditLeaveId] = useState<string | null>(null);
  const [editLeaveType, setEditLeaveType] = useState("EL");
  const [editFrom, setEditFrom] = useState("");
  const [editTo, setEditTo] = useState("");
  const [editReason, setEditReason] = useState("");
  const [rejoinLeaveId, setRejoinLeaveId] = useState<string | null>(null);
  const [rejoinDate, setRejoinDate] = useState("");
  const [rejoinFitnessUrl, setRejoinFitnessUrl] = useState("");
  const [rejoinScanUrl, setRejoinScanUrl] = useState("");
  const [rejoinUploading, setRejoinUploading] = useState(false);
  const [newRevisedFromId, setNewRevisedFromId] = useState("");

  const listUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (pendingOnly) params.set("pendingMyAction", "1");
    if (mineOnly) params.set("mine", "1");
    const q = params.toString();
    return q ? `/api/hr/leaves?${q}` : "/api/hr/leaves";
  }, [pendingOnly, mineOnly]);
  const { data: list, isLoading, isError } = useQuery<LeaveRequest[]>({
    queryKey: [listUrl],
  });
  const { data: employees = [] } = useQuery<Employee[]>({
    queryKey: ["/api/hr/employees"],
  });
  const { data: balances = [] } = useQuery<LeaveBalanceRow[]>({
    queryKey: ["/api/hr/leave-balances"],
  });
  const { data: substitutes = [] } = useQuery<{ id: string; empId?: string | null; firstName: string; surname: string }[]>({
    queryKey: ["/api/hr/leaves/available-substitutes", newFrom, newTo],
    queryFn: () => newFrom && newTo ? fetch(`/api/hr/leaves/available-substitutes?fromDate=${newFrom}&toDate=${newTo}`).then((r) => r.json()) : Promise.resolve([]),
    enabled: newOpen && !!newFrom && !!newTo,
  });
  const isAdmin = roles.includes("ADMIN");
  const effectiveEmployeeId = isAdmin ? newEmployeeId : user?.employeeId ?? "";
  const selectedEmployee = useMemo(
    () => employees.find((e) => e.id === effectiveEmployeeId) ?? null,
    [employees, effectiveEmployeeId],
  );
  const { data: prefixSuffixPreview } = useQuery<PrefixSuffixPreview | null>({
    queryKey: ["/api/hr/leaves/prefix-suffix-preview", newFrom, newTo, selectedEmployee?.locationPosted ?? ""],
    queryFn: () =>
      newFrom && newTo
        ? fetchApiGet<PrefixSuffixPreview>(
            `/api/hr/leaves/prefix-suffix-preview?fromDate=${encodeURIComponent(newFrom)}&toDate=${encodeURIComponent(newTo)}&locationType=${encodeURIComponent(selectedEmployee?.locationPosted ?? "")}`,
          )
        : Promise.resolve(null),
    enabled: newOpen && !!newFrom && !!newTo,
  });
  const employeeLabelById = Object.fromEntries(
    employees.map((e) => [e.id, `${e.empId ?? e.id} — ${e.firstName} ${e.surname}`]),
  );

  const approveLeave = useMemo(
    () => (approveLeaveId ? (list ?? []).find((r) => r.id === approveLeaveId) ?? null : null),
    [approveLeaveId, list],
  );
  const approveEmployee = useMemo(
    () => (approveLeave ? employees.find((e) => e.id === approveLeave.employeeId) ?? null : null),
    [approveLeave, employees],
  );
  const approvePreviewCopyTo = useMemo(() => {
    const trimmed = approveCopyToRows.map((x) => x.trim()).filter(Boolean);
    return trimmed.length > 0 ? trimmed : buildDefaultCopyToRows(approveEmployee);
  }, [approveCopyToRows, approveEmployee]);
  const approvePreviewBalanceAfter = useMemo(
    () => (approveLeave ? leaveBalanceAfterDebit(approveLeave, balances, false) : null),
    [approveLeave, balances],
  );
  const previewOrderLeave = useMemo(
    () => (previewOrderLeaveId ? (list ?? []).find((r) => r.id === previewOrderLeaveId) ?? null : null),
    [previewOrderLeaveId, list],
  );
  const previewOrderEmployee = useMemo(
    () => (previewOrderLeave ? employees.find((e) => e.id === previewOrderLeave.employeeId) ?? null : null),
    [previewOrderLeave, employees],
  );
  const previewOrderCopyTo = useMemo(() => {
    if (!previewOrderLeave) return { list: [] as string[], usingDefault: false };
    return resolveCopyToList(previewOrderLeave, previewOrderEmployee);
  }, [previewOrderLeave, previewOrderEmployee]);
  const previewOrderBalanceAfter = useMemo(
    () => (previewOrderLeave ? leaveBalanceAfterDebit(previewOrderLeave, balances, true) : null),
    [previewOrderLeave, balances],
  );

  const leaveTypesForEmployee = useMemo((): string[] => {
    return [...ALL_LEAVE_TYPES];
  }, []);

  const selectedBalance = useMemo((): LeaveBalanceRow | null => {
    const empId = effectiveEmployeeId.trim();
    const lt = newLeaveType.trim().toUpperCase();
    const balType = lt === "COMMUTED" ? "HPL" : lt;
    if (!empId || !balType) return null;
    return balances.find((b) => b.employeeId === empId && String(b.leaveType).trim().toUpperCase() === balType) ?? null;
  }, [balances, effectiveEmployeeId, newLeaveType]);

  const rhYear = newFrom ? Number(String(newFrom).slice(0, 4)) : new Date().getFullYear();
  const { data: holidaysForRh = [] } = useQuery<HolidayRow[]>({
    queryKey: ["/api/hr/holidays", rhYear],
    queryFn: () => fetch(`/api/hr/holidays?year=${rhYear}`).then((r) => r.json()),
    enabled: newOpen && newLeaveType.trim().toUpperCase() === "RH",
  });
  const restrictedHolidayDates = useMemo(
    () => holidaysForRh.filter((h) => h.category === "Restricted").sort((a, b) => a.date.localeCompare(b.date)),
    [holidaysForRh],
  );

  const requestedDays = useMemo(() => {
    if (!newFrom || !newTo) return 0;
    return inclusiveCalendarDays(newFrom, newTo);
  }, [newFrom, newTo]);
  const estimatedDebitDays = useMemo(
    () => calculateClientDebitDays(newLeaveType, newFrom, newTo, newHalfDay || undefined),
    [newLeaveType, newFrom, newTo, newHalfDay],
  );

  useEffect(() => {
    if (!newOpen) return;
    if (isAdmin && !newEmployeeId && employees.length > 0) {
      setNewEmployeeId(employees[0]!.id);
    }
  }, [newOpen, isAdmin, newEmployeeId, employees]);

  useEffect(() => {
    if (!newOpen) return;
    const lt = newLeaveType.trim().toUpperCase();
    if (!lt || !leaveTypesForEmployee.includes(lt)) {
      setNewLeaveType(leaveTypesForEmployee[0] ?? "EL");
    }
  }, [newOpen, leaveTypesForEmployee, newLeaveType]);

  const createMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch("/api/hr/leaves", {
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
      queryClient.invalidateQueries({ queryKey: ["/api/hr/leaves"] });
      queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0] ?? "").startsWith("/api/hr/leaves") });
      toast({ title: "Leave submitted", description: "Request is Pending for DV verification." });
      setNewOpen(false);
      setNewReason("");
      setNewDocUrl("");
      setNewRetrospective(false);
      setNewHalfDay("");
      setNewSubstituteId("");
      setNewAddress("");
      setNewLtc(false);
      setNewLeaveHq("");
      setNewDutyDate("");
      setNewExPostFacto(false);
      setNewCopyToRows([""]);
      setNewDocUrl("");
      setNewDocFileName("");
      setNewDocUploading(false);
      setNewRevisedFromId("");
    },
    onError: (e: Error) => toast({ title: "Create failed", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async (vars: { id: string; body: Record<string, unknown> }) => {
      const res = await fetch(`/api/hr/leaves/${vars.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(vars.body),
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? res.statusText);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hr/leaves"] });
      queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0] ?? "").startsWith("/api/hr/leaves") });
      toast({ title: "Leave updated", description: "Pending leave request saved." });
      setEditLeaveId(null);
    },
    onError: (e: Error) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  const statusMutation = useMutation({
    mutationFn: async (vars: { id: string; status: string } & Record<string, unknown>) => {
      const { id, ...body } = vars;
      const res = await fetch(`/api/hr/leaves/${id}`, {
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
      queryClient.invalidateQueries({ queryKey: ["/api/hr/leaves"] });
      queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0] ?? "").startsWith("/api/hr/leaves") });
      toast({ title: "Status updated", description: `Leave request set to ${vars.status}.` });
      setRejectId(null);
      setRejectRemarks("");
      setReturnLeaveId(null);
      setReturnRemarks("");
      setVerifyLeaveId(null);
      setVerifyRemarks("");
      setApproveLeaveId(null);
      setApprovePrefixSuffixNil(false);
      setApproveCopyToRows([]);
    },
    onError: (e: Error) => {
      toast({ title: "Update failed", description: e.message, variant: "destructive" });
    },
  });

  const rejoinMutation = useMutation({
    mutationFn: async (vars: {
      id: string;
      rejoiningDate: string;
      fitnessCertUrl?: string | null;
      joiningReportScanUrl?: string | null;
    }) => {
      const res = await fetch(`/api/hr/leaves/${vars.id}/rejoin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rejoiningDate: vars.rejoiningDate,
          fitnessCertUrl: vars.fitnessCertUrl || null,
          joiningReportScanUrl: vars.joiningReportScanUrl || null,
        }),
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? res.statusText);
      }
      return res.json();
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/hr/leaves"] });
      queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0] ?? "").startsWith("/api/hr/leaves") });
      toast({ title: "Rejoining recorded", description: "Joining Report PDF is ready to download, sign, and submit offline." });
      setRejoinLeaveId(null);
      setRejoinDate("");
      setRejoinFitnessUrl("");
      setRejoinScanUrl("");
      window.open(`/api/hr/leaves/${vars.id}/joining-report`, "_blank");
    },
    onError: (e: Error) => toast({ title: "Rejoin failed", description: e.message, variant: "destructive" }),
  });

  const joiningAckMutation = useMutation({
    mutationFn: async (vars: { id: string; remarks?: string }) => {
      const res = await fetch(`/api/hr/leaves/${vars.id}/joining-report-ack`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ remarks: vars.remarks ?? null }),
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? res.statusText);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hr/leaves"] });
      queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0] ?? "").startsWith("/api/hr/leaves") });
      toast({ title: "Joining report acknowledged", description: "Hard copy / scan receipt recorded." });
    },
    onError: (e: Error) => toast({ title: "Acknowledgment failed", description: e.message, variant: "destructive" }),
  });

  const showActions = canVerify || canApprove;
  const canCancel = roles.includes("DO") || roles.includes("ADMIN");

  const columns = useMemo((): ReportTableColumn[] => {
    const base: ReportTableColumn[] = [
      { key: "employeeLabel", header: "Employee" },
      { key: "leaveType", header: "Leave type" },
      { key: "fromDate", header: "From" },
      { key: "toDate", header: "To" },
      { key: "_reason", header: "Reason / attachment", sortField: "reason" },
      { key: "_statusBlock", header: "Status", sortField: "status" },
    ];
    if (
      showActions ||
      (list ?? []).some((r) => r.status === "Approved" || r.status === "Pending" || r.status === "Verified" || r.status === "Rejected")
    ) {
      base.push({ key: "_actions", header: "Actions" });
    }
    return base;
  }, [showActions, list]);

  const sourceRows = useMemo((): Record<string, unknown>[] => {
    return (list ?? []).map((r) => ({
      id: r.id,
      employeeLabel: employeeLabelById[r.employeeId] ?? r.employeeId,
      leaveType: r.leaveType,
      fromDate: r.fromDate,
      toDate: r.toDate,
      reason: r.reason ?? "",
      _reason: (
        <div className="flex flex-col gap-0.5 text-xs">
          {r.reason ? <span className="line-clamp-2">{r.reason}</span> : <span className="text-muted-foreground">—</span>}
          {r.supportingDocumentUrl ? (
            <a
              className="text-primary underline truncate max-w-[220px]"
              href={r.supportingDocumentUrl}
              target="_blank"
              rel="noreferrer"
            >
              Attachment
            </a>
          ) : null}
        </div>
      ),
      status: r.status,
      rejectionSnippet:
        r.status === "Rejected" && r.rejectionRemarks
          ? `${r.rejectionReasonCode ?? ""}: ${r.rejectionRemarks}`
          : "",
      dvReturnSnippet: r.dvReturnRemarks ? `DV return: ${r.dvReturnRemarks}` : "",
      _statusBlock: (
        <div className="flex flex-col gap-1">
          <Badge variant="secondary">{r.status}</Badge>
          {r.isRetrospective ? <span className="text-xs text-muted-foreground">Retrospective</span> : null}
          {r.status === "Rejected" && r.rejectionRemarks && (
            <span className="text-xs text-muted-foreground line-clamp-2" title={r.rejectionRemarks}>
              {r.rejectionReasonCode}: {r.rejectionRemarks}
            </span>
          )}
          {r.controllingOfficerRemarks && (
            <span className="text-xs text-muted-foreground line-clamp-2" title={r.controllingOfficerRemarks}>
              DV remarks: {r.controllingOfficerRemarks}
            </span>
          )}
          {r.dvReturnRemarks && (
            <span className="text-xs text-muted-foreground line-clamp-2" title={r.dvReturnRemarks}>
              DV return: {r.dvReturnRemarks}
            </span>
          )}
          {(Number(r.prefixDays ?? 0) > 0 || Number(r.suffixDays ?? 0) > 0 || Number(r.debitDays ?? 0) > 0) && (
            <span className="text-xs text-muted-foreground">
              Debit {Number(r.debitDays ?? 0)}d
              {Number(r.prefixDays ?? 0) > 0 ? ` | Prefix ${Number(r.prefixDays ?? 0)}d` : ""}
              {Number(r.suffixDays ?? 0) > 0 ? ` | Suffix ${Number(r.suffixDays ?? 0)}d` : ""}
              {r.prefixSuffixDisallowed ? " | Prefix/Suffix Nil" : ""}
            </span>
          )}
          {r.rejoiningDate ? (
            <span className="text-xs text-muted-foreground">
              Rejoined: {r.rejoiningDate}
              {r.joiningReportAckAt ? " · Joining report acknowledged" : ""}
            </span>
          ) : null}
          {r.revisedFromLeaveId ? (
            <span className="text-xs text-muted-foreground">Revision of prior sanction</span>
          ) : null}
          {r.supersededByLeaveId ? (
            <span className="text-xs text-muted-foreground">Superseded by revision</span>
          ) : null}
        </div>
      ),
      _actions: showActions || r.status === "Approved" || r.status === "Pending" || r.status === "Verified" ? (
        <div className="flex flex-wrap gap-1">
          {r.status !== "Cancelled" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => window.open(`/api/hr/leaves/${r.id}/application-form`, "_blank")}
            >
              <FileText className="h-3.5 w-3.5 mr-1" />
              Print form
            </Button>
          )}
          {showActions && canCancel && r.status === "Pending" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setEditLeaveId(r.id);
                setEditLeaveType(r.leaveType);
                setEditFrom(r.fromDate);
                setEditTo(r.toDate);
                setEditReason(r.reason ?? "");
              }}
              disabled={statusMutation.isPending || updateMutation.isPending}
            >
              <Pencil className="h-3.5 w-3.5 mr-1" />
              Edit
            </Button>
          )}
          {showActions && canCancel && r.status === "Pending" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => statusMutation.mutate({ id: r.id, status: "Cancelled" })}
              disabled={statusMutation.isPending}
            >
              Cancel
            </Button>
          )}
          {showActions && canVerify && r.status === "Pending" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setVerifyLeaveId(r.id);
                setVerifyRemarks(r.controllingOfficerRemarks ?? "");
              }}
              disabled={statusMutation.isPending}
            >
              <ShieldCheck className="h-3.5 w-3.5 mr-1" />
              Verify
            </Button>
          )}
          {showActions && canVerify && r.status === "Verified" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setReturnLeaveId(r.id);
                setReturnRemarks("");
              }}
              disabled={statusMutation.isPending}
            >
              <SendHorizontal className="h-3.5 w-3.5 mr-1" />
              Send back
            </Button>
          )}
          {showActions && canApprove && r.status === "Verified" && (
            <>
              <Button
                size="sm"
                variant="default"
                onClick={() => {
                  setApproveLeaveId(r.id);
                  setApprovePrefixSuffixNil(Boolean(r.prefixSuffixDisallowed));
                  const emp = employees.find((e) => e.id === r.employeeId);
                  const existing = parseCopyToJson(r.copyToJson);
                  setApproveCopyToRows(existing.length > 0 ? existing : buildDefaultCopyToRows(emp));
                }}
                disabled={statusMutation.isPending}
              >
                <CheckCircle className="h-3.5 w-3.5 mr-1" />
                Approve
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => {
                  setRejectId(r.id);
                  setRejectCode(REJECTION_REASON_CODES[0]);
                  setRejectRemarks("");
                }}
                disabled={statusMutation.isPending}
              >
                <XCircle className="h-3.5 w-3.5 mr-1" />
                Reject
              </Button>
            </>
          )}
          {r.status === "Approved" && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setPreviewOrderLeaveId(r.id)}
              >
                <FileText className="h-3.5 w-3.5 mr-1" />
                View order
              </Button>
              {!r.rejoiningDate && (canSubmitNew || roles.includes("ADMIN")) && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setRejoinLeaveId(r.id);
                    setRejoinDate("");
                    setRejoinFitnessUrl("");
                    setRejoinScanUrl("");
                  }}
                  disabled={rejoinMutation.isPending}
                >
                  Report rejoining
                </Button>
              )}
              {r.rejoiningDate && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => window.open(`/api/hr/leaves/${r.id}/joining-report`, "_blank")}
                >
                  <Download className="h-3.5 w-3.5 mr-1" />
                  Joining report
                </Button>
              )}
              {r.rejoiningDate &&
                !r.joiningReportAckAt &&
                (roles.includes("DV") || roles.includes("DA") || roles.includes("ADMIN")) && (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={joiningAckMutation.isPending}
                    onClick={() => joiningAckMutation.mutate({ id: r.id })}
                  >
                    Ack joining report
                  </Button>
                )}
              {canSubmitNew && !r.supersededByLeaveId && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setNewEmployeeId(r.employeeId);
                    setNewLeaveType(r.leaveType);
                    setNewFrom(r.fromDate);
                    setNewTo(r.toDate);
                    setNewReason(r.reason ? `Revision of sanctioned leave: ${r.reason}` : "Revision of sanctioned leave");
                    setNewRevisedFromId(r.id);
                    setNewOpen(true);
                  }}
                >
                  Apply revision
                </Button>
              )}
            </>
          )}
        </div>
      ) : null,
    }));
  }, [list, employeeLabelById, employees, showActions, canVerify, canApprove, canCancel, canSubmitNew, roles, statusMutation.isPending, updateMutation.isPending, rejoinMutation.isPending, joiningAckMutation.isPending]);

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "HR", href: "/hr/employees" }, { label: "Leave requests" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Failed to load leave requests.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "HR", href: "/hr/employees" }, { label: "Leave requests (M-01)" }]}>
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                Leave requests (IOMS M-01)
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Workflow: Pending (DO) → Verified (DV) → Approved or Rejected (DA). DV may return Verified → Pending with
                remarks.
              </p>
            </div>
            {canSubmitNew && (
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const employeeId = user?.employeeId ?? "";
                    if (!employeeId) return;
                    window.open(`/api/hr/leave-balance-statement?employeeIds=${encodeURIComponent(employeeId)}`, "_blank");
                  }}
                >
                  <Download className="h-4 w-4 mr-1" />
                  My balance statement
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    setNewEmployeeId(user?.employeeId ?? "");
                    setNewRevisedFromId("");
                    setNewOpen(true);
                  }}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  New leave
                </Button>
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-4 pt-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id="leave-pending-me"
                checked={pendingOnly}
                onCheckedChange={(c) => setPendingOnly(c === true)}
              />
              <Label htmlFor="leave-pending-me" className="text-sm font-normal cursor-pointer">
                Pending my action (DV/DA queue)
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="leave-mine-only"
                checked={mineOnly}
                onCheckedChange={(c) => setMineOnly(c === true)}
              />
              <Label htmlFor="leave-mine-only" className="text-sm font-normal cursor-pointer">
                My leaves only
              </Label>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <ClientDataGrid
              columns={columns}
              sourceRows={sourceRows}
              searchKeys={[
                "employeeLabel",
                "leaveType",
                "fromDate",
                "toDate",
                "reason",
                "status",
                "rejectionSnippet",
                "dvReturnSnippet",
              ]}
              searchPlaceholder="Search leave requests…"
              defaultSortKey="fromDate"
              defaultSortDir="desc"
              resetPageDependency={listUrl}
              emptyMessage="No leave requests."
            />
          )}
        </CardContent>
      </Card>

      <Dialog
        open={newOpen}
        onOpenChange={(o) => {
          if (!o) setNewOpen(false);
        }}
      >
        <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{newRevisedFromId ? "Revised leave application" : "New leave application"}</DialogTitle>
          </DialogHeader>
          {newRevisedFromId ? (
            <p className="text-sm text-muted-foreground">
              This application revises an already-sanctioned leave. On approval, a new order is issued and balances are
              adjusted (original order becomes Superseded).
            </p>
          ) : null}
          <div className="space-y-3">
            {roles.includes("ADMIN") && (
              <div className="space-y-1">
                <Label>Employee</Label>
                <Select value={newEmployeeId} onValueChange={setNewEmployeeId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select employee" />
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
              <Label>Leave type</Label>
              <Select value={newLeaveType.trim().toUpperCase() || (leaveTypesForEmployee[0] ?? "EL")} onValueChange={setNewLeaveType}>
                <SelectTrigger>
                  <SelectValue placeholder="Select leave type" />
                </SelectTrigger>
                <SelectContent>
                  {leaveTypesForEmployee.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t} — {LEAVE_TYPE_LABELS[t] ?? t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground pt-1">
                <span>
                  Balance{newLeaveType.trim().toUpperCase() === "COMMUTED" ? " (HPL)" : ""}:{" "}
                  <span className="font-medium text-foreground">
                    {selectedBalance ? `${Number(selectedBalance.balanceDays ?? 0)} days` : "N/A"}
                  </span>
                  {newLeaveType.trim().toUpperCase() === "EL" && selectedBalance && Number(selectedBalance.setOffDays ?? 0) > 0 ? (
                    <span className="ml-1">
                      (+ set-off {Number(selectedBalance.setOffDays ?? 0)}d)
                    </span>
                  ) : null}
                </span>
                {requestedDays > 0 && (
                  <span>
                    Requested: <span className="font-medium text-foreground">{requestedDays} days</span>
                  </span>
                )}
              </div>
              {newLeaveType.trim().toUpperCase() === "COMMUTED" && (
                <p className="text-xs text-muted-foreground">Commuted leave debits HPL balance at 2× calendar days.</p>
              )}
            </div>
            {newLeaveType.trim().toUpperCase() === "RH" ? (
              <div className="space-y-1">
                <Label>Restricted holiday date</Label>
                <Select
                  value={newFrom || "__none__"}
                  onValueChange={(v) => {
                    if (v === "__none__") {
                      setNewFrom("");
                      setNewTo("");
                    } else {
                      setNewFrom(v);
                      setNewTo(v);
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select RH date from holiday list" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Select date…</SelectItem>
                    {restrictedHolidayDates.map((h) => (
                      <SelectItem key={h.id} value={h.date}>
                        {h.date} — {h.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label>From</Label>
                <Input type="date" value={newFrom} onChange={(e) => setNewFrom(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>To</Label>
                <Input type="date" value={newTo} onChange={(e) => setNewTo(e.target.value)} />
              </div>
            </div>
            )}
            {(requestedDays > 0 || prefixSuffixPreview) && (
              <div className="rounded-md border bg-muted/30 p-3 text-sm">
                <div className="font-medium">Preview</div>
                <div className="mt-1 text-muted-foreground">
                  Calendar days: {requestedDays || 0} | Debit days: {estimatedDebitDays}
                  {prefixSuffixPreview ? ` | Prefix: ${prefixSuffixPreview.prefixDays} | Suffix: ${prefixSuffixPreview.suffixDays}` : ""}
                </div>
                {prefixSuffixPreview?.prefixFromDate || prefixSuffixPreview?.suffixToDate ? (
                  <div className="mt-1 text-xs text-muted-foreground">
                    {prefixSuffixPreview.prefixFromDate ? `Prefix from ${prefixSuffixPreview.prefixFromDate}` : ""}
                    {prefixSuffixPreview.prefixFromDate && prefixSuffixPreview.suffixToDate ? " | " : ""}
                    {prefixSuffixPreview.suffixToDate ? `Suffix to ${prefixSuffixPreview.suffixToDate}` : ""}
                  </div>
                ) : null}
                {selectedEmployee?.locationPosted ? (
                  <div className="mt-1 text-xs text-muted-foreground">Location basis: {selectedEmployee.locationPosted}</div>
                ) : null}
              </div>
            )}
            {newLeaveType === "CL" && requestedDays === 1 && (
              <div className="space-y-1">
                <Label>Half-day</Label>
                <Select value={newHalfDay || "__none__"} onValueChange={(v) => setNewHalfDay(v === "__none__" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder="Full day" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Full day</SelectItem>
                    <SelectItem value="first_half">First half</SelectItem>
                    <SelectItem value="second_half">Second half</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            {newLeaveType === "SPL_H" && (
              <div className="space-y-1">
                <Label>Duty date (in lieu of)</Label>
                <Input type="date" value={newDutyDate} onChange={(e) => setNewDutyDate(e.target.value)} />
              </div>
            )}
            <div className="space-y-1">
              <Label>Reason / Grounds</Label>
              <Textarea value={newReason} onChange={(e) => setNewReason(e.target.value)} rows={2} />
            </div>
            {FORM1_TYPES.includes(newLeaveType) && (
              <>
                <div className="space-y-1">
                  <Label>Address during leave</Label>
                  <Input value={newAddress} onChange={(e) => setNewAddress(e.target.value)} placeholder="Address where you can be contacted" />
                </div>
                <div className="space-y-1">
                  <Label>Leave headquarters / destination</Label>
                  <Input value={newLeaveHq} onChange={(e) => setNewLeaveHq(e.target.value)} placeholder="Station / City" />
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox checked={newLtc} onCheckedChange={(v) => setNewLtc(Boolean(v))} />
                  <Label>LTC proposed</Label>
                </div>
              </>
            )}
            <div className="space-y-2">
              <Label>Copy to (optional)</Label>
              {newCopyToRows.map((value, index) => (
                <div key={`copy-to-${index}`} className="flex gap-2">
                  <Input
                    value={value}
                    onChange={(e) => {
                      const next = [...newCopyToRows];
                      next[index] = e.target.value;
                      setNewCopyToRows(next);
                    }}
                    placeholder={`Copy to recipient ${index + 1}`}
                  />
                  {newCopyToRows.length > 1 && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setNewCopyToRows(newCopyToRows.filter((_, i) => i !== index))}
                    >
                      Remove
                    </Button>
                  )}
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={() => setNewCopyToRows([...newCopyToRows, ""])}>
                Add copy-to row
              </Button>
            </div>
            <div className="space-y-1">
              <Label>Substitute employee (optional)</Label>
              <Select value={newSubstituteId || "__none__"} onValueChange={(v) => setNewSubstituteId(v === "__none__" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {substitutes.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {(s.empId ?? s.id) + " — " + s.firstName + " " + s.surname}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>
                Supporting document (PDF, 5MB)
                {["ML", "PL", "COMMUTED", "HPL"].includes(newLeaveType.trim().toUpperCase()) ? " *" : ""}
              </Label>
              <Input
                type="file"
                accept="application/pdf,.pdf"
                disabled={newDocUploading}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  // Fast client-side guard (server will still enforce).
                  if (file.size > 5 * 1024 * 1024) {
                    toast({ title: "File too large", description: "Supporting document must be <= 5MB.", variant: "destructive" });
                    return;
                  }
                  if (file.type && file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
                    toast({ title: "Invalid file type", description: "Only PDF documents are allowed.", variant: "destructive" });
                    return;
                  }
                  try {
                    setNewDocUploading(true);
                    setNewDocUrl("");
                    setNewDocFileName(file.name);
                    const form = new FormData();
                    form.append("file", file);
                    form.append("leaveType", newLeaveType.trim().toUpperCase());
                    const res = await fetch("/api/hr/leaves/supporting-document-upload", {
                      method: "POST",
                      body: form,
                      credentials: "include",
                    });
                    if (!res.ok) {
                      const err = await res.json().catch(() => ({}));
                      throw new Error((err as { error?: string }).error ?? res.statusText);
                    }
                    const data = (await res.json()) as { url?: string; key?: string };
                    if (!data.url) throw new Error("Upload succeeded but no URL returned.");
                    setNewDocUrl(data.url);
                    toast({ title: "Document uploaded", description: file.name });
                  } catch (err) {
                    setNewDocUrl("");
                    setNewDocFileName("");
                    toast({ title: "Upload failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
                  } finally {
                    setNewDocUploading(false);
                  }
                }}
              />
              {newDocUploading ? (
                <div className="text-xs text-muted-foreground flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Uploading…
                </div>
              ) : newDocUrl ? (
                <div className="flex items-center justify-between gap-3 pt-1">
                  <div className="min-w-0">
                    <div className="text-xs text-muted-foreground">Uploaded</div>
                    <div className="text-sm truncate" title={newDocFileName}>
                      {newDocFileName || "PDF"}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => window.open(newDocUrl, "_blank")}
                    >
                      View
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      onClick={() => {
                        setNewDocUrl("");
                        setNewDocFileName("");
                      }}
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              ) : null}
              {["ML", "PL", "COMMUTED", "HPL"].includes(newLeaveType) && (
                <p className="text-xs text-destructive">Required for this leave type</p>
              )}
            </div>
            {(roles.includes("ADMIN") || roles.includes("DA")) && (
              <div className="flex items-center gap-2 pt-1">
                <Checkbox checked={newExPostFacto} onCheckedChange={(v) => setNewExPostFacto(Boolean(v))} />
                <Label>Ex-post facto (applied after return from leave)</Label>
              </div>
            )}
            {roles.includes("ADMIN") && (
              <div className="flex items-center gap-2 pt-1">
                <Checkbox checked={newRetrospective} onCheckedChange={(v) => setNewRetrospective(Boolean(v))} />
                <Label>Retrospective entry</Label>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setNewOpen(false);
                setNewDocUrl("");
                setNewDocFileName("");
                setNewDocUploading(false);
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={createMutation.isPending}
              onClick={() => {
                const employeeId = roles.includes("ADMIN") ? newEmployeeId : user?.employeeId ?? "";
                if (!employeeId || !newFrom || !newTo) {
                  toast({ title: "Missing fields", description: "Employee, from and to dates are required.", variant: "destructive" });
                  return;
                }
                const lt = newLeaveType.trim().toUpperCase() || "EL";
                if (["ML", "PL", "COMMUTED", "HPL"].includes(lt) && !newDocUrl.trim()) {
                  toast({
                    title: "Supporting document required",
                    description: "Upload a medical / supporting PDF for this leave type.",
                    variant: "destructive",
                  });
                  return;
                }
                createMutation.mutate({
                  employeeId,
                  leaveType: lt,
                  fromDate: newFrom,
                  toDate: newTo,
                  reason: newReason.trim() || null,
                  supportingDocumentUrl: newDocUrl.trim() || null,
                  isRetrospective: roles.includes("ADMIN") ? newRetrospective : false,
                  isExPostFacto: newExPostFacto,
                  halfDay: newHalfDay || null,
                  substituteEmployeeId: newSubstituteId || null,
                  addressDuringLeave: newAddress.trim() || null,
                  ltcProposed: newLtc,
                  leaveHq: newLeaveHq.trim() || null,
                  dutyDateForSplH: newDutyDate || null,
                  copyToJson: JSON.stringify(newCopyToRows.map((x) => x.trim()).filter(Boolean)),
                  revisedFromLeaveId: newRevisedFromId.trim() || null,
                });
              }}
            >
              Submit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={rejectId != null} onOpenChange={(o) => !o && setRejectId(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reject leave request</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Reason code</Label>
              <Select value={rejectCode} onValueChange={setRejectCode}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REJECTION_REASON_CODES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="leave-reject-remarks">Remarks (min {MIN_WORKFLOW_REMARKS_LENGTH} characters)</Label>
              <Textarea
                id="leave-reject-remarks"
                value={rejectRemarks}
                onChange={(e) => setRejectRemarks(e.target.value)}
                rows={4}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRejectId(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={
                rejectId == null ||
                rejectRemarks.trim().length < MIN_WORKFLOW_REMARKS_LENGTH ||
                statusMutation.isPending
              }
              onClick={() => {
                if (!rejectId) return;
                statusMutation.mutate({
                  id: rejectId,
                  status: "Rejected",
                  rejectionReasonCode: rejectCode,
                  rejectionRemarks: rejectRemarks.trim(),
                });
              }}
            >
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={returnLeaveId != null} onOpenChange={(o) => !o && setReturnLeaveId(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Return leave to Pending</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Remarks are required (min {MIN_WORKFLOW_REMARKS_LENGTH} characters).
          </p>
          <div className="space-y-2">
            <Label htmlFor="leave-return-remarks">Return remarks</Label>
            <Textarea
              id="leave-return-remarks"
              value={returnRemarks}
              onChange={(e) => setReturnRemarks(e.target.value)}
              rows={4}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setReturnLeaveId(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={
                returnLeaveId == null ||
                returnRemarks.trim().length < MIN_WORKFLOW_REMARKS_LENGTH ||
                statusMutation.isPending
              }
              onClick={() => {
                if (!returnLeaveId) return;
                statusMutation.mutate({
                  id: returnLeaveId,
                  status: "Pending",
                  returnRemarks: returnRemarks.trim(),
                });
              }}
            >
              Send back to Pending
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={verifyLeaveId != null} onOpenChange={(o) => !o && setVerifyLeaveId(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Verify leave request</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="leave-verify-remarks">Controlling officer remarks</Label>
            <Textarea
              id="leave-verify-remarks"
              value={verifyRemarks}
              onChange={(e) => setVerifyRemarks(e.target.value)}
              rows={4}
              placeholder="Optional remarks recorded at DV step"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setVerifyLeaveId(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={verifyLeaveId == null || statusMutation.isPending}
              onClick={() => {
                if (!verifyLeaveId) return;
                statusMutation.mutate({
                  id: verifyLeaveId,
                  status: "Verified",
                  controllingOfficerRemarks: verifyRemarks.trim() || null,
                });
              }}
            >
              Verify
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={approveLeaveId != null}
        onOpenChange={(o) => {
          if (!o) {
            setApproveLeaveId(null);
            setApproveCopyToRows([]);
          }
        }}
      >
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Approve leave &amp; sanction order</DialogTitle>
          </DialogHeader>
          {approveLeave && (
            <SanctionOrderPreviewPanel
              leave={approveLeave}
              employee={approveEmployee}
              employeeLabel={employeeLabelById[approveLeave.employeeId] ?? approveLeave.employeeId}
              copyToList={approvePreviewCopyTo}
              balanceAfter={approvePreviewBalanceAfter}
              prefixSuffixNil={approvePrefixSuffixNil}
              usingDefaultCopyTo={approveCopyToRows.map((x) => x.trim()).filter(Boolean).length === 0}
              pendingFileNo
            />
          )}
          <div className="flex items-center gap-2">
            <Checkbox
              checked={approvePrefixSuffixNil}
              onCheckedChange={(v) => setApprovePrefixSuffixNil(v === true)}
            />
            <Label>Override prefix / suffix to Nil</Label>
          </div>
          <p className="text-sm text-muted-foreground">
            Use this only when DA wants non-working prefix/suffix days not to be counted in the sanction order.
          </p>
          <div className="space-y-2">
            <Label>Copy to recipients</Label>
            <p className="text-xs text-muted-foreground">
              Edit rows below to match the sanction order. Leave all blank to use the default list shown in the preview.
            </p>
            {approveCopyToRows.map((value, index) => (
              <div key={`approve-copy-to-${index}`} className="flex gap-2">
                <Input
                  value={value}
                  onChange={(e) => {
                    const next = [...approveCopyToRows];
                    next[index] = e.target.value;
                    setApproveCopyToRows(next);
                  }}
                  placeholder={`Copy to recipient ${index + 1}`}
                />
                {approveCopyToRows.length > 1 && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setApproveCopyToRows(approveCopyToRows.filter((_, i) => i !== index))}
                  >
                    Remove
                  </Button>
                )}
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setApproveCopyToRows([...approveCopyToRows, ""])}
            >
              Add copy-to row
            </Button>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setApproveLeaveId(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={approveLeaveId == null || statusMutation.isPending}
              onClick={() => {
                if (!approveLeaveId) return;
                const trimmedCopyTo = approveCopyToRows.map((x) => x.trim()).filter(Boolean);
                statusMutation.mutate({
                  id: approveLeaveId,
                  status: "Approved",
                  prefixSuffixDisallowed: approvePrefixSuffixNil,
                  copyToJson: trimmedCopyTo.length > 0 ? JSON.stringify(trimmedCopyTo) : null,
                });
              }}
            >
              Approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editLeaveId != null} onOpenChange={(o) => !o && setEditLeaveId(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit pending leave</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Leave type</Label>
              <Input value={editLeaveType} disabled />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label>From</Label>
                <Input type="date" value={editFrom} onChange={(e) => setEditFrom(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>To</Label>
                <Input type="date" value={editTo} onChange={(e) => setEditTo(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Reason</Label>
              <Textarea value={editReason} onChange={(e) => setEditReason(e.target.value)} rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditLeaveId(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={editLeaveId == null || updateMutation.isPending}
              onClick={() => {
                if (!editLeaveId) return;
                updateMutation.mutate({
                  id: editLeaveId,
                  body: {
                    fromDate: editFrom,
                    toDate: editTo,
                    reason: editReason.trim() || null,
                  },
                });
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={previewOrderLeaveId != null} onOpenChange={(o) => !o && setPreviewOrderLeaveId(null)}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Sanction order</DialogTitle>
          </DialogHeader>
          {previewOrderLeave && (
            <SanctionOrderPreviewPanel
              leave={previewOrderLeave}
              employee={previewOrderEmployee}
              employeeLabel={employeeLabelById[previewOrderLeave.employeeId] ?? previewOrderLeave.employeeId}
              copyToList={previewOrderCopyTo.list}
              balanceAfter={previewOrderBalanceAfter}
              prefixSuffixNil={Boolean(previewOrderLeave.prefixSuffixDisallowed)}
              fileNo={previewOrderLeave.fileNo}
              usingDefaultCopyTo={previewOrderCopyTo.usingDefault}
            />
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPreviewOrderLeaveId(null)}>
              Close
            </Button>
            <Button
              type="button"
              disabled={previewOrderLeaveId == null}
              onClick={() => {
                if (!previewOrderLeaveId) return;
                window.open(`/api/hr/leaves/${previewOrderLeaveId}/sanction-order`, "_blank");
              }}
            >
              <Download className="h-4 w-4 mr-1" />
              Download PDF
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={rejoinLeaveId != null}
        onOpenChange={(o) => {
          if (!o) {
            setRejoinLeaveId(null);
            setRejoinDate("");
            setRejoinFitnessUrl("");
            setRejoinScanUrl("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Report rejoining / duty resumption</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Enter the joining date. The system will generate a pre-filled Joining Report PDF for you to sign, scan, and
            submit offline (and in hard copy). Fitness certificate upload is optional.
          </p>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Joining / rejoining date</Label>
              <Input type="date" value={rejoinDate} onChange={(e) => setRejoinDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Fitness certificate (optional PDF)</Label>
              <Input
                type="file"
                accept="application/pdf,.pdf"
                disabled={rejoinUploading}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  if (file.size > 5 * 1024 * 1024) {
                    toast({ title: "File too large", description: "Must be <= 5MB.", variant: "destructive" });
                    return;
                  }
                  try {
                    setRejoinUploading(true);
                    const form = new FormData();
                    form.append("file", file);
                    const res = await fetch("/api/hr/leaves/supporting-document-upload", {
                      method: "POST",
                      body: form,
                      credentials: "include",
                    });
                    if (!res.ok) {
                      const err = await res.json().catch(() => ({}));
                      throw new Error((err as { error?: string }).error ?? res.statusText);
                    }
                    const data = (await res.json()) as { url?: string };
                    if (!data.url) throw new Error("No URL returned");
                    setRejoinFitnessUrl(data.url);
                    toast({ title: "Fitness certificate uploaded" });
                  } catch (err) {
                    toast({
                      title: "Upload failed",
                      description: err instanceof Error ? err.message : "Unknown error",
                      variant: "destructive",
                    });
                  } finally {
                    setRejoinUploading(false);
                  }
                }}
              />
              {rejoinFitnessUrl ? <p className="text-xs text-muted-foreground">Uploaded.</p> : null}
            </div>
            <div className="space-y-1">
              <Label>Signed Joining Report scan (optional PDF)</Label>
              <Input
                type="file"
                accept="application/pdf,.pdf"
                disabled={rejoinUploading}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  if (file.size > 5 * 1024 * 1024) {
                    toast({ title: "File too large", description: "Must be <= 5MB.", variant: "destructive" });
                    return;
                  }
                  try {
                    setRejoinUploading(true);
                    const form = new FormData();
                    form.append("file", file);
                    const res = await fetch("/api/hr/leaves/supporting-document-upload", {
                      method: "POST",
                      body: form,
                      credentials: "include",
                    });
                    if (!res.ok) {
                      const err = await res.json().catch(() => ({}));
                      throw new Error((err as { error?: string }).error ?? res.statusText);
                    }
                    const data = (await res.json()) as { url?: string };
                    if (!data.url) throw new Error("No URL returned");
                    setRejoinScanUrl(data.url);
                    toast({ title: "Joining report scan uploaded" });
                  } catch (err) {
                    toast({
                      title: "Upload failed",
                      description: err instanceof Error ? err.message : "Unknown error",
                      variant: "destructive",
                    });
                  } finally {
                    setRejoinUploading(false);
                  }
                }}
              />
              {rejoinScanUrl ? <p className="text-xs text-muted-foreground">Uploaded.</p> : null}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRejoinLeaveId(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!rejoinLeaveId || !rejoinDate || rejoinMutation.isPending}
              onClick={() => {
                if (!rejoinLeaveId || !rejoinDate) return;
                rejoinMutation.mutate({
                  id: rejoinLeaveId,
                  rejoiningDate: rejoinDate,
                  fitnessCertUrl: rejoinFitnessUrl || null,
                  joiningReportScanUrl: rejoinScanUrl || null,
                });
              }}
            >
              Save &amp; generate report
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
