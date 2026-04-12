import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { useMutation } from '@tanstack/react-query';
import { AppShell } from '@/components/layout/AppShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { UserPlus, Save, X, Check } from 'lucide-react';
import { COMMODITIES } from '@/data/yards';
import { apiYardToLegacyYardId, legacyYardIdToApiYardId } from '@/lib/legacyYardMatch';
import { useScopedActiveYards } from '@/hooks/useScopedActiveYards';
import { isValidEmailFormat, isStrictAadhaar12Digits, parseIndianMobile10Digits } from '@shared/india-validation';
import { Badge } from '@/components/ui/badge';
import { apiRequest, queryClient } from '@/lib/queryClient';
import type { Trader } from '@shared/schema';

interface TraderFormProps {
  traderId?: string;
  initialData?: Trader | null;
}

export default function TraderForm({ traderId, initialData }: TraderFormProps = {}) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const isEdit = !!traderId && !!initialData;

  const [applicantType, setApplicantType] = useState<string>(initialData?.type ?? 'Individual');
  const [name, setName] = useState(initialData?.name ?? '');
  const [proprietorName, setProprietorName] = useState('');
  const [firmName, setFirmName] = useState(initialData?.firmName ?? '');
  const [residentialAddress, setResidentialAddress] = useState(initialData?.residentialAddress ?? '');
  const [businessAddress, setBusinessAddress] = useState(initialData?.businessAddress ?? '');
  const [mobile, setMobile] = useState(initialData?.mobile ?? '');
  const [phone, setPhone] = useState(initialData?.phone ?? '');
  const [email, setEmail] = useState(initialData?.email ?? '');
  const [aadhaar, setAadhaar] = useState(initialData?.aadhaar ?? '');
  const [pan, setPan] = useState(initialData?.pan ?? '');
  const [gst, setGst] = useState(initialData?.gst ?? '');
  const [epic, setEpic] = useState(initialData?.epicVoterId ?? '');
  const [bankName, setBankName] = useState(initialData?.bankName ?? '');
  const [accountNumber, setAccountNumber] = useState(initialData?.accountNumber ?? '');
  const [ifsc, setIfsc] = useState(initialData?.ifscCode ?? '');
  const [branchName, setBranchName] = useState(initialData?.branchName ?? '');
  const [yardId, setYardId] = useState<string>('');
  const [premises, setPremises] = useState(initialData?.premises ?? '');
  const [premisesType, setPremisesType] = useState<string>(initialData?.premisesType ?? 'Stall');
  const [registrationType, setRegistrationType] = useState<string>(initialData?.registrationType ?? 'Temporary');
  const [selectedCommodities, setSelectedCommodities] = useState<string[]>(initialData?.commodities ?? []);

  const { data: yards = [], isLoading: yardsLoading } = useScopedActiveYards();

  const yardOptions = useMemo(
    () => yards.filter((y) => String(y.type ?? '').toLowerCase() === 'yard'),
    [yards],
  );

  useEffect(() => {
    if (!isEdit || initialData?.yardId == null || yardOptions.length === 0) return;
    const apiId = legacyYardIdToApiYardId(initialData.yardId, yardOptions);
    setYardId(apiId ?? '');
  }, [isEdit, initialData?.yardId, yardOptions]);

  const selectedYard = yardOptions.find((y) => y.id === yardId);

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest('POST', '/api/traders', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/traders'] });
      queryClient.invalidateQueries({ queryKey: ['/api/stats'] });
    },
    onError: (error) => {
      toast({ 
        title: 'Error', 
        description: 'Failed to save trader. Please check all required fields.',
        variant: 'destructive' 
      });
      console.error('Trader creation error:', error);
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: any) => apiRequest('PUT', `/api/traders/${traderId}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/traders'] });
      queryClient.invalidateQueries({ queryKey: ['/api/traders', traderId] });
      queryClient.invalidateQueries({ queryKey: ['/api/stats'] });
    },
    onError: (error) => {
      toast({ 
        title: 'Error', 
        description: 'Failed to update trader. Please check all required fields.',
        variant: 'destructive' 
      });
      console.error('Trader update error:', error);
    },
  });

  const toggleCommodity = (commodity: string) => {
    setSelectedCommodities(prev => 
      prev.includes(commodity) 
        ? prev.filter(c => c !== commodity)
        : [...prev, commodity]
    );
  };

  const handleSubmit = (isDraft: boolean) => {
    if (!name || !mobile || !email || !aadhaar || !pan || !yardId) {
      toast({
        title: 'Validation Error',
        description: 'Please fill in all required fields',
        variant: 'destructive',
      });
      return;
    }
    if (!isValidEmailFormat(email)) {
      toast({ title: 'Validation Error', description: 'Please enter a valid email address.', variant: 'destructive' });
      return;
    }
    const mobileDigits = parseIndianMobile10Digits(mobile);
    if (!mobileDigits) {
      toast({ title: 'Validation Error', description: 'Mobile must be a valid 10-digit Indian number.', variant: 'destructive' });
      return;
    }
    if (!isStrictAadhaar12Digits(aadhaar)) {
      toast({ title: 'Validation Error', description: 'Please enter a valid Aadhaar number (12 digits, no spaces).', variant: 'destructive' });
      return;
    }

    const apiYard = yardOptions.find((y) => y.id === yardId);
    const legacyYardId = apiYard ? apiYardToLegacyYardId(apiYard) : null;
    if (legacyYardId == null) {
      toast({
        title: 'Validation Error',
        description: 'Select a yard from your assigned list (yard code must match the legacy register).',
        variant: 'destructive',
      });
      return;
    }

    const payload = {
      name,
      firmName: firmName || undefined,
      type: applicantType as 'Individual' | 'Firm' | 'Pvt Ltd' | 'Public Ltd',
      mobile: mobileDigits,
      phone: phone || undefined,
      email: email.trim().toLowerCase(),
      residentialAddress: residentialAddress || undefined,
      businessAddress: businessAddress || undefined,
      aadhaar: aadhaar.trim(),
      pan,
      gst: gst || undefined,
      epicVoterId: epic || undefined,
      bankName: bankName || undefined,
      accountNumber: accountNumber || undefined,
      ifscCode: ifsc || undefined,
      branchName: branchName || undefined,
      yardId: legacyYardId,
      yardName: apiYard?.name || '',
      premises: premises || 'Stall 1',
      premisesType: premisesType as 'Stall' | 'Godown' | 'Shop',
      registrationType: registrationType as 'Temporary' | 'Permanent',
      commodities: selectedCommodities.length > 0 ? selectedCommodities : ['General'],
      status: isDraft ? 'Pending' : 'Active',
      rentAmount: initialData?.rentAmount ?? 5000,
      securityDeposit: initialData?.securityDeposit ?? 10000,
    };

    if (isEdit && traderId) {
      updateMutation.mutate(payload, {
        onSuccess: () => {
          toast({
            title: isDraft ? 'Draft Saved' : 'Trader Updated',
            description: isDraft ? 'Trader draft updated' : 'Trader updated successfully',
          });
          setLocation('/traders');
        },
      });
    } else {
      const assetId = `TRD-${apiYard?.code || 'YARD'}-${Date.now().toString().slice(-6)}`;
      createMutation.mutate({ ...payload, assetId }, {
        onSuccess: () => {
          toast({
            title: isDraft ? 'Draft Saved' : 'Registration Submitted',
            description: isDraft ? 'Trader saved as draft' : 'Trader registration submitted successfully',
          });
          setLocation('/traders');
        },
      });
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <AppShell breadcrumbs={[{ label: 'Traders', href: '/traders' }, { label: isEdit ? 'Edit Trader' : 'Register New' }]}>
      <div className="space-y-6 max-w-4xl">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <UserPlus className="h-6 w-6 text-primary" />
            {isEdit ? 'Edit Trader' : 'Register New Trader'}
          </h1>
          <p className="text-muted-foreground">{isEdit ? 'Update trader details' : 'Add a new trader to the system'}</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Basic Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Applicant Type *</Label>
              <RadioGroup value={applicantType} onValueChange={setApplicantType} className="flex flex-wrap gap-4">
                {['Individual', 'Firm', 'Pvt Ltd', 'Public Ltd'].map((type) => (
                  <div key={type} className="flex items-center space-x-2">
                    <RadioGroupItem value={type} id={type} data-testid={`radio-${type.toLowerCase().replace(' ', '-')}`} />
                    <Label htmlFor={type} className="font-normal cursor-pointer">{type}</Label>
                  </div>
                ))}
              </RadioGroup>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="name">Full Name of Applicant *</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Enter full name"
                  data-testid="input-name"
                />
              </div>
              {applicantType !== 'Individual' && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="proprietor">Name of Proprietor/Partner</Label>
                    <Input
                      id="proprietor"
                      value={proprietorName}
                      onChange={(e) => setProprietorName(e.target.value)}
                      placeholder="Enter proprietor/partner name"
                      data-testid="input-proprietor"
                    />
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="firmName">Firm/Company Name</Label>
                    <Input
                      id="firmName"
                      value={firmName}
                      onChange={(e) => setFirmName(e.target.value)}
                      placeholder="Enter firm/company name"
                      data-testid="input-firm-name"
                    />
                  </div>
                </>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Contact Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="residentialAddress">Residential Address</Label>
              <Textarea
                id="residentialAddress"
                value={residentialAddress}
                onChange={(e) => setResidentialAddress(e.target.value)}
                placeholder="Enter residential address"
                data-testid="input-residential-address"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="businessAddress">Office/Business Address</Label>
              <Textarea
                id="businessAddress"
                value={businessAddress}
                onChange={(e) => setBusinessAddress(e.target.value)}
                placeholder="Enter business address"
                data-testid="input-business-address"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="mobile">Mobile Number *</Label>
                <Input
                  id="mobile"
                  value={mobile}
                  onChange={(e) => setMobile(e.target.value.replace(/\D/g, "").slice(0, 10))}
                  placeholder="10-digit mobile"
                  inputMode="numeric"
                  data-testid="input-mobile"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Phone Number</Label>
                <Input
                  id="phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="Landline"
                  data-testid="input-phone"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email ID *</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="email@example.com"
                  data-testid="input-email"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Identity & Tax</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="aadhaar">Aadhaar Card Number *</Label>
                <Input
                  id="aadhaar"
                  value={aadhaar}
                  onChange={(e) => setAadhaar(e.target.value.replace(/\D/g, "").slice(0, 12))}
                  placeholder="12 digits, no spaces"
                  inputMode="numeric"
                  data-testid="input-aadhaar"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pan">PAN Card Number *</Label>
                <Input
                  id="pan"
                  value={pan}
                  onChange={(e) => setPan(e.target.value.toUpperCase())}
                  placeholder="ABCDE1234F"
                  data-testid="input-pan"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="gst">GST Registration Number</Label>
                <Input
                  id="gst"
                  value={gst}
                  onChange={(e) => setGst(e.target.value.toUpperCase())}
                  placeholder="22AAAAA0000A1Z5"
                  data-testid="input-gst"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="epic">EPIC/Voter ID</Label>
                <Input
                  id="epic"
                  value={epic}
                  onChange={(e) => setEpic(e.target.value.toUpperCase())}
                  placeholder="Enter Voter ID"
                  data-testid="input-epic"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Bank Details</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="bankName">Bank Name</Label>
                <Input
                  id="bankName"
                  value={bankName}
                  onChange={(e) => setBankName(e.target.value)}
                  placeholder="Enter bank name"
                  data-testid="input-bank-name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="accountNumber">Account Number</Label>
                <Input
                  id="accountNumber"
                  value={accountNumber}
                  onChange={(e) => setAccountNumber(e.target.value)}
                  placeholder="Enter account number"
                  data-testid="input-account-number"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ifsc">IFSC Code</Label>
                <Input
                  id="ifsc"
                  value={ifsc}
                  onChange={(e) => setIfsc(e.target.value.toUpperCase())}
                  placeholder="SBIN0001234"
                  data-testid="input-ifsc"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="branchName">Branch Name</Label>
                <Input
                  id="branchName"
                  value={branchName}
                  onChange={(e) => setBranchName(e.target.value)}
                  placeholder="Enter branch name"
                  data-testid="input-branch-name"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Premises & License</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Yard *</Label>
                <Select value={yardId} onValueChange={setYardId} disabled={yardsLoading}>
                  <SelectTrigger data-testid="select-yard">
                    <SelectValue placeholder={yardsLoading ? 'Loading yards…' : 'Select yard'} />
                  </SelectTrigger>
                  <SelectContent>
                    {yardOptions.map((yard) => (
                      <SelectItem key={yard.id} value={yard.id}>
                        {yard.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="premises">Premises/Stall/Godown Number</Label>
                <Input
                  id="premises"
                  value={premises}
                  onChange={(e) => setPremises(e.target.value)}
                  placeholder="e.g., Stall 14"
                  data-testid="input-premises"
                />
              </div>
              <div className="space-y-2">
                <Label>Premises Type</Label>
                <Select value={premisesType} onValueChange={setPremisesType}>
                  <SelectTrigger data-testid="select-premises-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Stall">Stall</SelectItem>
                    <SelectItem value="Godown">Godown</SelectItem>
                    <SelectItem value="Shop">Shop</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Registration Type *</Label>
                <Select value={registrationType} onValueChange={setRegistrationType}>
                  <SelectTrigger data-testid="select-registration-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Temporary">Temporary</SelectItem>
                    <SelectItem value="Permanent">Permanent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Purpose/Commodities to Deal</Label>
              <div className="flex flex-wrap gap-2">
                {COMMODITIES.map((commodity) => (
                  <Badge
                    key={commodity.name}
                    variant={selectedCommodities.includes(commodity.name) ? 'default' : 'outline'}
                    className="cursor-pointer"
                    onClick={() => toggleCommodity(commodity.name)}
                    data-testid={`badge-commodity-${commodity.name.toLowerCase()}`}
                  >
                    {commodity.name}
                  </Badge>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-col sm:flex-row gap-3 justify-end">
          <Button variant="outline" onClick={() => setLocation('/traders')} data-testid="button-cancel">
            <X className="h-4 w-4 mr-2" />
            Cancel
          </Button>
          <Button 
            variant="secondary" 
            onClick={() => handleSubmit(true)} 
            disabled={isPending}
            data-testid="button-save-draft"
          >
            <Save className="h-4 w-4 mr-2" />
            Save as Draft
          </Button>
          <Button 
            onClick={() => handleSubmit(false)} 
            disabled={isPending}
            data-testid="button-submit"
          >
            <Check className="h-4 w-4 mr-2" />
            Submit for Approval
          </Button>
        </div>
      </div>
    </AppShell>
  );
}
