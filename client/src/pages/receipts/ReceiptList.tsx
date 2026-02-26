import { useState } from 'react';
import { Link } from 'wouter';
import { useQuery, useMutation } from '@tanstack/react-query';
import { AppShell } from '@/components/layout/AppShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  Plus, 
  Search, 
  Eye, 
  Printer, 
  XCircle,
  Receipt as ReceiptIcon,
  AlertCircle,
  RefreshCcw
} from 'lucide-react';
import { YARDS } from '@/data/yards';
import { format } from 'date-fns';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import type { Receipt } from '@shared/schema';

const typeColors: Record<string, string> = {
  Rent: 'bg-primary/10 text-primary border-primary/20',
  'Market Fee': 'bg-accent/10 text-accent border-accent/20',
  'License Fee': 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  Other: 'bg-muted text-muted-foreground border-muted',
};

export default function ReceiptList() {
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [selectedYard, setSelectedYard] = useState<string>('all');
  const [selectedType, setSelectedType] = useState<string>('all');

  const { data: receipts, isLoading, isError, refetch } = useQuery<Receipt[]>({
    queryKey: ['/api/receipts'],
  });

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

  const filteredReceipts = (receipts ?? []).filter((receipt) => {
    const matchesSearch =
      receipt.traderName.toLowerCase().includes(search.toLowerCase()) ||
      receipt.receiptNo.toLowerCase().includes(search.toLowerCase());
    const matchesYard = selectedYard === 'all' || receipt.yardId.toString() === selectedYard;
    const matchesType = selectedType === 'all' || receipt.type === selectedType;
    return matchesSearch && matchesYard && matchesType;
  });

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
          <Button asChild data-testid="button-new-receipt">
            <Link href="/receipts/new">
              <Plus className="h-4 w-4 mr-2" />
              New Receipt
            </Link>
          </Button>
        </div>

        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-base font-medium">Filters</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search receipt or trader..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                  data-testid="input-search"
                />
              </div>
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
                  {YARDS.map((yard) => (
                    <SelectItem key={yard.id} value={yard.id.toString()}>
                      {yard.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-6 space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Receipt No</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Trader</TableHead>
                      <TableHead>Head</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Mode</TableHead>
                      <TableHead>Issued By</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredReceipts.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                          No receipts found
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredReceipts.map((receipt) => (
                        <TableRow key={receipt.id} data-testid={`row-receipt-${receipt.id}`}>
                          <TableCell className="font-medium font-mono">{receipt.receiptNo}</TableCell>
                          <TableCell>{format(new Date(receipt.receiptDate), 'MMM dd, yyyy')}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={typeColors[receipt.type]}>
                              {receipt.type}
                            </Badge>
                          </TableCell>
                          <TableCell>{receipt.traderName}</TableCell>
                          <TableCell className="text-muted-foreground">{receipt.head}</TableCell>
                          <TableCell className="text-right font-semibold">₹{receipt.total.toLocaleString()}</TableCell>
                          <TableCell>{receipt.paymentMode}</TableCell>
                          <TableCell className="text-muted-foreground">{receipt.issuedBy}</TableCell>
                          <TableCell>
                            <div className="flex items-center justify-end gap-1">
                              <Button variant="ghost" size="icon" data-testid={`button-view-${receipt.id}`}>
                                <Eye className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="icon" data-testid={`button-print-${receipt.id}`}>
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
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
