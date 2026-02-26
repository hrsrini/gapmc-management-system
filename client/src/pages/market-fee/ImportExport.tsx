import { useState, useMemo } from 'react';
import { useLocation } from 'wouter';
import { useQuery, useMutation } from '@tanstack/react-query';
import { AppShell } from '@/components/layout/AppShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { ArrowLeftRight, Save, Printer, X, AlertCircle } from 'lucide-react';
import { LOCATIONS, COMMODITIES, VEHICLE_TYPES, UNITS } from '@/data/yards';
import { format } from 'date-fns';
import { apiRequest, queryClient } from '@/lib/queryClient';
import type { Trader } from '@shared/schema';

export default function ImportExport() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [entryType, setEntryType] = useState<'Import' | 'Export'>('Import');
  const [selectedTraderId, setSelectedTraderId] = useState<string>('');
  const [commodity, setCommodity] = useState<string>('');
  const [quantity, setQuantity] = useState<number>(0);
  const [unit, setUnit] = useState<string>('Kg');
  const [ratePerUnit, setRatePerUnit] = useState<number>(0);
  const [vehicleType, setVehicleType] = useState<string>('');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [locationId, setLocationId] = useState<string>('');
  const [entryDateTime, setEntryDateTime] = useState(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
  const [paymentMode, setPaymentMode] = useState<string>('Cash');

  const { data: traders, isLoading, isError } = useQuery<Trader[]>({
    queryKey: ['/api/traders'],
  });

  const selectedTrader = useMemo(() => {
    return (traders ?? []).find(t => t.id === selectedTraderId);
  }, [traders, selectedTraderId]);

  const selectedCommodity = useMemo(() => {
    return COMMODITIES.find(c => c.name === commodity);
  }, [commodity]);

  const commodityType = useMemo(() => {
    return selectedCommodity?.type || 'Horticultural';
  }, [selectedCommodity]);

  const selectedLocationData = useMemo(() => {
    return LOCATIONS.find(l => l.id.toString() === locationId);
  }, [locationId]);

  const totalValue = useMemo(() => quantity * ratePerUnit, [quantity, ratePerUnit]);
  const marketFee = useMemo(() => Math.round(totalValue * 0.025), [totalValue]);

  const receiptNo = useMemo(() => {
    return `MF-${format(new Date(), 'yyyy')}-${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`;
  }, []);

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest('POST', '/api/marketfees', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/marketfees'] });
      queryClient.invalidateQueries({ queryKey: ['/api/stats'] });
    },
    onError: () => {
      toast({ title: 'Error', description: 'Failed to create entry', variant: 'destructive' });
    },
  });

  const handleSubmit = (printReceipt: boolean) => {
    if (!selectedTraderId || !commodity || !quantity || !locationId) {
      toast({
        title: 'Validation Error',
        description: 'Please fill in all required fields',
        variant: 'destructive',
      });
      return;
    }

    createMutation.mutate({
      receiptNo,
      entryType,
      traderId: selectedTraderId,
      traderName: selectedTrader?.name || '',
      licenseNo: `LIC-${selectedTrader?.yardName?.split(' ')[0]?.toUpperCase() || 'YARD'}-${selectedTraderId.slice(-3)}`,
      address: selectedTrader ? `${selectedTrader.premises}, ${selectedTrader.yardName}` : '',
      gstPan: selectedTrader?.gst || selectedTrader?.pan || '',
      commodity,
      commodityType: commodityType as 'Horticultural' | 'Non-Horticultural',
      quantity,
      unit,
      ratePerUnit,
      totalValue,
      marketFee,
      vehicleType: vehicleType || 'Truck',
      vehicleNumber: vehicleNumber || 'N/A',
      locationId: parseInt(locationId),
      locationName: selectedLocationData?.name || '',
      entryDate: format(new Date(entryDateTime), 'yyyy-MM-dd'),
      paymentMode,
    }, {
      onSuccess: () => {
        toast({
          title: printReceipt ? 'Receipt Generated' : 'Entry Saved',
          description: printReceipt ? `Receipt ${receiptNo} generated` : 'Market fee entry saved successfully',
        });
        
        if (printReceipt) {
          setLocation('/market-fee');
        } else {
          setSelectedTraderId('');
          setCommodity('');
          setQuantity(0);
          setRatePerUnit(0);
          setVehicleNumber('');
        }
      },
    });
  };

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: 'Market Fee', href: '/market-fee' }, { label: 'Import/Export Entry' }]}>
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
    <AppShell breadcrumbs={[{ label: 'Market Fee', href: '/market-fee' }, { label: 'Import/Export Entry' }]}>
      <div className="space-y-6 max-w-4xl">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ArrowLeftRight className="h-6 w-6 text-primary" />
            Import/Export Entry
          </h1>
          <p className="text-muted-foreground">Record market fee for goods entering or leaving</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Entry Type</CardTitle>
          </CardHeader>
          <CardContent>
            <RadioGroup value={entryType} onValueChange={(v) => setEntryType(v as 'Import' | 'Export')} className="flex gap-6">
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="Import" id="import" data-testid="radio-import" />
                <Label htmlFor="import" className="font-normal cursor-pointer">Import (Goods Coming In)</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="Export" id="export" data-testid="radio-export" />
                <Label htmlFor="export" className="font-normal cursor-pointer">Export (Goods Going Out)</Label>
              </div>
            </RadioGroup>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Trader Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Trader/Firm Name *</Label>
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
                          {trader.name} - {trader.firmName || trader.premises}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              {selectedTrader && (
                <>
                  <div className="space-y-2">
                    <Label>License Number</Label>
                    <Input value={`LIC-${selectedTrader.yardName.split(' ')[0].toUpperCase()}-${selectedTrader.id.slice(-3)}`} readOnly className="bg-muted" />
                  </div>
                  <div className="space-y-2">
                    <Label>Address</Label>
                    <Input value={`${selectedTrader.premises}, ${selectedTrader.yardName}`} readOnly className="bg-muted" />
                  </div>
                  <div className="space-y-2">
                    <Label>GST/PAN</Label>
                    <Input value={selectedTrader.gst || selectedTrader.pan} readOnly className="bg-muted" />
                  </div>
                </>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Commodity Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-2">
                <Label>Commodity *</Label>
                <Select value={commodity} onValueChange={setCommodity}>
                  <SelectTrigger data-testid="select-commodity">
                    <SelectValue placeholder="Select commodity" />
                  </SelectTrigger>
                  <SelectContent>
                    {COMMODITIES.map((c) => (
                      <SelectItem key={c.name} value={c.name}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Type</Label>
                <Input value={selectedCommodity?.type || 'N/A'} readOnly className="bg-muted" />
              </div>
              <div className="space-y-2">
                <Label>Quantity *</Label>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    value={quantity || ''}
                    onChange={(e) => setQuantity(parseInt(e.target.value, 10) || 0)}
                    placeholder="0"
                    data-testid="input-quantity"
                  />
                  <Select value={unit} onValueChange={setUnit}>
                    <SelectTrigger className="w-32" data-testid="select-unit">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {UNITS.map((u) => (
                        <SelectItem key={u} value={u}>{u}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Rate per Unit (₹)</Label>
                <Input
                  type="number"
                  value={ratePerUnit || ''}
                  onChange={(e) => setRatePerUnit(parseInt(e.target.value, 10) || 0)}
                  placeholder="0"
                  data-testid="input-rate"
                />
              </div>
              <div className="space-y-2">
                <Label>Total Value (₹)</Label>
                <Input value={totalValue.toLocaleString()} readOnly className="bg-muted" />
              </div>
              <div className="space-y-2">
                <Label>Market Fee (₹) @ 2.5%</Label>
                <Input value={marketFee.toLocaleString()} readOnly className="bg-primary/10 font-bold" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Vehicle & Location</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Vehicle Type</Label>
                <Select value={vehicleType} onValueChange={setVehicleType}>
                  <SelectTrigger data-testid="select-vehicle-type">
                    <SelectValue placeholder="Select vehicle type" />
                  </SelectTrigger>
                  <SelectContent>
                    {VEHICLE_TYPES.map((v) => (
                      <SelectItem key={v} value={v}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Vehicle Number</Label>
                <Input
                  value={vehicleNumber}
                  onChange={(e) => setVehicleNumber(e.target.value.toUpperCase())}
                  placeholder="GA-01-A-1234"
                  data-testid="input-vehicle-number"
                />
              </div>
              <div className="space-y-2">
                <Label>Entry Location *</Label>
                <Select value={locationId} onValueChange={setLocationId}>
                  <SelectTrigger data-testid="select-location">
                    <SelectValue placeholder="Select location" />
                  </SelectTrigger>
                  <SelectContent>
                    {LOCATIONS.map((loc) => (
                      <SelectItem key={loc.id} value={loc.id.toString()}>
                        {loc.name} ({loc.type})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Entry Date & Time</Label>
                <Input
                  type="datetime-local"
                  value={entryDateTime}
                  onChange={(e) => setEntryDateTime(e.target.value)}
                  data-testid="input-datetime"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Receipt</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
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
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Receipt Number</Label>
                <Input value={receiptNo} readOnly className="bg-muted font-mono" />
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-col sm:flex-row gap-3 justify-end">
          <Button variant="outline" onClick={() => setLocation('/market-fee')} data-testid="button-cancel">
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
            Save & New Entry
          </Button>
          <Button 
            onClick={() => handleSubmit(true)} 
            disabled={createMutation.isPending}
            data-testid="button-save-print"
          >
            <Printer className="h-4 w-4 mr-2" />
            Save & Print Receipt
          </Button>
        </div>
      </div>
    </AppShell>
  );
}
