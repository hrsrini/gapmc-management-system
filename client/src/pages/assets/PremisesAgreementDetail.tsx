import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { formatInr } from "@/lib/formatInr";
import { renewalStatusBadgeClass, renewalStatusLabel, ymdToDmy } from "@/lib/premisesAgreementUi";
import { cn } from "@/lib/utils";

export default function PremisesAgreementDetail() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { toast } = useToast();
  const qc = useQueryClient();
  const { can, user } = useAuth();
  const tiers = (user?.roles ?? []).map((r) => r.tier);
  const canVerify = can("M-02", "Update") && (tiers.includes("DV") || tiers.includes("ADMIN"));
  const canApprove = can("M-02", "Update") && (tiers.includes("DA") || tiers.includes("ADMIN"));
  const fileRef = useRef<HTMLInputElement>(null);
  const [remarks, setRemarks] = useState("");
  const [checkSigned, setCheckSigned] = useState(false);
  const [checkDates, setCheckDates] = useState(false);
  const [checkRent, setCheckRent] = useState(false);
  const [manageLineId, setManageLineId] = useState<string | null>(null);
  const [tenancyChoice, setTenancyChoice] = useState<"Active" | "Vacating" | "Vacated">("Active");
  const [vacatedOn, setVacatedOn] = useState(new Date().toISOString().slice(0, 10));

  const { data, isLoading } = useQuery<Record<string, unknown>>({
    queryKey: [`/api/ioms/premises-agreements/${id}`],
    enabled: Boolean(id),
  });

  const workflow = useMutation({
    mutationFn: async (approvalStatus: string) => {
      if ((approvalStatus === "Draft" || approvalStatus === "Rejected") && remarks.trim().length < 3) {
        throw new Error("Remarks are required when returning or rejecting.");
      }
      const res = await fetch(`/api/ioms/premises-agreements/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ approvalStatus, remarks }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error ?? res.statusText);
      return body;
    },
    onSuccess: () => {
      toast({ title: "Workflow updated" });
      void qc.invalidateQueries({ queryKey: [`/api/ioms/premises-agreements/${id}`] });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/ioms/premises-agreements/${id}/agreement-doc`, {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error ?? res.statusText);
      return body;
    },
    onSuccess: () => {
      toast({ title: "Agreement uploaded" });
      void qc.invalidateQueries({ queryKey: [`/api/ioms/premises-agreements/${id}`] });
    },
    onError: (e: Error) => toast({ title: "Upload failed", description: e.message, variant: "destructive" }),
  });

  if (isLoading || !data) {
    return (
      <AppShell breadcrumbs={[{ label: "Agreements", href: "/assets/agreements" }, { label: "…" }]}>
        <Skeleton className="h-64 w-full" />
      </AppShell>
    );
  }

  const premises = (data.premises as Array<Record<string, unknown>>) ?? [];
  const approval = String(data.approvalStatus ?? "");
  const renewal = String(data.renewalStatus ?? "");
  const premisesLabel =
    premises.length <= 1
      ? String(premises[0]?.premisesId ?? data.agreementNo)
      : `${String(premises[0]?.premisesId ?? "")} to ${String(premises[premises.length - 1]?.premisesId ?? "")}`;
  const manageLine = premises.find((p) => String(p.id) === manageLineId);
  const totalArea = premises.reduce((s, p) => s + Number(p.areaSqm ?? 0), 0);
  const totalRent = premises.reduce((s, p) => s + Number(p.monthlyRent ?? 0), 0);
  const totalDep = premises.reduce((s, p) => s + Number(p.depositShare ?? 0), 0);

  type TrailTone = "done" | "pending" | "idle" | "rejected";
  const trail: Array<{ step: string; officer: string; status: string; date: string; tone: TrailTone }> = [
    {
      step: "Draft created",
      officer: String(data.createdBy ?? "—"),
      status: "Done",
      date: String(data.createdAt ?? "").slice(0, 10),
      tone: "done",
    },
    {
      step: "DV verification",
      officer: String(data.verifiedBy ?? "[DV officer]"),
      status: approval === "Draft" ? "Pending" : approval === "Rejected" ? "Rejected" : "Done",
      date: String(data.verifiedAt ?? "").slice(0, 10) || "—",
      tone: approval === "Draft" ? "pending" : approval === "Rejected" ? "rejected" : "done",
    },
    {
      step: "DA approval",
      officer: String(data.approvedBy ?? "[DA]"),
      status: approval === "Approved" ? "Done" : approval === "Verified" ? "Pending" : "Not started",
      date: String(data.approvedAt ?? "").slice(0, 10) || "—",
      tone: approval === "Approved" ? "done" : approval === "Verified" ? "pending" : "idle",
    },
  ];

  return (
    <AppShell
      breadcrumbs={[
        { label: "Premises allocations", href: "/assets/agreements" },
        { label: String(data.agreementNo ?? id) },
      ]}
    >
      <div className="space-y-4 max-w-4xl">
        {!manageLineId ? (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-semibold">Edit allotment: {premisesLabel}</h1>
                  <Badge variant="outline" className={renewalStatusBadgeClass(renewal)}>
                    {approval === "Draft"
                      ? "Draft · awaiting DV"
                      : approval === "Verified"
                        ? "Verified · awaiting DA"
                        : `${approval} · ${renewalStatusLabel(renewal)}`}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  {String(data.allotteeName)} · {String(data.agreementNo)}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {data.agreementDocFile ? (
                  <Button asChild variant="outline" size="sm">
                    <a href={`/api/ioms/premises-agreements/${id}/agreement-doc`} target="_blank" rel="noreferrer">
                      Open agreement PDF
                    </a>
                  </Button>
                ) : null}
                {approval === "Approved" && (
                  <Button asChild variant="default" size="sm">
                    <Link href={`/assets/agreements/leave-licence/new?premisesAgreementId=${id}`}>
                      Leave &amp; Licence
                    </Link>
                  </Button>
                )}
                <Button asChild variant="outline" size="sm">
                  <Link href={`/assets/agreements/${id}/renew`}>Renew</Link>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <Link href={`/assets/agreements/${id}/notice`}>Notice</Link>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <Link href={`/assets/agreements/${id}/history`}>History</Link>
                </Button>
              </div>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">1. Agreement summary</CardTitle>
                <p className="text-xs text-muted-foreground">Read-only here; change it through the draft.</p>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>Agreement ID: {String(data.agreementNo)}</div>
                  <div>Allottee: {String(data.allotteeName)}</div>
                  <div>Location / yard: {String(data.yardName ?? data.yardId ?? "—")}</div>
                  <div>
                    Validity: {ymdToDmy(String(data.fromDate))} to {ymdToDmy(String(data.toDate))}
                  </div>
                  <div>Agreement Period Number: Period {String(data.agreementPeriodNumber)}</div>
                  <div>
                    Rent Revision Frequency: {String(data.rentRevisionFrequency)} — next revision at Period{" "}
                    {Number(data.rentRevisionFrequency) + 1}
                    {Number(data.rentRevisionFrequency) > 0
                      ? `, ${Number(data.rentRevisionFrequency) * 2 + 1}, …`
                      : ""}
                  </div>
                </div>
                <div className="overflow-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left border-b">
                        <th className="py-2">Premises</th>
                        <th className="py-2">Type</th>
                        <th className="py-2">Area</th>
                        <th className="py-2">Rent</th>
                        <th className="py-2">Deposit</th>
                        <th className="py-2">Tenancy</th>
                        <th className="py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {premises.map((p) => (
                        <tr key={String(p.id)} className="border-b border-border/50">
                          <td className="py-2 font-mono text-xs">{String(p.premisesId)}</td>
                          <td className="py-2">{String(p.assetType ?? "—")}</td>
                          <td className="py-2">{Number(p.areaSqm ?? 0).toFixed(1)} sq m</td>
                          <td className="py-2">{formatInr(Number(p.monthlyRent ?? 0))}</td>
                          <td className="py-2">{formatInr(Number(p.depositShare ?? 0))}</td>
                          <td className="py-2">{String(p.tenancyStatus)}</td>
                          <td className="py-2">
                            {approval === "Approved" && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setManageLineId(String(p.id));
                                  setTenancyChoice(
                                    String(p.tenancyStatus) === "Vacating" || String(p.tenancyStatus) === "Vacated"
                                      ? (String(p.tenancyStatus) as "Vacating" | "Vacated")
                                      : "Active",
                                  );
                                }}
                              >
                                Manage
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="font-medium">
                        <td className="py-2" colSpan={2}>
                          Totals
                        </td>
                        <td className="py-2">{totalArea.toFixed(1)}</td>
                        <td className="py-2">{formatInr(totalRent)}</td>
                        <td className="py-2">{formatInr(totalDep || Number(data.totalSecurityDeposit ?? 0))}</td>
                        <td colSpan={2} />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">2. Signed agreement</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm">
                  <div>
                    {data.agreementDocFile ? (
                      <>
                        <div className="font-medium">{String(data.agreementDocFile)}</div>
                        <div className="text-muted-foreground text-xs">
                          Version kept on replace. Earlier versions are kept.
                        </div>
                      </>
                    ) : (
                      <span className="text-muted-foreground">No file attached yet.</span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    {data.agreementDocFile ? (
                      <Button asChild size="sm" variant="outline">
                        <a href={`/api/ioms/premises-agreements/${id}/agreement-doc`} target="_blank" rel="noreferrer">
                          View
                        </a>
                      </Button>
                    ) : null}
                    <input
                      ref={fileRef}
                      type="file"
                      accept=".pdf,application/pdf"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) upload.mutate(f);
                      }}
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={approval === "Approved"}
                      onClick={() => fileRef.current?.click()}
                    >
                      {data.agreementDocFile ? "Replace" : "Upload"}
                    </Button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">Replacing the file adds a new version. Earlier versions are kept.</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">3. Verification checklist</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <label className="flex items-start gap-2 text-sm">
                  <Checkbox checked={checkSigned} onCheckedChange={(c) => setCheckSigned(Boolean(c))} />
                  <span>Agreement is signed by both parties.</span>
                </label>
                <label className="flex items-start gap-2 text-sm">
                  <Checkbox checked={checkDates} onCheckedChange={(c) => setCheckDates(Boolean(c))} />
                  <span>Dates, period number and revision frequency match the draft.</span>
                </label>
                <label className="flex items-start gap-2 text-sm">
                  <Checkbox checked={checkRent} onCheckedChange={(c) => setCheckRent(Boolean(c))} />
                  <span>Rent and deposit match the draft for every premises.</span>
                </label>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">4. Approval trail</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left border-b">
                      <th className="py-2">Step</th>
                      <th className="py-2">Officer</th>
                      <th className="py-2">Status</th>
                      <th className="py-2">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trail.map((t) => (
                      <tr key={t.step} className="border-b border-border/50">
                        <td className="py-2">{t.step}</td>
                        <td className="py-2">{t.officer}</td>
                        <td className="py-2">
                          <Badge
                            variant="outline"
                            className={cn(
                              t.tone === "done" && "bg-emerald-500/10 text-emerald-700 border-emerald-500/20",
                              t.tone === "pending" && "bg-amber-500/10 text-amber-800 border-amber-500/30",
                              t.tone === "idle" && "bg-muted text-muted-foreground",
                              t.tone === "rejected" && "bg-destructive/10 text-destructive",
                            )}
                          >
                            {t.status}
                          </Badge>
                        </td>
                        <td className="py-2">{t.date !== "—" ? ymdToDmy(t.date) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <Alert>
                  <AlertDescription>
                    DA approval sets Approval to Approved and Tenancy to Active for all {premises.length} premises under
                    this agreement. Every step is written to the audit trail.
                  </AlertDescription>
                </Alert>
                <div className="space-y-1">
                  <Label>Remarks (required when returning or rejecting)</Label>
                  <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} />
                </div>
                <div className="flex flex-wrap justify-between gap-2">
                  <div className="flex gap-2">
                    {(approval === "Draft" || approval === "Verified") && canApprove && (
                      <Button
                        variant="outline"
                        className="text-destructive border-destructive/40"
                        onClick={() => workflow.mutate("Rejected")}
                        disabled={workflow.isPending}
                      >
                        Reject
                      </Button>
                    )}
                    {approval === "Verified" && canVerify && (
                      <Button variant="outline" onClick={() => workflow.mutate("Draft")} disabled={workflow.isPending}>
                        Return with remarks
                      </Button>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button asChild variant="outline">
                      <Link href="/assets/agreements">Cancel</Link>
                    </Button>
                    {approval === "Draft" && canVerify && (
                      <Button
                        onClick={() => {
                          if (!checkSigned || !checkDates || !checkRent) {
                            toast({
                              title: "Complete checklist",
                              description: "Tick all verification items before submitting.",
                              variant: "destructive",
                            });
                            return;
                          }
                          if (!data.agreementDocFile) {
                            toast({ title: "Upload signed agreement first", variant: "destructive" });
                            return;
                          }
                          workflow.mutate("Verified");
                        }}
                        disabled={workflow.isPending}
                      >
                        Submit for DV
                      </Button>
                    )}
                    {approval === "Verified" && canApprove && (
                      <Button onClick={() => workflow.mutate("Approved")} disabled={workflow.isPending}>
                        DA Approve
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </>
        ) : (
          <>
            <div>
              <h1 className="text-2xl font-semibold">Manage premises allocation</h1>
              <p className="text-sm text-muted-foreground">
                {String(manageLine?.premisesId)} · {String(data.agreementNo)}
                {data.allotmentRefNo ? ` · ${String(data.allotmentRefNo)}` : ""}
              </p>
              <div className="flex gap-2 mt-2">
                <Badge>{approval}</Badge>
                <Badge variant="secondary">{String(manageLine?.tenancyStatus)}</Badge>
                {data.agreementDocFile ? (
                  <Button asChild size="sm" variant="outline">
                    <a href={`/api/ioms/premises-agreements/${id}/agreement-doc`} target="_blank" rel="noreferrer">
                      Open agreement PDF
                    </a>
                  </Button>
                ) : null}
              </div>
            </div>

            <Alert>
              <AlertDescription>
                Lessee: {String(data.allotteeName)}. Agreement {ymdToDmy(String(data.fromDate))} to{" "}
                {ymdToDmy(String(data.toDate))}. Rent {formatInr(Number(manageLine?.monthlyRent ?? 0))}; Security deposit{" "}
                {formatInr(Number(manageLine?.depositShare ?? 0))}. This agreement covers {premises.length} premises
                {premises.length === 1
                  ? ", so vacating it ends the agreement."
                  : "; only the selected premises is vacated."}
              </AlertDescription>
            </Alert>

            <Card>
              <CardHeader>
                <CardTitle>Tenancy status</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {(
                  [
                    {
                      id: "Active" as const,
                      title: "Active",
                      body: "Premises is in use. Renewal, rent revision and penalty rules apply.",
                    },
                    {
                      id: "Vacating" as const,
                      title: "Vacating",
                      body: "The lessee has given prior intimation to vacate before the agreement end date. Opens the vacation intimation form.",
                    },
                    {
                      id: "Vacated" as const,
                      title: "Vacated",
                      body: "Premises is handed back, on the agreement end date or by an eviction order. Opens the vacation record and starts the Full and Final Settlement.",
                    },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setTenancyChoice(opt.id)}
                    className={cn(
                      "w-full text-left rounded-lg border p-4",
                      tenancyChoice === opt.id ? "border-primary bg-primary/5" : "hover:bg-muted/40",
                    )}
                  >
                    <div className="flex gap-3">
                      <span
                        className={cn(
                          "mt-1 h-4 w-4 rounded-full border",
                          tenancyChoice === opt.id ? "border-primary bg-primary" : "border-muted-foreground",
                        )}
                      />
                      <div>
                        <div className="font-medium">{opt.title}</div>
                        <p className="text-sm text-muted-foreground">{opt.body}</p>
                      </div>
                    </div>
                  </button>
                ))}
                {tenancyChoice === "Vacated" && (
                  <div className="space-y-1 max-w-sm">
                    <Label>Vacated on</Label>
                    <Input type="date" value={vacatedOn} onChange={(e) => setVacatedOn(e.target.value)} />
                    <p className="text-xs text-muted-foreground">
                      Required for Vacated. It cannot be a future date. This is the date used to calculate the settlement.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Related records for this premises</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                <Badge variant="outline">Vacation intimation: none</Badge>
                <Badge variant="outline">Settlement: not started</Badge>
                <Button asChild size="sm" variant="outline">
                  <Link href={`/assets/agreements/${id}/history`}>History and audit trail</Link>
                </Button>
              </CardContent>
            </Card>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setManageLineId(null)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  if (tenancyChoice === "Active") {
                    toast({ title: "Tenancy remains Active" });
                    setManageLineId(null);
                    return;
                  }
                  window.location.href = `/assets/agreements/${id}/lines/${manageLineId}/vacation`;
                }}
              >
                {tenancyChoice === "Active" ? "Save" : "Continue to vacation form"}
              </Button>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
