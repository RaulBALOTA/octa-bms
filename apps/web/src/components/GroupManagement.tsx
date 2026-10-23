import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { hasPermission, useAuthStore } from '../stores/auth';
import { Button, Dialog, Field, SelectInput, TextInput, useToast } from './ui';

interface Office {
  id: string; code: string; name: string; isActive: boolean; isHQ?: boolean;
  street: string | null; postalCode: string | null; city: string | null;
  countryCode: string | null; phone: string | null; email: string | null;
}
interface Company extends Office {
  legalName: string | null; legalForm: string | null; vatId: string | null;
  taxNumber: string | null; commercialRegister: string | null; website: string | null;
  parentCompanyId: string | null; defaultCurrency: string; defaultLocale: string; fiscalYearStart: number;
  offices: Office[];
}
type Editor = { kind: 'company'; record?: Company } | { kind: 'office'; companyId: string; record?: Office };
type Deletion = { kind: 'company'; record: Company } | { kind: 'office'; companyId: string; record: Office };
const officeFields = ['code', 'name', 'street', 'postalCode', 'city', 'phone', 'email'];
const companyFields = ['code', 'name', 'legalName', 'legalForm', 'vatId', 'taxNumber', 'commercialRegister', 'street', 'postalCode', 'city', 'phone', 'email', 'website'];

function text(record: Office | Company | undefined, key: string): string {
  const value: unknown = record ? Reflect.get(record, key) : undefined;
  return value == null ? '' : String(value);
}

function EntityEditor({ editor, companies, onClose, onSaved }: {
  editor: Editor; companies: Company[]; onClose: () => void; onSaved: (id: string) => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const isCompany = editor.kind === 'company';
  const fields = isCompany ? companyFields : officeFields;
  const [form, setForm] = useState<Record<string, string>>(() => ({
    ...Object.fromEntries(fields.map((key) => [key, text(editor.record, key)])),
    countryCode: editor.record?.countryCode ?? '',
    parentCompanyId: text(editor.record, 'parentCompanyId'),
    defaultCurrency: text(editor.record, 'defaultCurrency') || 'EUR',
    defaultLocale: text(editor.record, 'defaultLocale') || 'de',
    fiscalYearStart: text(editor.record, 'fiscalYearStart') || '1',
  }));
  const [isActive, setIsActive] = useState(editor.record?.isActive ?? true);
  const [isHQ, setIsHQ] = useState(editor.record?.isHQ ?? false);
  const { data: countries } = useQuery({ queryKey: ['countries'], queryFn: () => api.get<{ code: string; name: string; nameDe?: string }[]>('/master/countries') });
  const { data: currencies } = useQuery({ queryKey: ['currencies'], queryFn: () => api.get<{ code: string }[]>('/master/currencies'), enabled: isCompany });
  const excluded = new Set(editor.record ? [editor.record.id] : []);
  for (let size = -1; size !== excluded.size;) {
    size = excluded.size;
    for (const company of companies) if (company.parentCompanyId && excluded.has(company.parentCompanyId)) excluded.add(company.id);
  }
  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...Object.fromEntries(fields.map((key) => [key, ['code', 'name'].includes(key) ? form[key].trim() : form[key].trim() || null])),
        countryCode: form.countryCode || null, isActive,
        ...(isCompany ? { parentCompanyId: form.parentCompanyId || null, defaultCurrency: form.defaultCurrency, defaultLocale: form.defaultLocale, fiscalYearStart: Number(form.fiscalYearStart) } : { isHQ }),
      };
      const base = isCompany ? '/master/companies' : `/master/companies/${editor.companyId}/offices`;
      return editor.record ? api.patch<{ id: string }>(`${base}/${editor.record.id}`, body) : api.post<{ id: string }>(base, body);
    },
    onSuccess: async (result) => { await onSaved(result.id); toast(t(editor.record ? 'common.saved' : 'common.created')); onClose(); },
    onError: (err: Error) => toast(err.message, 'error'),
  });
  const title = t(isCompany ? editor.record ? 'group.editCompany' : 'group.newCompany' : editor.record ? 'group.editOffice' : 'group.newOffice');
  return <Dialog open onClose={() => { if (!save.isPending) onClose(); }} title={title} width="max-w-3xl">
    <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); if (!save.isPending) save.mutate(); }}>
      <fieldset disabled={save.isPending} className="grid max-h-[60vh] grid-cols-1 gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
        {fields.map((key) => <Field key={key} label={t(`group.fields.${key}`)} required={['code', 'name'].includes(key)}>
          <TextInput value={form[key]} onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))}
            type={key === 'email' ? 'email' : key === 'website' ? 'url' : 'text'}
            required={['code', 'name'].includes(key)} maxLength={key === 'code' ? 40 : ['street', 'website'].includes(key) ? 500 : 250} autoFocus={key === 'code'} />
        </Field>)}
        <Field label={t('group.fields.countryCode')}><SelectInput value={form.countryCode} onChange={(event) => setForm((current) => ({ ...current, countryCode: event.target.value }))}>
          <option value="">—</option>
          {countries?.map((country) => <option key={country.code} value={country.code}>{i18n.language === 'de' ? country.nameDe ?? country.name : country.name}</option>)}
        </SelectInput></Field>
        {isCompany && <>
          <Field label={t('group.fields.parentCompanyId')}><SelectInput value={form.parentCompanyId} onChange={(event) => setForm((current) => ({ ...current, parentCompanyId: event.target.value }))}>
            <option value="">{t('group.noParent')}</option>
            {companies.filter((company) => company.isActive && !excluded.has(company.id)).map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
          </SelectInput></Field>
          <Field label={t('group.fields.defaultCurrency')}><SelectInput value={form.defaultCurrency} onChange={(event) => setForm((current) => ({ ...current, defaultCurrency: event.target.value }))}>
            {[...new Set([form.defaultCurrency, ...(currencies?.map((currency) => currency.code) ?? [])])].map((code) => <option key={code}>{code}</option>)}
          </SelectInput></Field>
          <Field label={t('group.fields.defaultLocale')}><SelectInput value={form.defaultLocale} onChange={(event) => setForm((current) => ({ ...current, defaultLocale: event.target.value }))}>
            {[...new Set([form.defaultLocale, 'de', 'en'])].map((locale) => <option key={locale}>{locale}</option>)}
          </SelectInput></Field>
          <Field label={t('group.fields.fiscalYearStart')}><TextInput type="number" required min={1} max={12} value={form.fiscalYearStart} onChange={(event) => setForm((current) => ({ ...current, fiscalYearStart: event.target.value }))} /></Field>
        </>}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} />{t('group.active')}</label>
        {!isCompany && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={isHQ} onChange={(event) => setIsHQ(event.target.checked)} />{t('group.headquarters')}</label>}
      </fieldset>
      {save.error && <p role="alert" className="text-sm text-destructive">{save.error.message}</p>}
      <div className="flex justify-end gap-2"><Button type="button" variant="secondary" disabled={save.isPending} onClick={onClose}>{t('common.cancel')}</Button><Button type="submit" disabled={save.isPending}>{save.isPending ? t('common.loading') : t('common.save')}</Button></div>
    </form>
  </Dialog>;
}

export function GroupManagement() {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const me = useAuthStore((state) => state.me);
  const companyId = useAuthStore((state) => state.companyId);
  const loadMe = useAuthStore((state) => state.loadMe);
  const canCreate = hasPermission(me, 'admin.masterdata.create');
  const canEdit = hasPermission(me, 'admin.masterdata.update');
  const canDelete = hasPermission(me, 'admin.masterdata.delete');
  const [editor, setEditor] = useState<Editor | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewingOffice, setViewingOffice] = useState<Office | null>(null);
  const [deleting, setDeleting] = useState<Deletion | null>(null);
  const { data: companies = [], isLoading, error } = useQuery({ queryKey: ['group-companies', companyId], queryFn: () => api.get<Company[]>('/master/companies'), enabled: hasPermission(me, 'admin.masterdata.read') });
  const selected = companies.find((company) => company.id === selectedId);
  const refresh = async () => {
    await loadMe();
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['group-companies'] }), queryClient.invalidateQueries({ queryKey: ['group-overview'] }),
      queryClient.invalidateQueries({ queryKey: ['offices'] }), queryClient.invalidateQueries({ queryKey: ['company-profile'] }),
    ]);
  };
  const remove = useMutation({
    mutationFn: (record: Deletion) => api.delete(record.kind === 'company' ? `/master/companies/${record.record.id}` : `/master/companies/${record.companyId}/offices/${record.record.id}`),
    onSuccess: async (_result, record) => {
      if (record.kind === 'company' && selectedId === record.record.id) setSelectedId(null);
      await refresh(); setDeleting(null); toast(t('common.deleted'));
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });
  if (!hasPermission(me, 'admin.masterdata.read')) return null;
  const actions = (record: Company | Office, officeCompanyId?: string) => <div className="flex justify-end gap-1">
    <Button size="sm" variant="ghost" onClick={() => officeCompanyId ? setViewingOffice(record) : setSelectedId(record.id)} aria-label={t('group.viewNamed', { name: record.name })}>{t('common.view')}</Button>
    {canEdit && <Button size="sm" variant="secondary" onClick={() => setEditor(officeCompanyId ? { kind: 'office', companyId: officeCompanyId, record } : { kind: 'company', record: record as Company })} aria-label={t('group.editNamed', { name: record.name })}><Pencil size={12} />{t('common.edit')}</Button>}
    {canDelete && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => { remove.reset(); setDeleting(officeCompanyId ? { kind: 'office', companyId: officeCompanyId, record } : { kind: 'company', record: record as Company }); }} aria-label={t('group.deleteNamed', { name: record.name })}><Trash2 size={12} />{t('common.delete')}</Button>}
  </div>;
  return <section className="mt-6 space-y-4 border-t border-border pt-5">
    <div className="flex items-center justify-between gap-3"><h2 className="text-base font-semibold">{t('group.manage')}</h2>{canCreate && <Button onClick={() => setEditor({ kind: 'company' })}><Plus size={14} />{t('group.newCompany')}</Button>}</div>
    <p className="text-xs text-muted-foreground">{t('group.deleteHint')}</p>
    {error && <p role="alert" className="text-sm text-destructive">{error.message}</p>}
    <div className="overflow-x-auto rounded-lg border border-border bg-card"><table className="w-full text-sm"><thead><tr className="border-b border-border text-left">
      <th className="p-3">{t('group.fields.code')}</th><th className="p-3">{t('group.fields.name')}</th><th className="p-3">{t('group.fields.parentCompanyId')}</th><th className="p-3">{t('common.status')}</th><th className="p-3 text-right">{t('common.actions')}</th>
    </tr></thead><tbody>{companies.map((company) => <tr key={company.id} className="border-b border-border last:border-0">
      <td className="p-3">{company.code}</td><td className="p-3"><button className="text-left font-medium hover:text-primary" onClick={() => setSelectedId(company.id)}>{company.name}</button></td><td className="p-3">{companies.find((parent) => parent.id === company.parentCompanyId)?.name ?? '—'}</td><td className="p-3">{t(company.isActive ? 'group.active' : 'group.inactive')}</td><td className="p-3">{actions(company)}</td>
    </tr>)}{!companies.length && <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">{t(isLoading ? 'common.loading' : 'common.noResults')}</td></tr>}</tbody></table></div>
    {selected && <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between"><h3 className="font-semibold">{selected.name}</h3><Button variant="ghost" onClick={() => setSelectedId(null)}>{t('group.closeDetails')}</Button></div>
      <dl className="mb-4 grid gap-3 text-sm sm:grid-cols-3">{[...companyFields, 'countryCode', 'defaultCurrency', 'defaultLocale', 'fiscalYearStart'].map((key) => <div key={key}><dt className="text-xs text-muted-foreground">{t(`group.fields.${key}`)}</dt><dd className="break-words">{text(selected, key) || '—'}</dd></div>)}</dl>
      <div className="mb-2 flex items-center justify-between"><h4 className="text-sm font-semibold">{t('group.officeList')}</h4>{canCreate && <Button size="sm" onClick={() => setEditor({ kind: 'office', companyId: selected.id })}><Plus size={12} />{t('group.newOffice')}</Button>}</div>
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-border text-left"><th className="p-2">{t('group.fields.code')}</th><th className="p-2">{t('group.fields.name')}</th><th className="p-2">{t('group.fields.city')}</th><th className="p-2">{t('common.status')}</th><th className="p-2 text-right">{t('common.actions')}</th></tr></thead><tbody>
        {selected.offices.map((office) => <tr key={office.id} className="border-b border-border last:border-0"><td className="p-2">{office.code}</td><td className="p-2">{office.name}{office.isHQ ? ` · ${t('group.headquarters')}` : ''}</td><td className="p-2">{office.city ?? '—'}</td><td className="p-2">{t(office.isActive ? 'group.active' : 'group.inactive')}</td><td className="p-2">{actions(office, selected.id)}</td></tr>)}
        {!selected.offices.length && <tr><td colSpan={5} className="p-4 text-center text-muted-foreground">{t('common.noResults')}</td></tr>}
      </tbody></table></div>
    </div>}
    {editor && <EntityEditor editor={editor} companies={companies} onClose={() => setEditor(null)} onSaved={async (id) => { await refresh(); if (editor.kind === 'company') setSelectedId(id); }} />}
    <Dialog open={viewingOffice !== null} onClose={() => setViewingOffice(null)} title={viewingOffice?.name ?? ''}><dl className="grid gap-3 text-sm sm:grid-cols-2">{[...officeFields, 'countryCode'].map((key) => <div key={key}><dt className="text-xs text-muted-foreground">{t(`group.fields.${key}`)}</dt><dd>{text(viewingOffice ?? undefined, key) || '—'}</dd></div>)}</dl></Dialog>
    <Dialog open={deleting !== null} onClose={() => { if (!remove.isPending) setDeleting(null); }} title={t('common.delete')}>
      <p className="mb-3 text-sm">{t('group.deleteConfirm', { name: deleting?.record.name })}</p>
      {remove.error && <p role="alert" className="mb-3 text-sm text-destructive">{remove.error.message}</p>}
      <div className="flex justify-end gap-2"><Button variant="secondary" disabled={remove.isPending} onClick={() => setDeleting(null)}>{t('common.cancel')}</Button><Button variant="destructive" disabled={remove.isPending} onClick={() => { if (deleting) remove.mutate(deleting); }}>{t('common.delete')}</Button></div>
    </Dialog>
  </section>;
}
