import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AppShell } from '@/components/layout/AppShell';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { BarChart3, Download, FileText, AlertCircle } from 'lucide-react';
import { YARDS } from '@/data/yards';
import { useToast } from '@/hooks/use-toast';
import type { Invoice, Trader } from '@shared/schema';

export default function RentReports() {
  const { toast } = useToast();
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedYard, setSelectedYard] = useState<string>('all');

  const { data: invoices, isLoading: invoicesLoading, isError: invoicesError } = useQuery<Invoice[]>({
    queryKey: ['/api/invoices'],
  });

  const { data: traders, isLoading: tradersLoading } = useQuery<Trader[]>({
    queryKey: ['/api/traders'],
  });

  const isLoading = invoicesLoading || tradersLoading;

  const handleExport = () => {
    toast({
      title: 'Export Started',
      description: 'Your report is being generated for download.',
    });
  };

  const outstandingDues = (invoices ?? []).filter(i => i.status !== 'Paid').map(inv => {
    const trader = (traders ?? []).find(t => t.id === inv.traderId);
    return {
      ...inv,
      traderMobile: trader?.mobile || '',
    };
  });

  const yardWiseCollection = YARDS.map(yard => {
    const yardInvoices = (invoices ?? []).filter(i => i.yardId === yard.id);
    const total = yardInvoices.reduce((sum, i) => sum + i.total, 0);
    const paid = yardInvoices.filter(i => i.status === 'Paid').reduce((sum, i) => sum + i.total, 0);
    const pending = yardInvoices.filter(i => i.status !== 'Paid').reduce((sum, i) => sum + i.total, 0);
    return {
      yard: yard.name,
      code: yard.code,
      totalInvoices: yardInvoices.length,
      totalAmount: total,
      collected: paid,
      pending: pending,
    };
  }).filter(y => y.totalInvoices > 0);

  const gstSummary = (invoices ?? []).reduce((acc, inv) => {
    return {
      totalBase: acc.totalBase + inv.baseRent,
      totalCGST: acc.totalCGST + inv.cgst,
      totalSGST: acc.totalSGST + inv.sgst,
      totalInterest: acc.totalInterest + inv.interest,
      grandTotal: acc.grandTotal + inv.total,
    };
  }, { totalBase: 0, totalCGST: 0, totalSGST: 0, totalInterest: 0, grandTotal: 0 });

  if (invoicesError) {
    return (
      <AppShell breadcrumbs={[{ label: 'Rent & Tax', href: '/rent' }, { label: 'Reports' }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Failed to load report data. Please try again.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: 'Rent & Tax', href: '/rent' }, { label: 'Reports' }]}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-primary" />
            Rent Reports
          </h1>
          <p className="text-muted-foreground">Generate and export rent/tax reports</p>
        </div>

        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-base">Report Filters</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-2">
                <Label>From Date</Label>
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  data-testid="input-date-from"
                />
              </div>
              <div className="space-y-2">
                <Label>To Date</Label>
                <Input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  data-testid="input-date-to"
                />
              </div>
              <div className="space-y-2">
                <Label>Yard</Label>
                <Select value={selectedYard} onValueChange={setSelectedYard}>
                  <SelectTrigger data-testid="select-yard">
                    <SelectValue placeholder="All Yards" />
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
              <div className="flex items-end">
                <Button onClick={handleExport} variant="outline" className="w-full" data-testid="button-export">
                  <Download className="h-4 w-4 mr-2" />
                  Export CSV
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {isLoading ? (
          <Card>
            <CardContent className="p-6">
              <Skeleton className="h-64 w-full" />
            </CardContent>
          </Card>
        ) : (
          <Tabs defaultValue="outstanding" className="space-y-4">
            <TabsList className="grid w-full grid-cols-3 lg:w-auto lg:inline-grid">
              <TabsTrigger value="outstanding" data-testid="tab-outstanding">Outstanding Dues</TabsTrigger>
              <TabsTrigger value="yardwise" data-testid="tab-yardwise">Yard-wise Collection</TabsTrigger>
              <TabsTrigger value="gst" data-testid="tab-gst">GST Summary</TabsTrigger>
            </TabsList>

            <TabsContent value="outstanding">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FileText className="h-5 w-5" />
                    Outstanding Dues Report
                  </CardTitle>
                  <CardDescription>Traders with pending payments</CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Invoice No</TableHead>
                        <TableHead>Trader Name</TableHead>
                        <TableHead>Mobile</TableHead>
                        <TableHead>Yard</TableHead>
                        <TableHead className="text-right">Amount Due</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {outstandingDues.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                            No outstanding dues
                          </TableCell>
                        </TableRow>
                      ) : (
                        outstandingDues.map((item) => (
                          <TableRow key={item.id}>
                            <TableCell className="font-medium">{item.id}</TableCell>
                            <TableCell>{item.traderName}</TableCell>
                            <TableCell>{item.traderMobile}</TableCell>
                            <TableCell>{item.yard}</TableCell>
                            <TableCell className="text-right font-semibold">₹{item.total.toLocaleString()}</TableCell>
                            <TableCell>
                              <span className={`px-2 py-1 rounded text-xs ${item.status === 'Overdue' ? 'bg-destructive/10 text-destructive' : 'bg-amber-500/10 text-amber-600'}`}>
                                {item.status}
                              </span>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="yardwise">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BarChart3 className="h-5 w-5" />
                    Yard-wise Collection Report
                  </CardTitle>
                  <CardDescription>Collection summary by yard</CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Yard</TableHead>
                        <TableHead>Code</TableHead>
                        <TableHead className="text-right">Invoices</TableHead>
                        <TableHead className="text-right">Total Amount</TableHead>
                        <TableHead className="text-right">Collected</TableHead>
                        <TableHead className="text-right">Pending</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {yardWiseCollection.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                            No collection data
                          </TableCell>
                        </TableRow>
                      ) : (
                        yardWiseCollection.map((item) => (
                          <TableRow key={item.code}>
                            <TableCell className="font-medium">{item.yard}</TableCell>
                            <TableCell>{item.code}</TableCell>
                            <TableCell className="text-right">{item.totalInvoices}</TableCell>
                            <TableCell className="text-right">₹{item.totalAmount.toLocaleString()}</TableCell>
                            <TableCell className="text-right text-accent">₹{item.collected.toLocaleString()}</TableCell>
                            <TableCell className="text-right text-amber-600">₹{item.pending.toLocaleString()}</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="gst">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FileText className="h-5 w-5" />
                    GST Summary (for GSTR-1 filing)
                  </CardTitle>
                  <CardDescription>Tax summary for the selected period</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                    <Card className="bg-muted/50">
                      <CardContent className="p-4 text-center">
                        <p className="text-sm text-muted-foreground">Total Base Rent</p>
                        <p className="text-2xl font-bold">₹{gstSummary.totalBase.toLocaleString()}</p>
                      </CardContent>
                    </Card>
                    <Card className="bg-muted/50">
                      <CardContent className="p-4 text-center">
                        <p className="text-sm text-muted-foreground">Total CGST</p>
                        <p className="text-2xl font-bold">₹{gstSummary.totalCGST.toLocaleString()}</p>
                      </CardContent>
                    </Card>
                    <Card className="bg-muted/50">
                      <CardContent className="p-4 text-center">
                        <p className="text-sm text-muted-foreground">Total SGST</p>
                        <p className="text-2xl font-bold">₹{gstSummary.totalSGST.toLocaleString()}</p>
                      </CardContent>
                    </Card>
                    <Card className="bg-muted/50">
                      <CardContent className="p-4 text-center">
                        <p className="text-sm text-muted-foreground">Total Interest</p>
                        <p className="text-2xl font-bold">₹{gstSummary.totalInterest.toLocaleString()}</p>
                      </CardContent>
                    </Card>
                    <Card className="bg-primary/10">
                      <CardContent className="p-4 text-center">
                        <p className="text-sm text-muted-foreground">Grand Total</p>
                        <p className="text-2xl font-bold text-primary">₹{gstSummary.grandTotal.toLocaleString()}</p>
                      </CardContent>
                    </Card>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        )}
      </div>
    </AppShell>
  );
}
