import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Database, Pencil, Plus, RotateCcw, Search, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { api, Paged } from '../lib/api';
import { useAuthStore } from '../stores/auth';
import { RecordRow, Resource } from '../lib/records';
import { RecordDetails, RecordEditor, fieldLabel, useRecordDisplay } from '../components/RecordEditor';
import { Button, Dialog, Field, SelectInput, TextInput, useToast } from '../components/ui';

export function DataManagementPage() {
  const { t, i18n } = useTranslation(); const toast = useToast(); const queryClient = useQueryClient();
  const me = useAuthStore((state) => state.me); const companyId = useAuthStore((state) => state.companyId); const loadMe = useAuthStore((state) => state.loadMe);
  const [params, setParams] = useSearchParams(); const module = params.get('module') ?? 'all'; const key = params.get('resource') ?? '';
  const [page, setPage] = useState(1); const [search, setSearch] = useState(''); const [archived, setArchived] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set()); const [editor, setEditor] = useState<{ record?: RecordRow } | null>(null);
  const [viewing, setViewing] = useState<RecordRow | null>(null); const [deleting, setDeleting] = useState<RecordRow[] | null>(null);
  const { data: catalog = [], error: catalogError } = useQuery({ queryKey: ['record-catalog'], queryFn: () => api.get<Resource[]>('/records/catalog'), enabled: !!me?.isSystemAdmin });
  const available = catalog.filter((item) => module === 'all' || item.module === module);
  const resource = available.find((item) => item.key === key) ?? available[0];
  useEffect(() => { setPage(1); setSearch(''); setSelected(new Set()); setArchived(false); setEditor(null); setViewing(null); setDeleting(null); }, [resource?.key, companyId]);
  const { data: records, isLoading, error } = useQuery({
    queryKey: ['managed-records', companyId, resource?.key, page, search, archived],
    queryFn: () => api.get<Paged<RecordRow>>(`/records/${resource!.key}${archived ? '/archived/list' : ''}?page=${page}&pageSize=50&q=${encodeURIComponent(search)}`), enabled: !!me?.isSystemAdmin && !!resource,
  });
  const refresh = async () => { await loadMe(); await queryClient.invalidateQueries(); };
  const remove = useMutation({
    mutationFn: (rows: RecordRow[]) => rows.length === 1 ? api.delete(`/records/${resource!.key}/${encodeURIComponent(rows[0]._key)}`) : api.post(`/records/${resource!.key}/bulk-delete`, { ids: rows.map((row) => row._key) }),
    onSuccess: async () => { const count = deleting?.length; await refresh(); setDeleting(null); setSelected(new Set()); if (count === records?.data.length && page > 1) setPage(page - 1); toast(t(resource?.deleteAction === 'reverse' ? 'data.reversed' : 'common.deleted')); },
  });
  const restore = useMutation({ mutationFn: (row: RecordRow) => api.post(`/records/${resource!.key}/${encodeURIComponent(row._key)}/restore`), onSuccess: async () => { await refresh(); toast(t('data.restored')); }, onError: (err: Error) => toast(err.message, 'error') });
  const selectedRows = records?.data.filter((row) => selected.has(row._key)) ?? []; const allSelected = !!records?.data.length && selectedRows.length === records.data.length;
  const display = useRecordDisplay();
  if (!me) return <p>{t('common.loading')}</p>;
  if (!me.isSystemAdmin) return <p role="alert" className="text-sm text-destructive">{t('data.adminOnly')}</p>;
  return <div className="mx-auto max-w-7xl space-y-4">
    <div><h1 className="flex items-center gap-2 text-lg font-bold"><Database size={18} />{t('data.title')}</h1><p className="mt-1 text-sm text-muted-foreground">{t('data.subtitle')}</p></div>
    {catalogError && <p role="alert" className="text-sm text-destructive">{catalogError.message}</p>}
    <div className="grid items-end gap-3 md:grid-cols-3">
      <Field label={t('data.module')}><SelectInput value={module} onChange={(event) => setParams({ module: event.target.value })}><option value="all">{t('data.allModules')}</option>{[...new Set(catalog.map((item) => item.module))].map((value) => <option key={value} value={value}>{t(`nav.${value}`)}</option>)}</SelectInput></Field>
      <Field label={t('data.recordType')}><SelectInput value={resource?.key ?? ''} onChange={(event) => setParams({ module, resource: event.target.value })}>{available.map((item) => <option key={item.key} value={item.key}>{item.name[i18n.language === 'de' ? 'de' : 'en']}</option>)}</SelectInput></Field>
      <div className="flex items-center justify-end gap-2">{resource?.native && <Link to={resource.native} className="text-sm text-primary">{t('data.openModule')}</Link>}{resource && (resource.createNative ? <Link to={resource.native ?? '/'} className="inline-flex h-8 items-center gap-1 rounded-md bg-primary px-3 text-sm text-primary-foreground"><Plus size={14} />{t('common.new')}</Link> : <Button onClick={() => setEditor({})}><Plus size={14} />{t('common.new')}</Button>)}</div>
    </div>
    {resource && <>
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-48 flex-1"><Search size={14} className="absolute left-2.5 top-2 text-muted-foreground" /><TextInput className="pl-8" value={search} type="search" placeholder={t('common.searchShort')} aria-label={t('data.searchRecords')} onChange={(event) => { setSearch(event.target.value); setPage(1); setSelected(new Set()); }} /></div>
        <span className="text-xs text-muted-foreground">{t(resource.companyScoped ? 'data.activeCompany' : 'data.sharedData')}</span>
        {resource.canArchive && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={archived} onChange={(event) => { setArchived(event.target.checked); setPage(1); setSelected(new Set()); }} />{t('data.archived')}</label>}
        {!archived && <Button variant="destructive" disabled={!selectedRows.length} onClick={() => { remove.reset(); setDeleting(selectedRows); }}><Trash2 size={14} />{t(resource.deleteAction === 'reverse' ? 'data.reverseSelected' : 'documents.deleteSelected')}</Button>}
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error.message}</p>}
      <div className="overflow-x-auto rounded-lg border border-border bg-card"><table className="w-full text-sm"><thead><tr className="border-b border-border text-left">
        {!archived && <th className="px-3 py-2"><input type="checkbox" aria-label={t('data.selectAll')} checked={allSelected} ref={(element) => { if (element) element.indeterminate = selectedRows.length > 0 && !allSelected; }} onChange={() => setSelected(allSelected ? new Set() : new Set(records?.data.map((row) => row._key)))} /></th>}
        {resource.columns.map((column) => <th key={column} className="px-3 py-2 font-medium">{fieldLabel(t, column)}</th>)}
        <th className="sticky right-0 bg-card px-3 py-2 text-right font-medium">{t('common.actions')}</th>
      </tr></thead><tbody>{records?.data.map((row) => <tr key={row._key} className="border-b border-border last:border-0 hover:bg-muted/40">
        {!archived && <td className="px-3 py-2"><input type="checkbox" checked={selected.has(row._key)} aria-label={t('data.selectNamed', { name: row._label })} onChange={() => setSelected((current) => { const next = new Set(current); if (next.has(row._key)) next.delete(row._key); else next.add(row._key); return next; })} /></td>}
        {resource.columns.map((column) => <td key={column} className="max-w-xs truncate px-3 py-2">{display(row, resource.fields.find((field) => field.name === column)!)}</td>)}
        <td className="sticky right-0 bg-card px-3 py-2"><div className="flex justify-end gap-1 whitespace-nowrap">
          <Button size="sm" variant="ghost" onClick={() => setViewing(row)} aria-label={t('data.viewNamed', { name: row._label })}>{t('common.view')}</Button>
          {archived ? <Button size="sm" variant="secondary" disabled={restore.isPending} onClick={() => restore.mutate(row)} aria-label={t('data.restoreNamed', { name: row._label })}><RotateCcw size={12} />{t('data.restore')}</Button> : <>
            <Button size="sm" variant="secondary" onClick={() => setEditor({ record: row })} aria-label={t('data.editNamed', { name: row._label })}><Pencil size={12} />{t('common.edit')}</Button>
            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => { remove.reset(); setDeleting([row]); }} aria-label={t(resource.deleteAction === 'reverse' ? 'data.reverseNamed' : 'data.deleteNamed', { name: row._label })}><Trash2 size={12} />{t(resource.deleteAction === 'reverse' ? 'data.reverse' : 'common.delete')}</Button>
          </>}
        </div></td>
      </tr>)}{!records?.data.length && <tr><td colSpan={resource.columns.length + 2} className="p-8 text-center text-muted-foreground">{t(isLoading ? 'common.loading' : 'common.noResults')}</td></tr>}</tbody></table></div>
      {records && <div className="flex items-center justify-between text-sm text-muted-foreground"><span>{t('common.total')}: {records.meta.total}</span><div className="flex items-center gap-2"><Button variant="secondary" disabled={page <= 1} onClick={() => { setPage(page - 1); setSelected(new Set()); }}>{t('documents.previousPage')}</Button><span>{t('documents.pageOf', { page, total: records.meta.totalPages || 1 })}</span><Button variant="secondary" disabled={page >= records.meta.totalPages} onClick={() => { setPage(page + 1); setSelected(new Set()); }}>{t('documents.nextPage')}</Button></div></div>}
      {editor && <RecordEditor key={`${resource.key}-${editor.record?._key ?? 'new'}`} resource={resource} record={editor.record} onClose={() => setEditor(null)} onSaved={async () => { await refresh(); toast(t(editor.record ? 'common.saved' : 'common.created')); }} />}
      <Dialog open={viewing !== null} onClose={() => setViewing(null)} title={viewing?._label ?? ''} width="max-w-4xl">{viewing && <RecordDetails resource={resource} record={viewing} />}</Dialog>
      <Dialog open={deleting !== null} onClose={() => { if (!remove.isPending) setDeleting(null); }} title={t(resource.deleteAction === 'reverse' ? 'data.reverse' : 'common.delete')}>
        <p className="mb-3 text-sm">{t(resource.deleteAction === 'reverse' ? 'data.reverseConfirm' : resource.canArchive ? 'data.deleteConfirm' : 'data.deletePermanentConfirm', { count: deleting?.length ?? 0 })}</p>
        <ul className="mb-3 max-h-40 overflow-y-auto text-sm">{deleting?.map((row) => <li key={row._key} className="break-words">{row._label}</li>)}</ul>
        {remove.error && <p role="alert" className="mb-3 text-sm text-destructive">{remove.error.message}</p>}
        {resource.native && remove.error && <Link to={resource.native} className="mb-3 inline-block text-sm text-primary">{t('data.openModule')}</Link>}
        <div className="flex justify-end gap-2"><Button variant="secondary" disabled={remove.isPending} onClick={() => setDeleting(null)}>{t('common.cancel')}</Button><Button variant="destructive" disabled={remove.isPending} onClick={() => { if (deleting) remove.mutate(deleting); }}>{t(remove.isPending ? 'common.loading' : resource.deleteAction === 'reverse' ? 'data.reverse' : 'common.delete')}</Button></div>
      </Dialog>
    </>}
  </div>;
}
