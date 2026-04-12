import { useState, useEffect, useMemo } from 'react';
import { Link } from 'wouter';
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Plus,
  Eye,
  Printer,
  XCircle,
  Receipt as ReceiptIcon,
  AlertCircle,
  RefreshCcw,
} from 'lucide-react';
import { legacyRowMatchesSelectedApiYard } from '@/lib/legacyYardMatch';
import { useScopedActiveYards } from '@/hooks/useScopedActiveYards';
import { formatDisplayDate } from '@/lib/dateFormat';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import type { Receipt } from '@shared/schema';

const typeColors: Record<string, string> = {
  Rent: 'bg-primary/10 text-primary border-primary/20',
  'Market Fee': 'bg-accent/10 text-accent border-accent/20',
  'License Fee': 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  Other: 'bg-muted text-muted-foreground border-muted',
};

const receiptColumns: ReportTableColumn[] = [
  { key: 'receiptNo', header: 'Receipt No' },
  { key: 'receiptDate', header: 'Date' },
  { key: '_type', header: 'Type', sortField: 'type' },
  { key: 'traderName', header: 'Trader' },
  { key: 'head', header: 'Head' },
  { key: '_total', header: 'Amount', sortField: 'total' },
  { key: 'paymentMode', header: 'Mode' },
  { key: 'issuedBy', header: 'Issued By' },
  { key: '_actions', header: 'Actions' },
];

export default function ReceiptList() {
  const { toast } = useToast();
  const { can } = useAuth();
  const canCreate = can('M-05', 'Create');
  const [selectedYard, setSelectedYard] = useState<string>('all');
  const [selectedType, setSelectedType] = useState<string>('all');
  const [viewReceipt, setViewReceipt] = useState<Receipt | null>(null);
  const [autoPrint, setAutoPrint] = useState(false);

  useEffect(() => {
    if (!viewReceipt || !autoPrint) return;
    const t = setTimeout(() => {
      window.print();
      setAutoPrint(false);
    }, 300);
    return () => clearTimeout(t);
  }, [viewReceipt, autoPrint]);

  const { data: receipts, isLoading, isError, refetch } = useQuery<Receipt[]>({
    queryKey: ['/api/receipts'],
  });

  const { data: yards = [] } = useScopedActiveYards();

  const voidMutation = useMutation({
    mutationFn: (id: string) => apiRequest('PUT', `/api/receipts/${id}`, { status: 'Voided' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/receipts'] });
      toast({ title: 'Receipt voided', description: 'Receipt has been voided successfully' });
    },
    onError: () => {
      toast({ title: 'Error', description: 'Failed to void receipt', variant: 'destructive' });
    },
  });

  const filteredReceipts = useMemo(() => {
    return (receipts ?? []).filter((receipt) => {
      const matchesYard = legacyRowMatchesSelectedApiYard(
        receipt.yardId,
        receipt.yardName,
        selectedYard,
        yards,
      );
      const matchesType = selectedType === 'all' || receipt.type === selectedType;
      return matchesYard && matchesType;
    });
  }, [receipts, selectedYard, selectedType, yards]);

  const sourceRows = useMemo((): Record<string, unknown>[] => {
    return filteredReceipts.map((receipt) => ({
      id: receipt.id,
      receiptNo: receipt.receiptNo,
      receiptDate:
        typeof receipt.receiptDate === 'string'
          ? receipt.receiptDate.slice(0, 10)
          : String(receipt.receiptDate ?? ''),
      type: receipt.type,
      _type: (
        <Badge variant="outline" className={typeColors[receipt.type] ?? typeColors.Other}>
          {receipt.type}
        </Badge>
      ),
      traderName: receipt.traderName,
      head: receipt.head,
      total: receipt.total,
      _total: `₹${receipt.total.toLocaleString()}`,
      paymentMode: receipt.paymentMode,
      issuedBy: receipt.issuedBy,
      _actions: (
        <div className="flex items-center justify-end gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              setViewReceipt(receipt);
              setAutoPrint(false);
            }}
            data-testid={`button-view-${receipt.id}`}
            aria-label="View receipt"
          >
            <Eye className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              setViewReceipt(receipt);
              setAutoPrint(true);
            }}
            data-testid={`button-print-${receipt.id}`}
            aria-label="Print receipt"
          >
            <Printer className="h-4 w-4" />
          </Button>
          {receipt.status === 'Active' && (
            <Button
              variant="ghost"
              size="icon"
              className="text-destructive"
              onClick={() => voidMutation.mutate(receipt.id)}
              disabled={voidMutation.isPending}
              data-testid={`button-void-${receipt.id}`}
            >
              <XCircle className="h-4 w-4" />
            </Button>
          )}
        </div>
      ),
    }));
  }, [filteredReceipts, voidMutation]);

  const filterKey = `${selectedYard}|${selectedType}`;

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: 'Receipts', href: '/receipts' }, { label: 'All Receipts' }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-destructive" />
              <span className="text-destructive">Failed to load receipts. Please try again.</span>
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
    <AppShell breadcrumbs={[{ label: 'Receipts', href: '/receipts' }, { label: 'All Receipts' }]}>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <ReceiptIcon className="h-6 w-6 text-primary" />
              All Receipts
            </h1>
            <p className="text-muted-foreground">View and manage all receipts</p>
          </div>
          {canCreate && (
            <Button asChild data-testid="button-new-receipt">
              <Link href="/receipts/new">
                <Plus className="h-4 w-4 mr-2" />
                New Receipt
              </Link>
            </Button>
          )}
        </div>

        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-base font-medium">Filters</CardTitle>
            <p className="text-sm text-muted-foreground">Use the grid search for receipt number, trader, head, etc.</p>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Select value={selectedType} onValueChange={setSelectedType}>
                <SelectTrigger data-testid="select-type">
                  <SelectValue placeholder="Receipt Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="Rent">Rent</SelectItem>
                  <SelectItem value="Market Fee">Market Fee</SelectItem>
                  <SelectItem value="License Fee">License Fee</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
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
                columns={receiptColumns}
                sourceRows={sourceRows}
                searchKeys={['receiptNo', 'receiptDate', 'type', 'traderName', 'head', 'paymentMode', 'issuedBy']}
                defaultSortKey="receiptDate"
                defaultSortDir="desc"
                emptyMessage="No receipts found"
                resetPageDependency={filterKey}
              />
            )}
          </CardContent>
        </Card>

        <Dialog open={!!viewReceipt} onOpenChange={(open) => !open && setViewReceipt(null)}>
          <DialogContent className="max-w-lg receipt-print-content">
            <DialogHeader className="no-print">
              <DialogTitle>Receipt</DialogTitle>
            </DialogHeader>
            {viewReceipt && (
              <div className="space-y-4">
                <div className="border-b pb-3 flex justify-between items-start">
                  <div>
                    <p className="text-2xl font-bold font-mono">{viewReceipt.receiptNo}</p>
                    <p className="text-sm text-muted-foreground">{viewReceipt.yardName}</p>
                  </div>
                  <Badge variant={viewReceipt.status === 'Voided' ? 'destructive' : 'default'}>
                    {viewReceipt.status}
                  </Badge>
                </div>
                <div className="grid gap-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Date</span>
                    <span>{formatDisplayDate(viewReceipt.receiptDate)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Type</span>
                    <span>{viewReceipt.type}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Trader</span>
                    <span className="font-medium">{viewReceipt.traderName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Head</span>
                    <span>{viewReceipt.head}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Amount</span>
                    <span>₹{viewReceipt.amount?.toLocaleString() ?? '—'}</span>
                  </div>
                  {viewReceipt.cgst != null && viewReceipt.cgst > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">CGST</span>
                      <span>₹{viewReceipt.cgst.toLocaleString()}</span>
                    </div>
                  )}
                  {viewReceipt.sgst != null && viewReceipt.sgst > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">SGST</span>
                      <span>₹{viewReceipt.sgst.toLocaleString()}</span>
                    </div>
                  )}
                  {viewReceipt.interest != null && viewReceipt.interest > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Interest</span>
                      <span>₹{viewReceipt.interest.toLocaleString()}</span>
                    </div>
                  )}
                  {viewReceipt.tdsAmount != null && viewReceipt.tdsAmount > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">TDS</span>
                      <span>₹{viewReceipt.tdsAmount.toLocaleString()}</span>
                    </div>
                  )}
                  <div className="flex justify-between pt-2 border-t font-semibold text-base">
                    <span>Total</span>
                    <span>₹{viewReceipt.total.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Payment</span>
                    <span>{viewReceipt.paymentMode}</span>
                  </div>
                  {viewReceipt.transactionRef && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Ref</span>
                      <span className="font-mono text-xs">{viewReceipt.transactionRef}</span>
                    </div>
                  )}
                  <div className="flex justify-between pt-1">
                    <span className="text-muted-foreground">Issued by</span>
                    <span>{viewReceipt.issuedBy}</span>
                  </div>
                </div>
              </div>
            )}
            <DialogFooter className="no-print">
              <Button variant="outline" onClick={() => setViewReceipt(null)}>
                Close
              </Button>
              <Button onClick={() => window.print()} data-testid="button-dialog-print">
                <Printer className="h-4 w-4 mr-2" />
                Print
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
