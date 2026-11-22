import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useParams, useSearchParams } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { formatInr } from "@/lib/formatInr";
import { ymdToDmy } from "@/lib/premisesAgreementUi";
import {
  applyDerivedFields,
  calcAgreementEndDate,
  calcDamagesPerDay,
  calcRequiredDeposit,
  defaultLicenseeClause,
  defaultLicensorClause,
  extractLicenseeAddressFromClause,
  LEAVE_LICENCE_FORMAT_LABELS,
  type LeaveLicenceFormat,
  type LeaveLicenceSnapshot,
  validateLeaveLicenceSnapshot,
} from "@shared/leave-licence-agreement";

type Detail = {
  id: string;
  premisesAgreementId: string;
  allotmentRef: string;
  status: string;
  currentVersionNo: number;
  signedScanFile?: string | null;
  versions?: Array<{
    id: string;
    versionNo: number;
    kind: string;
    pdfFile?: string | null;
    generatedAt: string;
  }>;
  snapshot: LeaveLicenceSnapshot | null;
};

function statusBadge(status: string) {
  if (status === "Executed") return "bg-emerald-100 text-emerald-900 border-emerald-300";
  if (status === "Final") return "bg-sky-100 text-sky-900 border-sky-300";
  if (status === "Cancelled") return "bg-rose-100 text-rose-900 border-rose-300";
  return "bg-amber-50 text-amber-900 border-amber-300";
}

export default function LeaveLicenceAgreementGenerator() {
  const params = useParams<{ id?: string; premisesId?: string }>();
  const [searchParams] = useSearchParams();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const signedRef = useRef<HTMLInputElement>(null);
  const orderRef = useRef<HTMLInputElement>(null);

  const premisesFromQuery = useMemo(() => {
    return searchParams.get("premisesAgreementId") ?? params.premisesId ?? "";
  }, [searchParams, params.premisesId]);

  const [llaId, setLlaId] = useState(() => (params.id && params.id !== "new" ? params.id : ""));
  const [snap, setSnap] = useState<LeaveLicenceSnapshot | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelDate, setCancelDate] = useState(new Date().toISOString().slice(0, 10));
  const [cancelOrder, setCancelOrder] = useState("");
  const openAttempted = useRef(false);

  useEffect(() => {
    if (params.id && params.id !== "new" && params.id !== llaId) {
      setLlaId(params.id);
      openAttempted.current = false;
    }
  }, [params.id, llaId]);

  const openMut = useMutation({
    mutationFn: async (premisesAgreementId: string) => {
      const res = await fetch("/api/ioms/leave-licence-agreements/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ premisesAgreementId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error ?? res.statusText);
      return body as Detail;
    },
    onSuccess: (d) => {
      setLlaId(d.id);
      setSnap(d.snapshot);
      setLocation(`/assets/agreements/leave-licence/${d.id}`);
    },
    onError: (e: Error) => {
      openAttempted.current = false;
      toast({ title: "Cannot open generator", description: e.message, variant: "destructive" });
    },
  });

  const { data, isLoading } = useQuery<Detail>({
    queryKey: [`/api/ioms/leave-licence-agreements/${llaId}`],
    enabled: Boolean(llaId),
  });

  useEffect(() => {
    if (!llaId && premisesFromQuery && !openAttempted.current) {
      openAttempted.current = true;
      openMut.mutate(premisesFromQuery);
    }
    // openMut.mutate is stable enough; gate with openAttempted to avoid loops
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [llaId, premisesFromQuery]);

  useEffect(() => {
    if (!data?.snapshot) return;
    // After Final generate, keep server snapshot; while Draft, hydrate from server.
    if (data.status === "Draft" || data.status === "Executed" || data.status === "Cancelled") {
      setSnap(applyDerivedFields(data.snapshot));
    } else {
      setSnap((prev) => prev ?? applyDerivedFields(data.snapshot!));
    }
  }, [data?.id, data?.currentVersionNo, data?.status, data?.snapshot]);

  const locked = data?.status === "Executed" || data?.status === "Cancelled";
  const derived = snap ? applyDerivedFields(snap) : null;
  const issues = derived ? validateLeaveLicenceSnapshot(derived, { forFinal: false }) : [];
  const finalIssues = derived ? validateLeaveLicenceSnapshot(derived, { forFinal: true }) : [];
  const finalBlocked = finalIssues.some((i) => i.severity === "Block");

  const patch = (partial: Partial<LeaveLicenceSnapshot>) => {
    if (!snap || locked) return;
    let next = { ...snap, ...partial };
    if (partial.startDate != null || partial.termMonths != null) {
      const end =
        calcAgreementEndDate(partial.startDate ?? next.startDate, partial.termMonths ?? next.termMonths) ??
        next.endDate;
      next = { ...next, endDate: end };
    }
    if (partial.licensorSigningOfficer != null || partial.licensorMeetingNo != null || partial.licensorMeetingDate != null || partial.licensorResolutionNo != null || partial.licensorOfficeAddress != null) {
      next.licensorClause = defaultLicensorClause({
        signingOfficer: next.licensorSigningOfficer,
        meetingNo: next.licensorMeetingNo,
        meetingDate: next.licensorMeetingDate,
        resolutionNo: next.licensorResolutionNo,
        officeAddress: next.licensorOfficeAddress,
      });
    }
    if (
      partial.agreementFormat != null ||
      partial.traderOrEntityName != null ||
      partial.licenseeSignsInPerson != null ||
      partial.representativeName != null ||
      partial.representativeParentage != null ||
      partial.representativeAge != null ||
      partial.representativeAddress != null ||
      partial.representativeAuthority != null
    ) {
      // Format 2 office template uses the entity party block; Format 1 uses the trader person block.
      const asEntity = next.agreementFormat === "Format2";
      const preservedAddress =
        extractLicenseeAddressFromClause(next.licenseeClause) ||
        extractLicenseeAddressFromClause(snap.licenseeClause) ||
        undefined;
      next.licenseeClause = defaultLicenseeClause({
        name: next.traderOrEntityName,
        asEntity,
        address: preservedAddress,
        representative: asEntity
          ? {
              name: next.representativeName || "________",
              designation: "authorised signatory",
              authority: next.representativeAuthority || "________",
            }
          : next.licenseeSignsInPerson
            ? null
            : {
                name: next.representativeName,
                parentage: next.representativeParentage,
                ageYears: next.representativeAge,
                address: next.representativeAddress,
                authority: next.representativeAuthority,
              },
      });
    }
    setSnap(applyDerivedFields(next));
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/ioms/leave-licence-agreements/${llaId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ snapshot: derived }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error ?? res.statusText);
      return body as Detail;
    },
    onSuccess: (d) => {
      toast({ title: "Draft saved" });
      if (d.snapshot) setSnap(applyDerivedFields(d.snapshot));
      void qc.invalidateQueries({ queryKey: [`/api/ioms/leave-licence-agreements/${llaId}`] });
    },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const previewMut = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/ioms/leave-licence-agreements/${llaId}/preview-pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ snapshot: derived }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? res.statusText);
      }
      return res.blob();
    },
    onSuccess: (blob) => {
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
    },
    onError: (e: Error) => toast({ title: "Preview failed", description: e.message, variant: "destructive" }),
  });

  const generateMut = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/ioms/leave-licence-agreements/${llaId}/generate-final`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ snapshot: derived }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error ?? res.statusText);
      return body as Detail & { currentVersion?: { id: string } };
    },
    onSuccess: (d) => {
      toast({ title: "Final PDF generated" });
      void qc.invalidateQueries({ queryKey: [`/api/ioms/leave-licence-agreements/${llaId}`] });
      const ver = d.versions?.find((v) => v.versionNo === d.currentVersionNo);
      if (ver?.id) {
        window.open(`/api/ioms/leave-licence-agreements/${llaId}/pdf/${ver.id}`, "_blank", "noopener,noreferrer");
      }
    },
    onError: (e: Error) => toast({ title: "Generate failed", description: e.message, variant: "destructive" }),
  });

  const uploadMut = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/ioms/leave-licence-agreements/${llaId}/upload-signed`, {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error ?? res.statusText);
      return body;
    },
    onSuccess: () => {
      toast({ title: "Signed copy uploaded — agreement Executed" });
      void qc.invalidateQueries({ queryKey: [`/api/ioms/leave-licence-agreements/${llaId}`] });
    },
    onError: (e: Error) => toast({ title: "Upload failed", description: e.message, variant: "destructive" }),
  });

  const cancelMut = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.append("reason", cancelReason);
      fd.append("effectiveDate", cancelDate);
      fd.append("orderRef", cancelOrder);
      const f = orderRef.current?.files?.[0];
      if (f) fd.append("orderFile", f);
      const res = await fetch(`/api/ioms/leave-licence-agreements/${llaId}/cancel`, {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error ?? res.statusText);
      return body as Detail;
    },
    onSuccess: (d) => {
      toast({ title: "Cancelled — fresh draft created" });
      setCancelOpen(false);
      setLlaId(d.id);
      setSnap(d.snapshot);
      setLocation(`/assets/agreements/leave-licence/${d.id}`);
    },
    onError: (e: Error) => toast({ title: "Cancel failed", description: e.message, variant: "destructive" }),
  });

  if ((!llaId && openMut.isPending) || (llaId && isLoading) || !derived) {
    return (
      <AppShell breadcrumbs={[{ label: "Premises allocations", href: "/assets/agreements" }, { label: "Leave & Licence" }]}>
        <Skeleton className="h-64 w-full" />
      </AppShell>
    );
  }

  const requiredDep = calcRequiredDeposit(derived.totalRent, derived.depositMonths);
  const damages = calcDamagesPerDay(derived.totalRent, derived.damagesMultiplier);

  return (
    <AppShell
      breadcrumbs={[
        { label: "Premises allocations", href: "/assets/agreements" },
        {
          label: data?.allotmentRef ?? "Agreement",
          href: data?.premisesAgreementId ? `/assets/agreements/${data.premisesAgreementId}` : undefined,
        },
        { label: "Leave & Licence" },
      ]}
    >
      <div className="space-y-4 max-w-5xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold">Leave and licence agreement</h1>
              <Badge variant="outline" className={statusBadge(data?.status ?? "Draft")}>
                {data?.status === "Executed" ? "Executed · locked" : data?.status}
                {data?.currentVersionNo ? ` · v${data.currentVersionNo}` : ""}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              {derived.traderOrEntityName} · {derived.allotmentRef} · {derived.basis}
              {derived.basis === "Renewal" ? ` no. ${derived.renewalNo}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {data?.premisesAgreementId ? (
              <Button asChild variant="outline" size="sm">
                <Link href={`/assets/agreements/${data.premisesAgreementId}`}>Allotment</Link>
              </Button>
            ) : null}
          </div>
        </div>

        {issues.length > 0 && (
          <Alert>
            <AlertDescription className="text-sm space-y-1">
              {issues.map((i) => (
                <div key={`${i.id}-${i.message}`}>
                  {i.severity}: {i.message}
                </div>
              ))}
            </AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">1. Allotment (read-only)</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2 text-sm">
            <div>Basis: {derived.basis}</div>
            <div>Allotment ref.: {derived.allotmentRef}</div>
            <div>Licence / entity no.: {derived.licenceOrEntityNo || "—"}</div>
            <div>Renewal no.: {derived.renewalNo}</div>
            <div>Trader / entity: {derived.traderOrEntityName}</div>
            <div>Yard: {derived.yardName}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Agreement format (APMC office)</CardTitle>
            <p className="text-xs text-muted-foreground">
              Format 1 — Stall &amp; Godowns; Format 2 — Office. PDF page 1 prints on A4 stamp paper; remaining pages on Legal size.
            </p>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Format *</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                disabled={locked}
                value={derived.agreementFormat ?? "Format1"}
                onChange={(e) => {
                  const agreementFormat = e.target.value as LeaveLicenceFormat;
                  const purposeOfUse =
                    agreementFormat === "Format1"
                      ? derived.purposeOfUse?.includes("office")
                        ? "notified commodities/Agricultural input as a Trader"
                        : derived.purposeOfUse || "notified commodities/Agricultural input as a Trader"
                      : derived.purposeOfUse?.includes("commodities")
                        ? "office/Commercial purpose"
                        : derived.purposeOfUse || "office/Commercial purpose";
                  patch({
                    agreementFormat,
                    purposeOfUse,
                    // Format 2 party block is entity-style (registered office + authorised signatory).
                    licenseeSignsInPerson: agreementFormat === "Format1" ? derived.licenseeSignsInPerson : false,
                  });
                }}
              >
                {(Object.keys(LEAVE_LICENCE_FORMAT_LABELS) as LeaveLicenceFormat[]).map((k) => (
                  <option key={k} value={k}>
                    {LEAVE_LICENCE_FORMAT_LABELS[k]}
                  </option>
                ))}
              </select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">2. Premises (read-only)</CardTitle>
          </CardHeader>
          <CardContent className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-2">Premises</th>
                  <th className="py-2">Area</th>
                  <th className="py-2">Rent (excl. GST)</th>
                  <th className="py-2">Deposit share</th>
                </tr>
              </thead>
              <tbody>
                {derived.premises.map((p) => (
                  <tr key={p.assetId} className="border-b border-border/50">
                    <td className="py-2 font-mono text-xs">
                      {p.premisesId} {p.location ? `· ${p.location}` : ""}
                    </td>
                    <td className="py-2">{p.areaSqm.toFixed(2)}</td>
                    <td className="py-2">{formatInr(p.monthlyRent)}</td>
                    <td className="py-2">{formatInr(p.depositShare)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-medium">
                  <td className="py-2">Total</td>
                  <td className="py-2">{derived.totalAreaSqm.toFixed(2)}</td>
                  <td className="py-2">{formatInr(derived.totalRent)}</td>
                  <td className="py-2">{formatInr(requiredDep)}</td>
                </tr>
              </tfoot>
            </table>
            <p className="text-xs text-muted-foreground mt-2">
              GST note ({derived.gstNotePct}%): invoices add CGST/SGST; agreement rent is without GST.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">3. Period and execution</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Date of execution</Label>
              <Input
                type="date"
                disabled={locked}
                value={derived.agreementDate}
                onChange={(e) => patch({ agreementDate: e.target.value })}
              />
            </div>
            <div>
              <Label>Place of execution</Label>
              <Input
                disabled={locked}
                value={derived.placeOfExecution}
                onChange={(e) => patch({ placeOfExecution: e.target.value })}
              />
            </div>
            <div>
              <Label>Agreement start date</Label>
              <Input
                type="date"
                disabled={locked}
                value={derived.startDate}
                onChange={(e) => patch({ startDate: e.target.value })}
              />
            </div>
            <div>
              <Label>Duration (months)</Label>
              <Input
                type="number"
                min={1}
                max={120}
                disabled={locked}
                value={derived.termMonths}
                onChange={(e) => patch({ termMonths: Number(e.target.value) || 1 })}
              />
            </div>
            <div>
              <Label>Agreement end date (calculated)</Label>
              <Input disabled value={ymdToDmy(derived.endDate)} />
            </div>
            <div>
              <Label>Start-date override reason</Label>
              <Input
                disabled={locked}
                value={derived.startDateOverrideReason}
                onChange={(e) => patch({ startDateOverrideReason: e.target.value })}
                placeholder="Required if start ≠ previous end + 1"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">4. Security deposit and default terms</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <Label>Deposit months (N)</Label>
                <Input
                  type="number"
                  min={1}
                  disabled={locked}
                  value={derived.depositMonths}
                  onChange={(e) => patch({ depositMonths: Number(e.target.value) || 1 })}
                />
              </div>
              <div>
                <Label>Required deposit</Label>
                <Input disabled value={formatInr(requiredDep)} />
              </div>
              <div>
                <Label>Damages / day</Label>
                <Input disabled value={formatInr(damages)} />
              </div>
              <div>
                <Label>Termination after continuous months</Label>
                <Input
                  type="number"
                  min={1}
                  disabled={locked}
                  value={derived.continuousMonthsForTermination}
                  onChange={(e) => patch({ continuousMonthsForTermination: Number(e.target.value) || 3 })}
                />
              </div>
              <div>
                <Label>Notice period (days)</Label>
                <Input
                  type="number"
                  min={1}
                  disabled={locked}
                  value={derived.noticeDays}
                  onChange={(e) => patch({ noticeDays: Number(e.target.value) || 10 })}
                />
              </div>
              <div>
                <Label>Interest (config text)</Label>
                <Input disabled value={derived.interestRateText} />
              </div>
            </div>
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b">
                    <th className="py-2">Receipt</th>
                    <th className="py-2">Date</th>
                    <th className="py-2">Particulars</th>
                    <th className="py-2">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {(derived.depositReceipts ?? []).map((r, idx) => (
                    <tr key={`${r.receiptNo}-${idx}`} className="border-b border-border/50">
                      <td className="py-2 font-mono text-xs">{r.receiptNo || "—"}</td>
                      <td className="py-2">{r.receiptDate ? ymdToDmy(r.receiptDate) : "—"}</td>
                      <td className="py-2">{r.particulars}</td>
                      <td className="py-2">{formatInr(r.amount)}</td>
                    </tr>
                  ))}
                  {!derived.depositReceipts?.length && (
                    <tr>
                      <td colSpan={4} className="py-2 text-muted-foreground">
                        No security-deposit receipts linked yet. Held amount: {formatInr(derived.originalDepositHeld)}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">5. Purpose of use</CardTitle>
          </CardHeader>
          <CardContent>
            <Input
              disabled={locked}
              value={derived.purposeOfUse}
              onChange={(e) => patch({ purposeOfUse: e.target.value })}
              placeholder="Printed in recital and clauses 1 and 3"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">6. Licensor (Board) clause</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Signing officer</Label>
              <Input
                disabled={locked}
                value={derived.licensorSigningOfficer}
                onChange={(e) => patch({ licensorSigningOfficer: e.target.value })}
              />
            </div>
            <div>
              <Label>Meeting no.</Label>
              <Input
                disabled={locked}
                value={derived.licensorMeetingNo}
                onChange={(e) => patch({ licensorMeetingNo: e.target.value })}
              />
            </div>
            <div>
              <Label>Meeting date</Label>
              <Input
                disabled={locked}
                value={derived.licensorMeetingDate}
                onChange={(e) => patch({ licensorMeetingDate: e.target.value })}
              />
            </div>
            <div>
              <Label>Resolution no.</Label>
              <Input
                disabled={locked}
                value={derived.licensorResolutionNo}
                onChange={(e) => patch({ licensorResolutionNo: e.target.value })}
              />
            </div>
            <div className="sm:col-span-2">
              <Label>Office address</Label>
              <Input
                disabled={locked}
                value={derived.licensorOfficeAddress}
                onChange={(e) => patch({ licensorOfficeAddress: e.target.value })}
              />
            </div>
            <div className="sm:col-span-2">
              <Label>Licensor clause as printed</Label>
              <Textarea
                disabled={locked}
                rows={5}
                value={derived.licensorClause}
                onChange={(e) => patch({ licensorClause: e.target.value })}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">7. Licensee clause</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  disabled={locked}
                  checked={derived.licenseeSignsInPerson}
                  onChange={() => patch({ licenseeSignsInPerson: true })}
                />
                Signs in person
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  disabled={locked}
                  checked={!derived.licenseeSignsInPerson}
                  onChange={() => patch({ licenseeSignsInPerson: false })}
                />
                Authorised representative
              </label>
            </div>
            {!derived.licenseeSignsInPerson && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label>Representative name</Label>
                  <Input
                    disabled={locked}
                    value={derived.representativeName}
                    onChange={(e) => patch({ representativeName: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Son / daughter of</Label>
                  <Input
                    disabled={locked}
                    value={derived.representativeParentage}
                    onChange={(e) => patch({ representativeParentage: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Age (years)</Label>
                  <Input
                    disabled={locked}
                    value={derived.representativeAge}
                    onChange={(e) => patch({ representativeAge: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Authority</Label>
                  <Input
                    disabled={locked}
                    value={derived.representativeAuthority}
                    onChange={(e) => patch({ representativeAuthority: e.target.value })}
                  />
                </div>
                <div className="sm:col-span-2">
                  <Label>Representative address</Label>
                  <Input
                    disabled={locked}
                    value={derived.representativeAddress}
                    onChange={(e) => patch({ representativeAddress: e.target.value })}
                  />
                </div>
              </div>
            )}
            <div>
              <Label>Licensee clause as printed</Label>
              <Textarea
                disabled={locked}
                rows={4}
                value={derived.licenseeClause}
                onChange={(e) => patch({ licenseeClause: e.target.value })}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">8. Stamp paper (required before Final)</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Serial no. *</Label>
              <Input
                disabled={locked}
                value={derived.stampSerialNo}
                onChange={(e) => patch({ stampSerialNo: e.target.value })}
              />
            </div>
            <div>
              <Label>Value (₹)</Label>
              <Input
                type="number"
                disabled={locked}
                value={derived.stampValue ?? ""}
                onChange={(e) =>
                  patch({ stampValue: e.target.value === "" ? null : Number(e.target.value) })
                }
              />
            </div>
            <div>
              <Label>Purchase date *</Label>
              <Input
                type="date"
                disabled={locked}
                value={derived.stampPurchaseDate}
                onChange={(e) => patch({ stampPurchaseDate: e.target.value })}
              />
            </div>
            <div>
              <Label>Vendor name & licence *</Label>
              <Input
                disabled={locked}
                value={derived.stampVendor}
                onChange={(e) => patch({ stampVendor: e.target.value })}
              />
            </div>
            <div>
              <Label>Place of purchase</Label>
              <Input
                disabled={locked}
                value={derived.stampPlaceOfPurchase}
                onChange={(e) => patch({ stampPlaceOfPurchase: e.target.value })}
              />
            </div>
            <div>
              <Label>Purchased in the name of</Label>
              <Input
                disabled={locked}
                value={derived.stampPurchasedInNameOf}
                onChange={(e) => patch({ stampPurchasedInNameOf: e.target.value })}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">9. Witnesses (optional)</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Witness 1 name</Label>
              <Input
                disabled={locked}
                value={derived.witness1Name}
                onChange={(e) => patch({ witness1Name: e.target.value })}
              />
            </div>
            <div>
              <Label>Witness 1 address</Label>
              <Input
                disabled={locked}
                value={derived.witness1Address}
                onChange={(e) => patch({ witness1Address: e.target.value })}
              />
            </div>
            <div>
              <Label>Witness 2 name</Label>
              <Input
                disabled={locked}
                value={derived.witness2Name}
                onChange={(e) => patch({ witness2Name: e.target.value })}
              />
            </div>
            <div>
              <Label>Witness 2 address</Label>
              <Input
                disabled={locked}
                value={derived.witness2Address}
                onChange={(e) => patch({ witness2Address: e.target.value })}
              />
            </div>
          </CardContent>
        </Card>

        {!locked && (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
              Save draft
            </Button>
            <Button variant="outline" onClick={() => previewMut.mutate()} disabled={previewMut.isPending}>
              Preview draft PDF
            </Button>
            <Button
              onClick={() => generateMut.mutate()}
              disabled={generateMut.isPending || finalBlocked}
              title={finalBlocked ? finalIssues.filter((i) => i.severity === "Block").map((i) => i.message).join("; ") : undefined}
            >
              Generate final PDF
            </Button>
          </div>
        )}

        {data?.status === "Final" && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Upload signed and sealed copy</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Upload locks the agreement as Executed and writes the reference back to the allotment.
              </p>
              <input
                ref={signedRef}
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadMut.mutate(f);
                }}
              />
              <Button onClick={() => signedRef.current?.click()} disabled={uploadMut.isPending}>
                Upload signed PDF
              </Button>
            </CardContent>
          </Card>
        )}

        {(data?.status === "Final" || data?.status === "Executed") && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Documents</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {(data.versions ?? [])
                .filter((v) => v.pdfFile)
                .map((v) => (
                  <div key={v.id} className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{v.kind}</Badge>
                    <span>
                      v{v.versionNo} · {ymdToDmy(v.generatedAt.slice(0, 10))}
                    </span>
                    <Button asChild size="sm" variant="outline">
                      <a href={`/api/ioms/leave-licence-agreements/${llaId}/pdf/${v.id}`} target="_blank" rel="noreferrer">
                        Open PDF
                      </a>
                    </Button>
                  </div>
                ))}
              {data.signedScanFile ? (
                <Button asChild size="sm" variant="outline">
                  <a href={`/api/ioms/leave-licence-agreements/${llaId}/signed-scan`} target="_blank" rel="noreferrer">
                    Open signed scan
                  </a>
                </Button>
              ) : null}
            </CardContent>
          </Card>
        )}

        {data?.status === "Executed" && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Cancel and record afresh</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {!cancelOpen ? (
                <Button variant="destructive" onClick={() => setCancelOpen(true)}>
                  Cancel and record afresh…
                </Button>
              ) : (
                <>
                  <div>
                    <Label>Reason *</Label>
                    <Textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} rows={3} />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <Label>Effective from *</Label>
                      <Input type="date" value={cancelDate} onChange={(e) => setCancelDate(e.target.value)} />
                    </div>
                    <div>
                      <Label>Secretary&apos;s order / file ref. *</Label>
                      <Input value={cancelOrder} onChange={(e) => setCancelOrder(e.target.value)} />
                    </div>
                  </div>
                  <div>
                    <Label>Order copy (PDF)</Label>
                    <input ref={orderRef} type="file" accept="application/pdf" className="block w-full text-sm" />
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setCancelOpen(false)}>
                      Keep agreement
                    </Button>
                    <Button variant="destructive" onClick={() => cancelMut.mutate()} disabled={cancelMut.isPending}>
                      Cancel and create fresh draft
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
