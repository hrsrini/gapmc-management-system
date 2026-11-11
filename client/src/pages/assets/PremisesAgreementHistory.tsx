import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { formatInr } from "@/lib/formatInr";
import { renewalStatusBadgeClass, renewalStatusLabel, ymdToDmy } from "@/lib/premisesAgreementUi";
import { cn } from "@/lib/utils";

export default function PremisesAgreementHistory() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [view, setView] = useState<"premises" | "agreement">("premises");
  const { data } = useQuery<{
    agreement: Record<string, unknown>;
    renewals: Array<Record<string, unknown>>;
    notices: Array<Record<string, unknown>>;
    revisions: Array<Record<string, unknown>>;
    penalties: Array<Record<string, unknown>>;
    vacations: Array<Record<string, unknown>>;
    settlements: Array<Record<string, unknown>>;
    demands: Array<Record<string, unknown>>;
  }>({ queryKey: [`/api/ioms/premises-agreements/${id}/history`], enabled: Boolean(id) });

  const dispatch = useMutation({
    mutationFn: async (noticeId: string) => {
      const res = await fetch(`/api/ioms/renewal-notices/${noticeId}/dispatch`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({}),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error ?? res.statusText);
      return body;
    },
    onSuccess: () => {
      toast({ title: "Dispatch recorded" });
      void qc.invalidateQueries({ queryKey: [`/api/ioms/premises-agreements/${id}/history`] });
    },
  });

  const agr = data?.agreement;
  const premises = ((agr?.premises as Array<{ premisesId?: string }>) ?? [])
    .map((p) => p.premisesId)
    .filter(Boolean)
    .join(", ");
  const renewals = data?.renewals ?? [];
  const notices = data?.notices ?? [];
  const revisions = data?.revisions ?? [];
  const penalties = data?.penalties ?? [];

  return (
    <AppShell
      breadcrumbs={[
        { label: "Agreements", href: "/assets/agreements" },
        { label: String(agr?.agreementNo ?? id), href: `/assets/agreements/${id}` },
        { label: "History" },
      ]}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h1 className="text-2xl font-semibold">
              History: {premises || "—"} · {String(agr?.agreementNo ?? "")}
            </h1>
            <p className="text-sm text-muted-foreground">
              {String(agr?.allotteeName ?? "")}. Every agreement, renewal, notice, rent revision and penalty stays linked
              to this allotment and is never overwritten.
            </p>
          </div>
          <div className="flex gap-2">
            <Button asChild size="sm" variant="outline">
              <Link href={`/assets/agreements/${id}/notice`}>Generate renewal notice</Link>
            </Button>
            <Button asChild size="sm">
              <Link href={`/assets/agreements/${id}/renew`}>Renew agreement</Link>
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <Tabs defaultValue="renewals" className="w-full">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <TabsList className="flex flex-wrap h-auto">
                <TabsTrigger value="renewals">Agreement and renewals</TabsTrigger>
                <TabsTrigger value="revisions">Rent revisions ({revisions.length})</TabsTrigger>
                <TabsTrigger value="notices">Notices ({notices.length})</TabsTrigger>
                <TabsTrigger value="penalties">Penalties ({penalties.length})</TabsTrigger>
                <TabsTrigger value="docs">Documents (1)</TabsTrigger>
                <TabsTrigger value="audit">Audit trail</TabsTrigger>
              </TabsList>
              <div className="flex rounded-md border overflow-hidden text-sm">
                <button
                  type="button"
                  className={cn("px-3 py-1.5", view === "premises" && "bg-primary text-primary-foreground")}
                  onClick={() => setView("premises")}
                >
                  Premises-wise
                </button>
                <button
                  type="button"
                  className={cn("px-3 py-1.5", view === "agreement" && "bg-primary text-primary-foreground")}
                  onClick={() => setView("agreement")}
                >
                  Agreement-wise
                </button>
              </div>
            </div>

            <TabsContent value="renewals" className="space-y-3">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Agreement and renewals</CardTitle>
                </CardHeader>
                <CardContent className="overflow-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left border-b">
                        <th className="py-2 pr-2">Record</th>
                        <th className="py-2 pr-2">From</th>
                        <th className="py-2 pr-2">To</th>
                        <th className="py-2 pr-2">Rent (Rs.)</th>
                        <th className="py-2 pr-2">Rent revision</th>
                        <th className="py-2 pr-2">Agreement period</th>
                        <th className="py-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b border-border/50">
                        <td className="py-2 pr-2">Original agreement</td>
                        <td className="py-2 pr-2">{ymdToDmy(String(agr?.fromDate))}</td>
                        <td className="py-2 pr-2">{ymdToDmy(String(agr?.toDate))}</td>
                        <td className="py-2 pr-2">{formatInr(Number(agr?.totalMonthlyRent ?? 0))}</td>
                        <td className="py-2 pr-2">—</td>
                        <td className="py-2 pr-2">Period {String(agr?.agreementPeriodNumber ?? 1)}</td>
                        <td className="py-2">
                          <Badge variant="outline" className={renewalStatusBadgeClass(String(agr?.renewalStatus))}>
                            {renewalStatusLabel(String(agr?.renewalStatus ?? ""))}
                          </Badge>
                        </td>
                      </tr>
                      {renewals.map((r, idx) => (
                        <tr key={String(r.id)} className="border-b border-border/50">
                          <td className="py-2 pr-2">
                            Renewal {idx + 1}
                            {String(r.status) !== "Completed" ? " (proposed)" : ""}
                          </td>
                          <td className="py-2 pr-2">{ymdToDmy(String(r.renewalFromDate))}</td>
                          <td className="py-2 pr-2">{ymdToDmy(String(r.renewalToDate))}</td>
                          <td className="py-2 pr-2">—</td>
                          <td className="py-2 pr-2">
                            {r.revisionBatchId ? "Linked" : String(r.status) === "PendingRevision" ? "Pending approval" : "None"}
                          </td>
                          <td className="py-2 pr-2">
                            Period {String(r.priorPeriodNumber)} → {String(r.newPeriodNumber)}
                          </td>
                          <td className="py-2">
                            <Badge variant="outline">{String(r.status)}</Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {view === "premises" && premises && (
                    <p className="text-xs text-muted-foreground mt-2">Viewing premises: {premises}</p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="revisions" className="space-y-2">
              {(data?.revisions ?? []).map((b) => (
                <Card key={String(b.id)}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">
                      {ymdToDmy(String(b.effectiveDate))} · {String(b.status)} · {String(b.revisionBasis)}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm space-y-1">
                    {((b.lines as Array<Record<string, unknown>>) ?? []).map((l) => (
                      <div key={String(l.id)}>
                        {formatInr(Number(l.existingRent))} → {formatInr(Number(l.revisedRent))}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              ))}
              {(data?.revisions ?? []).length === 0 && <p className="text-sm text-muted-foreground">No revisions.</p>}
            </TabsContent>

            <TabsContent value="notices">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Renewal notice generation history</CardTitle>
                </CardHeader>
                <CardContent className="overflow-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left border-b">
                        <th className="py-2 pr-2">Notice reference</th>
                        <th className="py-2 pr-2">Ver.</th>
                        <th className="py-2 pr-2">Generated on</th>
                        <th className="py-2 pr-2">Generated by</th>
                        <th className="py-2 pr-2">Agreement no.</th>
                        <th className="py-2 pr-2">Dispatch date</th>
                        <th className="py-2">PDF copy</th>
                      </tr>
                    </thead>
                    <tbody>
                      {notices.map((n) => (
                        <tr key={String(n.id)} className="border-b border-border/50">
                          <td className="py-2 pr-2 font-mono text-xs">{String(n.noticeNo)}</td>
                          <td className="py-2 pr-2">{String(n.versionNo)}</td>
                          <td className="py-2 pr-2">{ymdToDmy(String(n.noticeDate))}</td>
                          <td className="py-2 pr-2">{String(n.generatedBy ?? "—")}</td>
                          <td className="py-2 pr-2">{String(agr?.agreementNo)}</td>
                          <td className="py-2 pr-2">
                            {n.dispatchDate ? (
                              ymdToDmy(String(n.dispatchDate))
                            ) : (
                              <span className="inline-flex items-center gap-2">
                                <Badge variant="outline" className="bg-amber-500/10 text-amber-800 border-amber-500/30">
                                  Not recorded
                                </Badge>
                                <Button size="sm" variant="outline" onClick={() => dispatch.mutate(String(n.id))}>
                                  Record
                                </Button>
                              </span>
                            )}
                          </td>
                          <td className="py-2">
                            <a
                              className="underline text-primary"
                              href={`/api/ioms/renewal-notices/${String(n.id)}/pdf`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              View PDF
                            </a>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {notices.length === 0 && <p className="text-sm text-muted-foreground">No notices.</p>}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="penalties">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Penalty history</CardTitle>
                </CardHeader>
                <CardContent className="overflow-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left border-b">
                        <th className="py-2 pr-2">Agreement</th>
                        <th className="py-2 pr-2">Expiry date</th>
                        <th className="py-2 pr-2">Regularised on</th>
                        <th className="py-2 pr-2">Days</th>
                        <th className="py-2 pr-2">Method and rate</th>
                        <th className="py-2 pr-2">Amount (Rs.)</th>
                        <th className="py-2">Verification</th>
                      </tr>
                    </thead>
                    <tbody>
                      {penalties.map((p) => (
                        <tr key={String(p.id)} className="border-b border-border/50">
                          <td className="py-2 pr-2">{String(agr?.agreementNo)}</td>
                          <td className="py-2 pr-2">{ymdToDmy(String(p.expiryDate))}</td>
                          <td className="py-2 pr-2">{ymdToDmy(String(p.regularisationDate))}</td>
                          <td className="py-2 pr-2">{String(p.daysOfDelay)}</td>
                          <td className="py-2 pr-2">
                            {String(p.method)} · {String(p.rate)}
                          </td>
                          <td className="py-2 pr-2">{formatInr(Number(p.calculatedAmount))}</td>
                          <td className="py-2">
                            <Badge
                              variant="outline"
                              className={
                                String(p.status) === "Approved"
                                  ? "bg-emerald-500/10 text-emerald-700"
                                  : "bg-amber-500/10 text-amber-800 border-amber-500/30"
                              }
                            >
                              {String(p.status)}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {penalties.length === 0 && <p className="text-sm text-muted-foreground">No penalties.</p>}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="docs" className="space-y-2">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Supporting documents</CardTitle>
                </CardHeader>
                <CardContent className="overflow-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left border-b">
                        <th className="py-2 pr-2">Document</th>
                        <th className="py-2 pr-2">Linked to</th>
                        <th className="py-2 pr-2">Uploaded on</th>
                        <th className="py-2">File</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b border-border/50">
                        <td className="py-2 pr-2">Signed agreement</td>
                        <td className="py-2 pr-2">Period {String(agr?.agreementPeriodNumber ?? 1)}</td>
                        <td className="py-2 pr-2">—</td>
                        <td className="py-2">
                          {agr?.agreementDocFile ? (
                            <a
                              className="underline text-primary"
                              href={`/api/ioms/premises-agreements/${id}/agreement-doc`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              View PDF
                            </a>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="audit" className="space-y-2">
              {(data?.vacations ?? []).map((v) => (
                <Card key={String(v.id)}>
                  <CardContent className="pt-4 text-sm">
                    Vacation {String(v.caseType)} · actual {ymdToDmy(String(v.actualVacationDate ?? ""))}
                  </CardContent>
                </Card>
              ))}
              {(data?.settlements ?? []).map((s) => (
                <Card key={String(s.id)}>
                  <CardContent className="pt-4 text-sm">
                    Settlement {String(s.status)} · net{" "}
                    {formatInr(Number(s.finalApprovedNet ?? s.systemCalculatedNet ?? 0))}
                  </CardContent>
                </Card>
              ))}
              {(data?.demands ?? []).map((d) => (
                <Card key={String(d.id)}>
                  <CardContent className="pt-4 text-sm flex justify-between">
                    <span>
                      Demand {String(d.noticeNo)} · {formatInr(Number(d.totalPayable))}
                    </span>
                    <a
                      className="underline text-primary"
                      href={`/api/ioms/final-demand-notices/${String(d.id)}/pdf`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      PDF
                    </a>
                  </CardContent>
                </Card>
              ))}
              {!(data?.vacations?.length || data?.settlements?.length || data?.demands?.length) && (
                <p className="text-sm text-muted-foreground">No vacation / settlement audit rows yet.</p>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </AppShell>
  );
}
