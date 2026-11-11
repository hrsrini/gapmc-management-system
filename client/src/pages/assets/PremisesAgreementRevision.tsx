import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearch } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
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
import { isRentRevisionDueForPeriod } from "@shared/premises-agreement";

type PremisesLine = {
  id: string;
  premisesId?: string;
  monthlyRent?: number;
  assetType?: string;
  areaSqm?: number;
};

export default function PremisesAgreementRevision() {
  const { id } = useParams<{ id: string }>();
  const search = useSearch();
  const renewalId = new URLSearchParams(search).get("renewalId") ?? undefined;
  const { toast } = useToast();
  const { data: agr } = useQuery<Record<string, unknown>>({
    queryKey: [`/api/ioms/premises-agreements/${id}`],
    enabled: Boolean(id),
  });
  const { data: history } = useQuery<{
    revisions: Array<Record<string, unknown>>;
  }>({ queryKey: [`/api/ioms/premises-agreements/${id}/history`], enabled: Boolean(id) });

  const premises = useMemo(
    () => (agr?.premises as PremisesLine[]) ?? [],
    [agr],
  );
  const [effectiveDate, setEffectiveDate] = useState(new Date().toISOString().slice(0, 10));
  const [basis, setBasis] = useState("FixedMonthly");
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [revised, setRevised] = useState<Record<string, string>>({});
  const [pct, setPct] = useState("10");
  const [remarks, setRemarks] = useState("");

  useEffect(() => {
    if (!premises.length) return;
    setTicked((prev) => {
      if (Object.keys(prev).length) return prev;
      return Object.fromEntries(premises.map((p) => [p.id, true]));
    });
  }, [premises]);

  const create = useMutation({
    mutationFn: async () => {
      const lines = premises
        .filter((p) => ticked[p.id])
        .map((p) => ({
          agreementLineId: p.id,
          revisedRent: Number(revised[p.id] ?? p.monthlyRent ?? 0),
        }));
      const res = await fetch(`/api/ioms/premises-agreements/${id}/revisions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ effectiveDate, revisionBasis: basis, renewalId, remarks, lines }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error ?? res.statusText);
      return body as { id: string };
    },
    onSuccess: (body) => {
      toast({ title: "Revision draft created", description: "Submit from Approvals queue." });
      window.location.href = `/assets/agreements/approvals?batch=${body.id}`;
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const day = Number(effectiveDate.slice(8, 10) || 0);
  const midMonth = day > 1;
  const period = Number(agr?.agreementPeriodNumber ?? 1);
  const freq = Number(agr?.rentRevisionFrequency ?? 3);
  const due = isRentRevisionDueForPeriod(period + 1, freq);
  const selectedCount = premises.filter((p) => ticked[p.id]).length;

  const totals = premises.reduce(
    (acc, p) => {
      const existing = Number(p.monthlyRent ?? 0);
      const next = Number(revised[p.id] ?? existing);
      acc.area += Number(p.areaSqm ?? 0);
      acc.existing += existing;
      acc.revised += next;
      acc.change += next - existing;
      return acc;
    },
    { area: 0, existing: 0, revised: 0, change: 0 },
  );

  return (
    <AppShell
      breadcrumbs={[
        { label: "Agreements", href: "/assets/agreements" },
        { label: String(agr?.agreementNo ?? id), href: `/assets/agreements/${id}` },
        { label: "Rent revision" },
      ]}
    >
      <div className="space-y-4 max-w-5xl">
        <h1 className="text-2xl font-semibold">Rent revision</h1>

        <Card>
          <CardContent className="pt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
            <div className="sm:col-span-2 space-y-1">
              <Label>Allotment (agreement)</Label>
              <div className="rounded-md border px-3 py-2 bg-muted/30">
                {String(agr?.allotteeName)} — {String(agr?.agreementNo)}
              </div>
            </div>
            <div className="space-y-1">
              <Label>Effective date</Label>
              <Input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Revision basis</Label>
              <Select value={basis} onValueChange={setBasis}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="FixedMonthly">Fixed monthly (₹)</SelectItem>
                  <SelectItem value="Percent">Percentage</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Alert>
          <AlertDescription>
            Premises: {premises.length} under this agreement. Validity: {ymdToDmy(String(agr?.fromDate))} to{" "}
            {ymdToDmy(String(agr?.toDate))}. Agreement period: Period {period}, frequency {freq}. Linked renewal:{" "}
            {renewalId ? renewalId.slice(0, 8) + "…" : "Not linked (stand-alone revision)"}. Status:{" "}
            {due ? "Revision due at next period" : `Not due until Period ${period + (freq - (period % freq || freq))}`}.
          </AlertDescription>
        </Alert>

        {midMonth && (
          <Alert className="border-amber-500/40 bg-amber-500/10">
            <AlertDescription>
              Mid-month date: the month of {ymdToDmy(effectiveDate)} will have two rates. Invoices already issued are not
              re-posted automatically.
            </AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-base">Revise rent premises-wise</CardTitle>
            <div className="flex items-end gap-2">
              <div className="space-y-1">
                <Label className="text-xs">% change vs current rent</Label>
                <Input className="w-24" value={pct} onChange={(e) => setPct(e.target.value)} />
              </div>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  const rate = Number(pct) || 0;
                  const next = { ...revised };
                  for (const p of premises) {
                    if (!ticked[p.id]) continue;
                    const base = Number(p.monthlyRent ?? 0);
                    next[p.id] = String(Math.round(base * (1 + rate / 100) * 100) / 100);
                  }
                  setRevised(next);
                }}
              >
                Apply to ticked premises
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b">
                    <th className="py-2 pr-2" />
                    <th className="py-2 pr-2">Premises</th>
                    <th className="py-2 pr-2">Type</th>
                    <th className="py-2 pr-2">Area (sq m)</th>
                    <th className="py-2 pr-2">Current rent (₹)</th>
                    <th className="py-2 pr-2">Change (₹)</th>
                    <th className="py-2 pr-2">Revised rent (₹)</th>
                    <th className="py-2">Change (%)</th>
                  </tr>
                </thead>
                <tbody>
                  {premises.map((p) => {
                    const existing = Number(p.monthlyRent ?? 0);
                    const next = Number(revised[p.id] ?? existing);
                    const delta = next - existing;
                    const pctCh = existing > 0 ? (delta / existing) * 100 : 0;
                    return (
                      <tr key={p.id} className="border-b border-border/50">
                        <td className="py-2 pr-2">
                          <Checkbox
                            checked={Boolean(ticked[p.id])}
                            onCheckedChange={(c) => setTicked((t) => ({ ...t, [p.id]: Boolean(c) }))}
                          />
                        </td>
                        <td className="py-2 pr-2 font-mono text-xs">{p.premisesId}</td>
                        <td className="py-2 pr-2">{p.assetType ?? "—"}</td>
                        <td className="py-2 pr-2">{Number(p.areaSqm ?? 0).toFixed(1)}</td>
                        <td className="py-2 pr-2">{formatInr(existing)}</td>
                        <td className="py-2 pr-2">
                          {delta >= 0 ? "+" : ""}
                          {formatInr(delta)}
                        </td>
                        <td className="py-2 pr-2">
                          <Input
                            className="w-28"
                            value={revised[p.id] ?? String(existing)}
                            onChange={(e) => setRevised((r) => ({ ...r, [p.id]: e.target.value }))}
                          />
                        </td>
                        <td className="py-2">{pctCh.toFixed(1)}%</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="font-medium">
                    <td />
                    <td className="py-2" colSpan={2}>
                      Total
                    </td>
                    <td className="py-2">{totals.area.toFixed(1)}</td>
                    <td className="py-2">{formatInr(totals.existing)}</td>
                    <td className="py-2">{formatInr(totals.change)}</td>
                    <td className="py-2">{formatInr(totals.revised)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className="space-y-1">
              <Label>Remarks</Label>
              <Textarea
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="Optional note (applies to every premises in this revision)"
              />
            </div>
            <div className="flex gap-2">
              <Button
                disabled={create.isPending || selectedCount === 0}
                onClick={() => create.mutate()}
              >
                Create draft ({selectedCount} premises)
              </Button>
              <Button asChild variant="outline">
                <Link href={`/assets/agreements/${id}`}>Back</Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Revision history</CardTitle>
          </CardHeader>
          <CardContent className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-2 pr-2">Effective date</th>
                  <th className="py-2 pr-2">Batch</th>
                  <th className="py-2 pr-2">Status</th>
                  <th className="py-2 pr-2">Basis</th>
                  <th className="py-2 pr-2">Renewal link</th>
                  <th className="py-2">Approval</th>
                </tr>
              </thead>
              <tbody>
                {(history?.revisions ?? []).map((b) => (
                  <tr key={String(b.id)} className="border-b border-border/50">
                    <td className="py-2 pr-2">{ymdToDmy(String(b.effectiveDate))}</td>
                    <td className="py-2 pr-2 font-mono text-xs">{String(b.id).slice(0, 8)}</td>
                    <td className="py-2 pr-2">
                      <Badge variant="outline">{String(b.status)}</Badge>
                    </td>
                    <td className="py-2 pr-2">{String(b.revisionBasis ?? "—")}</td>
                    <td className="py-2 pr-2">{b.renewalId ? "Linked" : "None"}</td>
                    <td className="py-2">{String(b.status) === "Draft" ? "Not submitted" : String(b.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(history?.revisions ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">No revision batches yet.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
