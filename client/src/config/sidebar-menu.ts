import type { LucideIcon } from "lucide-react";
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
  Landmark,
  FileSpreadsheet,
  Mail,
  Inbox,
  BellRing,
  Calendar,
  CalendarDays,
  Send,
  Grid3X3,
  PanelLeft,
  Clock,
  KeyRound,
  ShieldAlert,
  Bug,
  BookMarked,
  Ruler,
  Briefcase,
  Mic,
} from "lucide-react";

export type SidebarMenuPermission = { module: string; action: "Read" | "Create" | "Update" | "Delete" };

export type SidebarMenuItem = {
  title: string;
  icon: LucideIcon;
  href: string;
  requirePermission?: SidebarMenuPermission;
};

export type SidebarMenuGroup = {
  group: string;
  adminOnly?: boolean;
  items: SidebarMenuItem[];
};

export const SIDEBAR_MENU_GROUPS: SidebarMenuGroup[] = [
  {
    group: "Dashboard",
    items: [{ title: "Dashboard", icon: LayoutDashboard, href: "/dashboard" }],
  },
  {
    group: "Support",
    items: [
      { title: "Bugs", icon: Bug, href: "/bugs" },
      { title: "Bug dashboard", icon: LayoutDashboard, href: "/bugs/dashboard" },
    ],
  },
  {
    group: "Rent & Tax",
    items: [
      { title: "Invoices", icon: FileText, href: "/rent/ioms", requirePermission: { module: "M-03", action: "Read" } },
      { title: "Reports", icon: BarChart3, href: "/rent/reports", requirePermission: { module: "M-03", action: "Read" } },
      { title: "Legacy rent invoices", icon: FileText, href: "/rent/legacy", requirePermission: { module: "M-03", action: "Read" } },
      { title: "Credit Notes (M-03)", icon: StickyNote, href: "/rent/ioms/credit-notes", requirePermission: { module: "M-03", action: "Read" } },
      { title: "Rent deposit ledger", icon: BookOpen, href: "/rent/ioms/ledger", requirePermission: { module: "M-03", action: "Read" } },
      { title: "Rent revisions", icon: CalendarDays, href: "/rent/ioms/revisions", requirePermission: { module: "M-03", action: "Read" } },
    ],
  },
  {
    group: "Traders",
    items: [
      { title: "Agreements", icon: FileSignature, href: "/traders/agreements", requirePermission: { module: "M-02", action: "Read" } },
      { title: "Licences (IOMS M-02)", icon: FileCheck, href: "/traders/licences", requirePermission: { module: "M-02", action: "Read" } },
      { title: "Functionary registrations (BM)", icon: FileCheck, href: "/traders/functionaries", requirePermission: { module: "M-02", action: "Read" } },
      { title: "Entities (Track B)", icon: Building2, href: "/traders/entities", requirePermission: { module: "M-02", action: "Read" } },
      { title: "Unified entities", icon: Building2, href: "/traders/unified-entities", requirePermission: { module: "M-02", action: "Read" } },
      { title: "Pre-receipts (Govt)", icon: FileText, href: "/traders/pre-receipts", requirePermission: { module: "M-02", action: "Read" } },
      { title: "Outstanding dues", icon: Wallet, href: "/traders/dues", requirePermission: { module: "M-02", action: "Read" } },
      { title: "Blocking log", icon: ShieldAlert, href: "/traders/blocking-log", requirePermission: { module: "M-02", action: "Read" } },
    ],
  },
  {
    group: "Assets (IOMS M-02)",
    items: [
      { title: "Premises Register", icon: Building2, href: "/assets", requirePermission: { module: "M-02", action: "Read" } },
      { title: "Premises Master Report", icon: FileSpreadsheet, href: "/assets/premises-master-report", requirePermission: { module: "M-02", action: "Read" } },
      { title: "Premises Master Registration", icon: PlusCircle, href: "/assets/new", requirePermission: { module: "M-02", action: "Create" } },
      { title: "Shop Allotments", icon: KeyRound, href: "/assets/allotments", requirePermission: { module: "M-02", action: "Read" } },
    ],
  },
  {
    group: "Market Fee",
    items: [
      { title: "Fee Collection", icon: Wallet, href: "/market-fee", requirePermission: { module: "M-04", action: "Read" } },
      { title: "Import/Export", icon: ArrowLeftRight, href: "/market-fee/entry", requirePermission: { module: "M-04", action: "Read" } },
      { title: "Returns", icon: ClipboardList, href: "/market-fee/returns", requirePermission: { module: "M-04", action: "Read" } },
      { title: "Monthly returns (M-04)", icon: ClipboardList, href: "/market/returns", requirePermission: { module: "M-04", action: "Read" } },
      { title: "Fee statement (M-04)", icon: Banknote, href: "/market/fee-statement", requirePermission: { module: "M-04", action: "Read" } },
      { title: "Reports (M-04)", icon: BarChart3, href: "/market/reports", requirePermission: { module: "M-04", action: "Read" } },
      { title: "Daily prices (M-04)", icon: BarChart3, href: "/market/daily-prices", requirePermission: { module: "M-04", action: "Read" } },
      { title: "Advance ledger (M-04)", icon: Wallet, href: "/market/advance-ledger", requirePermission: { module: "M-04", action: "Read" } },
      { title: "Commodity reports (M-04)", icon: BarChart3, href: "/market/commodity-reports", requirePermission: { module: "M-04", action: "Read" } },
      { title: "Trader Transaction Report", icon: BarChart3, href: "/market/trader-transaction-report", requirePermission: { module: "M-04", action: "Read" } },
      { title: "AI calling / voice sessions", icon: Mic, href: "/market/voice-sessions", requirePermission: { module: "M-04", action: "Read" } },
      { title: "AI calling sample scripts", icon: BookOpen, href: "/market/voice-transcript-script", requirePermission: { module: "M-04", action: "Read" } },
      { title: "Commodities (M-04)", icon: Package, href: "/market/commodities", requirePermission: { module: "M-04", action: "Read" } },
      { title: "Fee rates (M-04)", icon: Percent, href: "/market/fee-rates", requirePermission: { module: "M-04", action: "Read" } },
      { title: "Farmers (M-04)", icon: Users, href: "/market/farmers", requirePermission: { module: "M-04", action: "Read" } },
      { title: "Transactions (M-04)", icon: ArrowRightLeft, href: "/market/transactions", requirePermission: { module: "M-04", action: "Read" } },
      { title: "New transaction wizard", icon: PlusCircle, href: "/market/transactions/new", requirePermission: { module: "M-04", action: "Create" } },
      { title: "MSP settings (M-02)", icon: Percent, href: "/market/msp", requirePermission: { module: "M-02", action: "Read" } },
    ],
  },
  {
    group: "Check Post (IOMS M-04)",
    items: [
      { title: "Inward", icon: LogIn, href: "/checkpost/inward", requirePermission: { module: "M-04", action: "Read" } },
      { title: "Outward", icon: Send, href: "/checkpost/outward", requirePermission: { module: "M-04", action: "Read" } },
      { title: "Stock returns", icon: ArrowLeftRight, href: "/checkpost/stock-returns", requirePermission: { module: "M-04", action: "Read" } },
      { title: "Exit permits", icon: FileCheck, href: "/checkpost/exit-permits", requirePermission: { module: "M-04", action: "Read" } },
      { title: "Bank deposits", icon: Banknote, href: "/checkpost/bank-deposits", requirePermission: { module: "M-04", action: "Read" } },
    ],
  },
  {
    group: "Receipts",
    items: [
      { title: "All Receipts", icon: Receipt, href: "/receipts", requirePermission: { module: "M-05", action: "Read" } },
      { title: "Create receipt (IOMS)", icon: PlusCircle, href: "/receipts/ioms/new", requirePermission: { module: "M-05", action: "Create" } },
      { title: "Create receipt (legacy)", icon: PlusCircle, href: "/receipts/new", requirePermission: { module: "M-05", action: "Create" } },
      { title: "Ledger Reports", icon: BookOpen, href: "/receipts/ledger", requirePermission: { module: "M-05", action: "Read" } },
      { title: "IOMS Receipts (M-05)", icon: Receipt, href: "/receipts/ioms", requirePermission: { module: "M-05", action: "Read" } },
      { title: "Cash-in-hand", icon: Wallet, href: "/receipts/ioms/cash-in-hand", requirePermission: { module: "M-05", action: "Read" } },
      { title: "Record deposit", icon: Landmark, href: "/receipts/ioms/deposit-entry", requirePermission: { module: "M-05", action: "Create" } },
      { title: "Deposit register", icon: Landmark, href: "/receipts/ioms/deposits", requirePermission: { module: "M-05", action: "Read" } },
      { title: "Receipt reconciliation", icon: FileSignature, href: "/receipts/ioms/reconciliation", requirePermission: { module: "M-05", action: "Read" } },
      { title: "IOMS Reports & Export", icon: BarChart3, href: "/reports/ioms", requirePermission: { module: "M-05", action: "Read" } },
    ],
  },
  {
    group: "Vouchers (IOMS M-06)",
    items: [
      { title: "Payment Vouchers", icon: Banknote, href: "/vouchers", requirePermission: { module: "M-06", action: "Read" } },
      { title: "Monthly statement", icon: CalendarDays, href: "/vouchers/monthly-statement", requirePermission: { module: "M-06", action: "Read" } },
      { title: "Create voucher", icon: PlusCircle, href: "/vouchers/create", requirePermission: { module: "M-06", action: "Create" } },
      { title: "Advance requests", icon: Wallet, href: "/vouchers/advances", requirePermission: { module: "M-06", action: "Read" } },
    ],
  },
  {
    group: "Fleet (IOMS M-07)",
    items: [
      { title: "Vehicles", icon: Truck, href: "/fleet", requirePermission: { module: "M-07", action: "Read" } },
      { title: "Reports", icon: BarChart3, href: "/fleet/reports", requirePermission: { module: "M-07", action: "Read" } },
    ],
  },
  {
    group: "Construction (IOMS M-08)",
    items: [
      { title: "Works", icon: HardHat, href: "/construction", requirePermission: { module: "M-08", action: "Read" } },
      { title: "Vendors", icon: Building2, href: "/construction/vendors", requirePermission: { module: "M-08", action: "Read" } },
      { title: "Works TDS report", icon: FileSpreadsheet, href: "/construction/tds-report", requirePermission: { module: "M-08", action: "Read" } },
      { title: "AMC contracts", icon: FileCheck, href: "/construction/amc", requirePermission: { module: "M-08", action: "Read" } },
      { title: "Land records", icon: MapPin, href: "/construction/land", requirePermission: { module: "M-08", action: "Read" } },
      { title: "Fixed assets", icon: Building2, href: "/construction/fixed-assets", requirePermission: { module: "M-08", action: "Read" } },
    ],
  },
  {
    group: "Correspondence (IOMS M-09)",
    items: [
      { title: "Tapal Inward", icon: Mail, href: "/correspondence/inward", requirePermission: { module: "M-09", action: "Read" } },
      { title: "My pending tapal", icon: Inbox, href: "/correspondence/inward/my-pending", requirePermission: { module: "M-09", action: "Read" } },
      { title: "Tapal escalations", icon: BellRing, href: "/correspondence/inward/escalations", requirePermission: { module: "M-09", action: "Read" } },
      { title: "Inward by subject", icon: Grid3X3, href: "/correspondence/inward/subjects", requirePermission: { module: "M-09", action: "Read" } },
      { title: "SLA breach report", icon: ClipboardList, href: "/correspondence/sla-report", requirePermission: { module: "M-09", action: "Read" } },
      { title: "Tapal Outward", icon: Send, href: "/correspondence/outward", requirePermission: { module: "M-09", action: "Read" } },
    ],
  },
  {
    group: "HR (IOMS M-01)",
    items: [
      { title: "Employees", icon: UserCircle, href: "/hr/employees", requirePermission: { module: "M-01", action: "Read" } },
      { title: "Designation master", icon: Briefcase, href: "/hr/designations", requirePermission: { module: "M-01", action: "Read" } },
      { title: "Leave requests (M-01)", icon: Calendar, href: "/hr/leaves", requirePermission: { module: "M-01", action: "Read" } },
      { title: "Leave opening balances", icon: CalendarDays, href: "/hr/leave-balances", requirePermission: { module: "M-01", action: "Read" } },
      { title: "Import leave balances", icon: CalendarDays, href: "/hr/leave-balances/import", requirePermission: { module: "M-01", action: "Update" } },
      { title: "Holiday calendar", icon: Calendar, href: "/hr/holiday-calendar", requirePermission: { module: "M-01", action: "Read" } },
      { title: "Claims (LTC / TA-DA)", icon: Wallet, href: "/hr/claims", requirePermission: { module: "M-01", action: "Read" } },
    ],
  },
  {
    group: "Admin (IOMS)",
    adminOnly: true,
    items: [
      { title: "Roles", icon: Shield, href: "/admin/roles" },
      { title: "Locations", icon: MapPin, href: "/admin/locations" },
      { title: "Config & PDF logo", icon: Settings, href: "/admin/config" },
      { title: "Sidebar menu visibility", icon: PanelLeft, href: "/admin/sidebar-menu" },
      { title: "Audit Log", icon: ScrollText, href: "/admin/audit" },
      { title: "Permission matrix", icon: Grid3X3, href: "/admin/permissions" },
      { title: "SLA config", icon: Clock, href: "/admin/sla-config" },
      { title: "Finance mappings", icon: BookMarked, href: "/admin/finance-mappings" },
      { title: "Bank accounts (M-05)", icon: Landmark, href: "/admin/bank-accounts" },
      { title: "Units master", icon: Ruler, href: "/admin/units" },
    ],
  },
];