import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { formatInr } from "@/lib/formatInr";
import { localCalendarYmd } from "@shared/premises-allocation";
import { computeSdRefundNet } from "@shared/premises-security-deposit";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { downloadIomsReceiptPdf } from "@/lib/downloadIomsReceiptPdf";

type LicenceOpt = { id: string; firmName: string; yardId: string };
type EntityOpt = { id: string; name: string; yardId: string; entityCode?: string | null };
type DepositRow = {
  id: string;
  premisesLabel?: string | null;
  amount: number;
  status: string;
  depositReceiptNo?: string | null;
  depositReceiptDate?: string | null;
  vacatedOn?: string | null;
  yardId: string;
};
type Deduction = { reason: string; amount: string };
type ProposalDetail = {
  id: string;
  proposalNo: string;
  status: string;
  payerType: string;
  payerRefId: string;
  yardId: string;
  paymentMode?: string | null;
  paymentDate?: string | null;
  chequeNo?: string | null;
  chequeDate?: string | null;
  bankName?: string | null;
  utrRef?: string | null;
  netPayable: number;
  selectedDepositTotal: number;
  deductionsTotal: number;
  refundReceiptId?: string | null;
  refundReceiptNo?: string | null;
  returnOrRejectRemarks?: string | null;
  deposits: DepositRow[];
  deductions: Array<{ reason: string; amount: number }>;
};

export default function PremisesSdRefundForm() {
  const { id: routeId } = useParams<{ id?: string }>();
  const { can, user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [payerKind, setPayerKind] = useState<"TraderLicence" | "Entity">("TraderLicence");
  const [payerRefId, setPayerRefId] = useState("");
  const [yardId, setYardId] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [deductions, setDeductions] = useState<Deduction[]>([{ reason: "", amount: "" }]);
  const [paymentMode, setPaymentMode] = useState("Cash");
  const [paymentDate, setPaymentDate] = useState(localCalendarYmd());
  const [chequeNo, setChequeNo] = useState("");
  const [chequeDate, setChequeDate] = useState("");
  const [bankName, setBankName] = useState("");
  const [utrRef, setUtrRef] = useState("");
  const [remarks, setRemarks] = useState("");
  const [proposalId, setProposalId] = useState<string | undefined>(routeId);

  const { data: licences = [] } = useQuery<LicenceOpt[]>({ queryKey: ["/api/ioms/traders/licences"] });
  const { data: entities = [] } = useQuery<EntityOpt[]>({ queryKey: ["/api/ioms/entities"] });

  const { data: existing } = useQuery<ProposalDetail>({
    queryKey: ["/api/ioms/sd-refund-proposals", proposalId],
    enabled: !!proposalId,
  });

  useEffect(() => {
    if (!existing) return;
    setPayerKind((existing.payerType as "TraderLicence" | "Entity") || "TraderLicence");
    setPayerRefId(existing.payerRefId);
    setYardId(existing.yardId);
    setSelected(existing.deposits.map((d) => d.id));
    setDeductions(
      existing.deductions.length
        ? existing.deductions.map((d) => ({ reason: d.reason, amount: String(d.amount) }))
        : [{ reason: "", amount: "" }],
    );
    setPaymentMode(existing.paymentMode === "Online" ? "NEFT/RTGS" : existing.paymentMode || "Cash");
    setPaymentDate(existing.paymentDate || localCalendarYmd());
    setChequeNo(existing.chequeNo || "");
    setChequeDate(existing.chequeDate || "");
    setBankName(existing.bankName || "");
    setUtrRef(existing.utrRef || "");
  }, [existing]);

  const depositsUrl = payerRefId
    ? `/api/ioms/premises-security-deposits/for-payer?payerType=${encodeURIComponent(payerKind)}&payerRefId=${encodeURIComponent(payerRefId)}&mode=refundable`
    : "";
  const { data: deposits = [] } = useQuery<DepositRow[]>({
    queryKey: [depositsUrl],
    enabled: !!payerRefId && (!existing || ["Draft", "ReturnedToDO", "Rejected"].includes(existing.status)),
    queryFn: async () => {
      const res = await fetch(depositsUrl, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const displayDeposits = existing?.deposits?.length && !["Draft", "ReturnedToDO", "Rejected"].includes(existing.status)
    ? existing.deposits
    : deposits;

  const selectedTotal = useMemo(() => {
    const src = displayDeposits;
    return src.filter((d) => selected.includes(d.id)).reduce((s, d) => s + Number(d.amount), 0);
  }, [displayDeposits, selected]);
  const dedTotal = deductions.reduce((s, d) => s + (Number(d.amount) || 0), 0);
  const net = computeSdRefundNet(selectedTotal, dedTotal);

  const editable =
    !existing || ["Draft", "ReturnedToDO", "Rejected"].includes(existing.status);

  const saveMut = useMutation({
    mutationFn: async (submit: boolean) => {
      const body = {
        id: proposalId,
        payerType: payerKind,
        payerRefId,
        yardId:
          yardId ||
          (payerKind === "TraderLicence"
            ? licences.find((l) => l.id === payerRefId)?.yardId
            : entities.find((e) => e.id === payerRefId)?.yardId) ||
          "",
        proposalDate: localCalendarYmd(),
        depositIds: selected,
        deductions: deductions
          .filter((d) => d.reason.trim() && Number(d.amount) > 0)
          .map((d) => ({ reason: d.reason.trim(), amount: Number(d.amount) })),
        paymentMode,
        paymentDate,
        chequeNo: chequeNo || null,
        chequeDate: chequeDate || null,
        bankName: bankName || null,
        utrRef: utrRef || null,
        submit,
      };
      const res = await fetch("/api/ioms/sd-refund-proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error((e as { error?: string }).error ?? res.statusText);
      }
      return res.json() as Promise<ProposalDetail>;
    },
    onSuccess: (row) => {
      setProposalId(row.id);
      queryClient.setQueryData(["/api/ioms/sd-refund-proposals", row.id], row);
      toast({ title: row.status === "PendingVerification" ? "Submitted to DV" : "Saved" });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const actionMut = useMutation({
    mutationFn: async (action: "verify" | "return" | "approve" | "reject") => {
      const res = await fetch(`/api/ioms/sd-refund-proposals/${encodeURIComponent(proposalId!)}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ remarks }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error((e as { error?: string }).error ?? res.statusText);
      }
      return res.json() as Promise<ProposalDetail>;
    },
    onSuccess: async (row) => {
      queryClient.setQueryData(["/api/ioms/sd-refund-proposals", row.id], row);
      toast({ title: `Status: ${row.status}` });
      if (row.refundReceiptId && row.refundReceiptNo) {
        try {
          await downloadIomsReceiptPdf(row.refundReceiptId, row.refundReceiptNo);
        } catch {
          /* ignore */
        }
      }
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const canApprove = can("M-02", "Approve");
  const canUpdate = can("M-02", "Update");

  return (
    <AppShell
      breadcrumbs={[
        { label: "Assets", href: "/assets" },
        { label: "Security deposits", href: "/assets/security-deposits" },
        { label: "Refund" },
      ]}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-semibold">Refund of Security Deposit of Premises</h1>
          <p className="text-sm text-muted-foreground">
            Select vacated deposits, enter deductions and payment details, then DO → DV → DA.
          </p>
        </div>
        {existing ? (
          <Badge className="text-sm">{existing.proposalNo} · {existing.status}</Badge>
        ) : null}
      </div>

      {existing?.returnOrRejectRemarks ? (
        <Card className="mb-4 border-destructive/40">
          <CardContent className="py-3 text-sm">
            Return / reject remarks: {existing.returnOrRejectRemarks}
          </CardContent>
        </Card>
      ) : null}

      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="text-base">1. Trader / entity</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>Type</Label>
            <Select
              disabled={!editable}
              value={payerKind}
              onValueChange={(v) => {
                setPayerKind(v as "TraderLicence" | "Entity");
                setPayerRefId("");
                setSelected([]);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="TraderLicence">Trader licence</SelectItem>
                <SelectItem value="Entity">Entity</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Payer</Label>
            <Select
              disabled={!editable}
              value={payerRefId || "__pick__"}
              onValueChange={(v) => {
                const id = v === "__pick__" ? "" : v;
                setPayerRefId(id);
                setSelected([]);
                if (payerKind === "TraderLicence") {
                  setYardId(licences.find((l) => l.id === id)?.yardId ?? "");
                } else {
                  setYardId(entities.find((e) => e.id === id)?.yardId ?? "");
                }
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__pick__">Select…</SelectItem>
                {payerKind === "TraderLicence"
                  ? licences.map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        {l.firmName}
                      </SelectItem>
                    ))
                  : entities.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.name}
                      </SelectItem>
                    ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="text-base">2. Vacated premises and deposits held</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {displayDeposits.map((d) => {
            const locked = d.status === "Refunded" || (!editable && !selected.includes(d.id));
            const unselectable = d.status === "Refunded";
            return (
              <label
                key={d.id}
                className={`flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm ${
                  unselectable ? "opacity-50 bg-muted/40" : ""
                }`}
              >
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={selected.includes(d.id)}
                    disabled={!editable || unselectable}
                    onCheckedChange={(c) => {
                      setSelected((prev) =>
                        c === true ? [...prev, d.id] : prev.filter((x) => x !== d.id),
                      );
                    }}
                  />
                  <span className="font-medium">{d.premisesLabel}</span>
                  <Badge variant="outline">{d.status}</Badge>
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  <div>Vacated {d.vacatedOn || "—"}</div>
                  <div>
                    {d.depositReceiptNo} · {d.depositReceiptDate} · {formatInr(d.amount)}
                  </div>
                </div>
              </label>
            );
          })}
          <p className="text-sm font-medium">Selected deposit {formatInr(selectedTotal)}</p>
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">3. Deductions</CardTitle>
          {editable ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setDeductions((p) => [...p, { reason: "", amount: "" }])}
            >
              <Plus className="h-4 w-4 mr-1" /> Add deduction row
            </Button>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-2">
          {deductions.map((d, i) => (
            <div key={i} className="grid grid-cols-1 md:grid-cols-[1fr_140px_40px] gap-2 items-end">
              <div className="space-y-1">
                <Label>Purpose / reason</Label>
                <Input
                  disabled={!editable}
                  value={d.reason}
                  onChange={(e) =>
                    setDeductions((prev) => prev.map((x, j) => (j === i ? { ...x, reason: e.target.value } : x)))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label>Amount (₹)</Label>
                <Input
                  disabled={!editable}
                  inputMode="decimal"
                  value={d.amount}
                  onChange={(e) =>
                    setDeductions((prev) => prev.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))
                  }
                />
              </div>
              {editable ? (
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={() => setDeductions((prev) => prev.filter((_, j) => j !== i))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              ) : (
                <span />
              )}
            </div>
          ))}
          <div className="text-sm space-y-1 pt-2 border-t">
            <div>Selected security deposit {formatInr(selectedTotal)}</div>
            <div>Total deductions − {formatInr(dedTotal)}</div>
            <div className="font-semibold">Net balance payable {formatInr(net)}</div>
          </div>
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="text-base">4. Payment details</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>Mode</Label>
            <Select disabled={!editable} value={paymentMode} onValueChange={setPaymentMode}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Cash">Cash</SelectItem>
                <SelectItem value="Cheque">Cheque</SelectItem>
                <SelectItem value="NEFT/RTGS">NEFT / RTGS</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Date of payment</Label>
            <Input disabled={!editable} type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
          </div>
          {paymentMode === "Cheque" ? (
            <>
              <div className="space-y-1">
                <Label>Cheque no.</Label>
                <Input disabled={!editable} value={chequeNo} onChange={(e) => setChequeNo(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Cheque date</Label>
                <Input disabled={!editable} type="date" value={chequeDate} onChange={(e) => setChequeDate(e.target.value)} />
              </div>
              <div className="space-y-1 md:col-span-2">
                <Label>Bank / branch</Label>
                <Input disabled={!editable} value={bankName} onChange={(e) => setBankName(e.target.value)} />
              </div>
            </>
          ) : null}
          {paymentMode === "NEFT/RTGS" ? (
            <>
              <div className="space-y-1">
                <Label>UTR / transaction ref.</Label>
                <Input disabled={!editable} value={utrRef} onChange={(e) => setUtrRef(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Bank</Label>
                <Input disabled={!editable} value={bankName} onChange={(e) => setBankName(e.target.value)} />
              </div>
            </>
          ) : null}
          <p className="text-xs text-muted-foreground md:col-span-2">
            Entered by {user?.name || "DO"}. DV verifies and DA approves with deposits, deductions and net payable.
          </p>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2 mb-8">
        <Button variant="outline" asChild>
          <Link href="/assets/security-deposits">Cancel</Link>
        </Button>
        {editable ? (
          <>
            <Button
              variant="secondary"
              disabled={saveMut.isPending || selected.length === 0}
              onClick={() => saveMut.mutate(false)}
            >
              {saveMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save draft"}
            </Button>
            <Button disabled={saveMut.isPending || selected.length === 0} onClick={() => saveMut.mutate(true)}>
              Submit to DV
            </Button>
          </>
        ) : null}
        {existing?.status === "PendingVerification" && canUpdate ? (
          <>
            <Button disabled={actionMut.isPending} onClick={() => actionMut.mutate("verify")}>
              Verify (DV)
            </Button>
            <div className="flex gap-2 items-end">
              <Textarea
                className="min-h-[40px] w-56"
                placeholder="Return remarks"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
              />
              <Button variant="outline" disabled={actionMut.isPending} onClick={() => actionMut.mutate("return")}>
                Return to DO
              </Button>
            </div>
          </>
        ) : null}
        {existing?.status === "PendingApproval" && canApprove ? (
          <>
            <Button disabled={actionMut.isPending} onClick={() => actionMut.mutate("approve")}>
              Approve (DA)
            </Button>
            <div className="flex gap-2 items-end">
              <Textarea
                className="min-h-[40px] w-56"
                placeholder="Reject remarks"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
              />
              <Button variant="destructive" disabled={actionMut.isPending} onClick={() => actionMut.mutate("reject")}>
                Reject
              </Button>
            </div>
          </>
        ) : null}
        {existing?.refundReceiptId ? (
          <Button
            variant="outline"
            onClick={() =>
              downloadIomsReceiptPdf(existing.refundReceiptId!, existing.refundReceiptNo || "SECREF")
            }
          >
            Download refund receipt
          </Button>
        ) : null}
      </div>
    </AppShell>
  );
}
