import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ClientDataGrid } from "@/components/reports/ClientDataGrid";
import type { ReportTableColumn } from "@/components/reports/ReportDataTable";
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

const columns: ReportTableColumn[] = [
  { key: "creditNoteNo", header: "Credit Note No" },
  { key: "invoiceLabel", header: "Invoice" },
  { key: "reason", header: "Reason" },
  { key: "amount", header: "Amount" },
  { key: "_status", header: "Status", sortField: "status" },
];

export default function IomsCreditNotes() {
  const { data: list, isLoading, isError } = useQuery<CreditNote[]>({
    queryKey: ["/api/ioms/rent/credit-notes"],
  });
  const { data: invoices = [] } = useQuery<RentInvoiceRef[]>({
    queryKey: ["/api/ioms/rent/invoices"],
  });
  const invoiceLabelById = Object.fromEntries(invoices.map((i) => [i.id, i.invoiceNo ?? i.id]));

  const sourceRows = useMemo((): Record<string, unknown>[] => {
    return (list ?? []).map((c) => ({
      id: c.id,
      creditNoteNo: c.creditNoteNo,
      invoiceLabel: invoiceLabelById[c.invoiceId] ?? c.invoiceId,
      reason: c.reason,
      amount: c.amount,
      status: c.status,
      _status: <Badge variant="secondary">{c.status}</Badge>,
    }));
  }, [list, invoiceLabelById]);

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
            <ClientDataGrid
              columns={columns}
              sourceRows={sourceRows}
              searchKeys={["creditNoteNo", "invoiceLabel", "reason", "status"]}
              defaultSortKey="creditNoteNo"
              defaultSortDir="desc"
              emptyMessage="No credit notes."
            />
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
