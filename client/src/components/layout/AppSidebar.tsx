import { useLayoutEffect, useEffect } from 'react';
import { useLocation, Link } from 'wouter';
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
} from 'lucide-react';

const menuItems = [
  {
    group: 'Dashboard',
    items: [
      { title: 'Dashboard', icon: LayoutDashboard, href: '/dashboard' },
    ]
  },
  {
    group: 'Rent & Tax',
    items: [
      { title: 'Invoices', icon: FileText, href: '/rent' },
      { title: 'Reports', icon: BarChart3, href: '/rent/reports' },
    ]
  },
  {
    group: 'Traders',
    items: [
      { title: 'Trader Directory', icon: Users, href: '/traders' },
      { title: 'Agreements', icon: FileSignature, href: '/traders/agreements' },
    ]
  },
  {
    group: 'Market Fee',
    items: [
      { title: 'Fee Collection', icon: Wallet, href: '/market-fee' },
      { title: 'Import/Export', icon: ArrowLeftRight, href: '/market-fee/entry' },
      { title: 'Returns', icon: ClipboardList, href: '/market-fee/returns' },
    ]
  },
  {
    group: 'Receipts',
    items: [
      { title: 'All Receipts', icon: Receipt, href: '/receipts' },
      { title: 'Create Receipt', icon: PlusCircle, href: '/receipts/new' },
      { title: 'Ledger Reports', icon: BookOpen, href: '/receipts/ledger' },
    ]
  },
];

const SIDEBAR_CONTENT_SELECTOR = '[data-sidebar="content"]';
const SIDEBAR_SCROLL_KEY = 'gapmc_sidebar_scroll';

export function AppSidebar() {
  const [location] = useLocation();

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
        {menuItems.map((group) => (
          <SidebarGroup key={group.group}>
            <SidebarGroupLabel className="text-sidebar-foreground/60 text-xs uppercase tracking-wider px-3">
              {group.group}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const isActive = location === item.href || 
                    (item.href !== '/dashboard' && location.startsWith(item.href));
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
