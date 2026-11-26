import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
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
import { EmployeeSearchSelect } from "@/components/selects/employee-search-select";
import { useToast } from "@/hooks/use-toast";
import { formatApiDateOrDateTime, formatYmdToDisplay } from "@/lib/dateFormat";
import { cn } from "@/lib/utils";
import { localCalendarYmd } from "@shared/premises-allocation";
import { MIN_WORKFLOW_REMARKS_LENGTH } from "@shared/workflow-rejection";
import {
  HO_SECTION_OPTIONS,
  isPostingChangeType,
  postingChangeTypeLabel,
  effectiveFromLabel,
  validatePostingSubmit,
  type PostingChangeType,
  type PostingFieldErrors,
} from "@shared/hr-posting-update";
import { AlertCircle, ArrowLeft, CheckCircle2, FileText, Loader2, MapPin } from "lucide-react";

type EmpHeader = {
  id: string;
  empId: string | null;
  name: string;
  designation: string;
};

type PostingDetail = {
  id: string;
  requestNo: string;
  employeeId: string;
  changeType: string;
  oldYardId: string | null;
  newYardId: string | null;
  newSection: string | null;
  newReportingOfficerEmployeeId: string | null;
  additionalYardIds: string[];
  withdrawYardIds: string[];
  hoSectionByYardId: Record<string, string>;
  effectiveFrom: string;
  orderNo: string | null;
  orderDate: string | null;
  remarks: string | null;
  orderCopyFileName: string | null;
  orderCopyBlobKey: string | null;
  status: string;
  submittedAt: string | null;
  verifiedAt: string | null;
  approvedAt: string | null;
  returnedAt: string | null;
  rejectedAt: string | null;
  returnOrRejectRemarks: string | null;
  employee: EmpHeader | null;
  yardNames: Record<string, string>;
  newReportingOfficer: EmpHeader | null;
  oldReportingOfficer: EmpHeader | null;
  actors: { doName: string | null; dvName: string | null; daName: string | null };
  canVerify: boolean;
  canApprove: boolean;
  canReturn: boolean;
  canReject: boolean;
  canResubmit: boolean;
};

type PostingContext = {
  yardId: string;
  yardName: string;
  section: string | null;
  additionalCharges: { yardId: string; yardName: string; section: string | null; from: string | null; isHeadOffice: boolean }[];
  reportingOfficer: EmpHeader | null;
  yards: { id: string; name: string | null; code: string | null; isHeadOffice: boolean }[];
  hoSectionOptions: string[];
};

function yardNameOf(detail: PostingDetail, id: string | null | undefined): string {
  if (!id) return "—";
  return detail.yardNames[id] ?? id;
}

function StepBar({
  detail,
}: {
  detail: PostingDetail;
}) {
  const steps = [
    {
      key: "entered",
      label: "Entered",
      name: detail.actors.doName,
      at: detail.submittedAt,
      done: Boolean(detail.submittedAt),
    },
    {
      key: "verified",
      label: "Verified",
      name: detail.actors.dvName,
      at: detail.verifiedAt,
      done: Boolean(detail.verifiedAt),
    },
    {
      key: "approved",
      label: "Approved",
      name: detail.actors.daName,
      at: detail.approvedAt,
      done: Boolean(detail.approvedAt) || detail.status === "Approved",
    },
  ];
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {steps.map((s, i) => (
        <div
          key={s.key}
          className={cn(
            "rounded-md border p-3 text-sm",
            s.done ? "border-primary/40 bg-primary/5" : "bg-muted/30",
          )}
        >
          <div className="flex items-center gap-2 font-medium">
            {s.done ? <CheckCircle2 className="h-4 w-4 text-primary" /> : <span className="text-muted-foreground">{i + 1}.</span>}
            {s.label}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {s.name ?? "—"}
            {s.at ? ` · ${formatApiDateOrDateTime(s.at)}` : ""}
          </p>
        </div>
      ))}
    </div>
  );
}

export default function HrPostingUpdateDetail() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const today = localCalendarYmd();

  const [actionDialog, setActionDialog] = useState<"return" | "reject" | null>(null);
  const [actionRemarks, setActionRemarks] = useState("");
  const [resubmitErrors, setResubmitErrors] = useState<PostingFieldErrors>({});

  const { data: detail, isLoading, isError } = useQuery<PostingDetail>({
    queryKey: ["/api/hr/posting-updates", id],
    queryFn: async () => {
      const res = await fetch(`/api/hr/posting-updates/${encodeURIComponent(id!)}`, { credentials: "include" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? res.statusText);
      }
      return res.json();
    },
    enabled: Boolean(id),
  });

  const needContext = Boolean(detail?.canResubmit && detail.status === "ReturnedToDO");
  const { data: ctx } = useQuery<PostingContext>({
    queryKey: ["/api/hr/employees", detail?.employeeId, "posting-update-context"],
    queryFn: async () => {
      const res = await fetch(
        `/api/hr/employees/${encodeURIComponent(detail!.employeeId)}/posting-update-context`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Failed to load context");
      return res.json();
    },
    enabled: needContext && Boolean(detail?.employeeId),
  });

  const changeType = (detail && isPostingChangeType(detail.changeType)
    ? detail.changeType
    : "Transfer") as PostingChangeType;

  const [editYardId, setEditYardId] = useState("");
  const [editSection, setEditSection] = useState("");
  const [editRoId, setEditRoId] = useState("");
  const [editAdditional, setEditAdditional] = useState<string[]>([]);
  const [editHoMap, setEditHoMap] = useState<Record<string, string>>({});
  const [editWithdraw, setEditWithdraw] = useState<string[]>([]);
  const [editEffectiveFrom, setEditEffectiveFrom] = useState("");
  const [editOrderNo, setEditOrderNo] = useState("");
  const [editOrderDate, setEditOrderDate] = useState("");
  const [editRemarks, setEditRemarks] = useState("");
  const [editOrderFile, setEditOrderFile] = useState<File | null>(null);

  useEffect(() => {
    if (!detail || detail.status !== "ReturnedToDO") return;
    setEditYardId(detail.newYardId ?? "");
    setEditSection(detail.newSection ?? "");
    setEditRoId(detail.newReportingOfficerEmployeeId ?? "");
    setEditAdditional(detail.additionalYardIds ?? []);
    setEditHoMap(detail.hoSectionByYardId ?? {});
    setEditWithdraw(detail.withdrawYardIds ?? []);
    setEditEffectiveFrom(detail.effectiveFrom ?? "");
    setEditOrderNo(detail.orderNo ?? "");
    setEditOrderDate(detail.orderDate ?? "");
    setEditRemarks(detail.remarks ?? "");
  }, [detail]);

  const yardById = useMemo(() => {
    const map: Record<string, { id: string; isHeadOffice: boolean; label: string }> = {};
    for (const y of ctx?.yards ?? []) {
      map[y.id] = {
        id: y.id,
        isHeadOffice: y.isHeadOffice,
        label: String(y.name ?? "").trim() || String(y.code ?? "").trim() || y.id,
      };
    }
    return map;
  }, [ctx?.yards]);

  const statusMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch(`/api/hr/posting-updates/${encodeURIComponent(id!)}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? res.statusText);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hr/posting-updates", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/hr/posting-updates"] });
      if (detail?.employeeId) {
        queryClient.invalidateQueries({ queryKey: ["/api/hr/employees", detail.employeeId] });
        queryClient.invalidateQueries({
          queryKey: ["/api/hr/employees", detail.employeeId, "posting-update-context"],
        });
      }
      setActionDialog(null);
      setActionRemarks("");
      toast({ title: "Updated" });
    },
    onError: (e: Error) => toast({ title: "Action failed", description: e.message, variant: "destructive" }),
  });

  const handleResubmit = async () => {
    if (!detail) return;
    const errors = validatePostingSubmit(
      {
        changeType,
        newYardId: editYardId || null,
        newSection: editSection || null,
        newReportingOfficerEmployeeId: editRoId || null,
        additionalYardIds: editAdditional,
        hoSectionByYardId: editHoMap,
        withdrawYardIds: editWithdraw,
        effectiveFrom: editEffectiveFrom,
        orderNo: editOrderNo,
        orderDate: editOrderDate,
        remarks: editRemarks,
      },
      {
        todayYmd: today,
        isHeadOfficeYardId: (yid) => Boolean(yardById[yid]?.isHeadOffice),
      },
    );
    setResubmitErrors(errors);
    if (Object.keys(errors).length > 0) {
      toast({ title: "Fix validation errors", variant: "destructive" });
      return;
    }

    let orderMeta: Record<string, unknown> = {};
    if (editOrderFile) {
      const fd = new FormData();
      fd.append("file", editOrderFile);
      const up = await fetch(
        `/api/hr/employees/${encodeURIComponent(detail.employeeId)}/posting-updates/order-copy`,
        { method: "POST", credentials: "include", body: fd },
      );
      if (!up.ok) {
        const err = await up.json().catch(() => ({}));
        toast({
          title: "Upload failed",
          description: (err as { error?: string }).error ?? "Order copy upload failed",
          variant: "destructive",
        });
        return;
      }
      const stored = (await up.json()) as {
        blobKey: string;
        fileName: string;
        mimeType: string;
        sizeBytes: number;
      };
      orderMeta = {
        orderCopyBlobKey: stored.blobKey,
        orderCopyFileName: stored.fileName,
        orderCopyMimeType: stored.mimeType,
        orderCopySizeBytes: stored.sizeBytes,
      };
    }

    statusMutation.mutate({
      resubmit: true,
      changeType,
      newYardId: editYardId || null,
      newSection: editSection || null,
      newReportingOfficerEmployeeId: editRoId || null,
      additionalYardIds: editAdditional,
      hoSectionByYardId: editHoMap,
      withdrawYardIds: editWithdraw,
      effectiveFrom: editEffectiveFrom,
      orderNo: editOrderNo || null,
      orderDate: editOrderDate || null,
      remarks: editRemarks || null,
      ...orderMeta,
    });
  };

  if (!id) return null;

  if (isLoading || !detail) {
    return (
      <AppShell breadcrumbs={[{ label: "HR", href: "/hr/posting-updates" }, { label: "Request" }]}>
        <Card>
          <CardContent className="p-6">
            <Skeleton className="h-8 w-64 mb-4" />
            <Skeleton className="h-40 w-full" />
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "HR", href: "/hr/posting-updates" }, { label: "Request" }]}>
        <Card className="border-destructive/30">
          <CardContent className="p-6 flex items-center gap-2 text-destructive">
            <AlertCircle className="h-5 w-5" /> Failed to load request.
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  const emp = detail.employee;
  const changeLabel = isPostingChangeType(detail.changeType)
    ? postingChangeTypeLabel(detail.changeType as PostingChangeType)
    : detail.changeType;
  const hoOptions = ctx?.hoSectionOptions?.length ? ctx.hoSectionOptions : [...HO_SECTION_OPTIONS];
  const heldIds = new Set<string>([
    ...(ctx ? [ctx.yardId] : []),
    ...(ctx?.additionalCharges.map((c) => c.yardId) ?? []),
  ]);

  const changeSummary = (() => {
    const lines: string[] = [`Type: ${changeLabel}`];
    if (detail.changeType === "Transfer") {
      lines.push(`From: ${yardNameOf(detail, detail.oldYardId)}`);
      lines.push(
        `To: ${yardNameOf(detail, detail.newYardId)}${detail.newSection ? ` — ${detail.newSection}` : ""}`,
      );
      lines.push(
        `RO: ${detail.oldReportingOfficer?.name ?? "—"} → ${detail.newReportingOfficer?.name ?? "—"}`,
      );
    } else if (detail.changeType === "AssignAdditionalCharge") {
      lines.push(
        `Assign: ${(detail.additionalYardIds ?? []).map((y) => {
          const sec = detail.hoSectionByYardId?.[y];
          return `${yardNameOf(detail, y)}${sec ? ` (${sec})` : ""}`;
        }).join("; ") || "—"}`,
      );
    } else if (detail.changeType === "WithdrawAdditionalCharge") {
      lines.push(
        `Withdraw: ${(detail.withdrawYardIds ?? []).map((y) => yardNameOf(detail, y)).join("; ") || "—"}`,
      );
    } else {
      lines.push(
        `RO: ${detail.oldReportingOfficer?.name ?? "—"} → ${detail.newReportingOfficer?.name ?? "—"}`,
      );
    }
    return lines;
  })();

  return (
    <AppShell
      breadcrumbs={[
        { label: "HR", href: "/hr/posting-updates" },
        { label: detail.requestNo },
      ]}
    >
      <div className="space-y-4">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <MapPin className="h-5 w-5" />
                {detail.requestNo}
              </CardTitle>
              {emp ? (
                <p className="text-sm text-muted-foreground mt-1">
                  {emp.name} · {emp.empId ?? "—"} · {emp.designation}
                </p>
              ) : null}
              <Badge className="mt-2" variant="secondary">
                {detail.status}
              </Badge>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/hr/posting-updates">
                <ArrowLeft className="h-4 w-4 mr-1" /> Back
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            <StepBar detail={detail} />

            {(detail.status === "ReturnedToDO" || detail.status === "Rejected") &&
            detail.returnOrRejectRemarks ? (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
                <p className="font-medium">
                  {detail.status === "Rejected" ? "Rejection remarks" : "Return remarks"}
                </p>
                <p className="mt-1 whitespace-pre-wrap">{detail.returnOrRejectRemarks}</p>
              </div>
            ) : null}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground mb-1">Change summary</p>
                <ul className="space-y-1">
                  {changeSummary.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
              <div className="space-y-1">
                <p>
                  <span className="text-muted-foreground">{effectiveFromLabel(changeType)}:</span>{" "}
                  {formatYmdToDisplay(detail.effectiveFrom)}
                </p>
                <p>
                  <span className="text-muted-foreground">Order:</span>{" "}
                  {detail.orderNo ?? "—"}
                  {detail.orderDate ? ` dated ${formatYmdToDisplay(detail.orderDate)}` : ""}
                </p>
                <p>
                  <span className="text-muted-foreground">Remarks:</span> {detail.remarks ?? "—"}
                </p>
                {detail.orderCopyFileName ? (
                  <p className="flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    <a
                      className="text-primary underline"
                      href={`/api/hr/posting-updates/${encodeURIComponent(detail.id)}/order-copy`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {detail.orderCopyFileName}
                    </a>
                  </p>
                ) : (
                  <p className="text-muted-foreground">No order copy attached</p>
                )}
              </div>
            </div>

            {(detail.canVerify || detail.canApprove || detail.canReturn || detail.canReject) && (
              <div className="flex flex-wrap gap-2 pt-2 border-t">
                {detail.canVerify ? (
                  <Button
                    onClick={() => statusMutation.mutate({ status: "PendingApproval" })}
                    disabled={statusMutation.isPending}
                  >
                    {statusMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Verify &amp; forward
                  </Button>
                ) : null}
                {detail.canApprove ? (
                  <Button
                    onClick={() => statusMutation.mutate({ status: "Approved" })}
                    disabled={statusMutation.isPending}
                  >
                    {statusMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Approve &amp; apply
                  </Button>
                ) : null}
                {detail.canReturn ? (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setActionRemarks("");
                      setActionDialog("return");
                    }}
                    disabled={statusMutation.isPending}
                  >
                    Return to DO
                  </Button>
                ) : null}
                {detail.canReject ? (
                  <Button
                    variant="destructive"
                    onClick={() => {
                      setActionRemarks("");
                      setActionDialog("reject");
                    }}
                    disabled={statusMutation.isPending}
                  >
                    Reject
                  </Button>
                ) : null}
              </div>
            )}
          </CardContent>
        </Card>

        {detail.canResubmit && detail.status === "ReturnedToDO" ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Correct &amp; resubmit</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Update fields as needed, then resubmit to Pending Verification.
              </p>

              {changeType === "Transfer" && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>New primary location</Label>
                    <Select
                      value={editYardId || undefined}
                      onValueChange={(v) => {
                        setEditYardId(v);
                        if (!yardById[v]?.isHeadOffice) setEditSection("");
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select" />
                      </SelectTrigger>
                      <SelectContent>
                        {(ctx?.yards ?? [])
                          .filter((y) => y.id !== ctx?.yardId)
                          .map((y) => (
                            <SelectItem key={y.id} value={y.id}>
                              {yardById[y.id]?.label ?? y.id}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {yardById[editYardId]?.isHeadOffice ? (
                    <div className="space-y-2">
                      <Label>Section (HO)</Label>
                      <Select value={editSection || undefined} onValueChange={setEditSection}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select" />
                        </SelectTrigger>
                        <SelectContent>
                          {hoOptions.map((s) => (
                            <SelectItem key={s} value={s}>
                              {s}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : null}
                  <div className="space-y-2 md:col-span-2">
                    <Label>Reporting officer</Label>
                    <EmployeeSearchSelect
                      value={editRoId}
                      onValueChange={setEditRoId}
                      excludeId={detail.employeeId}
                    />
                  </div>
                </div>
              )}

              {changeType === "AssignAdditionalCharge" && (
                <div className="space-y-2">
                  <Label>Locations to assign</Label>
                  <div className="rounded-md border p-3 space-y-2 max-h-48 overflow-y-auto">
                    {(ctx?.yards ?? [])
                      .filter((y) => !heldIds.has(y.id) || editAdditional.includes(y.id))
                      .map((y) => (
                        <label key={y.id} className="flex items-center gap-2 text-sm cursor-pointer">
                          <Checkbox
                            checked={editAdditional.includes(y.id)}
                            onCheckedChange={(v) => {
                              const on = v === true;
                              setEditAdditional((prev) =>
                                on ? [...prev.filter((x) => x !== y.id), y.id] : prev.filter((x) => x !== y.id),
                              );
                            }}
                          />
                          <span>{yardById[y.id]?.label ?? y.id}</span>
                        </label>
                      ))}
                  </div>
                </div>
              )}

              {changeType === "WithdrawAdditionalCharge" && (
                <div className="space-y-2">
                  <Label>Charges to withdraw</Label>
                  <div className="rounded-md border p-3 space-y-2">
                    {(ctx?.additionalCharges ?? []).map((c) => (
                      <label key={c.yardId} className="flex items-center gap-2 text-sm cursor-pointer">
                        <Checkbox
                          checked={editWithdraw.includes(c.yardId)}
                          onCheckedChange={(v) => {
                            const on = v === true;
                            setEditWithdraw((prev) =>
                              on
                                ? [...prev.filter((x) => x !== c.yardId), c.yardId]
                                : prev.filter((x) => x !== c.yardId),
                            );
                          }}
                        />
                        <span>{c.yardName}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {changeType === "ChangeReportingOfficer" && (
                <div className="space-y-2">
                  <Label>New reporting officer</Label>
                  <EmployeeSearchSelect
                    value={editRoId}
                    onValueChange={setEditRoId}
                    excludeId={detail.employeeId}
                    excludeIds={detail.oldReportingOfficer?.id ? [detail.oldReportingOfficer.id] : []}
                  />
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{effectiveFromLabel(changeType)}</Label>
                  <Input
                    type="date"
                    max={today}
                    value={editEffectiveFrom}
                    onChange={(e) => setEditEffectiveFrom(e.target.value)}
                    className={resubmitErrors.effectiveFrom ? "border-destructive" : ""}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Order number</Label>
                  <Input
                    value={editOrderNo}
                    onChange={(e) => setEditOrderNo(e.target.value)}
                    className={resubmitErrors.orderNo ? "border-destructive" : ""}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Order date</Label>
                  <Input
                    type="date"
                    max={today}
                    value={editOrderDate}
                    onChange={(e) => setEditOrderDate(e.target.value)}
                    className={resubmitErrors.orderDate ? "border-destructive" : ""}
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>Remarks</Label>
                  <Textarea value={editRemarks} onChange={(e) => setEditRemarks(e.target.value)} rows={3} />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>Replace order copy (optional)</Label>
                  <Input
                    type="file"
                    accept="application/pdf,image/png,image/jpeg,image/webp"
                    onChange={(e) => setEditOrderFile(e.target.files?.[0] ?? null)}
                  />
                </div>
              </div>

              <Button onClick={handleResubmit} disabled={statusMutation.isPending}>
                {statusMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Resubmit
              </Button>
            </CardContent>
          </Card>
        ) : null}

        {emp ? (
          <p className="text-sm text-muted-foreground">
            Employee record:{" "}
            <Link href={`/hr/employees/${detail.employeeId}`} className="text-primary underline">
              {emp.name}
            </Link>
          </p>
        ) : null}
      </div>

      <Dialog open={actionDialog != null} onOpenChange={(o) => !o && setActionDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{actionDialog === "reject" ? "Reject request" : "Return to DO"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Remarks (min {MIN_WORKFLOW_REMARKS_LENGTH} characters) *</Label>
            <Textarea
              value={actionRemarks}
              onChange={(e) => setActionRemarks(e.target.value)}
              rows={4}
              placeholder="Explain the reason…"
            />
            {actionRemarks.trim().length > 0 &&
            actionRemarks.trim().length < MIN_WORKFLOW_REMARKS_LENGTH ? (
              <p className="text-xs text-destructive">
                Enter at least {MIN_WORKFLOW_REMARKS_LENGTH} characters.
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setActionDialog(null)}>
              Cancel
            </Button>
            <Button
              variant={actionDialog === "reject" ? "destructive" : "default"}
              disabled={
                statusMutation.isPending ||
                actionRemarks.trim().length < MIN_WORKFLOW_REMARKS_LENGTH
              }
              onClick={() => {
                if (!actionDialog) return;
                statusMutation.mutate({
                  status: actionDialog === "reject" ? "Rejected" : "ReturnedToDO",
                  returnOrRejectRemarks: actionRemarks.trim(),
                });
              }}
            >
              {statusMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {actionDialog === "reject" ? "Reject" : "Return"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
