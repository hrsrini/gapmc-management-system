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
  SidebarFooter,
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
  PanelLeftClose
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSidebar } from '@/components/ui/sidebar';

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

export function AppSidebar() {
  const [location] = useLocation();
  const { toggleSidebar } = useSidebar();

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

      <SidebarFooter className="p-4 border-t border-sidebar-border">
        <Button
          variant="ghost"
          size="sm"
          onClick={toggleSidebar}
          className="w-full justify-start text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent"
          data-testid="button-collapse-sidebar"
        >
          <PanelLeftClose className="h-4 w-4 mr-2" />
          <span>Collapse</span>
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
