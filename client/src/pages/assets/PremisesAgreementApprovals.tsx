import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { formatInr } from "@/lib/formatInr";
import { ymdToDmy } from "@/lib/premisesAgreementUi";

export default function PremisesAgreementApprovals() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, refetch } = useQuery<{
    revisions: Array<Record<string, unknown>>;
    penalties: Array<Record<string, unknown>>;
  }>({ queryKey: ["/api/ioms/premises-agreements-approvals"] });
  const [remarks, setRemarks] = useState("");
  const [selectedRevId, setSelectedRevId] = useState<string | null>(null);

  const { data: selectedBatch } = useQuery<Record<string, unknown> & { lines?: Array<Record<string, unknown>> }>({
    queryKey: [`/api/ioms/rent-revision-batches/${selectedRevId}`],
    enabled: Boolean(selectedRevId),
  });

  const revisions = data?.revisions ?? [];
  const penalties = data?.penalties ?? [];
  const selected = useMemo(
    () => revisions.find((r) => String(r.id) === selectedRevId) ?? null,
    [revisions, selectedRevId],
  );

  const revAction = useMutation({
    mutationFn: async (args: { id: string; status: string }) => {
      if ((args.status === "Returned" || args.status === "Rejected") && remarks.trim().length < 3) {
        throw new Error("Remarks are required when returning or rejecting.");
      }
      const res = await fetch(`/api/ioms/rent-revision-batches/${args.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status: args.status, remarks }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error ?? res.statusText);
      return body;
    },
    onSuccess: () => {
      toast({ title: "Revision updated" });
      setRemarks("");
      void refetch();
      void qc.invalidateQueries({ queryKey: ["/api/ioms/premises-agreements/summary"] });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const penAction = useMutation({
    mutationFn: async (args: { id: string; status: string }) => {
      if ((args.status === "Returned" || args.status === "Rejected") && remarks.trim().length < 3) {
        throw new Error("Remarks are required when returning or rejecting.");
      }
      const res = await fetch(`/api/ioms/delay-penalties/${args.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status: args.status, remarks }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error ?? res.statusText);
      return body;
    },
    onSuccess: () => {
      toast({ title: "Penalty updated" });
      setRemarks("");
      void refetch();
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const line0 = selectedBatch?.lines?.[0];
  const oldRent = Number(line0?.existingRent ?? 0);
  const newRent = Number(line0?.revisedRent ?? 0);
  const pct = oldRent > 0 ? ((newRent - oldRent) / oldRent) * 100 : 0;

  return (
    <AppShell
      breadcrumbs={[
        { label: "Premises allocations", href: "/assets/agreements" },
        { label: "Approvals queue" },
      ]}
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl font-semibold">Approvals queue</h1>
            <p className="text-sm text-muted-foreground">
              Rent revisions and penalties wait here for verification and approval. Nothing takes effect until it is
              approved, and every decision is written to the history.
            </p>
          </div>
          <Button asChild variant="outline">
            <Link href="/assets/agreements">Back</Link>
          </Button>
        </div>

        <Tabs defaultValue="revisions">
          <TabsList>
            <TabsTrigger value="revisions">Rent revisions ({revisions.length})</TabsTrigger>
            <TabsTrigger value="penalties">Penalties ({penalties.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="revisions">
            <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
              <Card>
                <CardContent className="pt-4 overflow-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left border-b">
                        <th className="py-2 pr-2">Agreement</th>
                        <th className="py-2 pr-2">Effective</th>
                        <th className="py-2 pr-2">Linked to</th>
                        <th className="py-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {revisions.map((r) => (
                        <tr
                          key={String(r.id)}
                          className={`border-b cursor-pointer hover:bg-muted/40 ${
                            selectedRevId === String(r.id) ? "bg-primary/5" : ""
                          }`}
                          onClick={() => setSelectedRevId(String(r.id))}
                        >
                          <td className="py-2 pr-2 font-mono text-xs">{String(r.agreementId).slice(0, 10)}…</td>
                          <td className="py-2 pr-2">{ymdToDmy(String(r.effectiveDate))}</td>
                          <td className="py-2 pr-2">{r.renewalId ? "Renewal linked" : "Stand-alone"}</td>
                          <td className="py-2">
                            <Badge variant="outline" className="bg-amber-500/10 text-amber-800 border-amber-500/30">
                              {String(r.status) === "Verified" ? "Pending approval" : String(r.status)}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {revisions.length === 0 && <p className="text-sm text-muted-foreground py-4">No pending revisions.</p>}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">
                    {selected ? `Revision ${String(selected.id).slice(0, 8)}…` : "Select a revision"}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  {selected && line0 ? (
                    <>
                      <div>Old rent: {formatInr(oldRent)}</div>
                      <div>
                        New rent: {formatInr(newRent)} ({pct >= 0 ? "+" : ""}
                        {pct.toFixed(1)}%)
                      </div>
                      <div>Effective date: {ymdToDmy(String(selected.effectiveDate))}</div>
                      <div>Basis: {String(selected.revisionBasis)}</div>
                      {selected.renewalId ? (
                        <Alert>
                          <AlertDescription>
                            Approving this revision allows the linked renewal to be completed. Rejecting it keeps the
                            renewal blocked.
                          </AlertDescription>
                        </Alert>
                      ) : null}
                      <div className="space-y-1">
                        <Label>Remarks</Label>
                        <Textarea
                          placeholder="Required when returning or rejecting."
                          value={remarks}
                          onChange={(e) => setRemarks(e.target.value)}
                        />
                      </div>
                      <div className="flex flex-wrap gap-2 justify-end">
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => revAction.mutate({ id: String(selected.id), status: "Rejected" })}
                        >
                          Reject
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => revAction.mutate({ id: String(selected.id), status: "Returned" })}
                        >
                          Return
                        </Button>
                        <Button
                          size="sm"
                          onClick={() =>
                            revAction.mutate({
                              id: String(selected.id),
                              status: String(selected.status) === "Draft" ? "Verified" : "Approved",
                            })
                          }
                        >
                          {String(selected.status) === "Draft" ? "Verify" : "Approve"}
                        </Button>
                      </div>
                      <Button asChild size="sm" variant="ghost">
                        <Link href={`/assets/agreements/${String(selected.agreementId)}`}>Open agreement</Link>
                      </Button>
                    </>
                  ) : (
                    <p className="text-muted-foreground">Choose a row to review and approve.</p>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="penalties" className="space-y-3">
            <div className="space-y-1 max-w-xl">
              <Label>Remarks</Label>
              <Textarea placeholder="Required when returning or rejecting." value={remarks} onChange={(e) => setRemarks(e.target.value)} />
            </div>
            {penalties.map((p) => (
              <Card key={String(p.id)}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">
                    {String(p.daysOfDelay)} days · {formatInr(Number(p.calculatedAmount ?? 0))} · {String(p.status)}
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2 text-sm">
                  <span>
                    {String(p.method)} @ {String(p.rate)} · expiry {ymdToDmy(String(p.expiryDate))} →{" "}
                    {ymdToDmy(String(p.regularisationDate))}
                  </span>
                  <div className="w-full flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => penAction.mutate({ id: String(p.id), status: "Verified" })}>
                      Verify
                    </Button>
                    <Button size="sm" onClick={() => penAction.mutate({ id: String(p.id), status: "Approved" })}>
                      Approve
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => penAction.mutate({ id: String(p.id), status: "Returned" })}>
                      Return
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => penAction.mutate({ id: String(p.id), status: "Rejected" })}>
                      Reject
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
            {penalties.length === 0 && <p className="text-sm text-muted-foreground">No pending penalties.</p>}
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
