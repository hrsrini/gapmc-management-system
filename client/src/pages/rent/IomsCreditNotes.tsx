import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { StickyNote, AlertCircle } from "lucide-react";

interface CreditNote {
  id: string;
  creditNoteNo: string;
  invoiceId: string;
  reason: string;
  amount: number;
  status: string;
}

interface RentInvoiceRef {
  id: string;
  invoiceNo?: string | null;
}

export default function IomsCreditNotes() {
  const { data: list, isLoading, isError } = useQuery<CreditNote[]>({
    queryKey: ["/api/ioms/rent/credit-notes"],
  });
  const { data: invoices = [] } = useQuery<RentInvoiceRef[]>({
    queryKey: ["/api/ioms/rent/invoices"],
  });
  const invoiceLabelById = Object.fromEntries(invoices.map((i) => [i.id, i.invoiceNo ?? i.id]));

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "Rent (IOMS)", href: "/rent/ioms" }, { label: "Credit Notes" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Failed to load credit notes.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Rent (IOMS)", href: "/rent/ioms" }, { label: "Credit Notes" }]}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <StickyNote className="h-5 w-5" />
            Credit Notes (IOMS M-03)
          </CardTitle>
          <p className="text-sm text-muted-foreground">Credit notes against rent invoices.</p>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Credit Note No</TableHead>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(list ?? []).map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-mono text-sm">{c.creditNoteNo}</TableCell>
                    <TableCell>{invoiceLabelById[c.invoiceId] ?? c.invoiceId}</TableCell>
                    <TableCell>{c.reason}</TableCell>
                    <TableCell>{c.amount}</TableCell>
                    <TableCell><Badge variant="secondary">{c.status}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {!isLoading && (!list || list.length === 0) && (
            <p className="text-sm text-muted-foreground py-4">No credit notes.</p>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
