import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { useQuery } from '@tanstack/react-query';
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
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Plus, Eye, Wallet, IndianRupee, TrendingUp, Clock, AlertCircle, RefreshCcw } from 'lucide-react';
import { legacyRowMatchesSelectedApiYard } from '@/lib/legacyYardMatch';
import { useScopedActiveYards } from '@/hooks/useScopedActiveYards';
import { format, formatDisplayDate } from '@/lib/dateFormat';
import type { MarketFee } from '@shared/schema';
import { ClientDataGrid } from '@/components/reports/ClientDataGrid';
import type { ReportTableColumn } from '@/components/reports/ReportDataTable';

const columns: ReportTableColumn[] = [
  { key: 'receiptNo', header: 'Receipt No' },
  { key: 'entryDate', header: 'Date' },
  { key: '_entryType', header: 'Type', sortField: 'entryType' },
  { key: 'traderName', header: 'Trader' },
  { key: 'commodity', header: 'Commodity' },
  { key: 'quantityLabel', header: 'Quantity' },
  { key: 'totalValue', header: 'Value' },
  { key: '_marketFee', header: 'Fee Amount', sortField: 'marketFee' },
  { key: 'paymentMode', header: 'Mode' },
  { key: 'locationName', header: 'Location' },
  { key: '_actions', header: 'Actions' },
];

export default function FeeCollection() {
  const [selectedLocation, setSelectedLocation] = useState<string>('all');
  const [viewEntry, setViewEntry] = useState<MarketFee | null>(null);

  const { data: marketFees, isLoading, isError, refetch } = useQuery<MarketFee[]>({
    queryKey: ['/api/marketfees'],
  });

  const { data: yards = [] } = useScopedActiveYards();

  const filteredEntries = useMemo(() => {
    return (marketFees ?? []).filter((entry) =>
      legacyRowMatchesSelectedApiYard(entry.locationId, entry.locationName, selectedLocation, yards),
    );
  }, [marketFees, selectedLocation, yards]);

  const sourceRows = useMemo((): Record<string, unknown>[] => {
    return filteredEntries.map((entry) => ({
      id: entry.id,
      receiptNo: entry.receiptNo,
      entryDate: entry.entryDate,
      entryType: entry.entryType,
      traderName: entry.traderName,
      commodity: entry.commodity,
      quantityLabel: `${entry.quantity} ${entry.unit}`,
      totalValue: entry.totalValue,
      marketFee: entry.marketFee,
      paymentMode: entry.paymentMode,
      locationName: entry.locationName,
      _entryType: (
        <Badge variant={entry.entryType === 'Import' ? 'default' : 'secondary'}>{entry.entryType}</Badge>
      ),
      _marketFee: (
        <span className="font-semibold text-accent">₹{entry.marketFee.toLocaleString()}</span>
      ),
      _actions: (
        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setViewEntry(entry)}
            data-testid={`button-view-${entry.id}`}
            aria-label="View entry"
          >
            <Eye className="h-4 w-4" />
          </Button>
        </div>
      ),
    }));
  }, [filteredEntries]);

  const todayCollection = (marketFees ?? []).filter(
    mf => mf.entryDate === format(new Date(), 'yyyy-MM-dd')
  ).reduce((sum, mf) => sum + mf.marketFee, 0);

  const monthCollection = (marketFees ?? []).reduce((sum, mf) => sum + mf.marketFee, 0);

  const stats = [
    {
      title: "Today's Collection",
      value: `₹${todayCollection.toLocaleString()}`,
      icon: IndianRupee,
      color: 'bg-accent/10 text-accent',
    },
    {
      title: 'This Month',
      value: `₹${monthCollection.toLocaleString()}`,
      icon: TrendingUp,
      color: 'bg-primary/10 text-primary',
    },
    {
      title: 'Pending Dues',
      value: '₹0',
      icon: Clock,
      color: 'bg-amber-500/10 text-amber-600',
    },
  ];

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: 'Market Fee', href: '/market-fee' }, { label: 'Collection' }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-destructive" />
              <span className="text-destructive">Failed to load market fees. Please try again.</span>
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
    <AppShell breadcrumbs={[{ label: 'Market Fee', href: '/market-fee' }, { label: 'Collection' }]}>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Wallet className="h-6 w-6 text-primary" />
              Market Fee Collection
            </h1>
            <p className="text-muted-foreground">Track and manage market fee entries</p>
          </div>
          <Button asChild data-testid="button-new-entry">
            <Link href="/market-fee/entry">
              <Plus className="h-4 w-4 mr-2" />
              New Entry
            </Link>
          </Button>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {stats.map((stat) => (
            <Card key={stat.title}>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">{stat.title}</p>
                    {isLoading ? (
                      <Skeleton className="h-8 w-20 mt-1" />
                    ) : (
                      <p className="text-2xl font-bold mt-1">{stat.value}</p>
                    )}
                  </div>
                  <div className={`p-3 rounded-lg ${stat.color}`}>
                    <stat.icon className="h-6 w-6" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-base font-medium">Filters</CardTitle>
            <p className="text-sm text-muted-foreground">Use the grid search for trader, receipt, commodity, and location name.</p>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Select value={selectedLocation} onValueChange={setSelectedLocation}>
                <SelectTrigger data-testid="select-location">
                  <SelectValue placeholder="Select Location" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Locations</SelectItem>
                  {yards.map((loc) => (
                    <SelectItem key={loc.id} value={loc.id}>
                      {loc.name} ({loc.type ?? '—'})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : (
              <ClientDataGrid
                columns={columns}
                sourceRows={sourceRows}
                searchKeys={[
                  'receiptNo',
                  'entryDate',
                  'entryType',
                  'traderName',
                  'commodity',
                  'quantityLabel',
                  'totalValue',
                  'marketFee',
                  'paymentMode',
                  'locationName',
                ]}
                searchPlaceholder="Search trader, receipt, commodity, location…"
                defaultSortKey="entryDate"
                defaultSortDir="desc"
                resetPageDependency={selectedLocation}
                emptyMessage="No entries found"
              />
            )}
          </CardContent>
        </Card>

        <Dialog open={!!viewEntry} onOpenChange={(open) => !open && setViewEntry(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Market Fee Entry</DialogTitle>
            </DialogHeader>
            {viewEntry && (
              <div className="grid gap-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Receipt No</span>
                  <span className="font-mono">{viewEntry.receiptNo}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Date</span>
                  <span>{formatDisplayDate(viewEntry.entryDate)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Type</span>
                  <Badge variant={viewEntry.entryType === 'Import' ? 'default' : 'secondary'}>
                    {viewEntry.entryType}
                  </Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Trader</span>
                  <span className="font-medium">{viewEntry.traderName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Commodity</span>
                  <span>{viewEntry.commodity}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Quantity</span>
                  <span>{viewEntry.quantity} {viewEntry.unit}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Rate</span>
                  <span>₹{viewEntry.ratePerUnit?.toLocaleString()}/unit</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total Value</span>
                  <span>₹{viewEntry.totalValue.toLocaleString()}</span>
                </div>
                <div className="flex justify-between pt-2 border-t font-semibold">
                  <span>Market Fee</span>
                  <span className="text-accent">₹{viewEntry.marketFee.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Location</span>
                  <span>{viewEntry.locationName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Payment</span>
                  <span>{viewEntry.paymentMode}</span>
                </div>
                <Button variant="outline" size="sm" className="mt-2" onClick={() => setViewEntry(null)}>Close</Button>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
