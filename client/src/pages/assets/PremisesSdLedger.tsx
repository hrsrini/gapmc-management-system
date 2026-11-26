import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ClientDataGrid } from "@/components/reports/ClientDataGrid";
import type { ReportTableColumn } from "@/components/reports/ReportDataTable";
import { formatInr } from "@/lib/formatInr";

type LicenceOpt = { id: string; firmName: string };
type EntityOpt = { id: string; name: string; entityCode?: string | null };

const entryCols: ReportTableColumn[] = [
  { key: "entryDate", header: "Date" },
  { key: "particulars", header: "Particulars" },
  { key: "linkedDocNo", header: "Linked document" },
  { key: "premisesLabel", header: "Premises" },
  { key: "creditDisp", header: "Received (Cr) ₹", sortField: "creditAmount" },
  { key: "debitDisp", header: "Deducted / refunded (Dr) ₹", sortField: "debitAmount" },
  { key: "balDisp", header: "Balance ₹", sortField: "runningBalance" },
];

const balCols: ReportTableColumn[] = [
  { key: "premisesLabel", header: "Premises" },
  { key: "depositReceiptNo", header: "Deposit receipt" },
  { key: "refundReceiptNo", header: "Refund receipt" },
  { key: "amountDisp", header: "Amount ₹" },
  { key: "status", header: "Tally status" },
];

export default function PremisesSdLedger() {
  const [payerKind, setPayerKind] = useState<"TraderLicence" | "Entity">("TraderLicence");
  const [payerRefId, setPayerRefId] = useState("");

  const { data: licences = [] } = useQuery<LicenceOpt[]>({ queryKey: ["/api/ioms/traders/licences"] });
  const { data: entities = [] } = useQuery<EntityOpt[]>({ queryKey: ["/api/ioms/entities"] });

  const url = payerRefId
    ? `/api/ioms/premises-sd-ledger?payerType=${encodeURIComponent(payerKind)}&payerRefId=${encodeURIComponent(payerRefId)}`
    : "";
  const { data, isLoading } = useQuery<{
    entries: Array<Record<string, unknown>>;
    balanceByPremises: Array<Record<string, unknown>>;
    closingBalance: number;
  }>({
    queryKey: [url],
    enabled: !!payerRefId,
    queryFn: async () => {
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const entryRows = useMemo(
    () =>
      (data?.entries ?? []).map((e) => ({
        ...e,
        creditDisp: Number(e.creditAmount) > 0 ? formatInr(Number(e.creditAmount)) : "",
        debitDisp: Number(e.debitAmount) > 0 ? formatInr(Number(e.debitAmount)) : "",
        balDisp: formatInr(Number(e.runningBalance)),
        linkedDocNo: e.linkedDocId ? (
          <Link
            href={
              String(e.linkedDocType).startsWith("SEC")
                ? `/receipts/ioms/${e.linkedDocId}`
                : `/assets/security-deposits/refund/${e.linkedDocId}`
            }
            className="text-primary underline"
          >
            {String(e.linkedDocNo ?? "")}
          </Link>
        ) : (
          String(e.linkedDocNo ?? "")
        ),
      })),
    [data?.entries],
  );

  const balRows = useMemo(
    () =>
      (data?.balanceByPremises ?? []).map((b) => ({
        ...b,
        amountDisp: formatInr(Number(b.amount)),
        status: <Badge variant={b.status === "Refunded" ? "secondary" : "default"}>{String(b.status)}</Badge>,
      })),
    [data?.balanceByPremises],
  );

  return (
    <AppShell
      breadcrumbs={[
        { label: "Assets", href: "/assets" },
        { label: "Security deposits", href: "/assets/security-deposits" },
        { label: "Ledger" },
      ]}
    >
      <h1 className="text-2xl font-semibold mb-1">Trader security deposit ledger</h1>
      <p className="text-sm text-muted-foreground mb-4">
        Tally head Cash Security Deposit for Godown — deposits, deductions, refunds and balance.
      </p>

      <Card className="mb-4">
        <CardContent className="pt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>Type</Label>
            <Select
              value={payerKind}
              onValueChange={(v) => {
                setPayerKind(v as "TraderLicence" | "Entity");
                setPayerRefId("");
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
            <Select value={payerRefId || "__pick__"} onValueChange={(v) => setPayerRefId(v === "__pick__" ? "" : v)}>
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

      {payerRefId ? (
        <>
          <Card className="mb-4">
            <CardHeader className="flex flex-row justify-between items-center">
              <CardTitle className="text-base">Ledger</CardTitle>
              <span className="text-sm font-medium">Closing balance {formatInr(data?.closingBalance ?? 0)}</span>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : (
                <ClientDataGrid
                  columns={entryCols}
                  sourceRows={entryRows}
                  searchKeys={["particulars", "premisesLabel", "linkedDocNo"]}
                  searchPlaceholder="Search ledger…"
                  defaultSortKey="entryDate"
                  emptyMessage="No ledger entries."
                />
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Balance by premises</CardTitle>
            </CardHeader>
            <CardContent>
              <ClientDataGrid
                columns={balCols}
                sourceRows={balRows}
                searchKeys={["premisesLabel", "depositReceiptNo"]}
                defaultSortKey="premisesLabel"
                emptyMessage="No premises balances."
              />
            </CardContent>
          </Card>
        </>
      ) : null}
    </AppShell>
  );
}
