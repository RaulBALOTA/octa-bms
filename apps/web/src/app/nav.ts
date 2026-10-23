import {
  BarChart3,
  Briefcase,
  Gauge,
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

export interface NavItem {
  key: string; // i18n key under nav.*
  path: string;
  icon: LucideIcon;
  implemented?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { key: 'home', path: '/', icon: Home, implemented: true },
  { key: 'corporate', path: '/corporate', icon: Building2, implemented: true },
  { key: 'companyCalendar', path: '/company-calendar', icon: CalendarDays, implemented: true },
  { key: 'crm', path: '/crm/partners', icon: Users, implemented: true },
  { key: 'sales', path: '/sales/pipeline', icon: Briefcase, implemented: true },
  { key: 'contracts', path: '/contracts', icon: FileText, implemented: true },
  { key: 'finance', path: '/finance/invoices', icon: Wallet, implemented: true },
  { key: 'hr', path: '/hr/employees', icon: Landmark, implemented: true },
  { key: 'legal', path: '/legal', icon: Scale, implemented: true },
  { key: 'procurement', path: '/procurement', icon: ShoppingCart, implemented: true },
  { key: 'assets', path: '/assets', icon: Monitor, implemented: true },
  { key: 'knowledge', path: '/knowledge', icon: Lightbulb, implemented: true },
  { key: 'documents', path: '/documents', icon: FolderOpen, implemented: true },
  { key: 'communication', path: '/communication', icon: MessageSquare, implemented: true },
  { key: 'workflow', path: '/workflow', icon: Workflow, implemented: true },
  { key: 'engine', path: '/engine', icon: Gauge, implemented: true },
  { key: 'bi', path: '/bi', icon: BarChart3, implemented: true },
  { key: 'admin', path: '/admin', icon: Settings, implemented: true },
];
