/**
 * Permission code catalog — single source of truth.
 * Codes follow `module.resource.action`; the API seed generates the
 * permissions table from the same structure (apps/api/prisma/seed.ts).
 */
export const PERMISSION_MODULES = {
  calendar: ['items'],
  corporate: ['dashboard', 'goals', 'announcements'],
  crm: ['partners', 'contacts', 'activities'],
  sales: ['opportunities', 'proposals', 'gonogo'],
  contracts: ['contracts', 'guarantees', 'insurance'],
  finance: ['invoices', 'payments', 'budgets', 'datev'],
  hr: ['employees', 'leave', 'recruitment', 'reviews', 'trainings'],
  legal: ['cases', 'gdpr', 'compliance', 'whistleblower'],
  procurement: ['requests', 'orders', 'evaluations'],
  assets: ['assets', 'licenses'],
  knowledge: ['articles'],
  documents: ['documents', 'folders'],
  workflow: ['definitions', 'tasks'],
  bi: ['dashboards', 'reports'],
  identity: ['users', 'roles', 'groups', 'apikeys'],
  admin: ['masterdata', 'audit', 'settings'],
  engine: ['services', 'resources', 'portfolio', 'economics', 'scenarios', 'optimization', 'intelligence', 'settings'],
} as const;

export const PERMISSION_ACTIONS = [
  'read', 'create', 'update', 'delete', 'approve', 'export',
] as const;

export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

export function permissionCode(
  module: keyof typeof PERMISSION_MODULES,
  resource: string,
  action: PermissionAction,
): string {
  return `${module}.${resource}.${action}`;
}
