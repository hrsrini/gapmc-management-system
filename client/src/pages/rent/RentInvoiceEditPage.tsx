import { useParams } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { AppShell } from '@/components/layout/AppShell';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertCircle } from 'lucide-react';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import RentInvoiceForm from './RentInvoiceForm';
import type { Invoice } from '@shared/schema';

function RentInvoiceEditPageInner() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';

  const { data: invoice, isLoading, isError } = useQuery<Invoice | null>({
    queryKey: ['/api/invoices', id],
    queryFn: async () => {
      const res = await fetch(`/api/invoices/${id}`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!id,
  });

  if (!id) {
    return (
      <AppShell breadcrumbs={[{ label: 'Rent & Tax', href: '/rent' }, { label: 'Edit Invoice' }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Invalid invoice ID</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  if (isLoading) {
    return (
      <AppShell breadcrumbs={[{ label: 'Rent & Tax', href: '/rent' }, { label: 'Edit Invoice' }]}>
        <div className="space-y-4">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-64 w-full" />
        </div>
      </AppShell>
    );
  }

  if (isError || !invoice) {
    return (
      <AppShell breadcrumbs={[{ label: 'Rent & Tax', href: '/rent' }, { label: 'Edit Invoice' }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Invoice not found or failed to load</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return <RentInvoiceForm invoiceId={id} initialData={invoice} />;
}

export default function RentInvoiceEditPage() {
  return (
    <ProtectedRoute>
      <RentInvoiceEditPageInner />
    </ProtectedRoute>
  );
}
