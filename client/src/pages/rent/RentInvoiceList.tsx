import { useMemo, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useQuery, useMutation } from '@tanstack/react-query';
import { AppShell } from '@/components/layout/AppShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ClientDataGrid } from '@/components/reports/ClientDataGrid';
import type { ReportTableColumn } from '@/components/reports/ReportDataTable';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Plus, Eye, Pencil, Trash2, FileText, AlertCircle, RefreshCcw } from 'lucide-react';
import { legacyRowMatchesSelectedApiYard } from '@/lib/legacyYardMatch';
import { useScopedActiveYards } from '@/hooks/useScopedActiveYards';
import { formatDisplayDate } from '@/lib/dateFormat';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import type { Invoice } from '@shared/schema';

const statusColors: Record<string, string> = {
  Paid: 'bg-accent/10 text-accent border-accent/20',
  Pending: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  Overdue: 'bg-destructive/10 text-destructive border-destructive/20',
  Draft: 'bg-muted text-muted-foreground border-muted',
};

export default function RentInvoiceList() {
  const { toast } = useToast();
  const { can } = useAuth();
  const canCreate = can('M-03', 'Create');
  const canUpdate = can('M-03', 'Update');
  const canDelete = can('M-03', 'Delete');
  const [, setLocation] = useLocation();
  const [selectedYard, setSelectedYard] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [viewInvoice, setViewInvoice] = useState<Invoice | null>(null);

  const { data: invoices, isLoading, isError, refetch } = useQuery<Invoice[]>({
    queryKey: ['/api/invoices'],
  });

  const { data: yards = [] } = useScopedActiveYards();

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest('DELETE', `/api/invoices/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/invoices'] });
      queryClient.invalidateQueries({ queryKey: ['/api/stats'] });
      toast({ title: 'Invoice deleted', description: 'Invoice has been deleted successfully' });
    },
    onError: () => {
      toast({ title: 'Error', description: 'Failed to delete invoice', variant: 'destructive' });
    },
  });

  const filteredInvoices = useMemo(() => {
    return (invoices ?? []).filter((invoice) => {
      const matchesYard = legacyRowMatchesSelectedApiYard(
        invoice.yardId,
        invoice.yard,
        selectedYard,
        yards,
      );
      const matchesStatus = selectedStatus === 'all' || invoice.status === selectedStatus;
      return matchesYard && matchesStatus;
    });
  }, [invoices, selectedYard, selectedStatus, yards]);

  const invoiceColumns = useMemo((): ReportTableColumn[] => {
    return [
      { key: 'invoiceId', header: 'Invoice No' },
      { key: 'traderName', header: 'Trader Name' },
      { key: 'premises', header: 'Premises' },
      { key: 'yard', header: 'Yard' },
      { key: 'baseRent', header: 'Amount' },
      { key: '_gst', header: 'GST', sortField: 'gstSum' },
      { key: '_total', header: 'Total', sortField: 'total' },
      { key: '_status', header: 'Status', sortField: 'status' },
      { key: 'invoiceDate', header: 'Date' },
      { key: '_actions', header: 'Actions' },
    ];
  }, []);

  const sourceRows = useMemo((): Record<string, unknown>[] => {
    return filteredInvoices.map((invoice) => {
      const gstSum = invoice.cgst + invoice.sgst;
      return {
        id: invoice.id,
        invoiceId: invoice.id,
        traderName: invoice.traderName,
        premises: invoice.premises,
        yard: invoice.yard,
        baseRent: invoice.baseRent,
        gstSum,
        _gst: `₹${gstSum.toLocaleString()}`,
        total: invoice.total,
        _total: `₹${invoice.total.toLocaleString()}`,
        status: invoice.status,
        _status: (
          <Badge variant="outline" className={statusColors[invoice.status] ?? statusColors.Draft}>
            {invoice.status}
          </Badge>
        ),
        invoiceDate:
          typeof invoice.invoiceDate === 'string'
            ? invoice.invoiceDate.slice(0, 10)
            : String(invoice.invoiceDate ?? ''),
        _actions: (
          <div className="flex items-center justify-end gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setViewInvoice(invoice)}
              data-testid={`button-view-${invoice.id}`}
              aria-label="View invoice"
            >
              <Eye className="h-4 w-4" />
            </Button>
            {canUpdate && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setLocation(`/rent/edit/${invoice.id}`)}
                data-testid={`button-edit-${invoice.id}`}
                aria-label="Edit invoice"
              >
                <Pencil className="h-4 w-4" />
              </Button>
            )}
            {canDelete && (
              <Button
                variant="ghost"
                size="icon"
                className="text-destructive"
                onClick={() => deleteMutation.mutate(invoice.id)}
                disabled={deleteMutation.isPending}
                data-testid={`button-delete-${invoice.id}`}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        ),
      };
    });
  }, [filteredInvoices, canUpdate, canDelete, setLocation, deleteMutation]);

  const filterKey = `${selectedYard}|${selectedStatus}`;

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: 'Rent & Tax', href: '/rent' }, { label: 'Invoices' }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-destructive" />
              <span className="text-destructive">Failed to load invoices. Please try again.</span>
            </div>
            <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-retry">
              <RefreshCcw className="h-4 w-4 mr-2" />
              Retry
            </Button>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: 'Rent & Tax', href: '/rent' }, { label: 'Invoices' }]}>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <FileText className="h-6 w-6 text-primary" />
              Rent/Tax Invoices
            </h1>
            <p className="text-muted-foreground">Manage rent and tax invoices</p>
          </div>
          {canCreate && (
            <Button asChild data-testid="button-create-invoice">
              <Link href="/rent/new">
                <Plus className="h-4 w-4 mr-2" />
                Create Invoice
              </Link>
            </Button>
          )}
        </div>

        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-base font-medium">Filters</CardTitle>
            <p className="text-sm text-muted-foreground">Use the grid search for invoice id, trader, premises, or yard.</p>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Select value={selectedYard} onValueChange={setSelectedYard}>
                <SelectTrigger data-testid="select-yard">
                  <SelectValue placeholder="Select Yard" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Yards</SelectItem>
                  {yards
                    .filter((y) => String(y.type ?? '').toLowerCase() === 'yard')
                    .map((yard) => (
                      <SelectItem key={yard.id} value={yard.id}>
                        {yard.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <Select value={selectedStatus} onValueChange={setSelectedStatus}>
                <SelectTrigger data-testid="select-status">
                  <SelectValue placeholder="Select Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="Paid">Paid</SelectItem>
                  <SelectItem value="Pending">Pending</SelectItem>
                  <SelectItem value="Overdue">Overdue</SelectItem>
                  <SelectItem value="Draft">Draft</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : (
              <ClientDataGrid
                columns={invoiceColumns}
                sourceRows={sourceRows}
                searchKeys={['invoiceId', 'traderName', 'premises', 'yard', 'status']}
                defaultSortKey="invoiceDate"
                defaultSortDir="desc"
                emptyMessage="No invoices found"
                resetPageDependency={filterKey}
              />
            )}
          </CardContent>
        </Card>

        <Dialog open={!!viewInvoice} onOpenChange={(open) => !open && setViewInvoice(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Invoice {viewInvoice?.id}</DialogTitle>
            </DialogHeader>
            {viewInvoice && (
              <div className="grid gap-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Trader</span>
                  <span className="font-medium">{viewInvoice.traderName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Premises</span>
                  <span>{viewInvoice.premises}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Yard</span>
                  <span>{viewInvoice.yard}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Month</span>
                  <span>{viewInvoice.month}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Invoice Date</span>
                  <span>{formatDisplayDate(viewInvoice.invoiceDate)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Base Rent</span>
                  <span>₹{viewInvoice.baseRent.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">CGST + SGST</span>
                  <span>₹{(viewInvoice.cgst + viewInvoice.sgst).toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Interest</span>
                  <span>₹{viewInvoice.interest.toLocaleString()}</span>
                </div>
                {viewInvoice.tdsApplicable && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">TDS</span>
                    <span>₹{viewInvoice.tdsAmount.toLocaleString()}</span>
                  </div>
                )}
                <div className="flex justify-between pt-2 border-t font-semibold">
                  <span>Total</span>
                  <span>₹{viewInvoice.total.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Status</span>
                  <Badge variant="outline" className={statusColors[viewInvoice.status]}>
                    {viewInvoice.status}
                  </Badge>
                </div>
                <div className="flex gap-2 pt-2">
                  <Button variant="outline" size="sm" onClick={() => setViewInvoice(null)}>
                    Close
                  </Button>
                  {canUpdate && (
                    <Button
                      size="sm"
                      onClick={() => {
                        setViewInvoice(null);
                        setLocation(`/rent/edit/${viewInvoice.id}`);
                      }}
                      data-testid="button-edit-from-view"
                    >
                      <Pencil className="h-4 w-4 mr-1" />
                      Edit
                    </Button>
                  )}
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
