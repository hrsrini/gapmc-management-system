import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { noticeDisabledByRenewal } from "@shared/premises-agreement";
import { ymdToDmy } from "@/lib/premisesAgreementUi";

export default function PremisesAgreementNotice() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: agr } = useQuery<Record<string, unknown>>({
    queryKey: [`/api/ioms/premises-agreements/${id}`],
    enabled: Boolean(id),
  });
  const { data: hist } = useQuery<{ notices: Array<Record<string, unknown>> }>({
    queryKey: [`/api/ioms/premises-agreements/${id}/history`],
    enabled: Boolean(id),
  });
  const [lastDate, setLastDate] = useState("");
  const [lastNoticeId, setLastNoticeId] = useState<string | null>(null);

  const disabled = noticeDisabledByRenewal(String(agr?.renewalStatus ?? ""));
  const premises = useMemo(
    () => ((agr?.premises as Array<{ premisesId?: string }>) ?? []).map((p) => p.premisesId).filter(Boolean),
    [agr],
  );
  const notices = hist?.notices ?? [];
  const nextVersion = (notices[0] ? Number(notices[0].versionNo ?? 0) : 0) + 1;
  const noticeDate = new Date().toISOString().slice(0, 10);

  const generate = useMutation({
    mutationFn: async (isReprint: boolean) => {
      const res = await fetch(`/api/ioms/premises-agreements/${id}/notices`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ lastDateToRenew: lastDate || undefined, isReprint }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error ?? res.statusText);
      return body as { id: string; noticeNo: string };
    },
    onSuccess: (body) => {
      setLastNoticeId(body.id);
      toast({ title: "Notice generated", description: body.noticeNo });
      void qc.invalidateQueries({ queryKey: [`/api/ioms/premises-agreements/${id}`] });
      void qc.invalidateQueries({ queryKey: [`/api/ioms/premises-agreements/${id}/history`] });
      window.open(`/api/ioms/renewal-notices/${body.id}/pdf`, "_blank");
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  return (
    <AppShell
      breadcrumbs={[
        { label: "Agreements", href: "/assets/agreements" },
        { label: String(agr?.agreementNo ?? id), href: `/assets/agreements/${id}` },
        { label: "Renewal notice" },
      ]}
    >
      <div className="space-y-4 max-w-3xl">
        <div>
          <h1 className="text-2xl font-semibold">Generate renewal notice</h1>
          <p className="text-sm text-muted-foreground">
            {String(agr?.agreementNo)} · {String(agr?.allotteeName)}
          </p>
        </div>

        {!disabled ? (
          <Alert className="border-teal-500/30 bg-teal-500/5">
            <AlertTitle>Renewal window is open</AlertTitle>
            <AlertDescription>
              The notice can be generated and reprinted until renewal is initiated or completed.
            </AlertDescription>
          </Alert>
        ) : (
          <Alert variant="destructive">
            <AlertTitle>Notice printing disabled</AlertTitle>
            <AlertDescription>Renewal has started or completed for this agreement.</AlertDescription>
          </Alert>
        )}

        <Card>
          <CardContent className="pt-6 space-y-4">
            <div className="space-y-1">
              <Label>Notice date</Label>
              <Input readOnly value={ymdToDmy(noticeDate)} />
              <p className="text-xs text-muted-foreground">Filled in automatically on the day the notice is generated.</p>
            </div>
            <div className="space-y-1">
              <Label>Last date to complete renewal *</Label>
              <Input type="date" value={lastDate} onChange={(e) => setLastDate(e.target.value)} />
              <p className="text-xs text-muted-foreground">Printed on the notice.</p>
            </div>
            <div className="space-y-1">
              <Label>Premises on the notice</Label>
              <div className="flex flex-wrap gap-2">
                {premises.map((p) => (
                  <Badge key={String(p)} variant="secondary">
                    {String(p)}
                  </Badge>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">All premises under this agreement are listed.</p>
            </div>
            <div className="space-y-1">
              <Label>Penalty clause quoted</Label>
              <p className="text-sm">
                Clause {String(agr?.penaltyClauseRef || "[no.]")}: {String(agr?.penaltyMethod || "as per agreement")}
              </p>
              <p className="text-xs text-muted-foreground">Taken from the existing agreement.</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Preview</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border bg-muted/30 p-4 text-sm space-y-2 font-serif">
              <div className="text-center font-sans text-xs text-muted-foreground">[ORGANISATION NAME]</div>
              <div className="flex justify-between text-xs">
                <span>NRN/…/v{nextVersion}</span>
                <span>{ymdToDmy(noticeDate)}</span>
              </div>
              <div>To, {String(agr?.allotteeName)}</div>
              <div className="font-semibold">
                Subject: Renewal of agreement for premises {premises.join(", ") || "—"}
              </div>
              <p>
                The agreement {String(agr?.agreementNo)} (validity {ymdToDmy(String(agr?.fromDate))} to{" "}
                {ymdToDmy(String(agr?.toDate))}) requires renewal. Please confirm in writing your willingness to renew
                it. Complete renewal by {lastDate ? ymdToDmy(lastDate) : "[last date]"}. The penalty clause of the
                existing agreement applies for the period of delay.
              </p>
            </div>
          </CardContent>
        </Card>

        {notices.length > 0 && (
          <Alert className="border-amber-500/30 bg-amber-500/5">
            <AlertDescription>
              <strong>{notices.length} earlier notice{notices.length > 1 ? "s" : ""}:</strong>{" "}
              {notices
                .slice(0, 3)
                .map((n) => `${String(n.noticeNo)} (version ${String(n.versionNo)}, ${ymdToDmy(String(n.noticeDate))})`)
                .join(" and ")}
              . This will create version {nextVersion}. Earlier copies are kept and never overwritten.
            </AlertDescription>
          </Alert>
        )}

        <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
          <Button asChild variant="outline">
            <Link href={`/assets/agreements/${id}`}>Cancel</Link>
          </Button>
          {lastNoticeId && (
            <Button asChild variant="outline">
              <a href={`/api/ioms/renewal-notices/${lastNoticeId}/pdf`} target="_blank" rel="noreferrer">
                Print
              </a>
            </Button>
          )}
          <Button disabled={disabled || generate.isPending || !lastDate} onClick={() => generate.mutate(false)}>
            Generate and download PDF
          </Button>
        </div>
      </div>
    </AppShell>
  );
}
