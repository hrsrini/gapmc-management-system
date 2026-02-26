import { useState } from 'react';
import { Link } from 'wouter';
import { useQuery } from '@tanstack/react-query';
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
import { Plus, Search, Eye, Wallet, IndianRupee, TrendingUp, Clock, AlertCircle, RefreshCcw } from 'lucide-react';
import { LOCATIONS } from '@/data/yards';
import { format } from 'date-fns';
import type { MarketFee } from '@shared/schema';

export default function FeeCollection() {
  const [search, setSearch] = useState('');
  const [selectedLocation, setSelectedLocation] = useState<string>('all');

  const { data: marketFees, isLoading, isError, refetch } = useQuery<MarketFee[]>({
    queryKey: ['/api/marketfees'],
  });

  const filteredEntries = (marketFees ?? []).filter((entry) => {
    const matchesSearch =
      entry.traderName.toLowerCase().includes(search.toLowerCase()) ||
      entry.receiptNo.toLowerCase().includes(search.toLowerCase()) ||
      entry.commodity.toLowerCase().includes(search.toLowerCase());
    const matchesLocation = selectedLocation === 'all' || entry.locationId.toString() === selectedLocation;
    return matchesSearch && matchesLocation;
  });

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
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search trader, receipt, commodity..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                  data-testid="input-search"
                />
              </div>
              <Select value={selectedLocation} onValueChange={setSelectedLocation}>
                <SelectTrigger data-testid="select-location">
                  <SelectValue placeholder="Select Location" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Locations</SelectItem>
                  {LOCATIONS.map((location) => (
                    <SelectItem key={location.id} value={location.id.toString()}>
                      {location.name}
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
                      <TableHead>Commodity</TableHead>
                      <TableHead className="text-right">Quantity</TableHead>
                      <TableHead className="text-right">Value</TableHead>
                      <TableHead className="text-right">Fee Amount</TableHead>
                      <TableHead>Mode</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredEntries.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={11} className="text-center py-8 text-muted-foreground">
                          No entries found
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredEntries.map((entry) => (
                        <TableRow key={entry.id} data-testid={`row-entry-${entry.id}`}>
                          <TableCell className="font-medium">{entry.receiptNo}</TableCell>
                          <TableCell>{format(new Date(entry.entryDate), 'MMM dd, yyyy')}</TableCell>
                          <TableCell>
                            <Badge variant={entry.entryType === 'Import' ? 'default' : 'secondary'}>
                              {entry.entryType}
                            </Badge>
                          </TableCell>
                          <TableCell>{entry.traderName}</TableCell>
                          <TableCell>{entry.commodity}</TableCell>
                          <TableCell className="text-right">{entry.quantity} {entry.unit}</TableCell>
                          <TableCell className="text-right">₹{entry.totalValue.toLocaleString()}</TableCell>
                          <TableCell className="text-right font-semibold text-accent">₹{entry.marketFee.toLocaleString()}</TableCell>
                          <TableCell>{entry.paymentMode}</TableCell>
                          <TableCell className="text-muted-foreground text-xs">{entry.locationName}</TableCell>
                          <TableCell>
                            <Button variant="ghost" size="icon" data-testid={`button-view-${entry.id}`}>
                              <Eye className="h-4 w-4" />
                            </Button>
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
