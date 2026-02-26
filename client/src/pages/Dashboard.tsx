import { Link } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { AppShell } from '@/components/layout/AppShell';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  Users, 
  FileText, 
  Clock, 
  IndianRupee,
  ArrowRight,
  Receipt,
  Wallet,
  UserPlus
} from 'lucide-react';
import { format } from 'date-fns';
import type { ActivityLog } from '@shared/schema';

interface Stats {
  totalTraders: number;
  activeInvoices: number;
  pendingReceipts: number;
  todaysCollection: number;
}

const quickActions = [
  {
    title: 'Rent/Tax Module',
    description: 'Manage rent invoices and GST',
    href: '/rent',
    icon: FileText,
    color: 'text-primary',
  },
  {
    title: 'Trader Profiles',
    description: 'Register and manage traders',
    href: '/traders',
    icon: UserPlus,
    color: 'text-accent',
  },
  {
    title: 'Market Fee',
    description: 'Collection and import/export',
    href: '/market-fee',
    icon: Wallet,
    color: 'text-amber-600',
  },
  {
    title: 'Receipts',
    description: 'Issue and track receipts',
    href: '/receipts',
    icon: Receipt,
    color: 'text-slate-600',
  },
];

export default function Dashboard() {
  const { data: stats, isLoading: statsLoading } = useQuery<Stats>({
    queryKey: ['/api/stats'],
  });

  const { data: activityLogs, isLoading: logsLoading } = useQuery<ActivityLog[]>({
    queryKey: ['/api/activity'],
  });

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
            Welcome back, Super Admin
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

        <div>
          <h2 className="text-lg font-semibold mb-4">Quick Actions</h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {quickActions.map((action) => (
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
            <Button variant="outline" size="sm" asChild>
              <Link href="/receipts" data-testid="button-view-all-activity">
                View All
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {logsLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Action</TableHead>
                    <TableHead>Module</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead>Timestamp</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {activityLogs?.map((log) => (
                    <TableRow key={log.id} data-testid={`row-activity-${log.id}`}>
                      <TableCell className="font-medium">{log.action}</TableCell>
                      <TableCell>{log.module}</TableCell>
                      <TableCell>{log.user}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {format(new Date(log.timestamp), 'MMM dd, yyyy HH:mm')}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
