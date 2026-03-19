import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { BookOpen, AlertCircle } from "lucide-react";

interface LedgerEntry {
  id: string;
  tenantLicenceId: string;
  assetId: string;
  entryDate: string;
  entryType: string;
  debit: number;
  credit: number;
  balance: number;
  invoiceId?: string | null;
  receiptId?: string | null;
}
interface AssetRef {
  id: string;
  assetId: string;
}
interface RentInvoiceRef {
  id: string;
  invoiceNo?: string | null;
}

export default function RentLedger() {
  const [tenantLicenceId, setTenantLicenceId] = useState("");
  const [assetId, setAssetId] = useState("");

  const params = new URLSearchParams();
  if (tenantLicenceId.trim()) params.set("tenantLicenceId", tenantLicenceId.trim());
  if (assetId.trim()) params.set("assetId", assetId.trim());
  const url = params.toString() ? `/api/ioms/rent/ledger?${params.toString()}` : "/api/ioms/rent/ledger";

  const { data: list = [], isLoading, isError } = useQuery<LedgerEntry[]>({ queryKey: [url] });
  const { data: assets = [] } = useQuery<AssetRef[]>({
    queryKey: ["/api/ioms/assets"],
  });
  const { data: invoices = [] } = useQuery<RentInvoiceRef[]>({
    queryKey: ["/api/ioms/rent/invoices"],
  });
  const assetLabelById = Object.fromEntries(assets.map((a) => [a.id, a.assetId]));
  const invoiceLabelById = Object.fromEntries(invoices.map((i) => [i.id, i.invoiceNo ?? i.id]));

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "Rent (IOMS)", href: "/rent/ioms" }, { label: "Rent deposit ledger" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Failed to load ledger.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Rent (IOMS)", href: "/rent/ioms" }, { label: "Rent deposit ledger" }]}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            Rent deposit ledger (M-03)
          </CardTitle>
          <p className="text-sm text-muted-foreground">Per tenant per asset — opening balance, rent, interest, collections.</p>
          <div className="flex flex-wrap gap-4 pt-2">
            <div className="space-y-1">
              <Label>Tenant licence ID</Label>
              <Input
                className="w-[200px]"
                placeholder="Filter by tenant"
                value={tenantLicenceId}
                onChange={(e) => setTenantLicenceId(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Asset ID</Label>
              <Input
                className="w-[200px]"
                placeholder="Filter by asset"
                value={assetId}
                onChange={(e) => setAssetId(e.target.value)}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Entry date</TableHead>
                  <TableHead>Tenant licence</TableHead>
                  <TableHead>Asset</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Debit</TableHead>
                  <TableHead className="text-right">Credit</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead>Invoice / Receipt</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-muted-foreground text-center py-6">No ledger entries.</TableCell>
                  </TableRow>
                ) : (
                  list.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell>{e.entryDate}</TableCell>
                      <TableCell className="font-mono text-sm">{e.tenantLicenceId}</TableCell>
                      <TableCell>{assetLabelById[e.assetId] ?? e.assetId}</TableCell>
                      <TableCell>{e.entryType}</TableCell>
                      <TableCell className="text-right">₹{e.debit.toLocaleString()}</TableCell>
                      <TableCell className="text-right">₹{e.credit.toLocaleString()}</TableCell>
                      <TableCell className="text-right font-medium">₹{e.balance.toLocaleString()}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">
                        {e.invoiceId ? (invoiceLabelById[e.invoiceId] ?? e.invoiceId) : (e.receiptId ?? "—")}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
