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
import { Calendar, AlertCircle, CheckCircle, XCircle, ShieldCheck, SendHorizontal, Plus } from "lucide-react";
import { REJECTION_REASON_CODES, MIN_WORKFLOW_REMARKS_LENGTH } from "@shared/workflow-rejection";
import { ClientDataGrid } from "@/components/reports/ClientDataGrid";
import type { ReportTableColumn } from "@/components/reports/ReportDataTable";

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
}
interface Employee {
  id: string;
  empId?: string | null;
  firstName: string;
  surname: string;
}

interface LeaveBalanceRow {
  id: string;
  employeeId: string;
  leaveType: string;
  balanceDays: number;
}

const DEFAULT_LEAVE_TYPES = ["EL", "CL", "ML", "CCL"] as const;

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
  const [pendingOnly, setPendingOnly] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [newEmployeeId, setNewEmployeeId] = useState("");
  const [newLeaveType, setNewLeaveType] = useState("EL");
  const [newFrom, setNewFrom] = useState("");
  const [newTo, setNewTo] = useState("");
  const [newReason, setNewReason] = useState("");
  const [newDocUrl, setNewDocUrl] = useState("");
  const [newRetrospective, setNewRetrospective] = useState(false);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectCode, setRejectCode] = useState<string>(REJECTION_REASON_CODES[0]);
  const [rejectRemarks, setRejectRemarks] = useState("");
  const [returnLeaveId, setReturnLeaveId] = useState<string | null>(null);
  const [returnRemarks, setReturnRemarks] = useState("");

  const listUrl = pendingOnly ? "/api/hr/leaves?pendingMyAction=1" : "/api/hr/leaves";
  const { data: list, isLoading, isError } = useQuery<LeaveRequest[]>({
    queryKey: [listUrl],
  });
  const { data: employees = [] } = useQuery<Employee[]>({
    queryKey: ["/api/hr/employees"],
  });
  const { data: balances = [] } = useQuery<LeaveBalanceRow[]>({
    queryKey: ["/api/hr/leave-balances"],
  });
  const employeeLabelById = Object.fromEntries(
    employees.map((e) => [e.id, `${e.empId ?? e.id} — ${e.firstName} ${e.surname}`]),
  );

  const isAdmin = roles.includes("ADMIN");
  const effectiveEmployeeId = isAdmin ? newEmployeeId : user?.employeeId ?? "";

  const leaveTypesForEmployee = useMemo((): string[] => {
    const empId = effectiveEmployeeId.trim();
    if (!empId) return [...DEFAULT_LEAVE_TYPES];
    const set = new Set<string>();
    for (const b of balances) {
      if (b.employeeId === empId && b.leaveType) set.add(String(b.leaveType).trim().toUpperCase());
    }
    const list = Array.from(set).filter(Boolean).sort();
    return list.length ? list : [...DEFAULT_LEAVE_TYPES];
  }, [balances, effectiveEmployeeId]);

  const selectedBalance = useMemo((): LeaveBalanceRow | null => {
    const empId = effectiveEmployeeId.trim();
    const lt = newLeaveType.trim().toUpperCase();
    if (!empId || !lt) return null;
    return balances.find((b) => b.employeeId === empId && String(b.leaveType).trim().toUpperCase() === lt) ?? null;
  }, [balances, effectiveEmployeeId, newLeaveType]);

  const requestedDays = useMemo(() => {
    if (!newFrom || !newTo) return 0;
    return inclusiveCalendarDays(newFrom, newTo);
  }, [newFrom, newTo]);

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
      queryClient.invalidateQueries({ queryKey: ["/api/hr/leaves?pendingMyAction=1"] });
      toast({ title: "Leave submitted", description: "Request is Pending for DV verification." });
      setNewOpen(false);
      setNewReason("");
      setNewDocUrl("");
      setNewRetrospective(false);
    },
    onError: (e: Error) => toast({ title: "Create failed", description: e.message, variant: "destructive" }),
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
      queryClient.invalidateQueries({ queryKey: ["/api/hr/leaves?pendingMyAction=1"] });
      toast({ title: "Status updated", description: `Leave request set to ${vars.status}.` });
      setRejectId(null);
      setRejectRemarks("");
      setReturnLeaveId(null);
      setReturnRemarks("");
    },
    onError: (e: Error) => {
      toast({ title: "Update failed", description: e.message, variant: "destructive" });
    },
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
    if (showActions) base.push({ key: "_actions", header: "Actions" });
    return base;
  }, [showActions]);

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
          {r.dvReturnRemarks && (
            <span className="text-xs text-muted-foreground line-clamp-2" title={r.dvReturnRemarks}>
              DV return: {r.dvReturnRemarks}
            </span>
          )}
        </div>
      ),
      _actions: showActions ? (
        <div className="flex flex-wrap gap-1">
          {canCancel && r.status === "Pending" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => statusMutation.mutate({ id: r.id, status: "Cancelled" })}
              disabled={statusMutation.isPending}
            >
              Cancel
            </Button>
          )}
          {canVerify && r.status === "Pending" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => statusMutation.mutate({ id: r.id, status: "Verified" })}
              disabled={statusMutation.isPending}
            >
              <ShieldCheck className="h-3.5 w-3.5 mr-1" />
              Verify
            </Button>
          )}
          {canVerify && r.status === "Verified" && (
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
          {canApprove && r.status === "Verified" && (
            <>
              <Button
                size="sm"
                variant="default"
                onClick={() => statusMutation.mutate({ id: r.id, status: "Approved" })}
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
        </div>
      ) : null,
    }));
  }, [list, employeeLabelById, showActions, canVerify, canApprove, statusMutation.isPending]);

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
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  setNewEmployeeId(user?.employeeId ?? "");
                  setNewOpen(true);
                }}
              >
                <Plus className="h-4 w-4 mr-1" />
                New leave
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2 pt-2">
            <Checkbox
              id="leave-pending-me"
              checked={pendingOnly}
              onCheckedChange={(c) => setPendingOnly(c === true)}
            />
            <Label htmlFor="leave-pending-me" className="text-sm font-normal cursor-pointer">
              Pending my action (DV/DA queue)
            </Label>
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
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New leave application</DialogTitle>
          </DialogHeader>
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
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground pt-1">
                <span>
                  Balance:{" "}
                  <span className="font-medium text-foreground">
                    {selectedBalance ? `${Number(selectedBalance.balanceDays ?? 0)} days` : "Not configured"}
                  </span>
                </span>
                {requestedDays > 0 && (
                  <span>
                    Requested: <span className="font-medium text-foreground">{requestedDays} days</span>
                  </span>
                )}
              </div>
            </div>
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
            <div className="space-y-1">
              <Label>Reason</Label>
              <Textarea value={newReason} onChange={(e) => setNewReason(e.target.value)} rows={3} />
            </div>
            <div className="space-y-1">
              <Label>Supporting document URL (optional)</Label>
              <Input value={newDocUrl} onChange={(e) => setNewDocUrl(e.target.value)} placeholder="https://…" />
            </div>
            {roles.includes("ADMIN") && (
              <div className="flex items-center gap-2 pt-1">
                <Checkbox checked={newRetrospective} onCheckedChange={(v) => setNewRetrospective(Boolean(v))} />
                <Label>Retrospective entry</Label>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setNewOpen(false)}>
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
                createMutation.mutate({
                  employeeId,
                  leaveType: newLeaveType.trim().toUpperCase() || "EL",
                  fromDate: newFrom,
                  toDate: newTo,
                  reason: newReason.trim() || null,
                  supportingDocumentUrl: newDocUrl.trim() || null,
                  isRetrospective: roles.includes("ADMIN") ? newRetrospective : false,
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
    </AppShell>
  );
}
