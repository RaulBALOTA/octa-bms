import {
  BarChart3,
  Briefcase,
  Building2,
  CalendarDays,
  FileText,
  FolderOpen,
  Home,
  Landmark,
  Lightbulb,
  MessageSquare,
  Monitor,
  Scale,
  Settings,
  ShoppingCart,
  Users,
  Wallet,
  Workflow,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type NavGroup = 'overview' | 'commercial' | 'finance' | 'people' | 'workspace' | 'insights';

export interface NavItem {
  key: string; // i18n key under nav.*
  path: string;
  icon: LucideIcon;
  group: NavGroup; // i18n key under shell.groups.*
  implemented?: boolean;
}

export const NAV_GROUPS: NavGroup[] = ['overview', 'commercial', 'finance', 'people', 'workspace', 'insights'];

export const NAV_ITEMS: NavItem[] = [
  { key: 'home', group: 'overview', path: '/', icon: Home, implemented: true },
  { key: 'corporate', group: 'overview', path: '/corporate', icon: Building2, implemented: true },
  { key: 'companyCalendar', group: 'overview', path: '/company-calendar', icon: CalendarDays, implemented: true },
  { key: 'crm', group: 'commercial', path: '/crm/partners', icon: Users, implemented: true },
  { key: 'sales', group: 'commercial', path: '/sales/pipeline', icon: Briefcase, implemented: true },
  { key: 'contracts', group: 'commercial', path: '/contracts', icon: FileText, implemented: true },
  { key: 'finance', group: 'finance', path: '/finance/invoices', icon: Wallet, implemented: true },
  { key: 'hr', group: 'people', path: '/hr/employees', icon: Landmark, implemented: true },
  { key: 'legal', group: 'finance', path: '/legal', icon: Scale, implemented: true },
  { key: 'procurement', group: 'finance', path: '/procurement', icon: ShoppingCart, implemented: true },
  { key: 'assets', group: 'people', path: '/assets', icon: Monitor, implemented: true },
  { key: 'knowledge', group: 'workspace', path: '/knowledge', icon: Lightbulb, implemented: true },
  { key: 'documents', group: 'workspace', path: '/documents', icon: FolderOpen, implemented: true },
  { key: 'communication', group: 'workspace', path: '/communication', icon: MessageSquare, implemented: true },
  { key: 'workflow', group: 'workspace', path: '/workflow', icon: Workflow, implemented: true },
  { key: 'bi', group: 'insights', path: '/bi', icon: BarChart3, implemented: true },
  { key: 'admin', group: 'insights', path: '/admin', icon: Settings, implemented: true },
];

/** The top-level module a route belongs to (longest matching section). */
export function navItemFor(pathname: string): NavItem | undefined {
  const section = (path: string) => '/' + path.split('/').filter(Boolean)[0];
  if (pathname === '/') return NAV_ITEMS[0];
  return (
    NAV_ITEMS.find((item) => item.path === pathname) ??
    NAV_ITEMS.find((item) => item.path !== '/' && section(item.path) === section(pathname))
  );
}
