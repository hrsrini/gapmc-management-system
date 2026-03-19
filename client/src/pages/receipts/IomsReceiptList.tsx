import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { Receipt, AlertCircle, ExternalLink } from "lucide-react";

const REVENUE_HEADS = [
  "Rent",
  "GSTInvoice",
  "MarketFee",
  "LicenceFee",
  "SecurityDeposit",
  "Miscellaneous",
];

interface IomsReceipt {
  id: string;
  receiptNo: string;
  yardId: string;
  revenueHead: string;
  payerName: string | null;
  amount: number;
  totalAmount: number;
  paymentMode: string;
  status: string;
  sourceModule: string | null;
  createdAt: string;
}

export default function IomsReceiptList() {
  const [yardId, setYardId] = useState<string>("all");
  const [revenueHead, setRevenueHead] = useState<string>("all");

  const { data: yards } = useQuery<{ id: string; name: string; code: string }[]>({
    queryKey: ["/api/yards"],
  });

  const params = new URLSearchParams();
  if (yardId && yardId !== "all") params.set("yardId", yardId);
  if (revenueHead && revenueHead !== "all") params.set("revenueHead", revenueHead);
  const url = params.toString() ? `/api/ioms/receipts?${params.toString()}` : "/api/ioms/receipts";
  const { data: receipts, isLoading, isError } = useQuery<IomsReceipt[]>({
    queryKey: [url],
  });

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "Receipts", href: "/receipts" }, { label: "IOMS Receipts" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Failed to load IOMS receipts.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Receipts", href: "/receipts" }, { label: "IOMS Receipts" }]}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5" />
            IOMS Receipts (M-05)
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Central receipt engine — GAPLMB/[LOC]/[FY]/[HEAD]/[NNN]. Verify at /verify/[receiptNo]
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-4 items-end">
            <div className="space-y-2">
              <Label>Yard</Label>
              <Select value={yardId} onValueChange={setYardId}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="All yards" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All yards</SelectItem>
                  {(yards ?? []).map((y) => (
                    <SelectItem key={y.id} value={y.id}>{y.name} ({y.code})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Revenue head</Label>
              <Select value={revenueHead} onValueChange={setRevenueHead}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {REVENUE_HEADS.map((h) => (
                    <SelectItem key={h} value={h}>{h}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Receipt No</TableHead>
                  <TableHead>Revenue head</TableHead>
                  <TableHead>Payer</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(receipts ?? []).map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-sm">
                      <Link href={`/receipts/ioms/${r.id}`} className="text-primary hover:underline">{r.receiptNo}</Link>
                    </TableCell>
                    <TableCell>{r.revenueHead}</TableCell>
                    <TableCell>{r.payerName ?? "—"}</TableCell>
                    <TableCell>₹{Number(r.totalAmount).toLocaleString("en-IN")}</TableCell>
                    <TableCell>{r.paymentMode}</TableCell>
                    <TableCell>
                      <Badge variant={r.status === "Paid" ? "default" : "secondary"}>{r.status}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {r.createdAt ? new Date(r.createdAt).toLocaleString() : "—"}
                    </TableCell>
                    <TableCell>
                      <a
                        href={`/verify/${encodeURIComponent(r.receiptNo)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary text-xs flex items-center gap-1"
                      >
                        Verify <ExternalLink className="h-3 w-3" />
                      </a>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {!isLoading && (!receipts || receipts.length === 0) && (
            <p className="text-sm text-muted-foreground py-4">No IOMS receipts yet. Receipts are created by other modules (M-02, M-03, M-04, M-06, M-08).</p>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
