import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Wallet, Plane, Car, AlertCircle, CheckCircle, XCircle, ShieldCheck, SendHorizontal } from "lucide-react";
import { REJECTION_REASON_CODES, MIN_WORKFLOW_REMARKS_LENGTH } from "@shared/workflow-rejection";

interface LtcClaim {
  id: string;
  employeeId: string;
  claimDate: string;
  amount: number;
  period?: string | null;
  status: string;
}
interface TaDaClaim {
  id: string;
  employeeId: string;
  travelDate: string;
  purpose: string;
  amount: number;
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

export default function HrClaims() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const roles = user?.roles?.map((r) => r.tier) ?? [];
  const canVerify = roles.includes("DV") || roles.includes("ADMIN");
  const canApprove = roles.includes("DA") || roles.includes("ADMIN");
  const [tadaPendingOnly, setTadaPendingOnly] = useState(false);
  const [tadaRejectId, setTadaRejectId] = useState<string | null>(null);
  const [tadaRejectCode, setTadaRejectCode] = useState<string>(REJECTION_REASON_CODES[0]);
  const [tadaRejectRemarks, setTadaRejectRemarks] = useState("");
  const [tadaReturnId, setTadaReturnId] = useState<string | null>(null);
  const [tadaReturnRemarks, setTadaReturnRemarks] = useState("");

  const tadaListUrl = tadaPendingOnly ? "/api/hr/claims/tada?pendingMyAction=1" : "/api/hr/claims/tada";

  const { data: ltcList = [], isLoading: ltcLoading, isError: ltcError } = useQuery<LtcClaim[]>({
    queryKey: ["/api/hr/claims/ltc"],
  });
  const { data: tadaList = [], isLoading: tadaLoading, isError: tadaError } = useQuery<TaDaClaim[]>({
    queryKey: [tadaListUrl],
  });
  const { data: employees = [] } = useQuery<Employee[]>({
    queryKey: ["/api/hr/employees"],
  });
  const employeeLabelById = Object.fromEntries(
    employees.map((e) => [e.id, `${e.empId ?? e.id} — ${e.firstName} ${e.surname}`]),
  );

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
          <div>
            <h3 className="font-medium flex items-center gap-2 mb-2">
              <Plane className="h-4 w-4" />
              LTC claims
            </h3>
            {ltcLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Claim date</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ltcList.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-muted-foreground text-center py-6">No LTC claims.</TableCell>
                    </TableRow>
                  ) : (
                    ltcList.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell>{employeeLabelById[c.employeeId] ?? c.employeeId}</TableCell>
                        <TableCell>{c.claimDate}</TableCell>
                        <TableCell>{c.period ?? "—"}</TableCell>
                        <TableCell className="text-right">₹{c.amount.toLocaleString()}</TableCell>
                        <TableCell><Badge variant="secondary">{c.status}</Badge></TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            )}
          </div>
          <div>
            <h3 className="font-medium flex items-center gap-2 mb-2">
              <Car className="h-4 w-4" />
              TA/DA claims
            </h3>
            <p className="text-sm text-muted-foreground mb-2">
              Workflow: Pending (DO) → Verified (DV) → Approved or Rejected (DA). DV may return Verified → Pending with remarks.
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
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Travel date</TableHead>
                    <TableHead>Purpose</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                    {showTadaActions && <TableHead className="w-[280px]">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tadaList.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={showTadaActions ? 6 : 5} className="text-muted-foreground text-center py-6">No TA/DA claims.</TableCell>
                    </TableRow>
                  ) : (
                    tadaList.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell>{employeeLabelById[c.employeeId] ?? c.employeeId}</TableCell>
                        <TableCell>{c.travelDate}</TableCell>
                        <TableCell className="max-w-[200px] truncate">{c.purpose}</TableCell>
                        <TableCell className="text-right">₹{c.amount.toLocaleString()}</TableCell>
                        <TableCell>
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
                        </TableCell>
                        {showTadaActions && (
                          <TableCell className="flex flex-wrap gap-1">
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
                          </TableCell>
                        )}
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
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
    </AppShell>
  );
}
