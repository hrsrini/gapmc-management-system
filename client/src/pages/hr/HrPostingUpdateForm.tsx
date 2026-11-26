import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { formatYmdToDisplay } from "@/lib/dateFormat";
import { localCalendarYmd } from "@shared/premises-allocation";
import AccessDenied from "@/pages/AccessDenied";
import {
  POSTING_CHANGE_TYPES,
  postingChangeTypeLabel,
  postingServiceBookTypeLabel,
  effectiveFromLabel,
  validatePostingSubmit,
  HO_SECTION_OPTIONS,
  type PostingChangeType,
  type PostingFieldErrors,
} from "@shared/hr-posting-update";
import { AlertCircle, ArrowLeft, CheckCircle2, Loader2, MapPin } from "lucide-react";

type YardOption = {
  id: string;
  name: string | null;
  code: string | null;
  type: string | null;
  isHeadOffice: boolean;
};

type ChargeRow = {
  yardId: string;
  from: string | null;
  section: string | null;
  yardName: string;
  isHeadOffice: boolean;
};

type EmpHeader = {
  id: string;
  empId: string | null;
  name: string;
  designation: string;
};

type PostingContext = {
  employee: EmpHeader;
  yardId: string;
  yardName: string;
  section: string | null;
  isHeadOffice: boolean;
  additionalCharges: ChargeRow[];
  reportingOfficer: EmpHeader | null;
  openRequest: { id: string; requestNo: string; status: string } | null;
  hoSectionOptions: string[];
  yards: YardOption[];
};

function yardLabel(y: YardOption): string {
  return String(y.name ?? "").trim() || String(y.code ?? "").trim() || y.id;
}

function errBorder(has: boolean): string {
  return has ? "border-destructive focus-visible:ring-destructive" : "";
}

export default function HrPostingUpdateForm() {
  const { id: employeeId } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { can } = useAuth();
  const canAct = can("M-01", "Create") || can("M-01", "Update");
  const queryClient = useQueryClient();
  const today = localCalendarYmd();

  const [changeType, setChangeType] = useState<PostingChangeType>("Transfer");
  const [newYardId, setNewYardId] = useState("");
  const [newSection, setNewSection] = useState("");
  const [newRoId, setNewRoId] = useState("");
  const [additionalYardIds, setAdditionalYardIds] = useState<string[]>([]);
  const [hoSectionByYardId, setHoSectionByYardId] = useState<Record<string, string>>({});
  const [withdrawYardIds, setWithdrawYardIds] = useState<string[]>([]);
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [orderNo, setOrderNo] = useState("");
  const [orderDate, setOrderDate] = useState("");
  const [remarks, setRemarks] = useState("");
  const [orderFile, setOrderFile] = useState<File | null>(null);
  const [fieldErrors, setFieldErrors] = useState<PostingFieldErrors>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<{ id: string; requestNo: string } | null>(null);

  const { data: ctx, isLoading, isError } = useQuery<PostingContext>({
    queryKey: ["/api/hr/employees", employeeId, "posting-update-context"],
    queryFn: async () => {
      const res = await fetch(`/api/hr/employees/${encodeURIComponent(employeeId!)}/posting-update-context`, {
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? res.statusText);
      }
      return res.json();
    },
    enabled: Boolean(employeeId),
  });

  const yardById = useMemo(() => {
    const map: Record<string, YardOption> = {};
    for (const y of ctx?.yards ?? []) map[y.id] = y;
    return map;
  }, [ctx?.yards]);

  const heldYardIds = useMemo(() => {
    const set = new Set<string>();
    if (ctx?.yardId) set.add(ctx.yardId);
    for (const c of ctx?.additionalCharges ?? []) set.add(c.yardId);
    return set;
  }, [ctx]);

  const clearLocationSelection = () => {
    setNewYardId("");
    setNewSection("");
    setNewRoId("");
    setAdditionalYardIds([]);
    setHoSectionByYardId({});
    setWithdrawYardIds([]);
    setFieldErrors({});
  };

  const switchChangeType = (t: PostingChangeType) => {
    setChangeType(t);
    clearLocationSelection();
  };

  const buildSubmitPayload = () => {
    const payload: Record<string, unknown> = {
      changeType,
      effectiveFrom: effectiveFrom.trim() || null,
      orderNo: orderNo.trim() || null,
      orderDate: orderDate.trim() || null,
      remarks: remarks.trim() || null,
    };
    if (changeType === "Transfer") {
      payload.newYardId = newYardId || null;
      payload.newSection = newSection.trim() || null;
      payload.newReportingOfficerEmployeeId = newRoId || null;
    } else if (changeType === "AssignAdditionalCharge") {
      payload.additionalYardIds = additionalYardIds;
      payload.hoSectionByYardId = hoSectionByYardId;
    } else if (changeType === "WithdrawAdditionalCharge") {
      payload.withdrawYardIds = withdrawYardIds;
    } else if (changeType === "ChangeReportingOfficer") {
      payload.newReportingOfficerEmployeeId = newRoId || null;
    }
    return payload;
  };

  const runClientValidate = (): PostingFieldErrors => {
    const errors = validatePostingSubmit(
      {
        changeType,
        newYardId: newYardId || null,
        newSection: newSection || null,
        newReportingOfficerEmployeeId: newRoId || null,
        additionalYardIds,
        hoSectionByYardId,
        withdrawYardIds,
        effectiveFrom,
        orderNo,
        orderDate,
        remarks,
      },
      {
        todayYmd: today,
        isHeadOfficeYardId: (yid) => Boolean(yardById[yid]?.isHeadOffice),
      },
    );
    setFieldErrors(errors);
    return errors;
  };

  const doSubmit = async () => {
    if (!employeeId) return;
    let orderMeta: {
      orderCopyBlobKey?: string;
      orderCopyFileName?: string;
      orderCopyMimeType?: string;
      orderCopySizeBytes?: number;
    } = {};
    if (orderFile) {
      const fd = new FormData();
      fd.append("file", orderFile);
      const up = await fetch(
        `/api/hr/employees/${encodeURIComponent(employeeId)}/posting-updates/order-copy`,
        { method: "POST", credentials: "include", body: fd },
      );
      if (!up.ok) {
        const err = await up.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "Order copy upload failed");
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
    const res = await fetch(`/api/hr/employees/${encodeURIComponent(employeeId)}/posting-updates`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...buildSubmitPayload(), ...orderMeta }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const fe = (err as { details?: { fieldErrors?: PostingFieldErrors } }).details?.fieldErrors;
      if (fe) setFieldErrors(fe);
      throw new Error((err as { error?: string }).error ?? res.statusText);
    }
    const row = (await res.json()) as { id: string; requestNo: string };
    setConfirmOpen(false);
    setSuccess({ id: row.id, requestNo: row.requestNo });
    queryClient.invalidateQueries({ queryKey: ["/api/hr/employees", employeeId, "posting-update-context"] });
    queryClient.invalidateQueries({ queryKey: ["/api/hr/posting-updates"] });
    toast({ title: "Posting update submitted", description: row.requestNo });
  };

  const handleReview = () => {
    const errors = runClientValidate();
    if (Object.keys(errors).length > 0) {
      toast({ title: "Fix validation errors", description: "Required fields are highlighted.", variant: "destructive" });
      return;
    }
    setConfirmOpen(true);
  };

  const handleConfirmSubmit = async () => {
    setSubmitting(true);
    try {
      await doSubmit();
    } catch (e) {
      toast({
        title: "Submit failed",
        description: e instanceof Error ? e.message : "Failed",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const resetForAnother = () => {
    setSuccess(null);
    clearLocationSelection();
    setEffectiveFrom("");
    setOrderNo("");
    setOrderDate("");
    setRemarks("");
    setOrderFile(null);
    setChangeType("Transfer");
  };

  const beforePreview = useMemo(() => {
    if (!ctx) return "";
    const charges =
      ctx.additionalCharges.length > 0
        ? ctx.additionalCharges
            .map((c) => `${c.yardName}${c.section ? ` (${c.section})` : ""}${c.from ? ` from ${formatYmdToDisplay(c.from)}` : ""}`)
            .join("; ")
        : "None";
    const ro = ctx.reportingOfficer
      ? `${ctx.reportingOfficer.name}${ctx.reportingOfficer.empId ? ` (${ctx.reportingOfficer.empId})` : ""}`
      : "—";
    return [
      `Primary: ${ctx.yardName}${ctx.section ? ` — ${ctx.section}` : ""}`,
      `Additional charges: ${charges}`,
      `Reporting officer: ${ro}`,
    ].join("\n");
  }, [ctx]);

  const afterPreview = useMemo(() => {
    if (!ctx) return "";
    if (changeType === "Transfer") {
      const y = yardById[newYardId];
      const loc = y ? yardLabel(y) : "—";
      const sec = y?.isHeadOffice && newSection ? ` — ${newSection}` : "";
      return [
        `Primary: ${loc}${sec}`,
        `Additional charges: (unchanged)`,
        `Reporting officer: ${newRoId ? "(selected)" : "—"}`,
      ].join("\n");
    }
    if (changeType === "AssignAdditionalCharge") {
      const labels = additionalYardIds.map((id) => {
        const y = yardById[id];
        const sec = hoSectionByYardId[id];
        return `${y ? yardLabel(y) : id}${sec ? ` (${sec})` : ""}`;
      });
      const existing =
        ctx.additionalCharges.length > 0
          ? ctx.additionalCharges.map((c) => c.yardName).join("; ")
          : "None";
      return [
        `Primary: ${ctx.yardName} (unchanged)`,
        `Additional charges: ${existing}${labels.length ? `; + ${labels.join("; ")}` : ""}`,
        `Reporting officer: (unchanged)`,
      ].join("\n");
    }
    if (changeType === "WithdrawAdditionalCharge") {
      const remaining = ctx.additionalCharges
        .filter((c) => !withdrawYardIds.includes(c.yardId))
        .map((c) => c.yardName);
      return [
        `Primary: ${ctx.yardName} (unchanged)`,
        `Additional charges: ${remaining.length ? remaining.join("; ") : "None"}`,
        `Reporting officer: (unchanged)`,
      ].join("\n");
    }
    return [
      `Primary: ${ctx.yardName} (unchanged)`,
      `Additional charges: (unchanged)`,
      `Reporting officer: ${newRoId ? "(selected)" : "—"}`,
    ].join("\n");
  }, [ctx, changeType, newYardId, newSection, newRoId, additionalYardIds, hoSectionByYardId, withdrawYardIds, yardById]);

  const serviceBookPreview = useMemo(() => {
    if (!ctx) return "";
    const typeLabel = postingServiceBookTypeLabel(changeType);
    if (changeType === "Transfer") {
      const y = yardById[newYardId];
      return `${typeLabel}: Primary place of posting changed from ${ctx.yardName} to ${y ? yardLabel(y) : "—"}.`;
    }
    if (changeType === "AssignAdditionalCharge") {
      const labels = additionalYardIds.map((id) => {
        const y = yardById[id];
        const sec = hoSectionByYardId[id];
        return `${y ? yardLabel(y) : id}${sec ? ` (${sec})` : ""}`;
      });
      const list =
        labels.length > 1 ? `${labels.slice(0, -1).join(", ")} and ${labels.slice(-1)[0]}` : labels[0] ?? "—";
      return `${typeLabel}: Additional charge of ${list} assigned, in addition to ${ctx.yardName}.`;
    }
    if (changeType === "WithdrawAdditionalCharge") {
      const labels = withdrawYardIds.map((id) => {
        const c = ctx.additionalCharges.find((x) => x.yardId === id);
        if (c) return c.yardName;
        const y = yardById[id];
        return y ? yardLabel(y) : id;
      });
      const list =
        labels.length > 1 ? `${labels.slice(0, -1).join(", ")} and ${labels.slice(-1)[0]}` : labels[0] ?? "—";
      return `${typeLabel}: Additional charge of ${list} withdrawn.`;
    }
    return `${typeLabel}: Reporting officer changed. Primary location (${ctx.yardName}) and additional charge unchanged.`;
  }, [ctx, changeType, newYardId, additionalYardIds, hoSectionByYardId, withdrawYardIds, yardById]);

  useEffect(() => {
    if (!employeeId) setLocation("/hr/employees");
  }, [employeeId, setLocation]);

  if (!canAct) return <AccessDenied />;
  if (!employeeId) return null;

  if (isLoading || !ctx) {
    return (
      <AppShell breadcrumbs={[{ label: "HR", href: "/hr/employees" }, { label: "Posting update" }]}>
        <Card>
          <CardContent className="p-6">
            <Skeleton className="h-8 w-64 mb-4" />
            <Skeleton className="h-48 w-full" />
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "HR", href: "/hr/employees" }, { label: "Posting update" }]}>
        <Card className="border-destructive/30">
          <CardContent className="p-6 flex items-center gap-2 text-destructive">
            <AlertCircle className="h-5 w-5" /> Failed to load posting context.
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  const openBlocks = Boolean(ctx.openRequest);
  const hoOptions = ctx.hoSectionOptions?.length ? ctx.hoSectionOptions : [...HO_SECTION_OPTIONS];

  if (success) {
    return (
      <AppShell
        breadcrumbs={[
          { label: "HR", href: "/hr/employees" },
          { label: ctx.employee.name, href: `/hr/employees/${employeeId}` },
          { label: "Posting update" },
        ]}
      >
        <Card>
          <CardContent className="p-8 space-y-4 text-center">
            <CheckCircle2 className="h-12 w-12 text-green-600 mx-auto" />
            <h2 className="text-xl font-semibold">Request submitted</h2>
            <p className="text-muted-foreground">
              Request no. <span className="font-mono font-medium text-foreground">{success.requestNo}</span>
            </p>
            <div className="flex flex-wrap justify-center gap-2 pt-2">
              <Button asChild>
                <Link href={`/hr/posting-updates/${success.id}`}>Open request</Link>
              </Button>
              <Button variant="outline" onClick={resetForAnother}>
                Enter another action
              </Button>
              <Button variant="ghost" asChild>
                <Link href={`/hr/employees/${employeeId}`}>Back to employee</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell
      breadcrumbs={[
        { label: "HR", href: "/hr/employees" },
        { label: ctx.employee.name, href: `/hr/employees/${employeeId}` },
        { label: "Posting update" },
      ]}
    >
      <div className="space-y-4">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <MapPin className="h-5 w-5" />
                {ctx.employee.name}
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                {ctx.employee.empId ?? "—"} · {ctx.employee.designation}
              </p>
              <p className="text-sm mt-2 whitespace-pre-line text-muted-foreground">{beforePreview}</p>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <Link href={`/hr/employees/${employeeId}`}>
                <ArrowLeft className="h-4 w-4 mr-1" /> Back
              </Link>
            </Button>
          </CardHeader>
        </Card>

        {openBlocks && ctx.openRequest ? (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
            An open posting update exists (
            <Link href={`/hr/posting-updates/${ctx.openRequest.id}`} className="font-medium text-primary underline">
              {ctx.openRequest.requestNo}
            </Link>
            , {ctx.openRequest.status}). Complete or resolve it before submitting a new one.
          </div>
        ) : null}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">1. What is changing</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {POSTING_CHANGE_TYPES.map((t) => (
                  <button
                    key={t}
                    type="button"
                    disabled={openBlocks}
                    onClick={() => switchChangeType(t)}
                    className={cn(
                      "rounded-md border p-3 text-left text-sm transition-colors",
                      changeType === t ? "border-primary bg-primary/5" : "hover:bg-muted/50",
                      openBlocks && "opacity-60 cursor-not-allowed",
                    )}
                  >
                    <div className="font-medium">{postingChangeTypeLabel(t)}</div>
                  </button>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">2. Posting details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {changeType === "Transfer" && (
                  <>
                    <div className="space-y-2">
                      <Label>New primary location *</Label>
                      <Select
                        value={newYardId || undefined}
                        onValueChange={(v) => {
                          setNewYardId(v);
                          const y = yardById[v];
                          if (!y?.isHeadOffice) setNewSection("");
                        }}
                        disabled={openBlocks}
                      >
                        <SelectTrigger className={errBorder(Boolean(fieldErrors.newYardId))}>
                          <SelectValue placeholder="Select location" />
                        </SelectTrigger>
                        <SelectContent>
                          {(ctx.yards ?? [])
                            .filter((y) => y.id !== ctx.yardId)
                            .map((y) => (
                              <SelectItem key={y.id} value={y.id}>
                                {yardLabel(y)}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                      {fieldErrors.newYardId ? (
                        <p className="text-xs text-destructive">{fieldErrors.newYardId}</p>
                      ) : null}
                    </div>
                    {yardById[newYardId]?.isHeadOffice ? (
                      <div className="space-y-2">
                        <Label>Section (HO) *</Label>
                        <Select value={newSection || undefined} onValueChange={setNewSection} disabled={openBlocks}>
                          <SelectTrigger className={errBorder(Boolean(fieldErrors.newSection))}>
                            <SelectValue placeholder="Select section" />
                          </SelectTrigger>
                          <SelectContent>
                            {hoOptions.map((s) => (
                              <SelectItem key={s} value={s}>
                                {s}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {fieldErrors.newSection ? (
                          <p className="text-xs text-destructive">{fieldErrors.newSection}</p>
                        ) : null}
                      </div>
                    ) : null}
                    <div className="space-y-2">
                      <Label>Reporting officer *</Label>
                      <EmployeeSearchSelect
                        value={newRoId}
                        onValueChange={setNewRoId}
                        excludeId={employeeId}
                        disabled={openBlocks}
                        placeholder="Select reporting officer"
                        className={errBorder(Boolean(fieldErrors.newReportingOfficerEmployeeId))}
                      />
                      {fieldErrors.newReportingOfficerEmployeeId ? (
                        <p className="text-xs text-destructive">{fieldErrors.newReportingOfficerEmployeeId}</p>
                      ) : null}
                    </div>
                  </>
                )}

                {changeType === "AssignAdditionalCharge" && (
                  <div className="space-y-3">
                    <Label>Locations to assign *</Label>
                    {fieldErrors.additionalYardIds ? (
                      <p className="text-xs text-destructive">{fieldErrors.additionalYardIds}</p>
                    ) : null}
                    <div
                      className={cn(
                        "max-h-56 overflow-y-auto rounded-md border p-3 space-y-2",
                        fieldErrors.additionalYardIds && "border-destructive",
                      )}
                    >
                      {(ctx.yards ?? [])
                        .filter((y) => !heldYardIds.has(y.id))
                        .map((y) => {
                          const checked = additionalYardIds.includes(y.id);
                          return (
                            <div key={y.id} className="space-y-1">
                              <label className="flex items-center gap-2 text-sm cursor-pointer">
                                <Checkbox
                                  checked={checked}
                                  disabled={openBlocks}
                                  onCheckedChange={(v) => {
                                    const on = v === true;
                                    setAdditionalYardIds((prev) =>
                                      on ? [...prev.filter((x) => x !== y.id), y.id] : prev.filter((x) => x !== y.id),
                                    );
                                    if (!on) {
                                      setHoSectionByYardId((prev) => {
                                        const next = { ...prev };
                                        delete next[y.id];
                                        return next;
                                      });
                                    }
                                  }}
                                />
                                <span>{yardLabel(y)}</span>
                                {y.isHeadOffice ? (
                                  <Badge variant="outline" className="text-xs">
                                    HO
                                  </Badge>
                                ) : null}
                              </label>
                              {checked && y.isHeadOffice ? (
                                <div className="pl-6">
                                  <Select
                                    value={hoSectionByYardId[y.id] || undefined}
                                    onValueChange={(v) =>
                                      setHoSectionByYardId((prev) => ({ ...prev, [y.id]: v }))
                                    }
                                    disabled={openBlocks}
                                  >
                                    <SelectTrigger
                                      className={errBorder(Boolean(fieldErrors[`hoSection_${y.id}`]))}
                                    >
                                      <SelectValue placeholder="HO section" />
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
                            </div>
                          );
                        })}
                      {(ctx.yards ?? []).filter((y) => !heldYardIds.has(y.id)).length === 0 ? (
                        <p className="text-xs text-muted-foreground">No locations available to assign.</p>
                      ) : null}
                    </div>
                  </div>
                )}

                {changeType === "WithdrawAdditionalCharge" && (
                  <div className="space-y-3">
                    <Label>Charges to withdraw *</Label>
                    {fieldErrors.withdrawYardIds ? (
                      <p className="text-xs text-destructive">{fieldErrors.withdrawYardIds}</p>
                    ) : null}
                    <div
                      className={cn(
                        "rounded-md border p-3 space-y-2",
                        fieldErrors.withdrawYardIds && "border-destructive",
                      )}
                    >
                      {ctx.additionalCharges.map((c) => (
                        <label key={c.yardId} className="flex items-center gap-2 text-sm cursor-pointer">
                          <Checkbox
                            checked={withdrawYardIds.includes(c.yardId)}
                            disabled={openBlocks}
                            onCheckedChange={(v) => {
                              const on = v === true;
                              setWithdrawYardIds((prev) =>
                                on
                                  ? [...prev.filter((x) => x !== c.yardId), c.yardId]
                                  : prev.filter((x) => x !== c.yardId),
                              );
                            }}
                          />
                          <span>
                            {c.yardName}
                            {c.section ? ` (${c.section})` : ""}
                            {c.from ? ` — from ${formatYmdToDisplay(c.from)}` : ""}
                          </span>
                        </label>
                      ))}
                      {ctx.additionalCharges.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No additional charges to withdraw.</p>
                      ) : null}
                    </div>
                  </div>
                )}

                {changeType === "ChangeReportingOfficer" && (
                  <>
                    <div className="space-y-2">
                      <Label>Primary location</Label>
                      <Input
                        value={`${ctx.yardName}${ctx.section ? ` — ${ctx.section}` : ""}`}
                        readOnly
                        className="bg-muted"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>New reporting officer *</Label>
                      <EmployeeSearchSelect
                        value={newRoId}
                        onValueChange={setNewRoId}
                        excludeId={employeeId}
                        excludeIds={ctx.reportingOfficer?.id ? [ctx.reportingOfficer.id] : []}
                        disabled={openBlocks}
                        placeholder="Select reporting officer"
                        className={errBorder(Boolean(fieldErrors.newReportingOfficerEmployeeId))}
                      />
                      {ctx.reportingOfficer ? (
                        <p className="text-xs text-muted-foreground">
                          Current: {ctx.reportingOfficer.name}
                          {ctx.reportingOfficer.empId ? ` (${ctx.reportingOfficer.empId})` : ""}
                        </p>
                      ) : null}
                      {fieldErrors.newReportingOfficerEmployeeId ? (
                        <p className="text-xs text-destructive">{fieldErrors.newReportingOfficerEmployeeId}</p>
                      ) : null}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">3. Order details</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{effectiveFromLabel(changeType)} *</Label>
                  <Input
                    type="date"
                    max={today}
                    value={effectiveFrom}
                    onChange={(e) => setEffectiveFrom(e.target.value)}
                    disabled={openBlocks}
                    className={errBorder(Boolean(fieldErrors.effectiveFrom))}
                  />
                  {fieldErrors.effectiveFrom ? (
                    <p className="text-xs text-destructive">{fieldErrors.effectiveFrom}</p>
                  ) : null}
                </div>
                <div className="space-y-2">
                  <Label>
                    Order number
                    {changeType !== "ChangeReportingOfficer" ? " *" : " (optional)"}
                  </Label>
                  <Input
                    value={orderNo}
                    onChange={(e) => setOrderNo(e.target.value)}
                    disabled={openBlocks}
                    className={errBorder(Boolean(fieldErrors.orderNo))}
                  />
                  {fieldErrors.orderNo ? (
                    <p className="text-xs text-destructive">{fieldErrors.orderNo}</p>
                  ) : null}
                </div>
                <div className="space-y-2">
                  <Label>
                    Order date
                    {changeType !== "ChangeReportingOfficer" ? " *" : " (optional)"}
                  </Label>
                  <Input
                    type="date"
                    max={today}
                    value={orderDate}
                    onChange={(e) => setOrderDate(e.target.value)}
                    disabled={openBlocks}
                    className={errBorder(Boolean(fieldErrors.orderDate))}
                  />
                  {fieldErrors.orderDate ? (
                    <p className="text-xs text-destructive">{fieldErrors.orderDate}</p>
                  ) : null}
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>Remarks</Label>
                  <Textarea
                    value={remarks}
                    onChange={(e) => setRemarks(e.target.value)}
                    disabled={openBlocks}
                    rows={3}
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>Order copy (PDF/image, optional)</Label>
                  <Input
                    type="file"
                    accept="application/pdf,image/png,image/jpeg,image/webp"
                    disabled={openBlocks}
                    onChange={(e) => setOrderFile(e.target.files?.[0] ?? null)}
                  />
                  {orderFile ? (
                    <p className="text-xs text-muted-foreground">Selected: {orderFile.name}</p>
                  ) : null}
                </div>
              </CardContent>
            </Card>

            <div className="flex justify-end gap-2">
              <Button variant="outline" asChild>
                <Link href={`/hr/employees/${employeeId}`}>Cancel</Link>
              </Button>
              <Button onClick={handleReview} disabled={openBlocks || submitting}>
                Review &amp; submit
              </Button>
            </div>
          </div>

          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Before / after</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Before</p>
                  <pre className="mt-1 whitespace-pre-wrap font-sans text-sm">{beforePreview}</pre>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">After</p>
                  <pre className="mt-1 whitespace-pre-wrap font-sans text-sm">{afterPreview}</pre>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Service book particulars</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{serviceBookPreview}</p>
                {effectiveFrom ? (
                  <p className="text-xs text-muted-foreground mt-2">
                    Effective: {formatYmdToDisplay(effectiveFrom)}
                    {orderNo ? ` · Order ${orderNo}` : ""}
                    {orderDate ? ` dated ${formatYmdToDisplay(orderDate)}` : ""}
                  </p>
                ) : null}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm submission</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <p>
              Submit <span className="font-medium">{postingChangeTypeLabel(changeType)}</span> for{" "}
              <span className="font-medium">{ctx.employee.name}</span>?
            </p>
            <pre className="whitespace-pre-wrap rounded-md bg-muted/50 p-3 font-sans text-xs">{afterPreview}</pre>
            <p className="text-muted-foreground">The request will go to Pending Verification (DV).</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={submitting}>
              Back
            </Button>
            <Button onClick={handleConfirmSubmit} disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Confirm &amp; submit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
