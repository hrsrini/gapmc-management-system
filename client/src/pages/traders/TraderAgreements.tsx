import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { AppShell } from '@/components/layout/AppShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Search, FileText, RefreshCcw, XCircle, FileSignature, AlertCircle } from 'lucide-react';
import { YARDS } from '@/data/yards';
import { format } from 'date-fns';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import type { Agreement } from '@shared/schema';

const statusColors: Record<string, string> = {
  Active: 'bg-accent/10 text-accent border-accent/20',
  'Expiring Soon': 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  Expired: 'bg-destructive/10 text-destructive border-destructive/20',
  Terminated: 'bg-muted text-muted-foreground border-muted',
};

export default function TraderAgreements() {
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [selectedYard, setSelectedYard] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');

  const { data: agreements, isLoading, isError } = useQuery<Agreement[]>({
    queryKey: ['/api/agreements'],
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Agreement> }) => 
      apiRequest('PUT', `/api/agreements/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/agreements'] });
    },
    onError: () => {
      toast({ title: 'Error', description: 'Failed to update agreement', variant: 'destructive' });
    },
  });

  const filteredAgreements = (agreements ?? []).filter((agreement) => {
    const matchesSearch =
      agreement.traderName.toLowerCase().includes(search.toLowerCase()) ||
      agreement.agreementId.toLowerCase().includes(search.toLowerCase());
    const matchesYard = selectedYard === 'all' || agreement.yardId.toString() === selectedYard;
    const matchesStatus = selectedStatus === 'all' || agreement.status === selectedStatus;
    return matchesSearch && matchesYard && matchesStatus;
  });

  const handleAction = (action: string, agreement: Agreement) => {
    if (action === 'Terminate') {
      updateMutation.mutate({
        id: agreement.id,
        data: { status: 'Terminated' },
      }, {
        onSuccess: () => {
          toast({
            title: 'Agreement Terminated',
            description: `Agreement ${agreement.agreementId} has been terminated`,
          });
        },
      });
    } else if (action === 'Renew') {
      toast({
        title: 'Renew Agreement',
        description: `Agreement ${agreement.agreementId} renewal initiated`,
      });
    } else {
      toast({
        title: `${action} Agreement`,
        description: `Agreement ${agreement.agreementId} ${action.toLowerCase()} action initiated`,
      });
    }
  };

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: 'Traders', href: '/traders' }, { label: 'Agreements' }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Failed to load agreements. Please try again.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: 'Traders', href: '/traders' }, { label: 'Agreements' }]}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileSignature className="h-6 w-6 text-primary" />
            Trader Agreements
          </h1>
          <p className="text-muted-foreground">Manage trader agreements and renewals</p>
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
                  placeholder="Search trader or agreement ID..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                  data-testid="input-search"
                />
              </div>
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
              <Select value={selectedStatus} onValueChange={setSelectedStatus}>
                <SelectTrigger data-testid="select-status">
                  <SelectValue placeholder="Select Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="Active">Active</SelectItem>
                  <SelectItem value="Expiring Soon">Expiring Soon</SelectItem>
                  <SelectItem value="Expired">Expired</SelectItem>
                  <SelectItem value="Terminated">Terminated</SelectItem>
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
                      <TableHead>Agreement ID</TableHead>
                      <TableHead>Trader</TableHead>
                      <TableHead>Premises</TableHead>
                      <TableHead>Yard</TableHead>
                      <TableHead>Start Date</TableHead>
                      <TableHead>End Date</TableHead>
                      <TableHead className="text-right">Rent Amount</TableHead>
                      <TableHead className="text-right">Security Deposit</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredAgreements.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">
                          No agreements found
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredAgreements.map((agreement) => (
                        <TableRow 
                          key={agreement.id} 
                          className={agreement.status === 'Expiring Soon' ? 'bg-amber-50 dark:bg-amber-950/20' : ''}
                          data-testid={`row-agreement-${agreement.id}`}
                        >
                          <TableCell className="font-medium">{agreement.agreementId}</TableCell>
                          <TableCell>{agreement.traderName}</TableCell>
                          <TableCell>{agreement.premises}</TableCell>
                          <TableCell className="text-muted-foreground">{agreement.yardName}</TableCell>
                          <TableCell>{format(new Date(agreement.startDate), 'MMM dd, yyyy')}</TableCell>
                          <TableCell>{format(new Date(agreement.endDate), 'MMM dd, yyyy')}</TableCell>
                          <TableCell className="text-right">₹{agreement.rentAmount.toLocaleString()}</TableCell>
                          <TableCell className="text-right">₹{agreement.securityDeposit.toLocaleString()}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={statusColors[agreement.status]}>
                              {agreement.status}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center justify-end gap-1">
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                onClick={() => handleAction('View', agreement)}
                                data-testid={`button-view-${agreement.id}`}
                              >
                                <FileText className="h-4 w-4" />
                              </Button>
                              {(agreement.status === 'Active' || agreement.status === 'Expiring Soon') && (
                                <Button 
                                  variant="ghost" 
                                  size="icon"
                                  onClick={() => handleAction('Renew', agreement)}
                                  data-testid={`button-renew-${agreement.id}`}
                                >
                                  <RefreshCcw className="h-4 w-4" />
                                </Button>
                              )}
                              {agreement.status === 'Active' && (
                                <Button 
                                  variant="ghost" 
                                  size="icon" 
                                  className="text-destructive"
                                  onClick={() => handleAction('Terminate', agreement)}
                                  disabled={updateMutation.isPending}
                                  data-testid={`button-terminate-${agreement.id}`}
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
