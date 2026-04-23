import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { ClientDataGrid } from "@/components/reports/ClientDataGrid";
import type { ReportTableColumn } from "@/components/reports/ReportDataTable";
import { AlertCircle, CalendarDays, CheckCircle, SendHorizontal, ShieldCheck, Trash2 } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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
import { MIN_WORKFLOW_REMARKS_LENGTH } from "@shared/workflow-rejection";
import { DEFAULT_RENT_REVISION_BASIS, type RentRevisionBasis } from "@shared/rent-revision-basis";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface RevisionRow {
  id: string;
  allotmentId: string;
  effectiveMonth: string;
  rentAmount: number;
  revisionBasis?: string | null;
  remarks?: string | null;
  status?: string | null;
  doUser?: string | null;
  dvUser?: string | null;
  daUser?: string | null;
  verifiedAt?: string | null;
  approvedAt?: string | null;
  workflowRevisionCount?: number | null;
  dvReturnRemarks?: string | null;
  createdAt?: string | null;
  createdBy?: string | null;
}
interface AllotmentRef {
  id: string;
  assetId: string;
  traderLicenceId: string;
  status: string;
}
interface AssetRef {
  id: string;
  assetId: string;
}

interface RentContextResponse {
  allotmentId: string;
  effectiveMonth: string | null;
  referenceMonth: string;
  resolvedRent: number;
  source: string;
  matchedRevisionId: string | null;
  matchedInvoiceId: string | null;
}

const REVISION_BASIS_LABEL: Record<string, string> = {
  FixedMonthlyRent: "Fixed monthly (INR)",
  OtherDocumented: "Other / documented",
};

const columns: ReportTableColumn[] = [
  { key: "effectiveMonth", header: "Effective month", sortField: "effectiveMonth" },
  { key: "allotmentId", header: "Allotment" },
  { key: "assetLabel", header: "Asset" },
  { key: "_status", header: "Status" },
  { key: "_basis", header: "Basis" },
  { key: "_rent", header: "Rent amount" },
  { key: "remarks", header: "Remarks" },
  { key: "_actions", header: "Actions" },
];

export default function RentRevisions() {
  const { toast } = useToast();
  const { user } = useAuth();
  const qc = useQueryClient();
  const roles = user?.roles?.map((r) => r.tier) ?? [];
  const canVerify = roles.includes("DV") || roles.includes("ADMIN");
  const canApprove = roles.includes("DA") || roles.includes("ADMIN");
  const isAdmin = roles.includes("ADMIN");

  const { data: revisions = [], isLoading, isError } = useQuery<RevisionRow[]>({ queryKey: ["/api/ioms/rent/revisions"] });
  const { data: allotments = [] } = useQuery<AllotmentRef[]>({ queryKey: ["/api/ioms/asset-allotments"] });
  const { data: assets = [] } = useQuery<AssetRef[]>({ queryKey: ["/api/ioms/assets"] });
  const { data: systemConfig = {} } = useQuery<Record<string, string>>({
    queryKey: ["/api/system/config"],
  });
  const assetLabelById = useMemo(() => Object.fromEntries(assets.map((a) => [a.id, a.assetId])), [assets]);
  const allotmentById = useMemo(() => Object.fromEntries(allotments.map((a) => [a.id, a])), [allotments]);

  const [draft, setDraft] = useState({
    allotmentId: "",
    effectiveMonth: "",
    rentAmount: "",
    remarks: "",
    revisionBasis: DEFAULT_RENT_REVISION_BASIS,
  });
  const [sendBackOpen, setSendBackOpen] = useState(false);
  const [sendBackForId, setSendBackForId] = useState<string | null>(null);
  const [returnRemarks, setReturnRemarks] = useState("");
  const [percentAdjust, setPercentAdjust] = useState("");
  const percentPrefillApplied = useRef(false);

  const allotmentIdTrim = draft.allotmentId.trim();

  useEffect(() => {
    if (percentPrefillApplied.current) return;
    const raw = String(systemConfig.rent_revision_suggested_percent ?? "").trim();
    if (!raw || raw === "0") return;
    const p = Number(raw);
    if (!Number.isFinite(p) || p <= 0) return;
    setPercentAdjust(String(p));
    percentPrefillApplied.current = true;
  }, [systemConfig]);
  const {
    data: rentCtx,
    isLoading: rentCtxLoading,
    isError: rentCtxError,
    error: rentCtxErrObj,
  } = useQuery<RentContextResponse>({
    queryKey: ["rent-allotment-rent-context", allotmentIdTrim, draft.effectiveMonth.trim()],
    enabled: allotmentIdTrim.length > 0,
    queryFn: async (): Promise<RentContextResponse> => {
      let u = `/api/ioms/rent/allotments/${encodeURIComponent(allotmentIdTrim)}/rent-context`;
      if (/^\d{4}-\d{2}$/.test(draft.effectiveMonth.trim())) {
        u += `?effectiveMonth=${encodeURIComponent(draft.effectiveMonth.trim())}`;
      }
      const res = await fetch(u, { credentials: "include" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j as { message?: string }).message ?? res.statusText);
      }
      return (await res.json()) as RentContextResponse;
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/ioms/rent/revisions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          allotmentId: draft.allotmentId.trim(),
          effectiveMonth: draft.effectiveMonth.trim(),
          rentAmount: Number(draft.rentAmount),
          revisionBasis: draft.revisionBasis,
          remarks: draft.remarks.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText);
      return data as RevisionRow;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/ioms/rent/revisions"] });
      setDraft({
        allotmentId: "",
        effectiveMonth: "",
        rentAmount: "",
        remarks: "",
        revisionBasis: DEFAULT_RENT_REVISION_BASIS,
      });
      toast({ title: "Saved", description: "Rent revision draft created." });
    },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async (args: { id: string; body: Record<string, unknown> }) => {
      const res = await fetch(`/api/ioms/rent/revisions/${encodeURIComponent(args.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(args.body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText);
      return data as RevisionRow;
    },
    onSuccess: (_, args) => {
      qc.invalidateQueries({ queryKey: ["/api/ioms/rent/revisions"] });
      const st = args.body.status != null ? String(args.body.status) : "Updated";
      toast({ title: "Saved", description: `Revision ${st}.` });
      setSendBackOpen(false);
      setSendBackForId(null);
      setReturnRemarks("");
    },
    onError: (e: Error) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/ioms/rent/revisions/${encodeURIComponent(id)}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? res.statusText);
      }
      return true;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/ioms/rent/revisions"] });
      toast({ title: "Deleted", description: "Draft revision deleted." });
    },
    onError: (e: Error) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  const rows = useMemo((): Record<string, unknown>[] => {
    return (revisions ?? []).map((r) => {
      const all = allotmentById[r.allotmentId];
      const assetLabel = all ? (assetLabelById[all.assetId] ?? all.assetId) : "—";
      const st = String(r.status ?? "Draft");
      const isDraft = st === "Draft";
      const isVerified = st === "Verified";
      const doUid = r.doUser ?? r.createdBy;
      const mineDraft = Boolean(user?.id && doUid === user.id);

      const canDoVerify = canVerify && isDraft;
      const canDoApprove = canApprove && isVerified;
      const canSendBack = canVerify && isVerified;
      const canDeleteDraft = isDraft && (isAdmin || mineDraft);

      const statusBadge =
        st === "Approved" ? (
          <Badge variant="default" className="font-normal">
            Approved
          </Badge>
        ) : st === "Verified" ? (
          <Badge variant="secondary" className="font-normal">
            Verified
          </Badge>
        ) : (
          <Badge variant="outline" className="font-normal">
            Draft
          </Badge>
        );

      return {
        ...r,
        assetLabel,
        _status: statusBadge,
        _basis: REVISION_BASIS_LABEL[String(r.revisionBasis ?? "FixedMonthlyRent")] ?? String(r.revisionBasis ?? "—"),
        _rent: `₹${Number(r.rentAmount ?? 0).toLocaleString()}`,
        _actions: (
          <div className="flex flex-wrap gap-1 justify-end">
            {canDoVerify && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-2"
                onClick={() => updateMutation.mutate({ id: r.id, body: { status: "Verified" } })}
                disabled={updateMutation.isPending}
                title="Verify (DV)"
              >
                <ShieldCheck className="h-4 w-4" />
              </Button>
            )}
            {canDoApprove && (
              <Button
                size="sm"
                className="h-8 px-2"
                onClick={() => updateMutation.mutate({ id: r.id, body: { status: "Approved" } })}
                disabled={updateMutation.isPending}
                title="Approve (DA)"
              >
                <CheckCircle className="h-4 w-4" />
              </Button>
            )}
            {canSendBack && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-2"
                onClick={() => {
                  setSendBackForId(r.id);
                  setReturnRemarks("");
                  setSendBackOpen(true);
                }}
                disabled={updateMutation.isPending}
                title="Send back to Draft (DV)"
              >
                <SendHorizontal className="h-4 w-4" />
              </Button>
            )}
            {canDeleteDraft && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2"
                onClick={() => deleteMutation.mutate(r.id)}
                disabled={deleteMutation.isPending}
                title="Delete draft"
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            )}
          </div>
        ),
      };
    });
  }, [revisions, allotmentById, assetLabelById, deleteMutation, updateMutation, canVerify, canApprove, isAdmin, user?.id]);

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "Rent (IOMS)", href: "/rent/ioms" }, { label: "Rent revisions" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Failed to load rent revisions.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  const canCreate =
    Boolean(
      draft.allotmentId.trim() &&
        /^\d{4}-\d{2}$/.test(draft.effectiveMonth.trim()) &&
        Number.isFinite(Number(draft.rentAmount)) &&
        (draft.revisionBasis !== "OtherDocumented" || draft.remarks.trim().length >= 20),
    );

  return (
    <AppShell breadcrumbs={[{ label: "Rent (IOMS)", href: "/rent/ioms" }, { label: "Rent revisions (Sr.17)" }]}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5" />
            Rent revision overrides
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            DO creates a <span className="font-medium text-foreground">Draft</span>; DV verifies; DA approves. Only{" "}
            <span className="font-medium text-foreground">Approved</span> revisions affect monthly auto-generated Draft invoices and new manual invoice rent
            defaults.
            <span className="block mt-1">
              <span className="font-medium text-foreground">Revision basis</span> records SRS intent; billing still uses the
              approved <span className="font-mono">rent_amount</span> as INR/month. Baseline rent for an allotment matches
              invoice/cron resolution (GET{" "}
              <span className="font-mono">/api/ioms/rent/allotments/:id/rent-context</span>
              ); you can apply a percentage to pre-fill the new rent.
            </span>
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
            <div className="space-y-1">
              <Label>Allotment ID</Label>
              <Input value={draft.allotmentId} onChange={(e) => setDraft((s) => ({ ...s, allotmentId: e.target.value }))} placeholder="asset_allotments.id" />
            </div>
            <div className="space-y-1">
              <Label>Effective month</Label>
              <Input value={draft.effectiveMonth} onChange={(e) => setDraft((s) => ({ ...s, effectiveMonth: e.target.value }))} placeholder="YYYY-MM" />
            </div>
            <div className="space-y-1">
              <Label>Revision basis</Label>
              <Select
                value={draft.revisionBasis}
                onValueChange={(v) =>
                  setDraft((s) => ({ ...s, revisionBasis: v as RentRevisionBasis }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="FixedMonthlyRent">{REVISION_BASIS_LABEL.FixedMonthlyRent}</SelectItem>
                  <SelectItem value="OtherDocumented">{REVISION_BASIS_LABEL.OtherDocumented}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Rent amount</Label>
              <Input value={draft.rentAmount} onChange={(e) => setDraft((s) => ({ ...s, rentAmount: e.target.value }))} placeholder="e.g. 2500" />
            </div>
            <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending || !canCreate}>
              Create draft
            </Button>
            {allotmentIdTrim ? (
              rentCtxLoading ? (
                <div className="md:col-span-4">
                  <Skeleton className="h-20 w-full" />
                </div>
              ) : rentCtxError ? (
                <Alert variant="destructive" className="md:col-span-4">
                  <AlertTitle>Could not load rent context</AlertTitle>
                  <AlertDescription>{rentCtxErrObj instanceof Error ? rentCtxErrObj.message : "Request failed"}</AlertDescription>
                </Alert>
              ) : rentCtx ? (
                <Alert className="md:col-span-4">
                  <AlertTitle>Baseline rent (reference {rentCtx.referenceMonth})</AlertTitle>
                  <AlertDescription className="text-foreground space-y-3">
                    <p>
                      <span className="font-semibold tabular-nums">₹{Number(rentCtx.resolvedRent).toLocaleString()}</span>
                      {" — "}
                      <span className="capitalize">{rentCtx.source}</span>
                      {rentCtx.effectiveMonth ? (
                        <>
                          {" "}
                          (rent in force in the month before revision starts on{" "}
                          <span className="font-mono">{rentCtx.effectiveMonth}</span>)
                        </>
                      ) : (
                        <>
                          {" "}
                          (current UTC month; enter <span className="font-mono">effectiveMonth</span> to preview the prior
                          month&apos;s basis)
                        </>
                      )}
                    </p>
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">% change vs baseline</Label>
                        <Input
                          value={percentAdjust}
                          onChange={(e) => setPercentAdjust(e.target.value)}
                          placeholder="e.g. 10"
                          className="w-28"
                          inputMode="decimal"
                        />
                      </div>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="mb-0.5"
                        disabled={
                          !Number(rentCtx.resolvedRent) ||
                          !Number.isFinite(Number(percentAdjust)) ||
                          percentAdjust.trim() === ""
                        }
                        onClick={() => {
                          const pct = Number(percentAdjust);
                          const base = Number(rentCtx.resolvedRent);
                          const next = Math.round(base * (1 + pct / 100) * 100) / 100;
                          setDraft((s) => ({ ...s, rentAmount: String(next) }));
                        }}
                      >
                        Apply to rent amount
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      A positive default for this field can be set in Admin → Config as{" "}
                      <span className="font-mono">rent_revision_suggested_percent</span> (0 leaves the box empty).
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Plinth-area / rate-table engines and automatic ledger re-posting for invoices already issued are
                      not in this build — finance must handle any re-billing manually if required.
                    </p>
                  </AlertDescription>
                </Alert>
              ) : null
            ) : null}
            <div className="space-y-1 md:col-span-4">
              <Label>Remarks</Label>
              <Textarea
                value={draft.remarks}
                onChange={(e) => setDraft((s) => ({ ...s, remarks: e.target.value }))}
                placeholder={
                  draft.revisionBasis === "OtherDocumented"
                    ? "Required (min 20 characters) — cite order / file / rationale"
                    : "Optional note"
                }
              />
            </div>
          </div>

          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <ClientDataGrid
              columns={columns}
              sourceRows={rows}
              searchKeys={["effectiveMonth", "allotmentId", "remarks", "assetLabel", "status", "revisionBasis"]}
              searchPlaceholder="Search revisions…"
              defaultSortKey="effectiveMonth"
              defaultSortDir="desc"
              emptyMessage="No revisions."
            />
          )}
        </CardContent>
      </Card>

      <Dialog open={sendBackOpen} onOpenChange={setSendBackOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Send back to Draft</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            DV must record why the revision is returned (min {MIN_WORKFLOW_REMARKS_LENGTH} characters).
          </p>
          <div className="space-y-2">
            <Label htmlFor="rev-return-remarks">Return remarks</Label>
            <Textarea id="rev-return-remarks" value={returnRemarks} onChange={(e) => setReturnRemarks(e.target.value)} rows={4} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setSendBackOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={
                !sendBackForId || returnRemarks.trim().length < MIN_WORKFLOW_REMARKS_LENGTH || updateMutation.isPending
              }
              onClick={() => {
                if (!sendBackForId) return;
                updateMutation.mutate({
                  id: sendBackForId,
                  body: { status: "Draft", returnRemarks: returnRemarks.trim() },
                });
              }}
            >
              Send back
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
