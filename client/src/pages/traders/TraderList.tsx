import { useState } from 'react';
import { Link, useLocation } from 'wouter';
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Plus, Search, Eye, Pencil, Trash2, Users, AlertCircle, RefreshCcw } from 'lucide-react';
import { YARDS } from '@/data/yards';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import type { Trader } from '@shared/schema';

const statusColors: Record<string, string> = {
  Active: 'bg-accent/10 text-accent border-accent/20',
  Inactive: 'bg-muted text-muted-foreground border-muted',
  Pending: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
};

export default function TraderList() {
  const { toast } = useToast();
  const { can } = useAuth();
  const canCreate = can('M-02', 'Create');
  const canUpdate = can('M-02', 'Update');
  const canDelete = can('M-02', 'Delete');
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState('');
  const [selectedYard, setSelectedYard] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [selectedType, setSelectedType] = useState<string>('all');
  const [viewTrader, setViewTrader] = useState<Trader | null>(null);

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
          {canCreate && (
            <Button asChild data-testid="button-register-trader">
              <Link href="/traders/new">
                <Plus className="h-4 w-4 mr-2" />
                Register Trader
              </Link>
            </Button>
          )}
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
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setViewTrader(trader)}
                                data-testid={`button-view-${trader.id}`}
                                aria-label="View trader"
                              >
                                <Eye className="h-4 w-4" />
                              </Button>
                              {canUpdate && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => setLocation(`/traders/edit/${trader.id}`)}
                                  data-testid={`button-edit-${trader.id}`}
                                  aria-label="Edit trader"
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                              )}
                              {canDelete && (
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

        <Dialog open={!!viewTrader} onOpenChange={(open) => !open && setViewTrader(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Trader details</DialogTitle>
            </DialogHeader>
            {viewTrader && (
              <div className="grid gap-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Asset ID</span>
                  <span className="font-mono">{viewTrader.assetId}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Name</span>
                  <span className="font-medium">{viewTrader.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Firm / Type</span>
                  <span>{viewTrader.firmName || viewTrader.type}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Yard</span>
                  <span>{viewTrader.yardName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Premises</span>
                  <span>{viewTrader.premises} ({viewTrader.premisesType})</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Mobile</span>
                  <span>{viewTrader.mobile}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Email</span>
                  <span>{viewTrader.email}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Status</span>
                  <Badge variant="outline" className={statusColors[viewTrader.status]}>
                    {viewTrader.status}
                  </Badge>
                </div>
                <div className="flex gap-2 pt-2">
                  <Button variant="outline" size="sm" onClick={() => setViewTrader(null)}>Close</Button>
                  {canUpdate && (
                    <Button size="sm" onClick={() => { setViewTrader(null); setLocation(`/traders/edit/${viewTrader.id}`); }} data-testid="button-edit-from-view">
                      <Pencil className="h-4 w-4 mr-1" />
                      Edit
                    </Button>
                  )}
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
