import { useState, useMemo } from 'react';
import { useLocation } from 'wouter';
import { useQuery, useMutation } from '@tanstack/react-query';
import { AppShell } from '@/components/layout/AppShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { PlusCircle, Save, Printer, X, AlertCircle } from 'lucide-react';
import { RECEIPT_HEADS } from '@/data/yards';
import { format } from 'date-fns';
import { apiRequest, queryClient } from '@/lib/queryClient';
import type { Trader } from '@shared/schema';

type ReceiptType = 'Rent' | 'Market Fee' | 'License Fee' | 'Other';

export default function ReceiptForm() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [receiptType, setReceiptType] = useState<ReceiptType>('Rent');
  const [selectedTraderId, setSelectedTraderId] = useState<string>('');
  const [receiptDate, setReceiptDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [paymentMode, setPaymentMode] = useState<string>('Cash');
  const [chequeNo, setChequeNo] = useState('');
  const [chequeBank, setChequeBank] = useState('');
  const [chequeDate, setChequeDate] = useState('');
  const [transactionRef, setTransactionRef] = useState('');
  const [narration, setNarration] = useState('');
  const [otherHead, setOtherHead] = useState<string>('');
  
  const [rentAmount, setRentAmount] = useState<number>(0);
  const [cgst, setCgst] = useState<number>(0);
  const [sgst, setSgst] = useState<number>(0);
  const [interestRent, setInterestRent] = useState<number>(0);
  const [securityDeposit, setSecurityDeposit] = useState<number>(0);
  const [tdsRent, setTdsRent] = useState<number>(0);
  
  const [marketFeeAmount, setMarketFeeAmount] = useState<number>(0);
  const [interestMarketFee, setInterestMarketFee] = useState<number>(0);
  const [otherMarketFee, setOtherMarketFee] = useState<number>(0);
  
  const [licenseFee, setLicenseFee] = useState<number>(0);
  const [renewalFee, setRenewalFee] = useState<number>(0);
  const [godownRegFee, setGodownRegFee] = useState<number>(0);
  const [licenseSecurityDeposit, setLicenseSecurityDeposit] = useState<number>(0);
  const [upgradationFee, setUpgradationFee] = useState<number>(0);
  const [stationeryFee, setStationeryFee] = useState<number>(0);
  
  const [otherAmount, setOtherAmount] = useState<number>(0);
  const [otherRemarks, setOtherRemarks] = useState('');

  const { data: traders, isLoading, isError } = useQuery<Trader[]>({
    queryKey: ['/api/traders'],
  });

  const selectedTrader = useMemo(() => {
    return (traders ?? []).find(t => t.id === selectedTraderId);
  }, [traders, selectedTraderId]);

  const total = useMemo(() => {
    switch (receiptType) {
      case 'Rent':
        return rentAmount + cgst + sgst + interestRent + securityDeposit - tdsRent;
      case 'Market Fee':
        return marketFeeAmount + interestMarketFee + otherMarketFee;
      case 'License Fee':
        return licenseFee + renewalFee + godownRegFee + licenseSecurityDeposit + upgradationFee + stationeryFee;
      case 'Other':
        return otherAmount;
      default:
        return 0;
    }
  }, [receiptType, rentAmount, cgst, sgst, interestRent, securityDeposit, tdsRent, 
      marketFeeAmount, interestMarketFee, otherMarketFee,
      licenseFee, renewalFee, godownRegFee, licenseSecurityDeposit, upgradationFee, stationeryFee,
      otherAmount]);

  const getHeadForType = () => {
    switch (receiptType) {
      case 'Rent': return 'Rent Payment';
      case 'Market Fee': return 'Market Fee Payment';
      case 'License Fee': return 'License Fee Payment';
      case 'Other': return otherHead || 'Other Payment';
      default: return 'Payment';
    }
  };

  const getAmount = () => {
    switch (receiptType) {
      case 'Rent': return rentAmount;
      case 'Market Fee': return marketFeeAmount;
      case 'License Fee': return licenseFee;
      case 'Other': return otherAmount;
      default: return 0;
    }
  };

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest('POST', '/api/receipts', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/receipts'] });
      queryClient.invalidateQueries({ queryKey: ['/api/stats'] });
    },
    onError: (error) => {
      toast({ 
        title: 'Error', 
        description: 'Failed to create receipt. Please check all fields.',
        variant: 'destructive' 
      });
      console.error('Receipt creation error:', error);
    },
  });

  const handleSubmit = (printReceipt: boolean) => {
    if (!selectedTraderId || !selectedTrader) {
      toast({
        title: 'Validation Error',
        description: 'Please select a trader',
        variant: 'destructive',
      });
      return;
    }

    const receiptNo = `REC-${format(new Date(), 'yyyy')}-${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`;
    
    createMutation.mutate({
      receiptNo,
      receiptDate,
      type: receiptType,
      traderId: selectedTraderId,
      traderName: selectedTrader.name,
      head: getHeadForType(),
      amount: getAmount(),
      cgst: receiptType === 'Rent' ? cgst : undefined,
      sgst: receiptType === 'Rent' ? sgst : undefined,
      interest: receiptType === 'Rent' ? interestRent : (receiptType === 'Market Fee' ? interestMarketFee : undefined),
      securityDeposit: receiptType === 'Rent' ? securityDeposit : (receiptType === 'License Fee' ? licenseSecurityDeposit : undefined),
      tdsAmount: receiptType === 'Rent' ? tdsRent : undefined,
      total,
      paymentMode: paymentMode as 'Cash' | 'Cheque' | 'Online' | 'Adjustment',
      chequeNo: paymentMode === 'Cheque' ? chequeNo : undefined,
      chequeBank: paymentMode === 'Cheque' ? chequeBank : undefined,
      chequeDate: paymentMode === 'Cheque' ? chequeDate : undefined,
      transactionRef: paymentMode === 'Online' ? transactionRef : undefined,
      narration: narration || undefined,
      yardId: selectedTrader.yardId,
      yardName: selectedTrader.yardName,
      issuedBy: 'Super Admin',
      status: 'Active',
    }, {
      onSuccess: () => {
        toast({
          title: printReceipt ? 'Receipt Generated' : 'Receipt Saved',
          description: printReceipt ? `Receipt ${receiptNo} generated and ready for print` : 'Receipt saved successfully',
        });

        if (printReceipt) {
          setLocation('/receipts');
        } else {
          setSelectedTraderId('');
          setRentAmount(0);
          setCgst(0);
          setSgst(0);
          setInterestRent(0);
          setSecurityDeposit(0);
          setTdsRent(0);
          setMarketFeeAmount(0);
          setInterestMarketFee(0);
          setOtherMarketFee(0);
          setLicenseFee(0);
          setRenewalFee(0);
          setGodownRegFee(0);
          setLicenseSecurityDeposit(0);
          setUpgradationFee(0);
          setStationeryFee(0);
          setOtherAmount(0);
          setNarration('');
        }
      },
    });
  };

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: 'Receipts', href: '/receipts' }, { label: 'Create Receipt' }]}>
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
    <AppShell breadcrumbs={[{ label: 'Receipts', href: '/receipts' }, { label: 'Create Receipt' }]}>
      <div className="space-y-6 max-w-4xl">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <PlusCircle className="h-6 w-6 text-primary" />
            Create Receipt
          </h1>
          <p className="text-muted-foreground">Issue a new receipt</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Receipt Type</CardTitle>
          </CardHeader>
          <CardContent>
            <RadioGroup value={receiptType} onValueChange={(v) => setReceiptType(v as ReceiptType)} className="flex flex-wrap gap-4">
              {(['Rent', 'Market Fee', 'License Fee', 'Other'] as const).map((type) => (
                <div key={type} className="flex items-center space-x-2">
                  <RadioGroupItem value={type} id={type} data-testid={`radio-${type.toLowerCase().replace(' ', '-')}`} />
                  <Label htmlFor={type} className="font-normal cursor-pointer">{type} Receipt</Label>
                </div>
              ))}
            </RadioGroup>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Trader Selection</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Select Trader *</Label>
                {isLoading ? (
                  <Skeleton className="h-10 w-full" />
                ) : (
                  <Select value={selectedTraderId} onValueChange={setSelectedTraderId}>
                    <SelectTrigger data-testid="select-trader">
                      <SelectValue placeholder="Choose a trader" />
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
              {selectedTrader && (
                <div className="space-y-2">
                  <Label>Premises</Label>
                  <Input value={`${selectedTrader.premises}, ${selectedTrader.yardName}`} readOnly className="bg-muted" />
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {receiptType === 'Rent' && (
          <Card>
            <CardHeader>
              <CardTitle>Rent Receipt Details</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div className="space-y-2">
                  <Label>Rent Amount (₹)</Label>
                  <Input type="number" value={rentAmount || ''} onChange={(e) => setRentAmount(parseInt(e.target.value, 10) || 0)} data-testid="input-rent" />
                </div>
                <div className="space-y-2">
                  <Label>CGST (₹)</Label>
                  <Input type="number" value={cgst || ''} onChange={(e) => setCgst(parseInt(e.target.value, 10) || 0)} data-testid="input-cgst" />
                </div>
                <div className="space-y-2">
                  <Label>SGST (₹)</Label>
                  <Input type="number" value={sgst || ''} onChange={(e) => setSgst(parseInt(e.target.value, 10) || 0)} data-testid="input-sgst" />
                </div>
                <div className="space-y-2">
                  <Label>Interest on Rent (₹)</Label>
                  <Input type="number" value={interestRent || ''} onChange={(e) => setInterestRent(parseInt(e.target.value, 10) || 0)} data-testid="input-interest" />
                </div>
                <div className="space-y-2">
                  <Label>Security Deposit (₹)</Label>
                  <Input type="number" value={securityDeposit || ''} onChange={(e) => setSecurityDeposit(parseInt(e.target.value, 10) || 0)} data-testid="input-security" />
                </div>
                <div className="space-y-2">
                  <Label>TDS on Rent (₹)</Label>
                  <Input type="number" value={tdsRent || ''} onChange={(e) => setTdsRent(parseInt(e.target.value, 10) || 0)} data-testid="input-tds" />
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {receiptType === 'Market Fee' && (
          <Card>
            <CardHeader>
              <CardTitle>Market Fee Receipt Details</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label>Market Fee Amount (₹)</Label>
                  <Input type="number" value={marketFeeAmount || ''} onChange={(e) => setMarketFeeAmount(parseInt(e.target.value, 10) || 0)} data-testid="input-market-fee" />
                </div>
                <div className="space-y-2">
                  <Label>Interest on Market Fee (₹)</Label>
                  <Input type="number" value={interestMarketFee || ''} onChange={(e) => setInterestMarketFee(parseInt(e.target.value, 10) || 0)} data-testid="input-interest-mf" />
                </div>
                <div className="space-y-2">
                  <Label>Other (₹)</Label>
                  <Input type="number" value={otherMarketFee || ''} onChange={(e) => setOtherMarketFee(parseInt(e.target.value, 10) || 0)} data-testid="input-other-mf" />
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {receiptType === 'License Fee' && (
          <Card>
            <CardHeader>
              <CardTitle>License Fee Receipt Details</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div className="space-y-2">
                  <Label>License Fee (₹)</Label>
                  <Input type="number" value={licenseFee || ''} onChange={(e) => setLicenseFee(parseInt(e.target.value, 10) || 0)} data-testid="input-license-fee" />
                </div>
                <div className="space-y-2">
                  <Label>License Renewal Fee (₹)</Label>
                  <Input type="number" value={renewalFee || ''} onChange={(e) => setRenewalFee(parseInt(e.target.value, 10) || 0)} data-testid="input-renewal" />
                </div>
                <div className="space-y-2">
                  <Label>Godown Registration Fee (₹)</Label>
                  <Input type="number" value={godownRegFee || ''} onChange={(e) => setGodownRegFee(parseInt(e.target.value, 10) || 0)} data-testid="input-godown" />
                </div>
                <div className="space-y-2">
                  <Label>Security Deposit for License (₹)</Label>
                  <Input type="number" value={licenseSecurityDeposit || ''} onChange={(e) => setLicenseSecurityDeposit(parseInt(e.target.value, 10) || 0)} data-testid="input-license-security" />
                </div>
                <div className="space-y-2">
                  <Label>License Upgradation Fee (₹)</Label>
                  <Input type="number" value={upgradationFee || ''} onChange={(e) => setUpgradationFee(parseInt(e.target.value, 10) || 0)} data-testid="input-upgradation" />
                </div>
                <div className="space-y-2">
                  <Label>Stationery Supply Fee (₹)</Label>
                  <Input type="number" value={stationeryFee || ''} onChange={(e) => setStationeryFee(parseInt(e.target.value, 10) || 0)} data-testid="input-stationery" />
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {receiptType === 'Other' && (
          <Card>
            <CardHeader>
              <CardTitle>Other Receipt Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Head</Label>
                  <Select value={otherHead} onValueChange={setOtherHead}>
                    <SelectTrigger data-testid="select-other-head">
                      <SelectValue placeholder="Select head" />
                    </SelectTrigger>
                    <SelectContent>
                      {RECEIPT_HEADS.other.map((head) => (
                        <SelectItem key={head} value={head}>{head}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Amount (₹)</Label>
                  <Input type="number" value={otherAmount || ''} onChange={(e) => setOtherAmount(parseInt(e.target.value, 10) || 0)} data-testid="input-other-amount" />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Remarks</Label>
                <Textarea value={otherRemarks} onChange={(e) => setOtherRemarks(e.target.value)} placeholder="Enter remarks" data-testid="input-remarks" />
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Total: ₹{total.toLocaleString()}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Receipt Date</Label>
                <Input type="date" value={receiptDate} onChange={(e) => setReceiptDate(e.target.value)} data-testid="input-date" />
              </div>
              <div className="space-y-2">
                <Label>Mode of Payment</Label>
                <Select value={paymentMode} onValueChange={setPaymentMode}>
                  <SelectTrigger data-testid="select-payment-mode">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Cash">Cash</SelectItem>
                    <SelectItem value="Cheque">Cheque</SelectItem>
                    <SelectItem value="Online">Online</SelectItem>
                    <SelectItem value="Adjustment">Adjustment</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {paymentMode === 'Cheque' && (
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label>Cheque No</Label>
                  <Input value={chequeNo} onChange={(e) => setChequeNo(e.target.value)} data-testid="input-cheque-no" />
                </div>
                <div className="space-y-2">
                  <Label>Bank Name</Label>
                  <Input value={chequeBank} onChange={(e) => setChequeBank(e.target.value)} data-testid="input-cheque-bank" />
                </div>
                <div className="space-y-2">
                  <Label>Cheque Date</Label>
                  <Input type="date" value={chequeDate} onChange={(e) => setChequeDate(e.target.value)} data-testid="input-cheque-date" />
                </div>
              </div>
            )}

            {paymentMode === 'Online' && (
              <div className="space-y-2 max-w-md">
                <Label>Transaction Reference</Label>
                <Input value={transactionRef} onChange={(e) => setTransactionRef(e.target.value)} placeholder="UTR/Reference Number" data-testid="input-transaction-ref" />
              </div>
            )}

            <div className="space-y-2">
              <Label>Narration/Notes</Label>
              <Textarea value={narration} onChange={(e) => setNarration(e.target.value)} placeholder="Any additional notes..." data-testid="input-narration" />
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-col sm:flex-row gap-3 justify-end">
          <Button variant="outline" onClick={() => setLocation('/receipts')} data-testid="button-cancel">
            <X className="h-4 w-4 mr-2" />
            Cancel
          </Button>
          <Button 
            variant="secondary" 
            onClick={() => handleSubmit(false)} 
            disabled={createMutation.isPending}
            data-testid="button-save-new"
          >
            <Save className="h-4 w-4 mr-2" />
            Save & New
          </Button>
          <Button 
            onClick={() => handleSubmit(true)} 
            disabled={createMutation.isPending}
            data-testid="button-save-print"
          >
            <Printer className="h-4 w-4 mr-2" />
            Save & Print
          </Button>
        </div>
      </div>
    </AppShell>
  );
}
