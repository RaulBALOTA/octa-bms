import { useMutation, useQuery } from '@tanstack/react-query';
import { Eye, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { RecordRow, Resource, useRecordCatalog, useRecordsRefresh } from '../lib/records';
import { useAuthStore } from '../stores/auth';
import { RecordDetails, RecordEditor } from './RecordEditor';
import { Button, Dialog, useToast } from './ui';

type Action = 'view' | 'edit' | 'delete';
export function RecordActions({ resource: key, id, label, actions = ['view','edit','delete'], onDeleted }: {
  resource: string; id: string; label: string; actions?: Action[]; onDeleted?: () => void;
}) {
  const { t } = useTranslation(); const { data: catalog } = useRecordCatalog(); const refresh = useRecordsRefresh(); const toast = useToast();
  const companyId = useAuthStore((state) => state.companyId); const admin = useAuthStore((state) => state.me?.isSystemAdmin);
  const [action, setAction] = useState<Action | null>(null); const resource = catalog?.find((item) => item.key === key);
  useEffect(() => { setAction(null); }, [companyId, key, id]);
  const record = useQuery({ queryKey: ['module-record', companyId, key, id], enabled: !!admin && !!resource && action !== null && action !== 'delete',
    staleTime: 0, queryFn: () => api.get<RecordRow>(`/records/${key}/${encodeURIComponent(id)}`) });
  const remove = useMutation({ mutationFn: () => api.delete(`/records/${key}/${encodeURIComponent(id)}`),
    onSuccess: async () => { await refresh(); setAction(null); onDeleted?.(); toast(t(resource?.deleteAction === 'reverse' ? 'data.reversed' : 'common.deleted')); } });
  if (!admin || !resource) return null;
  const close = () => { if (!remove.isPending) setAction(null); };
  return <div className="flex flex-wrap justify-end gap-1" onClick={(event) => event.stopPropagation()} onDragStart={(event) => { event.preventDefault(); event.stopPropagation(); }}>
    {actions.includes('view') && <Button size="sm" variant="ghost" aria-label={t('data.viewNamed', { name: label })} onClick={() => setAction('view')}><Eye size={12} />{t('common.view')}</Button>}
    {actions.includes('edit') && <Button size="sm" variant="secondary" aria-label={t('data.editNamed', { name: label })} onClick={() => setAction('edit')}><Pencil size={12} />{t('common.edit')}</Button>}
    {actions.includes('delete') && <Button size="sm" variant="ghost" className="text-destructive" aria-label={t(resource.deleteAction === 'reverse' ? 'data.reverseNamed' : 'data.deleteNamed', { name: label })} onClick={() => { remove.reset(); setAction('delete'); }}><Trash2 size={12} />{t(resource.deleteAction === 'reverse' ? 'data.reverse' : 'common.delete')}</Button>}
    {action && createPortal(action === 'edit' && record.data && !record.isFetching ? <RecordEditor key={`${companyId}-${key}-${id}-${record.dataUpdatedAt}`} resource={{ ...resource, native: undefined }} record={record.data} onClose={close}
      onSaved={async () => { await refresh(); toast(t('common.saved')); }} /> : <Dialog open onClose={close} title={action === 'delete' ? t(resource.deleteAction === 'reverse' ? 'data.reverse' : 'common.delete') : label} width="max-w-4xl">
      {action === 'delete' ? <>
        <p className="mb-3 text-sm">{t(resource.deleteAction === 'reverse' ? 'data.reverseConfirm' : resource.canArchive ? 'data.deleteConfirm' : 'data.deletePermanentConfirm', { count: 1 })}</p>
        <p className="mb-3 break-words text-sm font-medium">{label}</p>
        {remove.error && <p role="alert" className="mb-3 text-sm text-destructive">{remove.error.message}</p>}
        <div className="flex justify-end gap-2"><Button variant="secondary" disabled={remove.isPending} onClick={close}>{t('common.cancel')}</Button><Button variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate()}>{t(remove.isPending ? 'common.loading' : resource.deleteAction === 'reverse' ? 'data.reverse' : 'common.delete')}</Button></div>
      </> : record.error ? <p role="alert" className="text-sm text-destructive">{record.error.message}</p> : record.isFetching || !record.data ? <p>{t('common.loading')}</p> : <RecordDetails resource={resource} record={record.data} />}
    </Dialog>, document.body)}
  </div>;
}

export function RecordCreateButton({ resource: key, defaults, label }: { resource: string; defaults?: Record<string, unknown>; label?: string }) {
  const { t } = useTranslation(); const { data: catalog } = useRecordCatalog(); const refresh = useRecordsRefresh(); const toast = useToast();
  const companyId = useAuthStore((state) => state.companyId); const admin = useAuthStore((state) => state.me?.isSystemAdmin); const [open, setOpen] = useState(false);
  const resource = catalog?.find((item) => item.key === key);
  useEffect(() => { setOpen(false); }, [companyId, key]);
  if (!admin || !resource || resource.createNative) return null;
  const configured: Resource = { ...resource, native: undefined, fields: resource.fields.map((field) => defaults && field.name in defaults ? { ...field, default: defaults[field.name] } : field) };
  return <><Button size="sm" onClick={() => setOpen(true)}><Plus size={12} />{label ?? t('common.new')}</Button>{open && createPortal(<RecordEditor resource={configured} onClose={() => setOpen(false)} onSaved={async () => { await refresh(); toast(t('common.created')); }} />, document.body)}</>;
}
