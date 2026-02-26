import { useState, useMemo } from 'react';
import { useLocation } from 'wouter';
import { useQuery, useMutation } from '@tanstack/react-query';
import { AppShell } from '@/components/layout/AppShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { FileText, Save, X, Check, AlertCircle } from 'lucide-react';
import { format } from 'date-fns';
import { apiRequest, queryClient } from '@/lib/queryClient';
import type { Trader } from '@shared/schema';

export default function RentInvoiceForm() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [selectedTraderId, setSelectedTraderId] = useState<string>('');
  const [invoiceDate, setInvoiceDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [billingMonth, setBillingMonth] = useState(format(new Date(), 'yyyy-MM'));
  const [baseRent, setBaseRent] = useState<number>(0);
  const [interest, setInterest] = useState<number>(0);
  const [tdsApplicable, setTdsApplicable] = useState(false);
  const [tdsAmount, setTdsAmount] = useState<number>(0);
  const [notes, setNotes] = useState('');

  const { data: traders, isLoading, isError } = useQuery<Trader[]>({
    queryKey: ['/api/traders'],
  });

  const selectedTrader = useMemo(() => {
    return (traders ?? []).find(t => t.id === selectedTraderId);
  }, [traders, selectedTraderId]);

  const cgst = useMemo(() => Math.round(baseRent * 0.09), [baseRent]);
  const sgst = useMemo(() => Math.round(baseRent * 0.09), [baseRent]);
  const total = useMemo(() => baseRent + cgst + sgst + interest - (tdsApplicable ? tdsAmount : 0), [baseRent, cgst, sgst, interest, tdsApplicable, tdsAmount]);

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest('POST', '/api/invoices', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/invoices'] });
      queryClient.invalidateQueries({ queryKey: ['/api/stats'] });
    },
    onError: (error) => {
      toast({ 
        title: 'Error', 
        description: 'Failed to create invoice. Please check all fields.',
        variant: 'destructive' 
      });
      console.error('Invoice creation error:', error);
    },
  });

  const handleTraderChange = (traderId: string) => {
    setSelectedTraderId(traderId);
    const trader = (traders ?? []).find(t => t.id === traderId);
    if (trader) {
      setBaseRent(trader.rentAmount);
    }
  };

  const handleSubmit = (isDraft: boolean) => {
    if (!selectedTraderId || !selectedTrader) {
      toast({
        title: 'Validation Error',
        description: 'Please select a trader',
        variant: 'destructive',
      });
      return;
    }

    createMutation.mutate({
      traderId: selectedTraderId,
      traderName: selectedTrader.name,
      premises: selectedTrader.premises,
      yard: selectedTrader.yardName,
      yardId: selectedTrader.yardId,
      month: billingMonth,
      invoiceDate,
      baseRent,
      cgst,
      sgst,
      interest,
      total,
      tdsApplicable,
      tdsAmount: tdsApplicable ? tdsAmount : 0,
      status: isDraft ? 'Draft' : 'Pending',
      notes: notes || undefined,
    }, {
      onSuccess: () => {
        toast({
          title: isDraft ? 'Draft Saved' : 'Invoice Generated',
          description: isDraft ? 'Invoice saved as draft' : 'Invoice has been generated successfully',
        });
        setLocation('/rent');
      },
    });
  };

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: 'Rent & Tax', href: '/rent' }, { label: 'Create Invoice' }]}>
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
    <AppShell breadcrumbs={[{ label: 'Rent & Tax', href: '/rent' }, { label: 'Create Invoice' }]}>
      <div className="space-y-6 max-w-4xl">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileText className="h-6 w-6 text-primary" />
            Create Rent Invoice
          </h1>
          <p className="text-muted-foreground">Generate a new rent/tax invoice</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Trader Selection</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="trader">Select Trader</Label>
                {isLoading ? (
                  <Skeleton className="h-10 w-full" />
                ) : (
                  <Select value={selectedTraderId} onValueChange={handleTraderChange}>
                    <SelectTrigger data-testid="select-trader">
                      <SelectValue placeholder="Choose a trader" />
                    </SelectTrigger>
                    <SelectContent>
                      {(traders ?? []).filter(t => t.status === 'Active').map((trader) => (
                        <SelectItem key={trader.id} value={trader.id}>
                          {trader.name} - {trader.firmName || 'Individual'}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              {selectedTrader && (
                <>
                  <div className="space-y-2">
                    <Label>Premises</Label>
                    <Input value={selectedTrader.premises} readOnly className="bg-muted" />
                  </div>
                  <div className="space-y-2">
                    <Label>Yard</Label>
                    <Input value={selectedTrader.yardName} readOnly className="bg-muted" />
                  </div>
                  <div className="space-y-2">
                    <Label>GST No</Label>
                    <Input value={selectedTrader.gst || 'N/A'} readOnly className="bg-muted" />
                  </div>
                </>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Invoice Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="invoiceDate">Invoice Date</Label>
                <Input
                  id="invoiceDate"
                  type="date"
                  value={invoiceDate}
                  onChange={(e) => setInvoiceDate(e.target.value)}
                  data-testid="input-invoice-date"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="billingMonth">Billing Month</Label>
                <Input
                  id="billingMonth"
                  type="month"
                  value={billingMonth}
                  onChange={(e) => setBillingMonth(e.target.value)}
                  data-testid="input-billing-month"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Amount Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="baseRent">Base Rent (₹)</Label>
                <Input
                  id="baseRent"
                  type="number"
                  value={baseRent || ''}
                  onChange={(e) => setBaseRent(parseInt(e.target.value, 10) || 0)}
                  data-testid="input-base-rent"
                />
              </div>
              <div className="space-y-2">
                <Label>CGST @ 9% (₹)</Label>
                <Input value={cgst} readOnly className="bg-muted" />
              </div>
              <div className="space-y-2">
                <Label>SGST @ 9% (₹)</Label>
                <Input value={sgst} readOnly className="bg-muted" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="interest">Interest if any (₹)</Label>
                <Input
                  id="interest"
                  type="number"
                  value={interest || ''}
                  onChange={(e) => setInterest(parseInt(e.target.value, 10) || 0)}
                  data-testid="input-interest"
                />
              </div>
              <div className="space-y-2 sm:col-span-2 lg:col-span-1">
                <Label>Total Amount (₹)</Label>
                <Input value={total} readOnly className="bg-primary/10 font-bold text-lg" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Additional Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any additional notes..."
                data-testid="input-notes"
              />
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="tds"
                checked={tdsApplicable}
                onCheckedChange={(checked) => setTdsApplicable(checked as boolean)}
                data-testid="checkbox-tds"
              />
              <Label htmlFor="tds" className="cursor-pointer">TDS Applicable</Label>
            </div>
            {tdsApplicable && (
              <div className="space-y-2 max-w-xs">
                <Label htmlFor="tdsAmount">TDS Amount (₹)</Label>
                <Input
                  id="tdsAmount"
                  type="number"
                  value={tdsAmount || ''}
                  onChange={(e) => setTdsAmount(parseInt(e.target.value, 10) || 0)}
                  data-testid="input-tds-amount"
                />
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-col sm:flex-row gap-3 justify-end">
          <Button variant="outline" onClick={() => setLocation('/rent')} data-testid="button-cancel">
            <X className="h-4 w-4 mr-2" />
            Cancel
          </Button>
          <Button 
            variant="secondary" 
            onClick={() => handleSubmit(true)} 
            disabled={createMutation.isPending}
            data-testid="button-save-draft"
          >
            <Save className="h-4 w-4 mr-2" />
            Save as Draft
          </Button>
          <Button 
            onClick={() => handleSubmit(false)} 
            disabled={createMutation.isPending}
            data-testid="button-generate"
          >
            <Check className="h-4 w-4 mr-2" />
            Generate Invoice
          </Button>
        </div>
      </div>
    </AppShell>
  );
}
