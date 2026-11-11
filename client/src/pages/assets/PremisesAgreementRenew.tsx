import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { calculateDelayPenalty, isRentRevisionDueForPeriod } from "@shared/premises-agreement";
import { formatInr } from "@/lib/formatInr";
import { renewalStatusBadgeClass, renewalStatusLabel, ymdToDmy } from "@/lib/premisesAgreementUi";
import { cn } from "@/lib/utils";

type OpenRenewalRow = {
  id: string;
  status?: string | null;
  renewalDate?: string | null;
  renewalFromDate?: string | null;
  renewalToDate?: string | null;
  revisionBatchId?: string | null;
};

export default function PremisesAgreementRenew() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: agr } = useQuery<Record<string, unknown>>({
    queryKey: [`/api/ioms/premises-agreements/${id}`],
    enabled: Boolean(id),
  });
  const { data: history } = useQuery<{ renewals: OpenRenewalRow[] }>({
    queryKey: [`/api/ioms/premises-agreements/${id}/history`],
    enabled: Boolean(id),
  });
  const premises = (agr?.premises as Array<{ premisesId?: string; monthlyRent?: number }>) ?? [];
  const totalRent = premises.reduce((s, p) => s + Number(p.monthlyRent ?? 0), 0);

  const [renewalDate, setRenewalDate] = useState(new Date().toISOString().slice(0, 10));
  const [renewalFrom, setRenewalFrom] = useState("");
  const [renewalTo, setRenewalTo] = useState("");
  const [renewalId, setRenewalId] = useState<string | null>(null);
  const [revisionDue, setRevisionDue] = useState(false);
  const [revisedRent, setRevisedRent] = useState("");
  const [revisionEffective, setRevisionEffective] = useState("");
  const [revisionSubmitted, setRevisionSubmitted] = useState(false);
  const [penaltyRemarks, setPenaltyRemarks] = useState("");
  const [penaltySent, setPenaltySent] = useState(false);
  const [blockReason, setBlockReason] = useState<string | null>(null);
  const [hydratedOpenRenewal, setHydratedOpenRenewal] = useState(false);

  // Restore in-progress renewal after refresh / return from approvals.
  useEffect(() => {
    if (hydratedOpenRenewal || !history?.renewals?.length) return;
    const open = history.renewals.find((r) => String(r.status ?? "") !== "Completed");
    if (!open) {
      setHydratedOpenRenewal(true);
      return;
    }
    const pendingRevision = String(open.status ?? "") === "PendingRevision";
    setRenewalId(open.id);
    if (open.renewalDate) setRenewalDate(String(open.renewalDate).slice(0, 10));
    if (open.renewalFromDate) {
      setRenewalFrom(String(open.renewalFromDate).slice(0, 10));
      setRevisionEffective(String(open.renewalFromDate).slice(0, 10));
    }
    if (open.renewalToDate) setRenewalTo(String(open.renewalToDate).slice(0, 10));
    setRevisionDue(pendingRevision);
    setRevisionSubmitted(Boolean(open.revisionBatchId));
    setBlockReason(
      pendingRevision
        ? "Blocked: rent revision approval is pending, so the renewal cannot be completed."
        : null,
    );
    if (!revisedRent && totalRent > 0) setRevisedRent(String(Math.round(totalRent * 1.1)));
    setHydratedOpenRenewal(true);
  }, [history, hydratedOpenRenewal, revisedRent, totalRent]);

  const period = Number(agr?.agreementPeriodNumber ?? 1);
  const freq = Number(agr?.rentRevisionFrequency ?? 3);
  const nextPeriod = period + 1;
  const nextRevisionDue = isRentRevisionDueForPeriod(nextPeriod, freq);
  const daysLate = useMemo(() => {
    const to = String(agr?.toDate ?? "");
    if (!to || !renewalDate) return 0;
    return Math.max(0, Math.round((Date.parse(renewalDate) - Date.parse(to)) / 86_400_000));
  }, [agr?.toDate, renewalDate]);
  const penaltyAmount = useMemo(() => {
    if (daysLate <= 0 || agr?.penaltyRate == null) return 0;
    return calculateDelayPenalty({
      method: String(agr?.penaltyMethod ?? "FixedPerDay"),
      rate: Number(agr?.penaltyRate ?? 0),
      daysOfDelay: daysLate,
      monthlyRentTotal: totalRent,
    });
  }, [agr?.penaltyMethod, agr?.penaltyRate, daysLate, totalRent]);

  const start = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/ioms/premises-agreements/${id}/renewals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          renewalDate,
          renewalFromDate: renewalFrom || undefined,
          renewalToDate: renewalTo || undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error ?? res.statusText);
      return body as {
        renewalId: string;
        revisionDue: boolean;
        renewalFrom: string;
        renewalTo: string;
        reused?: boolean;
      };
    },
    onSuccess: (body) => {
      setRenewalId(body.renewalId);
      setRevisionDue(body.revisionDue);
      setRenewalFrom(body.renewalFrom);
      setRenewalTo(body.renewalTo);
      setRevisionEffective(body.renewalFrom);
      if (!revisedRent) setRevisedRent(String(Math.round(totalRent * 1.1)));
      setBlockReason(
        body.revisionDue
          ? "Blocked: rent revision approval is pending, so the renewal cannot be completed."
          : null,
      );
      setHydratedOpenRenewal(true);
      toast({ title: body.reused ? "Open renewal restored" : "Renewal draft saved" });
      void qc.invalidateQueries({ queryKey: [`/api/ioms/premises-agreements/${id}`] });
      void qc.invalidateQueries({ queryKey: [`/api/ioms/premises-agreements/${id}/history`] });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const submitRevision = useMutation({
    mutationFn: async () => {
      if (!renewalId) throw new Error("Save draft / start renewal first");
      if (!(Number(revisedRent) > 0)) throw new Error("Revised rent required");
      const existingTotal = totalRent || 1;
      const targetTotal = Number(revisedRent);
      const withIds = (agr?.premises as Array<{ id: string; monthlyRent?: number }>) ?? [];
      const payloadLines = withIds.map((p) => {
        const existing = Number(p.monthlyRent ?? 0);
        const share = existing / existingTotal;
        return {
          agreementLineId: p.id,
          revisedRent: Math.round(targetTotal * share * 100) / 100,
        };
      });
      if (!payloadLines.length) throw new Error("No premises lines on this agreement");
      const res = await fetch(`/api/ioms/premises-agreements/${id}/revisions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          effectiveDate: revisionEffective || renewalFrom,
          renewalId,
          remarks: "Submitted from renew agreement screen",
          lines: payloadLines,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error ?? res.statusText);
      return body;
    },
    onSuccess: () => {
      setRevisionSubmitted(true);
      toast({ title: "Rent revision submitted for approval" });
    },
    onError: (e: Error) => toast({ title: "Revision failed", description: e.message, variant: "destructive" }),
  });

  const complete = useMutation({
    mutationFn: async () => {
      if (!renewalId) throw new Error("Start renewal first");
      const res = await fetch(`/api/ioms/agreement-renewals/${renewalId}/complete`, {
        method: "POST",
        credentials: "include",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error ?? res.statusText);
      return body;
    },
    onSuccess: () => {
      setBlockReason(null);
      toast({ title: "Renewal completed" });
      void qc.invalidateQueries({ queryKey: [`/api/ioms/premises-agreements/${id}`] });
    },
    onError: (e: Error) => {
      setBlockReason(e.message);
      toast({ title: "Cannot complete", description: e.message, variant: "destructive" });
    },
  });

  const status = String(agr?.renewalStatus ?? "");
  const periodDots = Array.from({ length: Math.max(nextPeriod, 4) }, (_, i) => i + 1);

  return (
    <AppShell
      breadcrumbs={[
        { label: "Agreements", href: "/assets/agreements" },
        { label: String(agr?.agreementNo ?? id), href: `/assets/agreements/${id}` },
        { label: "Renew" },
      ]}
    >
      <div className="space-y-4 max-w-4xl">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold">Renew agreement: {String(agr?.agreementNo ?? "")}</h1>
            <Badge variant="outline" className={renewalStatusBadgeClass(status)}>
              {renewalStatusLabel(status)}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Record the renewal, rent revision and any delay penalty. Everything is saved as history; earlier records are
            never overwritten.
          </p>
        </div>

        {(nextRevisionDue || revisionDue) && (
          <Alert className="border-amber-500/40 bg-amber-500/10">
            <AlertTitle>This renewal starts Period {nextPeriod}.</AlertTitle>
            <AlertDescription>
              Because the Rent Revision Frequency is {freq}, a rent revision is mandatory. The renewal cannot be
              completed until the revision is approved.
            </AlertDescription>
          </Alert>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-muted-foreground mr-2">Agreement period</span>
          {periodDots.map((p) => (
            <span
              key={p}
              className={cn(
                "h-8 w-8 rounded-full border flex items-center justify-center text-sm",
                p === nextPeriod ? "border-primary bg-primary text-primary-foreground ring-2 ring-primary/30" : "bg-muted",
                p < nextPeriod && "opacity-60",
              )}
              title={`Period ${p}`}
            >
              {p}
            </span>
          ))}
        </div>

        <Card className="bg-muted/30">
          <CardHeader>
            <CardTitle className="text-base">1. Existing agreement (read-only)</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2 text-sm">
            <div>
              <span className="text-muted-foreground">Premises: </span>
              {premises.map((p) => p.premisesId).filter(Boolean).join(", ") || "—"}
            </div>
            <div>
              <span className="text-muted-foreground">Lessee: </span>
              {String(agr?.allotteeName)}
            </div>
            <div>
              <span className="text-muted-foreground">Agreement number: </span>
              {String(agr?.agreementNo)}
            </div>
            <div>
              <span className="text-muted-foreground">Agreement from/to: </span>
              {ymdToDmy(String(agr?.fromDate))} to {ymdToDmy(String(agr?.toDate))}
              {daysLate > 0 && (
                <span className="text-destructive ml-1">(expired {daysLate} days ago)</span>
              )}
            </div>
            <div>
              <span className="text-muted-foreground">Existing monthly rent: </span>
              {formatInr(totalRent)}
            </div>
            <div>
              <span className="text-muted-foreground">Renewal status: </span>
              {renewalStatusLabel(status)}
            </div>
            <div>
              <span className="text-muted-foreground">Penalty clause: </span>
              {String(agr?.penaltyClauseRef || agr?.penaltyMethod || "—")}
            </div>
            <div>
              <span className="text-muted-foreground">Agreement Period Number: </span>
              Period {period}
            </div>
            <div>
              <span className="text-muted-foreground">Rent Revision Frequency: </span>
              {freq} agreement periods
            </div>
            <div>
              <span className="text-muted-foreground">Next revision due: </span>
              {nextRevisionDue ? `Start of Period ${nextPeriod}` : "Not yet"}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">2. Renewal details</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label>Renewal date *</Label>
              <Input type="date" value={renewalDate} onChange={(e) => setRenewalDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Renewal from *</Label>
              <Input type="date" value={renewalFrom} onChange={(e) => setRenewalFrom(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Renewal to *</Label>
              <Input type="date" value={renewalTo} onChange={(e) => setRenewalTo(e.target.value)} />
            </div>
            <p className="sm:col-span-3 text-xs text-muted-foreground">
              Dates are proposed based on the previous tenure when you save the draft.
            </p>
          </CardContent>
        </Card>

        {(nextRevisionDue || revisionDue) && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">3. Rent revision (Mandatory)</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label>Existing rent (Rs.)</Label>
                <Input readOnly value={String(totalRent)} />
              </div>
              <div className="space-y-1">
                <Label>Revised rent (Rs.)</Label>
                <Input value={revisedRent} onChange={(e) => setRevisedRent(e.target.value)} />
                {Number(revisedRent) > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Increase of Rs. {Math.round(Number(revisedRent) - totalRent)} per month
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <Label>Effective date of revision</Label>
                <Input
                  type="date"
                  value={revisionEffective || renewalFrom}
                  onChange={(e) => setRevisionEffective(e.target.value)}
                />
              </div>
              <div className="sm:col-span-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                <span className="text-sm">
                  Approval: {revisionSubmitted ? "submitted" : "not yet submitted"}
                </span>
                <Button
                  size="sm"
                  disabled={!renewalId || submitRevision.isPending || revisionSubmitted}
                  onClick={() => submitRevision.mutate()}
                >
                  Submit for approval
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link href={`/assets/agreements/${id}/revision?renewalId=${renewalId ?? ""}`}>
                    Premises-wise revision
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {daysLate > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">4. Delay penalty</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-2 sm:grid-cols-3 text-sm">
                <div>Agreement expiry: {ymdToDmy(String(agr?.toDate))}</div>
                <div>Date of regularisation: {ymdToDmy(renewalDate)}</div>
                <div>Days of delay: {daysLate}</div>
                <div>Method: {String(agr?.penaltyMethod ?? "—")}</div>
                <div>Rate: {String(agr?.penaltyRate ?? "—")}</div>
                <div className="font-semibold">Calculated penalty: {formatInr(penaltyAmount)}</div>
              </div>
              <div className="space-y-1">
                <Label>Remarks / justification for any correction</Label>
                <Textarea value={penaltyRemarks} onChange={(e) => setPenaltyRemarks(e.target.value)} />
              </div>
              <div className="flex items-center justify-between rounded-md border px-3 py-2">
                <span className="text-sm">Verification: {penaltySent ? "Sent" : "Pending"}</span>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!renewalId || penaltySent}
                  onClick={() => {
                    setPenaltySent(true);
                    toast({
                      title: "Penalty will be drafted on Complete",
                      description: "Completing renewal creates the penalty for verification when delay applies.",
                    });
                  }}
                >
                  Send for verification
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
          <div className="text-sm text-destructive max-w-md">{blockReason}</div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href={`/assets/agreements/${id}`}>Cancel</Link>
            </Button>
            <Button
              variant="outline"
              onClick={() => start.mutate()}
              disabled={start.isPending || Boolean(renewalId)}
            >
              {renewalId ? "Draft saved" : "Save draft"}
            </Button>
            <Button
              onClick={() => complete.mutate()}
              disabled={!renewalId || complete.isPending || (revisionDue && !revisionSubmitted)}
            >
              Complete renewal
            </Button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
