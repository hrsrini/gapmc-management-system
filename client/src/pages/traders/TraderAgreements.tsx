import { useMemo, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { AppShell } from '@/components/layout/AppShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FileText, RefreshCcw, XCircle, FileSignature, AlertCircle, Download, Upload, Eye } from 'lucide-react';
import { legacyRowMatchesSelectedApiYard } from '@/lib/legacyYardMatch';
import { useScopedActiveYards } from '@/hooks/useScopedActiveYards';
import { formatDisplayDate } from '@/lib/dateFormat';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import type { Agreement } from '@shared/schema';
import { ClientDataGrid } from '@/components/reports/ClientDataGrid';
import type { ReportTableColumn } from '@/components/reports/ReportDataTable';
import { useUploadFilePreview } from '@/hooks/useUploadFilePreview';
import { AuthenticatedBlobPreviewDialog } from '@/components/attachment/AuthenticatedBlobPreviewDialog';

const statusColors: Record<string, string> = {
  Active: 'bg-accent/10 text-accent border-accent/20',
  'Expiring Soon': 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  Expired: 'bg-destructive/10 text-destructive border-destructive/20',
  Terminated: 'bg-muted text-muted-foreground border-muted',
};

const columns: ReportTableColumn[] = [
  { key: 'agreementId', header: 'Agreement ID' },
  { key: 'traderName', header: 'Trader' },
  { key: 'premises', header: 'Premises' },
  { key: 'yardName', header: 'Yard' },
  { key: 'startDate', header: 'Start Date' },
  { key: 'endDate', header: 'End Date' },
  { key: 'rentAmount', header: 'Rent Amount', sortField: 'rentAmountNum' },
  { key: 'securityDeposit', header: 'Security Deposit', sortField: 'securityDepositNum' },
  { key: '_status', header: 'Status', sortField: 'status' },
  { key: '_actions', header: 'Actions' },
];

export default function TraderAgreements() {
  const { toast } = useToast();
  const [selectedYard, setSelectedYard] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [viewAgreement, setViewAgreement] = useState<Agreement | null>(null);
  const [docFile, setDocFile] = useState<File | null>(null);
  const [docPreviewOpen, setDocPreviewOpen] = useState(false);
  const [docPreviewPath, setDocPreviewPath] = useState<string | null>(null);
  const [docPreviewTitle, setDocPreviewTitle] = useState('');
  const docPickPreviewUrl = useUploadFilePreview(docFile);

  const agreementDocsUrl = viewAgreement?.id
    ? `/api/agreements/${encodeURIComponent(viewAgreement.id)}/documents`
    : '';
  const { data: docs = [] } = useQuery<
    Array<{ id: string; agreementId: string; version: number; fileName: string; createdAt?: string | null }>
  >({
    queryKey: [agreementDocsUrl],
    enabled: Boolean(agreementDocsUrl),
  });

  const uploadDocMutation = useMutation({
    mutationFn: async () => {
      if (!viewAgreement?.id) throw new Error('Agreement not selected');
      if (!docFile) throw new Error('Choose a file first');
      const fd = new FormData();
      fd.append('file', docFile);
      const res = await fetch(`/api/agreements/${encodeURIComponent(viewAgreement.id)}/documents`, {
        method: 'POST',
        credentials: 'include',
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText);
      return data as { id: string };
    },
    onSuccess: () => {
      if (agreementDocsUrl) queryClient.invalidateQueries({ queryKey: [agreementDocsUrl] });
      setDocFile(null);
      toast({ title: 'Uploaded', description: 'Agreement document uploaded.' });
    },
    onError: (e: unknown) => {
      toast({
        title: 'Upload failed',
        description: e instanceof Error ? e.message : 'Failed to upload document',
        variant: 'destructive',
      });
    },
  });

  const { data: agreements, isLoading, isError } = useQuery<Agreement[]>({
    queryKey: ['/api/agreements'],
  });

  const { data: yards = [] } = useScopedActiveYards();

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

  const filteredAgreements = useMemo(() => {
    return (agreements ?? []).filter((agreement) => {
      const matchesYard = legacyRowMatchesSelectedApiYard(
        agreement.yardId,
        agreement.yardName,
        selectedYard,
        yards,
      );
      const matchesStatus = selectedStatus === 'all' || agreement.status === selectedStatus;
      return matchesYard && matchesStatus;
    });
  }, [agreements, selectedYard, selectedStatus, yards]);

  const sourceRows = useMemo((): Record<string, unknown>[] => {
    return filteredAgreements.map((agreement) => ({
      id: agreement.id,
      agreementId: agreement.agreementId,
      traderName: agreement.traderName,
      premises: agreement.premises,
      yardName: agreement.yardName,
      startDate: agreement.startDate,
      endDate: agreement.endDate,
      rentAmount: `₹${agreement.rentAmount.toLocaleString()}`,
      rentAmountNum: agreement.rentAmount,
      securityDeposit: `₹${agreement.securityDeposit.toLocaleString()}`,
      securityDepositNum: agreement.securityDeposit,
      status: agreement.status,
      _status: (
        <Badge variant="outline" className={statusColors[agreement.status]}>
          {agreement.status}
        </Badge>
      ),
      _actions: (
        <div className="flex items-center justify-end gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setViewAgreement(agreement)}
            data-testid={`button-view-${agreement.id}`}
          >
            <FileText className="h-4 w-4" />
          </Button>
          {(agreement.status === 'Active' || agreement.status === 'Expiring Soon') && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                toast({
                  title: 'Renew Agreement',
                  description: `Agreement ${agreement.agreementId} renewal initiated`,
                });
              }}
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
              onClick={() =>
                updateMutation.mutate(
                  { id: agreement.id, data: { status: 'Terminated' } },
                  {
                    onSuccess: () => {
                      toast({
                        title: 'Agreement Terminated',
                        description: `Agreement ${agreement.agreementId} has been terminated`,
                      });
                    },
                  },
                )
              }
              disabled={updateMutation.isPending}
              data-testid={`button-terminate-${agreement.id}`}
            >
              <XCircle className="h-4 w-4" />
            </Button>
          )}
        </div>
      ),
    }));
  }, [filteredAgreements, updateMutation.isPending]);

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

  const filterKey = `${selectedYard}|${selectedStatus}`;

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
            <p className="text-sm text-muted-foreground">Use the grid search for trader name or agreement ID.</p>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Select value={selectedYard} onValueChange={setSelectedYard}>
                <SelectTrigger data-testid="select-yard">
                  <SelectValue placeholder="Select Yard" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Yards</SelectItem>
                  {yards
                    .filter((y) => String(y.type ?? '').toLowerCase() === 'yard')
                    .map((yard) => (
                      <SelectItem key={yard.id} value={yard.id}>
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
          <CardContent className="pt-6">
            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : (
              <ClientDataGrid
                columns={columns}
                sourceRows={sourceRows}
                searchKeys={[
                  'agreementId',
                  'traderName',
                  'premises',
                  'yardName',
                  'startDate',
                  'endDate',
                  'status',
                ]}
                searchPlaceholder="Search trader or agreement ID…"
                defaultSortKey="endDate"
                defaultSortDir="desc"
                resetPageDependency={filterKey}
                emptyMessage="No agreements found"
              />
            )}
          </CardContent>
        </Card>

        <Dialog open={!!viewAgreement} onOpenChange={(open) => !open && setViewAgreement(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Agreement details</DialogTitle>
            </DialogHeader>
            {viewAgreement && (
              <div className="grid gap-4 text-sm">
                <div className="grid gap-2">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Agreement ID</span>
                  <span className="font-mono">{viewAgreement.agreementId}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Trader</span>
                  <span className="font-medium">{viewAgreement.traderName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Premises</span>
                  <span>{viewAgreement.premises}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Yard</span>
                  <span>{viewAgreement.yardName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Start</span>
                  <span>{formatDisplayDate(viewAgreement.startDate)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">End</span>
                  <span>{formatDisplayDate(viewAgreement.endDate)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Rent</span>
                  <span>₹{viewAgreement.rentAmount.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Security Deposit</span>
                  <span>₹{viewAgreement.securityDeposit.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Status</span>
                  <Badge variant="outline" className={statusColors[viewAgreement.status]}>
                    {viewAgreement.status}
                  </Badge>
                </div>
                </div>

                <div className="rounded-md border p-3 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium">Documents</div>
                    <Badge variant="secondary">{docs.length}</Badge>
                  </div>
                  {docs.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No documents uploaded yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {docs.slice(0, 8).map((d) => (
                        <div key={d.id} className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-xs font-medium truncate" title={d.fileName}>
                              v{d.version} — {d.fileName}
                            </div>
                            {d.createdAt ? (
                              <div className="text-[11px] text-muted-foreground">
                                {new Date(d.createdAt).toLocaleString()}
                              </div>
                            ) : null}
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            title="Preview"
                            onClick={() => {
                              setDocPreviewTitle(d.fileName);
                              setDocPreviewPath(
                                `/api/agreements/${encodeURIComponent(viewAgreement.id)}/documents/${encodeURIComponent(d.id)}/download`,
                              );
                              setDocPreviewOpen(true);
                            }}
                          >
                            <Eye className="h-4 w-4 mr-1" /> View
                          </Button>
                          <Button asChild size="sm" variant="outline">
                            <a
                              href={`/api/agreements/${encodeURIComponent(viewAgreement.id)}/documents/${encodeURIComponent(d.id)}/download`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <Download className="h-4 w-4 mr-1" /> Download
                            </a>
                          </Button>
                        </div>
                      ))}
                      {docs.length > 8 ? (
                        <div className="text-xs text-muted-foreground">…and {docs.length - 8} more</div>
                      ) : null}
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label>Upload new version</Label>
                    <Input
                      type="file"
                      accept="application/pdf,image/png,image/jpeg"
                      onChange={(e) => setDocFile(e.target.files?.[0] ?? null)}
                    />
                    {docPickPreviewUrl ? (
                      docFile?.type === 'application/pdf' ? (
                        <iframe
                          title="Selected file preview"
                          src={docPickPreviewUrl}
                          className="w-full h-44 rounded-md border bg-background"
                        />
                      ) : (
                        <img
                          src={docPickPreviewUrl}
                          alt=""
                          className="max-h-40 max-w-full rounded-md border object-contain"
                        />
                      )
                    ) : null}
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        disabled={uploadDocMutation.isPending || !docFile}
                        onClick={() => uploadDocMutation.mutate()}
                      >
                        <Upload className="h-4 w-4 mr-1" />
                        Upload
                      </Button>
                    </div>
                  </div>
                </div>

                <Button variant="outline" size="sm" onClick={() => setViewAgreement(null)}>Close</Button>
              </div>
            )}
          </DialogContent>
        </Dialog>
        <AuthenticatedBlobPreviewDialog
          open={docPreviewOpen}
          onOpenChange={setDocPreviewOpen}
          title={docPreviewTitle}
          fetchPath={docPreviewPath}
        />
      </div>
    </AppShell>
  );
}
