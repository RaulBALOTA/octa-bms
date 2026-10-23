import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { useAuthStore } from '../stores/auth';

export interface RecordField {
  name: string; type: string; required: boolean; nullable: boolean; readOnly: boolean; createOnly?: boolean;
  default?: unknown; values?: string[]; reference?: { model: string; key: string }; list?: boolean; fields?: RecordField[];
}
export interface Resource {
  key: string; module: string; name: { en: string; de: string }; fields: RecordField[]; columns: string[];
  native?: string; createNative: boolean; companyScoped: boolean; canArchive: boolean; deleteAction: 'delete' | 'reverse';
}
export interface RecordRow extends Record<string, unknown> {
  _key: string; _label: string; _references?: Record<string, string | null>; _referenceLists?: Record<string, (string | null)[]>;
}
export function useRecordCatalog() {
  const admin = useAuthStore((state) => state.me?.isSystemAdmin);
  return useQuery({ queryKey: ['record-catalog'], enabled: !!admin, queryFn: async () => {
    const result = await api.get<Resource[]>('/records/catalog');
    if (!Array.isArray(result)) throw new Error('Could not load record forms');
    return result;
  } });
}
export function useRecordsRefresh() {
  const queryClient = useQueryClient(); const loadMe = useAuthStore((state) => state.loadMe);
  return async () => { await Promise.allSettled([loadMe(), queryClient.invalidateQueries()]); };
}
export const ENDPOINT_RESOURCES: Record<string, string> = {
  '/crm/partners': 'partners', '/hr/employees': 'employees', '/assets': 'assets', '/contracts': 'contracts',
  '/finance/invoices': 'invoices', '/finance/payments': 'payments', '/hr/leave-requests': 'leave',
  '/legal/cases': 'cases', '/legal/compliance-items': 'compliance', '/procurement/requests': 'requests',
};
export function recordLabel(row: { id: string } & object): string {
  const values = row as Record<string, unknown>;
  if (values.firstName || values.lastName) return [values.firstName, values.lastName].filter(Boolean).join(' ');
  for (const name of ['name','title','subject','invoiceNumber','contractNumber','requestNumber','assetNumber','reference','email']) {
    if (typeof values[name] === 'string' && values[name]) return values[name] as string;
  }
  return [values.firstName, values.lastName].filter(Boolean).join(' ') || row.id;
}
