import { useState } from 'react';
import { Link } from 'wouter';
import { useQuery, useMutation } from '@tanstack/react-query';
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
import { Plus, Search, Eye, Pencil, Trash2, Users, AlertCircle, RefreshCcw } from 'lucide-react';
import { YARDS } from '@/data/yards';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import type { Trader } from '@shared/schema';

const statusColors: Record<string, string> = {
  Active: 'bg-accent/10 text-accent border-accent/20',
  Inactive: 'bg-muted text-muted-foreground border-muted',
  Pending: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
};

export default function TraderList() {
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [selectedYard, setSelectedYard] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [selectedType, setSelectedType] = useState<string>('all');

  const { data: traders, isLoading, isError, refetch } = useQuery<Trader[]>({
    queryKey: ['/api/traders'],
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest('DELETE', `/api/traders/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/traders'] });
      queryClient.invalidateQueries({ queryKey: ['/api/stats'] });
      toast({ title: 'Trader deleted', description: 'Trader has been deleted successfully' });
    },
    onError: () => {
      toast({ title: 'Error', description: 'Failed to delete trader', variant: 'destructive' });
    },
  });

  const filteredTraders = (traders ?? []).filter((trader) => {
    const matchesSearch =
      trader.name.toLowerCase().includes(search.toLowerCase()) ||
      trader.firmName?.toLowerCase().includes(search.toLowerCase()) ||
      trader.assetId.toLowerCase().includes(search.toLowerCase());
    const matchesYard = selectedYard === 'all' || trader.yardId.toString() === selectedYard;
    const matchesStatus = selectedStatus === 'all' || trader.status === selectedStatus;
    const matchesType = selectedType === 'all' || trader.registrationType === selectedType;
    return matchesSearch && matchesYard && matchesStatus && matchesType;
  });

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: 'Traders', href: '/traders' }, { label: 'Directory' }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-destructive" />
              <span className="text-destructive">Failed to load traders. Please try again.</span>
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
    <AppShell breadcrumbs={[{ label: 'Traders', href: '/traders' }, { label: 'Directory' }]}>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Users className="h-6 w-6 text-primary" />
              Trader Directory
            </h1>
            <p className="text-muted-foreground">Manage registered traders and licensees</p>
          </div>
          <Button asChild data-testid="button-register-trader">
            <Link href="/traders/new">
              <Plus className="h-4 w-4 mr-2" />
              Register Trader
            </Link>
          </Button>
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
                  placeholder="Search name, firm, or ID..."
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
                  <SelectItem value="Inactive">Inactive</SelectItem>
                  <SelectItem value="Pending">Pending</SelectItem>
                </SelectContent>
              </Select>
              <Select value={selectedType} onValueChange={setSelectedType}>
                <SelectTrigger data-testid="select-type">
                  <SelectValue placeholder="Select Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="Temporary">Temporary</SelectItem>
                  <SelectItem value="Permanent">Permanent</SelectItem>
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
                      <TableHead>Asset ID</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Firm Name</TableHead>
                      <TableHead>Yard</TableHead>
                      <TableHead>Premises</TableHead>
                      <TableHead>GST No</TableHead>
                      <TableHead>Mobile</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredTraders.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                          No traders found
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredTraders.map((trader) => (
                        <TableRow key={trader.id} data-testid={`row-trader-${trader.id}`}>
                          <TableCell className="font-medium">{trader.assetId}</TableCell>
                          <TableCell>{trader.name}</TableCell>
                          <TableCell className="text-muted-foreground">{trader.firmName || '-'}</TableCell>
                          <TableCell>{trader.yardName}</TableCell>
                          <TableCell>{trader.premises}</TableCell>
                          <TableCell className="text-muted-foreground text-xs">{trader.gst || '-'}</TableCell>
                          <TableCell>{trader.mobile}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={statusColors[trader.status]}>
                              {trader.status}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center justify-end gap-1">
                              <Button variant="ghost" size="icon" data-testid={`button-view-${trader.id}`}>
                                <Eye className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="icon" data-testid={`button-edit-${trader.id}`}>
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                className="text-destructive"
                                onClick={() => deleteMutation.mutate(trader.id)}
                                disabled={deleteMutation.isPending}
                                data-testid={`button-delete-${trader.id}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
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
