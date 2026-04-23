import { useMemo } from 'react';
import { Link } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { AppShell } from '@/components/layout/AppShell';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ClientDataGrid } from '@/components/reports/ClientDataGrid';
import type { ReportTableColumn } from '@/components/reports/ReportDataTable';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  Users, 
  FileText, 
  Clock, 
  IndianRupee,
  ArrowRight,
  Receipt,
  Wallet,
  UserPlus,
  Calendar
} from 'lucide-react';
import type { ActivityLog } from '@shared/schema';

interface Stats {
  totalTraders: number;
  activeInvoices: number;
  pendingReceipts: number;
  todaysCollection: number;
}

const quickActions: {
  title: string;
  description: string;
  href: string;
  icon: typeof FileText;
  color: string;
  module: string;
}[] = [
  {
    title: 'Rent/Tax Module',
    description: 'Manage rent invoices and GST',
    href: '/rent',
    icon: FileText,
    color: 'text-primary',
    module: 'M-03',
  },
  {
    title: 'Trader Profiles',
    description: 'Register and manage traders',
    href: '/traders',
    icon: UserPlus,
    color: 'text-accent',
    module: 'M-02',
  },
  {
    title: 'Market Fee',
    description: 'Collection and import/export',
    href: '/market-fee',
    icon: Wallet,
    color: 'text-amber-600',
    module: 'M-04',
  },
  {
    title: 'Receipts',
    description: 'Issue and track receipts',
    href: '/receipts',
    icon: Receipt,
    color: 'text-slate-600',
    module: 'M-05',
  },
];

export default function Dashboard() {
  const { user, can } = useAuth();
  const displayName = user?.name?.trim() || user?.email || 'there';
  const canHrRead = can('M-01', 'Read');
  const canM05Read = can('M-05', 'Read');
  const visibleQuickActions = useMemo(() => quickActions.filter((a) => can(a.module, 'Read')), [can]);

  const { data: stats, isLoading: statsLoading } = useQuery<Stats>({
    queryKey: ['/api/stats'],
  });

  const { data: activityLogs, isLoading: logsLoading } = useQuery<ActivityLog[]>({
    queryKey: ['/api/activity'],
  });

  const { data: retirementSummary } = useQuery<{ count: number; until: string; days: number }>({
    queryKey: ['/api/hr/retirement-upcoming?days=90'],
    enabled: canHrRead,
  });

  const activityColumns = useMemo(
    (): ReportTableColumn[] => [
      { key: 'action', header: 'Action' },
      { key: 'module', header: 'Module' },
      { key: 'user', header: 'User' },
      { key: 'loggedAt', header: 'Timestamp' },
    ],
    [],
  );

  const activityRows = useMemo((): Record<string, unknown>[] => {
    return (activityLogs ?? []).map((log) => ({
      id: log.id,
      action: log.action,
      module: log.module,
      user: log.user,
      loggedAt: log.timestamp,
    }));
  }, [activityLogs]);

  const statCards = [
    {
      title: 'Total Traders',
      value: stats?.totalTraders ?? 0,
      icon: Users,
      color: 'bg-primary/10 text-primary',
      iconColor: 'text-primary',
    },
    {
      title: 'Active Invoices',
      value: stats?.activeInvoices ?? 0,
      icon: FileText,
      color: 'bg-accent/10 text-accent',
      iconColor: 'text-accent',
    },
    {
      title: 'Pending Receipts',
      value: stats?.pendingReceipts ?? 0,
      icon: Clock,
      color: 'bg-amber-500/10 text-amber-600',
      iconColor: 'text-amber-600',
    },
    {
      title: "Today's Collection",
      value: `${((stats?.todaysCollection ?? 0) / 1000).toFixed(1)}K`,
      prefix: '₹',
      icon: IndianRupee,
      color: 'bg-slate-500/10 text-slate-600',
      iconColor: 'text-slate-600',
    },
  ];

  return (
    <AppShell breadcrumbs={[{ label: 'Dashboard' }]}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground" data-testid="text-welcome">
            Welcome back, {displayName}
          </h1>
          <p className="text-muted-foreground">
            Goa APMC Management System Overview
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {statCards.map((stat) => (
            <Card key={stat.title} className="hover-elevate" data-testid={`card-stat-${stat.title.toLowerCase().replace(/\s+/g, '-')}`}>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">{stat.title}</p>
                    {statsLoading ? (
                      <Skeleton className="h-8 w-16 mt-1" />
                    ) : (
                      <p className="text-2xl font-bold mt-1">
                        {stat.prefix}{stat.value}
                      </p>
                    )}
                  </div>
                  <div className={`p-3 rounded-lg ${stat.color}`}>
                    <stat.icon className={`h-6 w-6 ${stat.iconColor}`} />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {canHrRead && retirementSummary != null && (
          <Card className={retirementSummary.count > 0 ? 'border-amber-500/40 bg-amber-500/5' : ''}>
            <CardHeader className="flex flex-row items-center justify-between gap-4 pb-2">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <Calendar className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-base">HR: retirements in next {retirementSummary.days} days</CardTitle>
                  <CardDescription>
                    Active employees with a retirement date on or before {retirementSummary.until}.
                  </CardDescription>
                </div>
              </div>
              <Button variant="outline" size="sm" asChild>
                <Link href="/hr/employees">Employees</Link>
              </Button>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold tabular-nums">{retirementSummary.count}</p>
              <p className="text-sm text-muted-foreground mt-1">
                {retirementSummary.count === 0
                  ? 'No matches in this window.'
                  : 'Review employee records and succession planning.'}
              </p>
            </CardContent>
          </Card>
        )}

        <div>
          <h2 className="text-lg font-semibold mb-4">Quick Actions</h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {visibleQuickActions.map((action) => (
              <Link key={action.title} href={action.href}>
                <Card className="h-full hover-elevate cursor-pointer group" data-testid={`card-action-${action.title.toLowerCase().replace(/\s+/g, '-')}`}>
                  <CardContent className="p-6">
                    <div className="flex items-start justify-between">
                      <div>
                        <action.icon className={`h-8 w-8 ${action.color} mb-3`} />
                        <h3 className="font-semibold">{action.title}</h3>
                        <p className="text-sm text-muted-foreground mt-1">
                          {action.description}
                        </p>
                      </div>
                      <ArrowRight className="h-5 w-5 text-muted-foreground group-hover:text-foreground transition-colors" />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4 pb-2">
            <div>
              <CardTitle>Recent Activity</CardTitle>
              <CardDescription>Latest actions in the system</CardDescription>
            </div>
            {canM05Read && (
              <Button variant="outline" size="sm" asChild>
                <Link href="/receipts" data-testid="button-view-all-activity">
                  View All
                </Link>
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {logsLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : (
              <div data-testid="grid-recent-activity">
                <ClientDataGrid
                  columns={activityColumns}
                  sourceRows={activityRows}
                  searchKeys={['action', 'module', 'user']}
                  defaultSortKey="loggedAt"
                  defaultSortDir="desc"
                  emptyMessage="No recent activity."
                />
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
