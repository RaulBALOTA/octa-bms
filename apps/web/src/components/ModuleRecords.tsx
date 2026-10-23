import { useMutation, useQuery } from '@tanstack/react-query';
import { RotateCcw, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { api, Paged } from '../lib/api';
import { RecordRow, useRecordCatalog, useRecordsRefresh } from '../lib/records';
import { useAuthStore } from '../stores/auth';
import { RecordActions, RecordCreateButton } from './RecordActions';
import { RecordDetails, fieldLabel, useRecordDisplay } from './RecordEditor';
import { Button, Dialog, TextInput, useToast } from './ui';

export function ModuleRecordsTable({ resource: key, onlyArchived = false }: { resource: string; onlyArchived?: boolean }) {
  const { t, i18n } = useTranslation(); const { data: catalog, error: catalogError } = useRecordCatalog(); const resource = catalog?.find((item) => item.key === key);
  const admin = useAuthStore((state) => state.me?.isSystemAdmin);
  const companyId = useAuthStore((state) => state.companyId); const display = useRecordDisplay(); const refresh = useRecordsRefresh(); const toast = useToast();
  const [page, setPage] = useState(1); const [search, setSearch] = useState(''); const [archived, setArchived] = useState(onlyArchived); const [viewing, setViewing] = useState<RecordRow | null>(null);
  useEffect(() => { setPage(1); setSearch(''); setArchived(onlyArchived); setViewing(null); }, [companyId, key, onlyArchived]);
  const records = useQuery({ queryKey: ['module-record-table', companyId, key, page, search, archived], enabled: !!admin && !!resource,
    queryFn: () => api.get<Paged<RecordRow>>(`/records/${key}${archived ? '/archived/list' : ''}?page=${page}&pageSize=25&q=${encodeURIComponent(search)}`) });
  useEffect(() => { if (records.data && page > Math.max(1, records.data.meta.totalPages)) setPage(Math.max(1, records.data.meta.totalPages)); }, [records.data, page]);
  const restore = useMutation({ mutationFn: (id: string) => api.post(`/records/${key}/${encodeURIComponent(id)}/restore`),
    onSuccess: async () => { await refresh(); toast(t('data.restored')); }, onError: (error: Error) => toast(error.message, 'error') });
  if (!admin) return null;
  if (catalogError) return <p role="alert" className="text-sm text-destructive">{catalogError.message}</p>;
  if (!resource) return <p className="text-sm text-muted-foreground">{t('common.loading')}</p>;
  return <section aria-label={resource.name[i18n.language === 'de' ? 'de' : 'en']} className="space-y-3">
    <div className="flex flex-wrap items-center gap-3">
      <h3 className="text-sm font-semibold">{resource.name[i18n.language === 'de' ? 'de' : 'en']}</h3>
      <div className="relative min-w-40 flex-1"><Search size={13} className="absolute left-2 top-2 text-muted-foreground" /><TextInput type="search" className="pl-7" aria-label={t('data.searchRecords')} placeholder={t('common.searchShort')} value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} /></div>
      {resource.canArchive && !onlyArchived && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={archived} onChange={(event) => { setArchived(event.target.checked); setPage(1); }} />{t('data.archived')}</label>}
      {!onlyArchived && <RecordCreateButton resource={key} />}
    </div>
    {records.error && <p role="alert" className="text-sm text-destructive">{records.error.message}</p>}
    <div className="overflow-x-auto rounded-lg border border-border bg-card"><table className="w-full text-sm"><thead><tr className="border-b border-border text-left">
      {resource.columns.map((column) => <th className="px-3 py-2 font-medium" key={column}>{fieldLabel(t, column)}</th>)}<th className="sticky right-0 bg-card px-3 py-2 text-right font-medium">{t('common.actions')}</th>
    </tr></thead><tbody>{records.data?.data.map((row) => <tr key={row._key} className="border-b border-border last:border-0">
      {resource.columns.map((column) => <td key={column} className="max-w-xs truncate px-3 py-2">{display(row, resource.fields.find((field) => field.name === column)!)}</td>)}
      <td className="sticky right-0 bg-card px-3 py-2">{archived ? <div className="flex justify-end gap-1"><Button size="sm" variant="ghost" aria-label={t('data.viewNamed', { name: row._label })} onClick={() => setViewing(row)}>{t('common.view')}</Button><Button size="sm" variant="secondary" disabled={restore.isPending} aria-label={t('data.restoreNamed', { name: row._label })} onClick={() => restore.mutate(row._key)}><RotateCcw size={12} />{t('data.restore')}</Button></div>
        : <RecordActions resource={key} id={row._key} label={row._label} />}</td>
    </tr>)}{!records.data?.data.length && <tr><td colSpan={resource.columns.length + 1} className="p-5 text-center text-muted-foreground">{t(records.isLoading ? 'common.loading' : 'common.noResults')}</td></tr>}</tbody></table></div>
    {records.data && <div className="flex items-center justify-between text-xs text-muted-foreground"><span>{t('common.total')}: {records.data.meta.total}</span><div className="flex items-center gap-2"><Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t('documents.previousPage')}</Button><span>{t('documents.pageOf', { page, total: records.data.meta.totalPages || 1 })}</span><Button size="sm" variant="secondary" disabled={page >= records.data.meta.totalPages} onClick={() => setPage(page + 1)}>{t('documents.nextPage')}</Button></div></div>}
    {viewing && createPortal(<Dialog open onClose={() => setViewing(null)} title={viewing._label} width="max-w-4xl"><RecordDetails resource={resource} record={viewing} /></Dialog>, document.body)}
  </section>;
}

export function ModuleRelatedRecords({ resources }: { resources: string[] }) {
  const { t, i18n } = useTranslation(); const admin = useAuthStore((state) => state.me?.isSystemAdmin); const { data: catalog } = useRecordCatalog();
  const [open, setOpen] = useState<string | null>(null); const companyId = useAuthStore((state) => state.companyId);
  useEffect(() => { setOpen(null); }, [companyId]);
  if (!admin || !catalog) return null;
  return <section aria-label={t('data.relatedRecords')} className="mt-5 space-y-2 border-t border-border pt-4">
    <h2 className="text-sm font-semibold">{t('data.relatedRecords')}</h2>
    <div className="flex flex-wrap gap-2">{resources.map((key) => { const resource = catalog.find((item) => item.key === key); return resource && <Button key={key} size="sm" variant={open === key ? 'secondary' : 'ghost'} aria-expanded={open === key} onClick={() => setOpen(open === key ? null : key)}>{resource.name[i18n.language === 'de' ? 'de' : 'en']}</Button>; })}</div>
    {open && <ModuleRecordsTable key={`${companyId}-${open}`} resource={open} />}
  </section>;
}

export function ArchivedRecordsButton({ resource: key, named = false }: { resource: string; named?: boolean }) {
  const { t, i18n } = useTranslation(); const { data: catalog } = useRecordCatalog(); const companyId = useAuthStore((state) => state.companyId); const [open, setOpen] = useState(false);
  const admin = useAuthStore((state) => state.me?.isSystemAdmin);
  useEffect(() => { setOpen(false); }, [companyId, key]);
  const resource = catalog?.find((item) => item.key === key);
  if (!admin || !resource?.canArchive) return null;
  const label = named ? t('data.archivedNamed', { name: resource.name[i18n.language === 'de' ? 'de' : 'en'] }) : t('data.archived');
  return <><Button size="sm" variant="ghost" onClick={() => setOpen(true)}>{label}</Button>{open && createPortal(<Dialog open onClose={() => setOpen(false)} title={label} width="max-w-6xl"><ModuleRecordsTable resource={key} onlyArchived /></Dialog>, document.body)}</>;
}
