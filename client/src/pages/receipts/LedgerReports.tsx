import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AppShell } from '@/components/layout/AppShell';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { BookOpen, Download } from 'lucide-react';
import { YARDS } from '@/data/yards';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import type { Receipt, Trader } from '@shared/schema';

type ReportType = 'trader' | 'head' | 'yard' | 'daily' | 'payment';

const reportTypes = [
  { value: 'trader', label: 'Trader-wise Ledger' },
  { value: 'head', label: 'Head-wise Collection Summary' },
  { value: 'yard', label: 'Yard-wise Collection' },
  { value: 'daily', label: 'Daily Collection Report' },
  { value: 'payment', label: 'Payment Mode Summary' },
];

export default function LedgerReports() {
  const { toast } = useToast();
  const [reportType, setReportType] = useState<ReportType>('trader');
  const [selectedTrader, setSelectedTrader] = useState<string>('all');
  const [selectedYard, setSelectedYard] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const { data: receipts, isLoading: receiptsLoading } = useQuery<Receipt[]>({
    queryKey: ['/api/receipts'],
  });

  const { data: traders, isLoading: tradersLoading } = useQuery<Trader[]>({
    queryKey: ['/api/traders'],
  });

  const isLoading = receiptsLoading || tradersLoading;

  const handleExport = () => {
    toast({
      title: 'Export Started',
      description: 'Your report is being generated for download.',
    });
  };

  const traderLedger = (receipts ?? []).filter(r => 
    selectedTrader === 'all' || r.traderId === selectedTrader
  ).map(r => ({
    ...r,
    traderDetails: (traders ?? []).find(t => t.id === r.traderId),
  }));

  const headWiseSummary = (receipts ?? []).reduce((acc, r) => {
    const key = `${r.type}-${r.head}`;
    if (!acc[key]) {
      acc[key] = { type: r.type, head: r.head, count: 0, total: 0 };
    }
    acc[key].count++;
    acc[key].total += r.total;
    return acc;
  }, {} as Record<string, { type: string; head: string; count: number; total: number }>);

  const yardWiseSummary = YARDS.map(yard => {
    const yardReceipts = (receipts ?? []).filter(r => r.yardId === yard.id);
    return {
      yard: yard.name,
      code: yard.code,
      count: yardReceipts.length,
      total: yardReceipts.reduce((sum, r) => sum + r.total, 0),
    };
  }).filter(y => y.count > 0);

  const paymentModeSummary = (receipts ?? []).reduce((acc, r) => {
    if (!acc[r.paymentMode]) {
      acc[r.paymentMode] = { mode: r.paymentMode, count: 0, total: 0 };
    }
    acc[r.paymentMode].count++;
    acc[r.paymentMode].total += r.total;
    return acc;
  }, {} as Record<string, { mode: string; count: number; total: number }>);

  return (
    <AppShell breadcrumbs={[{ label: 'Receipts', href: '/receipts' }, { label: 'Ledger Reports' }]}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BookOpen className="h-6 w-6 text-primary" />
            Ledger Reports
          </h1>
          <p className="text-muted-foreground">Generate and export receipt ledger reports</p>
        </div>

        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-base">Report Configuration</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <div className="space-y-2">
                <Label>Report Type</Label>
                <Select value={reportType} onValueChange={(v) => setReportType(v as ReportType)}>
                  <SelectTrigger data-testid="select-report-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {reportTypes.map((type) => (
                      <SelectItem key={type.value} value={type.value}>
                        {type.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {reportType === 'trader' && (
                <div className="space-y-2">
                  <Label>Trader</Label>
                  <Select value={selectedTrader} onValueChange={setSelectedTrader}>
                    <SelectTrigger data-testid="select-trader">
                      <SelectValue placeholder="All Traders" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Traders</SelectItem>
                      {(traders ?? []).map((trader) => (
                        <SelectItem key={trader.id} value={trader.id}>
                          {trader.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {reportType === 'yard' && (
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
              )}
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
          <>
            {reportType === 'trader' && (
              <Card>
                <CardHeader>
                  <CardTitle>Trader-wise Ledger</CardTitle>
                  <CardDescription>Receipt history by trader</CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Receipt No</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Trader</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Head</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Mode</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {traderLedger.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell className="font-mono">{item.receiptNo}</TableCell>
                          <TableCell>{format(new Date(item.receiptDate), 'MMM dd, yyyy')}</TableCell>
                          <TableCell>{item.traderName}</TableCell>
                          <TableCell>{item.type}</TableCell>
                          <TableCell>{item.head}</TableCell>
                          <TableCell className="text-right font-semibold">₹{item.total.toLocaleString()}</TableCell>
                          <TableCell>{item.paymentMode}</TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="bg-muted/50 font-bold">
                        <TableCell colSpan={5}>Total</TableCell>
                        <TableCell className="text-right">₹{traderLedger.reduce((sum, r) => sum + r.total, 0).toLocaleString()}</TableCell>
                        <TableCell></TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}

            {reportType === 'head' && (
              <Card>
                <CardHeader>
                  <CardTitle>Head-wise Collection Summary</CardTitle>
                  <CardDescription>Collection summary by receipt head</CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Receipt Type</TableHead>
                        <TableHead>Head</TableHead>
                        <TableHead className="text-right">Count</TableHead>
                        <TableHead className="text-right">Total Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {Object.values(headWiseSummary).map((item, idx) => (
                        <TableRow key={idx}>
                          <TableCell>{item.type}</TableCell>
                          <TableCell>{item.head}</TableCell>
                          <TableCell className="text-right">{item.count}</TableCell>
                          <TableCell className="text-right font-semibold">₹{item.total.toLocaleString()}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}

            {reportType === 'yard' && (
              <Card>
                <CardHeader>
                  <CardTitle>Yard-wise Collection</CardTitle>
                  <CardDescription>Collection summary by yard</CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Yard</TableHead>
                        <TableHead>Code</TableHead>
                        <TableHead className="text-right">Receipts</TableHead>
                        <TableHead className="text-right">Total Collection</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {yardWiseSummary.map((item) => (
                        <TableRow key={item.code}>
                          <TableCell>{item.yard}</TableCell>
                          <TableCell>{item.code}</TableCell>
                          <TableCell className="text-right">{item.count}</TableCell>
                          <TableCell className="text-right font-semibold">₹{item.total.toLocaleString()}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}

            {reportType === 'payment' && (
              <Card>
                <CardHeader>
                  <CardTitle>Payment Mode Summary</CardTitle>
                  <CardDescription>Collection summary by payment mode</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    {Object.values(paymentModeSummary).map((item) => (
                      <Card key={item.mode} className="bg-muted/50">
                        <CardContent className="p-4 text-center">
                          <p className="text-sm text-muted-foreground">{item.mode}</p>
                          <p className="text-2xl font-bold mt-1">₹{item.total.toLocaleString()}</p>
                          <p className="text-xs text-muted-foreground">{item.count} receipts</p>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
