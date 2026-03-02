import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { AppShell } from '@/components/layout/AppShell';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { ClipboardList, Save, Send, AlertCircle, Database } from 'lucide-react';
import { COMMODITIES } from '@/data/yards';
import { format } from '@/lib/dateFormat';
import { apiRequest, queryClient } from '@/lib/queryClient';
import type { Trader, StockReturn } from '@shared/schema';

interface ReturnEntry {
  commodity: string;
  openingBalance: number;
  locallyProcured: number;
  purchasedFromTrader: number;
  sales: number;
  closingBalance: number;
}

export default function Returns() {
  const { toast } = useToast();
  const [selectedTraderId, setSelectedTraderId] = useState<string>('');
  const [period, setPeriod] = useState(format(new Date(), 'yyyy-MM'));
  const [entries, setEntries] = useState<ReturnEntry[]>([]);

  const { data: traders, isLoading, isError } = useQuery<Trader[]>({
    queryKey: ['/api/traders'],
  });

  const { data: submittedReturns = [], isLoading: returnsLoading } = useQuery<StockReturn[]>({
    queryKey: ['/api/stockreturns'],
  });

  const seedSampleMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/seed-sample-stock-returns', { method: 'POST', credentials: 'include' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || res.statusText || 'Failed to load sample data');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/stockreturns'] });
      toast({ title: 'Sample data loaded', description: 'Sample stock returns have been added.' });
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: unknown) => {
      try {
        const res = await apiRequest('POST', '/api/stockreturns', data);
        return await res.json();
      } catch (err) {
        const msg = err instanceof Error ? err.message : '';
        const serverError = msg.includes(':') ? (() => {
          try {
            const jsonStr = msg.replace(/^\d+:\s*/, '').trim();
            const body = jsonStr.startsWith('{') ? JSON.parse(jsonStr) : null;
            return body?.error || body?.message || null;
          } catch {
            return null;
          }
        })() : null;
        throw new Error(serverError || msg || 'Failed to submit returns');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/stockreturns'] });
    },
    onError: (err: Error) => {
      const msg = err?.message || 'Failed to submit returns';
      const isNetworkError = msg === 'Failed to fetch' || msg.includes('NetworkError');
      toast({
        title: isNetworkError ? 'Connection error' : 'Validation Error',
        description: isNetworkError
          ? 'Cannot reach server. Make sure the app is running (npm run dev) and try again.'
          : msg,
        variant: 'destructive',
      });
    },
  });

  const selectedTrader = (traders ?? []).find(t => t.id === selectedTraderId);

  const updateEntry = (index: number, field: keyof ReturnEntry, value: number) => {
    setEntries(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      updated[index].closingBalance = 
        updated[index].openingBalance + 
        updated[index].locallyProcured + 
        updated[index].purchasedFromTrader - 
        updated[index].sales;
      return updated;
    });
  };

  const addCommodity = (commodity: string) => {
    if (!entries.find(e => e.commodity === commodity)) {
      const prevClosing =
        selectedTraderId && period
          ? submittedReturns
              .filter(
                (r) =>
                  r.traderId === selectedTraderId &&
                  r.commodity === commodity &&
                  r.period &&
                  r.period < period
              )
              .sort((a, b) => (b.period ?? "").localeCompare(a.period ?? ""))[0]?.closingBalance
          : undefined;
      const opening = typeof prevClosing === "number" && !Number.isNaN(prevClosing) ? prevClosing : 0;
      setEntries(prev => [...prev, {
        commodity,
        openingBalance: opening,
        locallyProcured: 0,
        purchasedFromTrader: 0,
        sales: 0,
        closingBalance: opening,
      }]);
    }
  };

  const handleSubmit = (isDraft: boolean) => {
    if (!selectedTraderId) {
      toast({
        title: 'Validation Error',
        description: 'Please select a trader',
        variant: 'destructive',
      });
      return;
    }
    if (!isDraft && entries.length === 0) {
      toast({
        title: 'Validation Error',
        description: 'Add at least one commodity before submitting returns',
        variant: 'destructive',
      });
      return;
    }

    const payload = {
      traderId: String(selectedTraderId),
      traderName: String(selectedTrader?.name ?? ''),
      period: String(period || format(new Date(), 'yyyy-MM')),
      entries: entries.map((e) => ({
        commodity: String(e.commodity),
        openingBalance: Number(e.openingBalance) || 0,
        locallyProcured: Number(e.locallyProcured) || 0,
        purchasedFromTrader: Number(e.purchasedFromTrader) || 0,
        sales: Number(e.sales) || 0,
        closingBalance: Number(e.closingBalance) || 0,
      })),
      status: (isDraft ? 'Draft' : 'Submitted') as const,
      submittedAt: new Date().toISOString(),
    };
    createMutation.mutate(payload, {
      onSuccess: () => {
        toast({
          title: isDraft ? 'Draft Saved' : 'Returns Submitted',
          description: isDraft ? 'Stock returns saved as draft' : 'Stock returns submitted successfully',
        });
      },
    });
  };

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: 'Market Fee', href: '/market-fee' }, { label: 'Returns' }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Failed to load traders. Please try again.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: 'Market Fee', href: '/market-fee' }, { label: 'Returns' }]}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ClipboardList className="h-6 w-6 text-primary" />
            Stock Returns
          </h1>
          <p className="text-muted-foreground">Submit periodic stock returns for traders</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Submitted returns</CardTitle>
            <CardDescription>Previously submitted stock returns (sample and your entries)</CardDescription>
          </CardHeader>
          <CardContent>
            {returnsLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : submittedReturns.length === 0 ? (
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 py-4">
                <p className="text-sm text-muted-foreground">No submitted returns yet. Submit one using the form below, or load sample data.</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => seedSampleMutation.mutate()}
                  disabled={seedSampleMutation.isPending}
                  data-testid="button-load-sample-returns"
                >
                  <Database className="h-4 w-4 mr-2" />
                  {seedSampleMutation.isPending ? 'Loading…' : 'Load sample data'}
                </Button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Trader</TableHead>
                      <TableHead>Period</TableHead>
                      <TableHead>Commodity</TableHead>
                      <TableHead className="text-right">Opening</TableHead>
                      <TableHead className="text-right">Locally procured</TableHead>
                      <TableHead className="text-right">Purchased</TableHead>
                      <TableHead className="text-right">Sales</TableHead>
                      <TableHead className="text-right">Closing</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {submittedReturns.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">{r.traderName}</TableCell>
                        <TableCell>{r.period}</TableCell>
                        <TableCell>{r.commodity}</TableCell>
                        <TableCell className="text-right">{Number(r.openingBalance ?? 0)}</TableCell>
                        <TableCell className="text-right">{Number(r.locallyProcured ?? 0)}</TableCell>
                        <TableCell className="text-right">{Number(r.purchasedFromTrader ?? 0)}</TableCell>
                        <TableCell className="text-right">{Number(r.sales ?? 0)}</TableCell>
                        <TableCell className="text-right font-medium">{Number(r.closingBalance ?? 0)}</TableCell>
                        <TableCell>
                          <span className={`text-xs font-medium px-2 py-0.5 rounded ${r.status === 'Submitted' ? 'bg-accent/10 text-accent' : 'bg-muted text-muted-foreground'}`}>
                            {r.status}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Trader Selection</CardTitle>
            <CardDescription>Select the trader and period for stock returns</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-2">
                <Label>Trader *</Label>
                {isLoading ? (
                  <Skeleton className="h-10 w-full" />
                ) : (
                  <Select value={selectedTraderId} onValueChange={setSelectedTraderId}>
                    <SelectTrigger data-testid="select-trader">
                      <SelectValue placeholder="Select trader" />
                    </SelectTrigger>
                    <SelectContent>
                      {(traders ?? []).filter(t => t.status === 'Active').map((trader) => (
                        <SelectItem key={trader.id} value={trader.id}>
                          {trader.name} - {trader.premises}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <div className="space-y-2">
                <Label>Period (Month/Year)</Label>
                <Input
                  type="month"
                  value={period}
                  onChange={(e) => setPeriod(e.target.value)}
                  data-testid="input-period"
                />
              </div>
              {selectedTrader && (
                <div className="space-y-2">
                  <Label>License Number</Label>
                  <Input value={`LIC-${selectedTrader.yardName.split(' ')[0].toUpperCase()}-${selectedTrader.id.slice(-3)}`} readOnly className="bg-muted" />
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {selectedTraderId && (
          <>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-4">
                <div>
                  <CardTitle>Add Commodity</CardTitle>
                  <CardDescription>Add more commodities to the returns</CardDescription>
                </div>
                <Select onValueChange={addCommodity}>
                  <SelectTrigger className="w-48" data-testid="select-add-commodity">
                    <SelectValue placeholder="Add commodity" />
                  </SelectTrigger>
                  <SelectContent>
                    {COMMODITIES.filter(c => !entries.find(e => e.commodity === c.name)).map((c) => (
                      <SelectItem key={c.name} value={c.name}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </CardHeader>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Stock Returns</CardTitle>
                <CardDescription>Enter quantities for each commodity (in Quintals)</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Commodity</TableHead>
                        <TableHead className="text-right">Opening Balance</TableHead>
                        <TableHead className="text-right">Locally Procured</TableHead>
                        <TableHead className="text-right">Purchased from Trader</TableHead>
                        <TableHead className="text-right">Sales</TableHead>
                        <TableHead className="text-right">Closing Balance</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {entries.map((entry, index) => (
                        <TableRow key={entry.commodity} data-testid={`row-return-${entry.commodity.toLowerCase()}`}>
                          <TableCell className="font-medium">{entry.commodity}</TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              value={entry.openingBalance}
                              onChange={(e) => updateEntry(index, 'openingBalance', Number(e.target.value) || 0)}
                              className="w-24 text-right"
                              data-testid={`input-opening-balance-${index}`}
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              value={entry.locallyProcured}
                              onChange={(e) => updateEntry(index, 'locallyProcured', Number(e.target.value))}
                              className="w-24 text-right"
                              data-testid={`input-locally-procured-${index}`}
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              value={entry.purchasedFromTrader}
                              onChange={(e) => updateEntry(index, 'purchasedFromTrader', Number(e.target.value))}
                              className="w-24 text-right"
                              data-testid={`input-purchased-${index}`}
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              value={entry.sales}
                              onChange={(e) => updateEntry(index, 'sales', Number(e.target.value))}
                              className="w-24 text-right"
                              data-testid={`input-sales-${index}`}
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              value={entry.closingBalance}
                              readOnly
                              className="w-24 text-right bg-primary/10 font-semibold"
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            <div className="flex flex-col sm:flex-row gap-3 justify-end">
              <Button 
                variant="secondary" 
                onClick={() => handleSubmit(true)} 
                disabled={createMutation.isPending}
                data-testid="button-save-draft"
              >
                <Save className="h-4 w-4 mr-2" />
                Save Draft
              </Button>
              <Button 
                onClick={() => handleSubmit(false)} 
                disabled={createMutation.isPending}
                data-testid="button-submit"
              >
                <Send className="h-4 w-4 mr-2" />
                Submit Returns
              </Button>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
