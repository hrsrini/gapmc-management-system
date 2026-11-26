import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { formatInr } from "@/lib/formatInr";
import { PaymentPreferenceForm } from "@/components/payments/PaymentPreferenceForm";
import {
  buildCounterDuesPaymentApiBody,
  defaultPaymentPreferenceValue,
  validatePaymentPreference,
  type PaymentPreferenceValue,
} from "@/lib/duesCounterPayment";
import { downloadIomsReceiptPdf } from "@/lib/downloadIomsReceiptPdf";
import { useAuth } from "@/context/AuthContext";
import { Loader2 } from "lucide-react";
import { localCalendarYmd } from "@shared/premises-allocation";

type LicenceOpt = { id: string; firmName: string; yardId: string };
type EntityOpt = { id: string; name: string; yardId: string; entityCode?: string | null };
type DepositRow = {
  id: string;
  premisesLabel?: string | null;
  amount: number;
  status: string;
  depositReceiptId?: string | null;
  depositReceiptNo?: string | null;
  depositReceiptDate?: string | null;
  yardId: string;
};

export default function PremisesSecurityDepositCollect() {
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [payerKind, setPayerKind] = useState<"TraderLicence" | "Entity">("TraderLicence");
  const [payerRefId, setPayerRefId] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [payment, setPayment] = useState<PaymentPreferenceValue>(() => defaultPaymentPreferenceValue());

  const { data: licences = [] } = useQuery<LicenceOpt[]>({
    queryKey: ["/api/ioms/traders/licences"],
    enabled: payerKind === "TraderLicence",
  });
  const { data: entities = [] } = useQuery<EntityOpt[]>({
    queryKey: ["/api/ioms/entities"],
    enabled: payerKind === "Entity",
  });

  const depositsUrl =
    payerRefId
      ? `/api/ioms/premises-security-deposits/for-payer?payerType=${encodeURIComponent(payerKind)}&payerRefId=${encodeURIComponent(payerRefId)}`
      : "";
  const { data: deposits = [], isLoading } = useQuery<DepositRow[]>({
    queryKey: [depositsUrl],
    enabled: !!payerRefId,
    queryFn: async () => {
      const res = await fetch(depositsUrl, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load deposits");
      return res.json();
    },
  });

  const selectable = useMemo(
    () => deposits.filter((d) => !d.depositReceiptId && d.status === "Held"),
    [deposits],
  );
  const selectedRows = selectable.filter((d) => selected.includes(d.id));
  const total = selectedRows.reduce((s, d) => s + Number(d.amount), 0);

  const mutate = useMutation({
    mutationFn: async () => {
      const pref = { ...payment, paidAmount: String(Math.round(total * 100) / 100) };
      const err = validatePaymentPreference(pref);
      if (err) throw new Error(err);
      const body = {
        depositIds: selected,
        ...buildCounterDuesPaymentApiBody(pref, total),
      };
      const res = await fetch("/api/ioms/premises-security-deposits/consolidated-receipt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error((e as { error?: string }).error ?? res.statusText);
      }
      return res.json() as Promise<{ receiptId: string; receiptNo: string }>;
    },
    onSuccess: async (r) => {
      toast({ title: "Receipt generated", description: r.receiptNo });
      setSelected([]);
      queryClient.invalidateQueries({ queryKey: [depositsUrl] });
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/premises-security-deposits"] });
      try {
        await downloadIomsReceiptPdf(r.receiptId, r.receiptNo);
      } catch {
        /* ignore */
      }
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const receivedByLabel = user?.name ? `${user.name} (Logged in user)` : "Logged in user";

  return (
    <AppShell
      breadcrumbs={[
        { label: "Assets", href: "/assets" },
        { label: "Security deposits", href: "/assets/security-deposits" },
        { label: "Collect" },
      ]}
    >
      <h1 className="text-2xl font-semibold mb-1">Collect security deposit</h1>
      <p className="text-sm text-muted-foreground mb-4">
        Tick one or more unreceipted premises deposits and generate one consolidated SECDEP receipt.
      </p>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="text-base">Trader / entity</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>Type</Label>
            <Select
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
            <Label>{payerKind === "TraderLicence" ? "Licence" : "Entity"}</Label>
            <Select
              value={payerRefId || "__pick__"}
              onValueChange={(v) => {
                setPayerRefId(v === "__pick__" ? "" : v);
                setSelected([]);
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
                        {e.entityCode ? `${e.entityCode} · ` : ""}
                        {e.name}
                      </SelectItem>
                    ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {payerRefId ? (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle className="text-base">Premises deposits</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : deposits.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No deposit rows. Create a premises allotment with security deposit first.
              </p>
            ) : (
              deposits.map((d) => {
                const locked = Boolean(d.depositReceiptId);
                const checked = selected.includes(d.id);
                return (
                  <label
                    key={d.id}
                    className={`flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm ${
                      locked ? "opacity-60 bg-muted/40" : "cursor-pointer"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Checkbox
                        checked={checked}
                        disabled={locked}
                        onCheckedChange={(c) => {
                          setSelected((prev) =>
                            c === true ? [...prev, d.id] : prev.filter((x) => x !== d.id),
                          );
                        }}
                      />
                      <span className="font-medium">{d.premisesLabel || d.id}</span>
                    </div>
                    <div className="text-right">
                      <div>{formatInr(d.amount)}</div>
                      <div className="text-xs text-muted-foreground">
                        {locked
                          ? `Receipted · ${d.depositReceiptNo} · ${d.depositReceiptDate}`
                          : "On generate"}
                      </div>
                    </div>
                  </label>
                );
              })
            )}
            <p className="text-sm font-medium pt-2">
              Selected total · {selectedRows.length} premises {formatInr(total)}
            </p>
          </CardContent>
        </Card>
      ) : null}

      {selectedRows.length > 0 ? (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle className="text-base">Payment & receipt</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm space-y-1">
              {selectedRows.map((d, i) => (
                <div key={d.id}>
                  {i + 1} · Security Deposit : {d.premisesLabel} {formatInr(d.amount)}
                </div>
              ))}
              <div className="font-medium">Total {formatInr(total)}</div>
            </div>
            <PaymentPreferenceForm
              value={{ ...payment, paidAmount: String(Math.round(total * 100) / 100) }}
              onChange={setPayment}
              receivedByLabel={receivedByLabel}
              receivedAtLabel="Yard"
              summaryAmount={String(Math.round(total * 100) / 100)}
            />
            <div className="flex gap-2">
              <Button variant="outline" asChild>
                <Link href="/assets/security-deposits">Cancel</Link>
              </Button>
              <Button
                disabled={mutate.isPending || selected.length === 0}
                onClick={() => {
                  if (!payment.paymentDate) {
                    setPayment((p) => ({ ...p, paymentDate: localCalendarYmd() }));
                  }
                  mutate.mutate();
                }}
              >
                {mutate.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Generate consolidated receipt"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </AppShell>
  );
}
