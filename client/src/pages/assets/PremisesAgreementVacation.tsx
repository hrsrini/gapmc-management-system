import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { formatInr } from "@/lib/formatInr";
import { ymdToDmy } from "@/lib/premisesAgreementUi";
import { cn } from "@/lib/utils";

const CASES = [
  {
    id: "PrematureIntimation",
    title: "Premature vacation intimation",
    body: "The lessee wants to vacate before the end date. Prior intimation is mandatory. Records the proposed date; the premises becomes Vacating.",
  },
  {
    id: "EndDateVacation",
    title: "Vacated on agreement end date",
    body: "No intimation needed. The official records the actual vacation date.",
  },
  {
    id: "EvictionByOrder",
    title: "Eviction by order",
    body: "Premises vacated under an Estate Officer order or a Government Order. Order details are recorded separately.",
  },
] as const;

export default function PremisesAgreementVacation() {
  const { id, lineId } = useParams<{ id: string; lineId: string }>();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: agr } = useQuery<Record<string, unknown>>({
    queryKey: [`/api/ioms/premises-agreements/${id}`],
    enabled: Boolean(id),
  });
  const premises = ((agr?.premises as Array<Record<string, unknown>>) ?? []).find((p) => String(p.id) === lineId);
  const [caseType, setCaseType] = useState<(typeof CASES)[number]["id"]>("EvictionByOrder");
  const [intimationDate, setIntimationDate] = useState(new Date().toISOString().slice(0, 10));
  const [proposedDate, setProposedDate] = useState("");
  const [actualDate, setActualDate] = useState(new Date().toISOString().slice(0, 10));
  const [orderType, setOrderType] = useState("EstateOfficerOrder");
  const [orderRef, setOrderRef] = useState("");
  const [orderDate, setOrderDate] = useState("");
  const [remarks, setRemarks] = useState("");
  const [settlement, setSettlement] = useState<Record<string, unknown> | null>(null);
  const [demand, setDemand] = useState<Record<string, unknown> | null>(null);
  const [adjType, setAdjType] = useState("AdditionalReceivable");
  const [adjAmount, setAdjAmount] = useState("");
  const [adjReason, setAdjReason] = useState("");
  const [proposedAdj, setProposedAdj] = useState<Array<{ type: string; amount: number; reason: string }>>([]);

  const vacate = useMutation({
    mutationFn: async () => {
      if (caseType === "EvictionByOrder" && (!orderRef.trim() || !orderDate || !actualDate)) {
        throw new Error("Order reference, order date and actual eviction date are required.");
      }
      const res = await fetch(`/api/ioms/premises-agreements/${id}/lines/${lineId}/vacation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          caseType,
          intimationDate: caseType === "PrematureIntimation" ? intimationDate : undefined,
          proposedVacationDate: caseType === "PrematureIntimation" ? proposedDate || undefined : undefined,
          actualVacationDate:
            caseType === "PrematureIntimation" && !actualDate ? undefined : actualDate || undefined,
          orderType: caseType === "EvictionByOrder" ? orderType : undefined,
          orderRefNo: caseType === "EvictionByOrder" ? orderRef : undefined,
          orderDate: caseType === "EvictionByOrder" ? orderDate : undefined,
          remarks,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error ?? res.statusText);
      return body as { settlement: Record<string, unknown> };
    },
    onSuccess: (body) => {
      setSettlement(body.settlement);
      toast({ title: "Vacation recorded", description: "Settlement draft created." });
      void qc.invalidateQueries({ queryKey: [`/api/ioms/premises-agreements/${id}`] });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const approve = useMutation({
    mutationFn: async () => {
      if (!settlement?.id) throw new Error("No settlement");
      const additional = proposedAdj
        .filter((a) => a.type === "AdditionalReceivable")
        .reduce((s, a) => s + a.amount, 0);
      const system = Number(settlement.systemCalculatedNet ?? 0);
      const res = await fetch(`/api/ioms/full-final-settlements/${String(settlement.id)}/approve`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          approvedAdjustments: proposedAdj,
          finalApprovedNet: system + additional,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error ?? res.statusText);
      return body as Record<string, unknown>;
    },
    onSuccess: (body) => {
      setSettlement(body);
      toast({ title: "Settlement approved" });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const demandNotice = useMutation({
    mutationFn: async () => {
      if (!settlement?.id) throw new Error("No settlement");
      const res = await fetch(`/api/ioms/full-final-settlements/${String(settlement.id)}/demand-notice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({}),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error ?? res.statusText);
      return body as Record<string, unknown>;
    },
    onSuccess: (body) => {
      setDemand(body);
      toast({ title: "Final demand notice generated" });
      window.open(`/api/ioms/final-demand-notices/${String(body.id)}/pdf`, "_blank");
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const proposedTotal = useMemo(
    () => proposedAdj.reduce((s, a) => s + a.amount, 0),
    [proposedAdj],
  );
  const systemNet = Number(settlement?.systemCalculatedNet ?? 0);

  return (
    <AppShell
      breadcrumbs={[
        { label: "Agreements", href: "/assets/agreements" },
        { label: String(agr?.agreementNo ?? id), href: `/assets/agreements/${id}` },
        { label: "Vacation / settlement" },
      ]}
    >
      <div className="space-y-4 max-w-4xl">
        {!settlement ? (
          <>
            <div>
              <h1 className="text-2xl font-semibold">Record vacation or eviction</h1>
              <p className="text-sm text-muted-foreground">
                {String(premises?.premisesId ?? lineId)} · {String(agr?.agreementNo)} · {String(agr?.allotteeName)} ·
                Agreement ends {ymdToDmy(String(agr?.toDate))}
              </p>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>What happened?</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {CASES.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setCaseType(c.id)}
                    className={cn(
                      "w-full text-left rounded-lg border p-4 transition-colors",
                      caseType === c.id ? "border-primary bg-primary/5" : "hover:bg-muted/40",
                    )}
                  >
                    <div className="flex gap-3">
                      <span
                        className={cn(
                          "mt-1 h-4 w-4 rounded-full border",
                          caseType === c.id ? "border-primary bg-primary" : "border-muted-foreground",
                        )}
                      />
                      <div>
                        <div className="font-medium">{c.title}</div>
                        <p className="text-sm text-muted-foreground">{c.body}</p>
                      </div>
                    </div>
                  </button>
                ))}
              </CardContent>
            </Card>

            {caseType === "PrematureIntimation" && (
              <Card>
                <CardHeader>
                  <CardTitle>Intimation details</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label>Intimation date *</Label>
                    <Input type="date" value={intimationDate} onChange={(e) => setIntimationDate(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label>Proposed vacation date *</Label>
                    <Input type="date" value={proposedDate} onChange={(e) => setProposedDate(e.target.value)} />
                  </div>
                </CardContent>
              </Card>
            )}

            {caseType === "EndDateVacation" && (
              <Card>
                <CardHeader>
                  <CardTitle>Vacation details</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1 max-w-sm">
                    <Label>Actual date of vacation *</Label>
                    <Input type="date" value={actualDate} onChange={(e) => setActualDate(e.target.value)} />
                    <p className="text-xs text-muted-foreground">Rent and interest are calculated up to this date.</p>
                  </div>
                </CardContent>
              </Card>
            )}

            {caseType === "EvictionByOrder" && (
              <Card>
                <CardHeader>
                  <CardTitle>Eviction details</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label>Eviction order type *</Label>
                    <Select value={orderType} onValueChange={setOrderType}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="EstateOfficerOrder">Estate Officer order</SelectItem>
                        <SelectItem value="GovernmentOrder">Government Order</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label>Order reference number *</Label>
                    <Input value={orderRef} onChange={(e) => setOrderRef(e.target.value)} placeholder="[Order number]" />
                  </div>
                  <div className="space-y-1">
                    <Label>Order date *</Label>
                    <Input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label>Actual date of eviction *</Label>
                    <Input type="date" value={actualDate} onChange={(e) => setActualDate(e.target.value)} />
                    <p className="text-xs text-muted-foreground">Rent and interest are calculated up to this date.</p>
                  </div>
                  <div className="sm:col-span-2 rounded-md border border-dashed p-4 text-sm text-muted-foreground flex items-center justify-between">
                    <span>Supporting order document — PDF, required. No file attached yet.</span>
                    <Button type="button" variant="outline" size="sm" disabled>
                      Attach file
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            <div className="space-y-1">
              <Label>Remarks</Label>
              <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} />
            </div>
            <Alert>
              <AlertDescription>
                Saving this record sets the premises to Vacated (or Vacating for premature intimation) and creates the
                Full and Final Settlement for approval. The intimation, vacation and settlement stay linked to this
                agreement and premises.
              </AlertDescription>
            </Alert>
            <div className="flex justify-end gap-2">
              <Button asChild variant="outline">
                <Link href={`/assets/agreements/${id}`}>Cancel</Link>
              </Button>
              <Button onClick={() => vacate.mutate()} disabled={vacate.isPending}>
                Save and calculate settlement
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h1 className="text-2xl font-semibold">
                  Full and Final Settlement: {String(premises?.premisesId ?? "")}
                </h1>
                <div className="flex gap-2 mt-1">
                  <Badge variant="outline" className="bg-amber-500/10 text-amber-800 border-amber-500/30">
                    {String(settlement.status) === "Approved" ? "Approved" : "Pending verification"}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  Agreement {String(agr?.agreementNo)} · {String(agr?.allotteeName)} · Eviction/vacation on{" "}
                  {ymdToDmy(actualDate)}. All amounts are calculated up to this date.
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">System-calculated balance</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-xl font-semibold">{formatInr(systemNet)}</div>
                  <p className="text-xs text-muted-foreground">
                    {systemNet >= 0 ? "Recoverable from lessee" : "Refundable to lessee"}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Proposed adjustments</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-xl font-semibold">+ {formatInr(proposedTotal)}</div>
                  <p className="text-xs text-muted-foreground">{proposedAdj.length} awaiting approval</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Approved adjustments</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-xl font-semibold">
                    {formatInr(settlement.status === "Approved" ? proposedTotal : 0)}
                  </div>
                </CardContent>
              </Card>
              <Card className="border-primary/40">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Final approved settlement</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-xl font-semibold">
                    {settlement.finalApprovedNet != null
                      ? formatInr(Number(settlement.finalApprovedNet))
                      : "Not approved yet"}
                  </div>
                  {settlement.status !== "Approved" && (
                    <p className="text-xs text-muted-foreground">
                      If approved as proposed: {formatInr(systemNet + proposedTotal)} recoverable
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Settlement calculation</CardTitle>
                </CardHeader>
                <CardContent className="text-sm space-y-2">
                  <div className="flex justify-between">
                    <span>Outstanding rent</span>
                    <span>{formatInr(Number(settlement.outstandingRent ?? 0))}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Applicable interest</span>
                    <span>{formatInr(Number(settlement.interestAmount ?? 0))}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Other outstanding dues</span>
                    <span>{formatInr(Number(settlement.otherDues ?? 0))}</span>
                  </div>
                  <div className="flex justify-between text-amber-800">
                    <span>Additional receivable (proposed)</span>
                    <span>{formatInr(proposedTotal)}</span>
                  </div>
                  <div className="flex justify-between font-medium border-t pt-2">
                    <span>Total outstanding amount</span>
                    <span>
                      {formatInr(
                        Number(settlement.outstandingRent ?? 0) +
                          Number(settlement.interestAmount ?? 0) +
                          Number(settlement.otherDues ?? 0) +
                          proposedTotal,
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Total security deposit held</span>
                    <span>{formatInr(Number(settlement.depositHeld ?? 0))}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Deposit adjusted against dues</span>
                    <span>{formatInr(Number(settlement.depositHeld ?? 0) - Number(settlement.deductions ?? 0))}</span>
                  </div>
                  <div className="flex justify-between bg-amber-500/10 -mx-2 px-2 py-1 rounded">
                    <span>Balance recoverable from lessee</span>
                    <span className="font-semibold">{formatInr(systemNet + proposedTotal)}</span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Manual adjustments</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  {proposedAdj.map((a, i) => (
                    <div key={`${a.reason}-${i}`} className="border rounded-md p-3 flex justify-between gap-2">
                      <div>
                        <div className="font-medium">
                          {a.type}: {formatInr(a.amount)}
                        </div>
                        <div className="text-muted-foreground">{a.reason}</div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setProposedAdj((list) => list.filter((_, j) => j !== i))}
                      >
                        Reject
                      </Button>
                    </div>
                  ))}
                  <div className="space-y-2 border-t pt-3">
                    <Label>Type</Label>
                    <Select value={adjType} onValueChange={setAdjType}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="AdditionalReceivable">Additional receivable</SelectItem>
                        <SelectItem value="DeductionFromDeposit">Deduction from deposit</SelectItem>
                      </SelectContent>
                    </Select>
                    <Label>Amount (Rs.)</Label>
                    <Input value={adjAmount} onChange={(e) => setAdjAmount(e.target.value)} />
                    <Label>Reason (required)</Label>
                    <Textarea value={adjReason} onChange={(e) => setAdjReason(e.target.value)} />
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => {
                        if (!adjReason.trim() || !(Number(adjAmount) > 0)) {
                          toast({ title: "Amount and reason required", variant: "destructive" });
                          return;
                        }
                        setProposedAdj((list) => [
                          ...list,
                          { type: adjType, amount: Number(adjAmount), reason: adjReason.trim() },
                        ]);
                        setAdjAmount("");
                        setAdjReason("");
                      }}
                    >
                      Add for approval
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="flex flex-wrap justify-between gap-2 border-t pt-3">
              <div className="flex gap-2">
                <Button asChild variant="outline">
                  <Link href={`/assets/agreements/${id}`}>Return</Link>
                </Button>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => window.print()}>
                  Print statement
                </Button>
                <Button
                  onClick={() => approve.mutate()}
                  disabled={approve.isPending || settlement.status === "Approved"}
                >
                  Verify and approve settlement
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => demandNotice.mutate()}
                  disabled={demandNotice.isPending || settlement.status !== "Approved"}
                >
                  Final Demand Notice
                </Button>
                {demand?.id != null ? (
                  <Button asChild variant="outline">
                    <a href={`/api/ioms/final-demand-notices/${String(demand.id)}/pdf`} target="_blank" rel="noreferrer">
                      Open demand PDF
                    </a>
                  </Button>
                ) : null}
              </div>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
