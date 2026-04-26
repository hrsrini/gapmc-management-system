import { useLayoutEffect, useEffect, useMemo } from 'react';
import { useLocation, Link } from 'wouter';
import { useAuth } from '@/context/AuthContext';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
} from '@/components/ui/sidebar';
import { 
  LayoutDashboard, 
  FileText, 
  BarChart3, 
  Users, 
  FileSignature, 
  Wallet,
  ArrowLeftRight,
  ClipboardList,
  Receipt,
  PlusCircle,
  BookOpen,
  Leaf,
  Settings,
  MapPin,
  Shield,
  ScrollText,
  UserCircle,
  FileCheck,
  Building2,
  StickyNote,
  Package,
  Percent,
  ArrowRightLeft,
  LogIn,
  Banknote,
  Truck,
  HardHat,
  Mail,
  Inbox,
  BellRing,
  Calendar,
  CalendarDays,
  Send,
  Grid3X3,
  Clock,
  Store,
  KeyRound,
  ShieldAlert,
  Bug,
  BookMarked,
} from 'lucide-react';

type MenuItem = {
  title: string;
  icon: typeof LayoutDashboard;
  href: string;
  /** If set, menu item is only shown when user has this permission. */
  requirePermission?: { module: string; action: 'Read' | 'Create' | 'Update' | 'Delete' };
};

/** True if this menu href is a prefix of the current location (exact or child path). */
function menuHrefMatchesLocation(location: string, href: string): boolean {
  if (location === href) return true;
  if (href === '/dashboard') return false;
  return location.startsWith(`${href}/`);
}

/** Among visible sidebar links, the most specific href that matches wins (e.g. /bugs/dashboard over /bugs). */
function pickActiveMenuHref(location: string, hrefs: string[]): string | null {
  const matches = hrefs.filter((h) => menuHrefMatchesLocation(location, h));
  if (matches.length === 0) return null;
  return matches.reduce((a, b) => (a.length >= b.length ? a : b));
}

const menuItems: { group: string; adminOnly?: boolean; items: MenuItem[] }[] = [
  {
    group: 'Dashboard',
    items: [
      { title: 'Dashboard', icon: LayoutDashboard, href: '/dashboard' },
    ]
  },
  {
    group: 'Support',
    items: [
      { title: 'Bugs', icon: Bug, href: '/bugs' },
      { title: 'Bug dashboard', icon: LayoutDashboard, href: '/bugs/dashboard' },
    ]
  },
  {
    group: 'Rent & Tax',
    items: [
      { title: 'Invoices', icon: FileText, href: '/rent', requirePermission: { module: 'M-03', action: 'Read' } },
      { title: 'Reports', icon: BarChart3, href: '/rent/reports', requirePermission: { module: 'M-03', action: 'Read' } },
      { title: 'IOMS Rent (M-03)', icon: FileText, href: '/rent/ioms', requirePermission: { module: 'M-03', action: 'Read' } },
      { title: 'Credit Notes (M-03)', icon: StickyNote, href: '/rent/ioms/credit-notes', requirePermission: { module: 'M-03', action: 'Read' } },
      { title: 'Rent deposit ledger', icon: BookOpen, href: '/rent/ioms/ledger', requirePermission: { module: 'M-03', action: 'Read' } },
      { title: 'Rent revisions', icon: CalendarDays, href: '/rent/ioms/revisions', requirePermission: { module: 'M-03', action: 'Read' } },
    ]
  },
  {
    group: 'Traders',
    items: [
      { title: 'Trader Directory', icon: Users, href: '/traders', requirePermission: { module: 'M-02', action: 'Read' } },
      { title: 'Agreements', icon: FileSignature, href: '/traders/agreements', requirePermission: { module: 'M-02', action: 'Read' } },
      { title: 'Licences (IOMS M-02)', icon: FileCheck, href: '/traders/licences', requirePermission: { module: 'M-02', action: 'Read' } },
      { title: 'Functionary registrations (BM)', icon: FileCheck, href: '/traders/functionaries', requirePermission: { module: 'M-02', action: 'Read' } },
      { title: 'Entities (Track B)', icon: Building2, href: '/traders/entities', requirePermission: { module: 'M-02', action: 'Read' } },
      { title: 'Unified entities', icon: Building2, href: '/traders/unified-entities', requirePermission: { module: 'M-02', action: 'Read' } },
      { title: 'Pre-receipts (Govt)', icon: FileText, href: '/traders/pre-receipts', requirePermission: { module: 'M-02', action: 'Read' } },
      { title: 'Outstanding dues', icon: Wallet, href: '/traders/dues', requirePermission: { module: 'M-02', action: 'Read' } },
      { title: 'Blocking log', icon: ShieldAlert, href: '/traders/blocking-log', requirePermission: { module: 'M-02', action: 'Read' } },
    ]
  },
  {
    group: 'Assets (IOMS M-02)',
    items: [
      { title: 'Asset Register', icon: Building2, href: '/assets', requirePermission: { module: 'M-02', action: 'Read' } },
      { title: 'Shop Allotments', icon: KeyRound, href: '/assets/allotments', requirePermission: { module: 'M-02', action: 'Read' } },
      { title: 'Shop Vacant', icon: Store, href: '/assets/vacant', requirePermission: { module: 'M-02', action: 'Read' } },
    ]
  },
  {
    group: 'Market Fee',
    items: [
      { title: 'Fee Collection', icon: Wallet, href: '/market-fee', requirePermission: { module: 'M-04', action: 'Read' } },
      { title: 'Import/Export', icon: ArrowLeftRight, href: '/market-fee/entry', requirePermission: { module: 'M-04', action: 'Read' } },
      { title: 'Returns', icon: ClipboardList, href: '/market-fee/returns', requirePermission: { module: 'M-04', action: 'Read' } },
      { title: 'Monthly returns (M-04)', icon: ClipboardList, href: '/market/returns', requirePermission: { module: 'M-04', action: 'Read' } },
      { title: 'Fee statement (M-04)', icon: Banknote, href: '/market/fee-statement', requirePermission: { module: 'M-04', action: 'Read' } },
      { title: 'Reports (M-04)', icon: BarChart3, href: '/market/reports', requirePermission: { module: 'M-04', action: 'Read' } },
      { title: 'Daily prices (M-04)', icon: BarChart3, href: '/market/daily-prices', requirePermission: { module: 'M-04', action: 'Read' } },
      { title: 'Advance ledger (M-04)', icon: Wallet, href: '/market/advance-ledger', requirePermission: { module: 'M-04', action: 'Read' } },
      { title: 'Commodity reports (M-04)', icon: BarChart3, href: '/market/commodity-reports', requirePermission: { module: 'M-04', action: 'Read' } },
      { title: 'Commodities (M-04)', icon: Package, href: '/market/commodities', requirePermission: { module: 'M-04', action: 'Read' } },
      { title: 'Fee rates (M-04)', icon: Percent, href: '/market/fee-rates', requirePermission: { module: 'M-04', action: 'Read' } },
      { title: 'Farmers (M-04)', icon: Users, href: '/market/farmers', requirePermission: { module: 'M-04', action: 'Read' } },
      { title: 'Transactions (M-04)', icon: ArrowRightLeft, href: '/market/transactions', requirePermission: { module: 'M-04', action: 'Read' } },
      { title: 'MSP settings (M-02)', icon: Percent, href: '/market/msp', requirePermission: { module: 'M-02', action: 'Read' } },
    ]
  },
  {
    group: 'Check Post (IOMS M-04)',
    items: [
      { title: 'Inward', icon: LogIn, href: '/checkpost/inward', requirePermission: { module: 'M-04', action: 'Read' } },
      { title: 'Outward', icon: Send, href: '/checkpost/outward', requirePermission: { module: 'M-04', action: 'Read' } },
      { title: 'Stock returns', icon: ArrowLeftRight, href: '/checkpost/stock-returns', requirePermission: { module: 'M-04', action: 'Read' } },
      { title: 'Exit permits', icon: FileCheck, href: '/checkpost/exit-permits', requirePermission: { module: 'M-04', action: 'Read' } },
      { title: 'Bank deposits', icon: Banknote, href: '/checkpost/bank-deposits', requirePermission: { module: 'M-04', action: 'Read' } },
    ]
  },
  {
    group: 'Receipts',
    items: [
      { title: 'All Receipts', icon: Receipt, href: '/receipts', requirePermission: { module: 'M-05', action: 'Read' } },
      { title: 'Create Receipt', icon: PlusCircle, href: '/receipts/new', requirePermission: { module: 'M-05', action: 'Create' } },
      { title: 'Ledger Reports', icon: BookOpen, href: '/receipts/ledger', requirePermission: { module: 'M-05', action: 'Read' } },
      { title: 'IOMS Receipts (M-05)', icon: Receipt, href: '/receipts/ioms', requirePermission: { module: 'M-05', action: 'Read' } },
      { title: 'Receipt reconciliation', icon: FileSignature, href: '/receipts/ioms/reconciliation', requirePermission: { module: 'M-05', action: 'Read' } },
      { title: 'IOMS Reports & Export', icon: BarChart3, href: '/reports/ioms', requirePermission: { module: 'M-05', action: 'Read' } },
    ]
  },
  {
    group: 'Vouchers (IOMS M-06)',
    items: [
      { title: 'Payment Vouchers', icon: Banknote, href: '/vouchers', requirePermission: { module: 'M-06', action: 'Read' } },
      { title: 'Monthly statement', icon: CalendarDays, href: '/vouchers/monthly-statement', requirePermission: { module: 'M-06', action: 'Read' } },
      { title: 'Create voucher', icon: PlusCircle, href: '/vouchers/create', requirePermission: { module: 'M-06', action: 'Create' } },
      { title: 'Advance requests', icon: Wallet, href: '/vouchers/advances', requirePermission: { module: 'M-06', action: 'Read' } },
    ]
  },
  {
    group: 'Fleet (IOMS M-07)',
    items: [
      { title: 'Vehicles', icon: Truck, href: '/fleet', requirePermission: { module: 'M-07', action: 'Read' } },
    ]
  },
  {
    group: 'Construction (IOMS M-08)',
    items: [
      { title: 'Works', icon: HardHat, href: '/construction', requirePermission: { module: 'M-08', action: 'Read' } },
      { title: 'AMC contracts', icon: FileCheck, href: '/construction/amc', requirePermission: { module: 'M-08', action: 'Read' } },
      { title: 'Land records', icon: MapPin, href: '/construction/land', requirePermission: { module: 'M-08', action: 'Read' } },
      { title: 'Fixed assets', icon: Building2, href: '/construction/fixed-assets', requirePermission: { module: 'M-08', action: 'Read' } },
    ]
  },
  {
    group: 'Correspondence (IOMS M-09)',
    items: [
      { title: 'Dak Inward', icon: Mail, href: '/correspondence/inward', requirePermission: { module: 'M-09', action: 'Read' } },
      { title: 'My pending dak', icon: Inbox, href: '/correspondence/inward/my-pending', requirePermission: { module: 'M-09', action: 'Read' } },
      { title: 'Dak escalations', icon: BellRing, href: '/correspondence/inward/escalations', requirePermission: { module: 'M-09', action: 'Read' } },
      { title: 'Inward by subject', icon: Grid3X3, href: '/correspondence/inward/subjects', requirePermission: { module: 'M-09', action: 'Read' } },
      { title: 'SLA breach report', icon: ClipboardList, href: '/correspondence/sla-report', requirePermission: { module: 'M-09', action: 'Read' } },
      { title: 'Dak Outward', icon: Send, href: '/correspondence/outward', requirePermission: { module: 'M-09', action: 'Read' } },
    ]
  },
  {
    group: 'HR (IOMS M-01)',
    items: [
      { title: 'Employees', icon: UserCircle, href: '/hr/employees', requirePermission: { module: 'M-01', action: 'Read' } },
      { title: 'Leave requests (M-01)', icon: Calendar, href: '/hr/leaves', requirePermission: { module: 'M-01', action: 'Read' } },
      { title: 'Leave opening balances', icon: CalendarDays, href: '/hr/leave-balances', requirePermission: { module: 'M-01', action: 'Read' } },
      { title: 'Claims (LTC / TA-DA)', icon: Wallet, href: '/hr/claims', requirePermission: { module: 'M-01', action: 'Read' } },
    ]
  },
  {
    group: 'Admin (IOMS)',
    adminOnly: true,
    items: [
      { title: 'Roles', icon: Shield, href: '/admin/roles' },
      { title: 'Locations', icon: MapPin, href: '/admin/locations' },
      { title: 'Config & PDF logo', icon: Settings, href: '/admin/config' },
      { title: 'Audit Log', icon: ScrollText, href: '/admin/audit' },
      { title: 'Permission matrix', icon: Grid3X3, href: '/admin/permissions' },
      { title: 'SLA config', icon: Clock, href: '/admin/sla-config' },
      { title: 'Finance mappings', icon: BookMarked, href: '/admin/finance-mappings' },
    ]
  },
];

const SIDEBAR_CONTENT_SELECTOR = '[data-sidebar="content"]';
const SIDEBAR_SCROLL_KEY = 'gapmc_sidebar_scroll';

/** Show Admin section if user has ADMIN role or any M-10 permission (from permission matrix). */
function hasAdminAccess(roles: { tier: string }[] | undefined, permissions: { module: string; action: string }[] | undefined): boolean {
  if (roles?.some((r) => r.tier === 'ADMIN')) return true;
  return Boolean(permissions?.some((p) => p.module === 'M-10'));
}

export function AppSidebar() {
  const [location] = useLocation();
  const { user, can } = useAuth();
  const isAdmin = hasAdminAccess(user?.roles, user?.permissions);
  const visibleGroups = useMemo(() => {
    return menuItems
      .filter((g) => !('adminOnly' in g && g.adminOnly) || isAdmin)
      .map((g) => ({
        ...g,
        items: g.items.filter(
          (item) => !item.requirePermission || can(item.requirePermission.module, item.requirePermission.action)
        ),
      }))
      .filter((g) => g.items.length > 0);
  }, [isAdmin, can]);

  const visibleMenuHrefs = useMemo(
    () => visibleGroups.flatMap((g) => g.items.map((i) => i.href)),
    [visibleGroups]
  );
  const activeMenuHref = useMemo(
    () => pickActiveMenuHref(location, visibleMenuHrefs),
    [location, visibleMenuHrefs]
  );

  // Save sidebar scroll position to sessionStorage (survives unmount on route change)
  useEffect(() => {
    const el = document.querySelector(SIDEBAR_CONTENT_SELECTOR);
    if (!el) return;
    const onScroll = () => {
      try {
        sessionStorage.setItem(SIDEBAR_SCROLL_KEY, String(el.scrollTop));
      } catch (_) {}
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // Restore sidebar scroll position when this sidebar mounts (after route change)
  useLayoutEffect(() => {
    const saved = (() => {
      try {
        return sessionStorage.getItem(SIDEBAR_SCROLL_KEY);
      } catch {
        return null;
      }
    })();
    if (saved === null) return;
    const top = parseInt(saved, 10);
    if (!Number.isFinite(top) || top <= 0) return;

    const el = document.querySelector(SIDEBAR_CONTENT_SELECTOR);
    if (el) {
      el.scrollTop = top;
    } else {
      // Sidebar content may not be in DOM yet; restore on next frame
      const id = requestAnimationFrame(() => {
        const el2 = document.querySelector(SIDEBAR_CONTENT_SELECTOR);
        if (el2) el2.scrollTop = top;
      });
      return () => cancelAnimationFrame(id);
    }
  }, [location]);

  return (
    <Sidebar className="border-r border-sidebar-border">
      <SidebarHeader className="p-4 border-b border-sidebar-border">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-white/10 text-white">
            <span className="text-xl font-bold">G</span>
          </div>
          <div className="flex flex-col">
            <span className="font-semibold text-sidebar-foreground flex items-center gap-1">
              <Leaf className="h-4 w-4" />
              Goa APMC
            </span>
            <span className="text-xs text-sidebar-foreground/70">Management System</span>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="px-2">
        {visibleGroups.map((group) => (
          <SidebarGroup key={group.group}>
            <SidebarGroupLabel className="text-sidebar-foreground/60 text-xs uppercase tracking-wider px-3">
              {group.group}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const isActive = item.href === activeMenuHref;
                  return (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton
                        asChild
                        isActive={isActive}
                        className="data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground"
                      >
                        <Link href={item.href} data-testid={`nav-${item.title.toLowerCase().replace(/\s+/g, '-')}`}>
                          <item.icon className="h-4 w-4" />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
    </Sidebar>
  );
}
