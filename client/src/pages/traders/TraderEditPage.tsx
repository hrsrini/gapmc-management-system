import { useParams } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { AppShell } from '@/components/layout/AppShell';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertCircle } from 'lucide-react';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import TraderForm from './TraderForm';
import type { Trader } from '@shared/schema';

function TraderEditPageInner() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';

  const { data: trader, isLoading, isError } = useQuery<Trader | null>({
    queryKey: ['/api/traders', id],
    queryFn: async () => {
      const res = await fetch(`/api/traders/${id}`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!id,
  });

  if (!id) {
    return (
      <AppShell breadcrumbs={[{ label: 'Traders', href: '/traders' }, { label: 'Edit Trader' }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Invalid trader ID</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  if (isLoading) {
    return (
      <AppShell breadcrumbs={[{ label: 'Traders', href: '/traders' }, { label: 'Edit Trader' }]}>
        <div className="space-y-4">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-64 w-full" />
        </div>
      </AppShell>
    );
  }

  if (isError || !trader) {
    return (
      <AppShell breadcrumbs={[{ label: 'Traders', href: '/traders' }, { label: 'Edit Trader' }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Trader not found or failed to load</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return <TraderForm traderId={id} initialData={trader} />;
}

export default function TraderEditPage() {
  return (
    <ProtectedRoute>
      <TraderEditPageInner />
    </ProtectedRoute>
  );
}
