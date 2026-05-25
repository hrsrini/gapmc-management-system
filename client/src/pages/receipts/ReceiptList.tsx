import { useState, useMemo, useCallback } from 'react';
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Download,
  XCircle,
  Trash2,
  Receipt as ReceiptIcon,
  AlertCircle,
  RefreshCcw,
  Loader2,
} from 'lucide-react';
import { legacyRowMatchesSelectedApiYard } from '@/lib/legacyYardMatch';
import { useScopedActiveYards } from '@/hooks/useScopedActiveYards';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import { formatInr } from "@/lib/formatInr";
import type { Receipt } from '@shared/schema';

const typeColors: Record<string, string> = {
  Rent: 'bg-primary/10 text-primary border-primary/20',
  'Market Fee': 'bg-accent/10 text-accent border-accent/20',
  'License Fee': 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  Other: 'bg-muted text-muted-foreground border-muted',
};

function isIomsUnifiedReceiptNo(receiptNo: string): boolean {
  return String(receiptNo ?? '').startsWith('GAPLMB/');
}

const receiptColumns: ReportTableColumn[] = [
  { key: '_receiptNo', header: 'Receipt No', sortField: 'receiptNo' },
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
  const canDelete = can('M-05', 'Delete');
  const [selectedYard, setSelectedYard] = useState<string>('all');
  const [selectedType, setSelectedType] = useState<string>('all');
  const [deleteTarget, setDeleteTarget] = useState<Receipt | null>(null);
  const [pdfLoadingId, setPdfLoadingId] = useState<string | null>(null);

  const downloadReceiptPdf = useCallback(
    async (receipt: Receipt) => {
      if (!isIomsUnifiedReceiptNo(receipt.receiptNo)) return;
      setPdfLoadingId(receipt.id);
      try {
        const res = await fetch(`/api/ioms/receipts/${encodeURIComponent(receipt.id)}/pdf`, {
          credentials: 'include',
        });
        if (!res.ok) {
          const t = await res.text();
          throw new Error(t || res.statusText);
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `receipt-${receipt.receiptNo.replace(/[^\w.-]+/g, '_')}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
        toast({ title: 'PDF downloaded', description: 'Server-generated receipt PDF.' });
      } catch (e: unknown) {
        toast({
          title: 'PDF download failed',
          description: e instanceof Error ? e.message : 'Could not download receipt PDF.',
          variant: 'destructive',
        });
      } finally {
        setPdfLoadingId(null);
      }
    },
    [toast],
  );

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

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest('DELETE', `/api/receipts/${id}`),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['/api/receipts'] });
      setDeleteTarget((t) => (t?.id === id ? null : t));
      toast({ title: 'Receipt deleted', description: 'The receipt record was removed.' });
    },
    onError: () => {
      toast({ title: 'Error', description: 'Failed to delete receipt', variant: 'destructive' });
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
      _receiptNo: isIomsUnifiedReceiptNo(receipt.receiptNo) ? (
        <Link href={`/receipts/ioms/${receipt.id}`} className="text-primary hover:underline font-mono text-sm">
          {receipt.receiptNo}
        </Link>
      ) : (
        <span className="font-mono text-sm">{receipt.receiptNo}</span>
      ),
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
      _total: `${formatInr(receipt.total)}`,
      paymentMode: receipt.paymentMode,
      issuedBy: receipt.issuedBy,
      _actions: (
        <div className="flex items-center justify-end gap-1">
          {isIomsUnifiedReceiptNo(receipt.receiptNo) && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => void downloadReceiptPdf(receipt)}
              disabled={pdfLoadingId === receipt.id}
              data-testid={`button-download-pdf-${receipt.id}`}
              aria-label="Download receipt PDF"
              title="Download PDF"
            >
              {pdfLoadingId === receipt.id ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
            </Button>
          )}
          {receipt.status === 'Active' && !isIomsUnifiedReceiptNo(receipt.receiptNo) && (
            <Button
              variant="ghost"
              size="icon"
              className="text-destructive"
              onClick={() => voidMutation.mutate(receipt.id)}
              disabled={voidMutation.isPending}
              data-testid={`button-void-${receipt.id}`}
              aria-label="Void receipt"
            >
              <XCircle className="h-4 w-4" />
            </Button>
          )}
          {canDelete && !isIomsUnifiedReceiptNo(receipt.receiptNo) && (
            <Button
              variant="ghost"
              size="icon"
              className="text-destructive"
              onClick={() => setDeleteTarget(receipt)}
              disabled={deleteMutation.isPending}
              data-testid={`button-delete-${receipt.id}`}
              aria-label="Delete receipt"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      ),
    }));
  }, [filteredReceipts, voidMutation, canDelete, deleteMutation.isPending, downloadReceiptPdf, pdfLoadingId]);

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
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ReceiptIcon className="h-6 w-6 text-primary" />
            All Receipts
          </h1>
          <p className="text-muted-foreground">View and manage all receipts</p>
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

        <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete receipt permanently?</AlertDialogTitle>
              <AlertDialogDescription>
                {deleteTarget
                  ? `This removes ${deleteTarget.receiptNo} from the register. This cannot be undone (unlike voiding).`
                  : null}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={deleteMutation.isPending}
                onClick={(e) => {
                  e.preventDefault();
                  if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
                }}
              >
                {deleteMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </AppShell>
  );
}
