import {
  BarChart3,
  Briefcase,
  Building2,
  FileText,
  FolderOpen,
  Home,
  Landmark,
  Lightbulb,
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
  { key: 'corporate', path: '/corporate', icon: Building2 },
  { key: 'crm', path: '/crm/partners', icon: Users, implemented: true },
  { key: 'sales', path: '/sales/pipeline', icon: Briefcase, implemented: true },
  { key: 'contracts', path: '/contracts', icon: FileText, implemented: true },
  { key: 'finance', path: '/finance/invoices', icon: Wallet, implemented: true },
  { key: 'hr', path: '/hr/employees', icon: Landmark, implemented: true },
  { key: 'legal', path: '/legal', icon: Scale },
  { key: 'procurement', path: '/procurement', icon: ShoppingCart },
  { key: 'assets', path: '/assets', icon: Monitor, implemented: true },
  { key: 'knowledge', path: '/knowledge', icon: Lightbulb },
  { key: 'documents', path: '/documents', icon: FolderOpen },
  { key: 'workflow', path: '/workflow', icon: Workflow },
  { key: 'bi', path: '/bi', icon: BarChart3 },
  { key: 'admin', path: '/admin', icon: Settings, implemented: true },
];
