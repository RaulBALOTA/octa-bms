import { useMutation, useQuery } from '@tanstack/react-query';
import { ExternalLink, Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuthStore } from '../stores/auth';
import { RecordField, RecordRow, Resource } from '../lib/records';
import { Button, Dialog, Field, SelectInput, TextArea, TextInput } from './ui';

type Form = Record<string, unknown>;
export const human = (name: string) => name.replace(/Id$/, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/^./, (letter) => letter.toUpperCase());
export const fieldLabel = (t: (key: string, options?: { defaultValue: string }) => string, name: string) => t(`data.fields.${name}`, { defaultValue: human(name) });
const editable = (fields: RecordField[], creating: boolean) => fields.filter((field) => !field.readOnly && (creating || !field.createOnly));
function defaults(fields: RecordField[], record?: Form): Form {
  return Object.fromEntries(fields.map((field) => {
    let value = record?.[field.name] ?? field.default ?? (field.fields ? [defaults(field.fields)] : field.list ? [] : field.type === 'Boolean' ? false : '');
    if (field.fields && Array.isArray(value)) value = value.map((row) => defaults(field.fields ?? [], row as Form));
    if (field.type === 'Json' && value !== '') value = JSON.stringify(value, null, 2);
    if (field.type === 'DateTime' && typeof value === 'string' && value) {
      const date = new Date(value); value = /At$|meetingDate|activityDate|validFrom/.test(field.name)
        ? new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : value.slice(0, 10);
    }
    return [field.name, value];
  }));
}
function payload(fields: RecordField[], form: Form, creating: boolean): Form {
  const result: Form = {};
  for (const field of editable(fields, creating)) {
    const value = form[field.name];
    if (field.fields) { result[field.name] = (value as Form[]).map((row) => payload(field.fields ?? [], row, true)); continue; }
    if (value === '' || value === undefined) { if (field.nullable) result[field.name] = null; continue; }
    if (field.type === 'DateTime') result[field.name] = new Date(String(value)).toISOString();
    else if (['Int','Float'].includes(field.type)) result[field.name] = Number(value);
    else if (field.type === 'Decimal') result[field.name] = String(value);
    else if (field.type === 'Json') result[field.name] = JSON.parse(String(value));
    else result[field.name] = value;
  }
  return result;
}

function RelationshipInput({ resource, field, path, value, onChange, required }: {
  resource: Resource; field: RecordField; path: string; value: unknown; onChange: (value: unknown) => void; required: boolean;
}) {
  const { t } = useTranslation(); const companyId = useAuthStore((state) => state.companyId); const [search, setSearch] = useState('');
  const selected = Array.isArray(value) ? value.join(',') : String(value ?? '');
  const { data: options = [], isLoading, error } = useQuery({
    queryKey: ['record-lookup', companyId, resource.key, path, search, selected],
    queryFn: () => api.get<{ value: string; label: string }[]>(`/records/${resource.key}/lookup/${path}?q=${encodeURIComponent(search)}&selected=${encodeURIComponent(selected)}`),
  });
  return <div className="space-y-1">
    <TextInput type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('common.searchShort')}
      aria-label={t('data.searchRelated', { name: fieldLabel(t, field.name) })} />
    <SelectInput multiple={field.list} size={field.list ? 4 : undefined} required={required && !field.list} value={field.list ? value as string[] : String(value ?? '')}
      aria-label={fieldLabel(t, field.name)} onChange={(event) => {
        if (!field.list) onChange(event.target.value);
        else onChange([...((value as string[]) ?? []).filter((id) => !options.some((option) => option.value === id)), ...Array.from(event.target.selectedOptions, (option) => option.value)]);
      }}>
      {!field.list && <option value="">{isLoading ? t('common.loading') : '—'}</option>}
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </SelectInput>
    {error && <p role="alert" className="text-xs text-destructive">{error.message}</p>}
  </div>;
}

function FormFields({ resource, fields, form, onChange, creating, prefix = '' }: {
  resource: Resource; fields: RecordField[]; form: Form; onChange: (form: Form) => void; creating: boolean; prefix?: string;
}) {
  const { t } = useTranslation();
  const set = (key: string, value: unknown) => onChange({ ...form, [key]: value });
  return <div className="grid gap-3 sm:grid-cols-2">{editable(fields, creating).map((field) => {
    const value = form[field.name]; const required = creating && field.required;
    if (field.fields) return <div key={field.name} className="space-y-3 rounded-lg border border-border p-3 sm:col-span-2">
      <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">{fieldLabel(t, field.name)}</h3><Button type="button" size="sm" variant="secondary" onClick={() => set(field.name, [...value as Form[], defaults(field.fields ?? [])])}><Plus size={12} />{t('data.addRow')}</Button></div>
      {(value as Form[]).map((row, index) => <div key={index} className="space-y-2 border-t border-border pt-3">
        <FormFields resource={resource} fields={field.fields ?? []} form={row} creating prefix={`${field.name}.`} onChange={(next) => set(field.name, (value as Form[]).map((current, rowIndex) => rowIndex === index ? next : current))} />
        <div className="flex justify-end"><Button type="button" size="sm" variant="ghost" className="text-destructive" disabled={(value as Form[]).length <= 1} onClick={() => set(field.name, (value as Form[]).filter((_row, rowIndex) => rowIndex !== index))}>{t('data.removeRow')}</Button></div>
      </div>)}
    </div>;
    if (field.type === 'Boolean') return <label key={field.name} className="flex items-center gap-2 self-center text-sm"><input type="checkbox" checked={!!value} onChange={(event) => set(field.name, event.target.checked)} />{fieldLabel(t, field.name)}</label>;
    const long = field.type === 'Json' || field.list || /content|description|notes|body|purpose|measures|evidence/i.test(field.name);
    return <Field key={field.name} label={fieldLabel(t, field.name)} required={required} className={long ? 'sm:col-span-2' : undefined}>
      {field.reference ? <RelationshipInput resource={resource} field={field} path={`${prefix}${field.name}`} value={value} onChange={(next) => set(field.name, next)} required={required} />
        : field.values ? <SelectInput value={String(value ?? '')} required={required} onChange={(event) => set(field.name, event.target.value)}>
          <option value="">—</option>{field.values.map((option) => <option key={option} value={option}>{t(`data.values.${option}`, { defaultValue: human(option) })}</option>)}
        </SelectInput>
        : long ? <TextArea rows={field.type === 'Json' ? 6 : 3} value={field.list ? (value as string[]).join('\n') : String(value ?? '')} required={required && !field.list}
          onChange={(event) => set(field.name, field.list ? event.target.value.split('\n').map((line) => line.trim()).filter(Boolean) : event.target.value)} />
        : <TextInput value={String(value ?? '')} required={required} minLength={field.type === 'Password' ? 12 : undefined}
          type={field.type === 'Password' ? 'password' : field.type === 'DateTime' ? /At$|meetingDate|activityDate|validFrom/.test(field.name) ? 'datetime-local' : 'date' : ['Int','Float','Decimal'].includes(field.type) ? 'number' : /email$/i.test(field.name) ? 'email' : 'text'}
          step={field.type === 'Int' ? '1' : ['Float','Decimal'].includes(field.type) ? 'any' : undefined}
          onChange={(event) => set(field.name, event.target.value)} />}
    </Field>;
  })}</div>;
}

export function RecordEditor({ resource, record, onClose, onSaved }: { resource: Resource; record?: RecordRow; onClose: () => void; onSaved: () => Promise<void> }) {
  const { t, i18n } = useTranslation(); const [form, setForm] = useState(() => defaults(resource.fields, record)); const [validationError, setValidationError] = useState('');
  const save = useMutation({
    mutationFn: () => { const data = payload(resource.fields, form, !record); return record ? api.patch(`/records/${resource.key}/${encodeURIComponent(record._key)}`, { data }) : api.post(`/records/${resource.key}`, { data }); },
    onSuccess: async () => { await onSaved(); onClose(); },
  });
  return <Dialog open onClose={() => { if (!save.isPending) onClose(); }} title={`${t(record ? 'common.edit' : 'common.new')} · ${resource.name[i18n.language === 'de' ? 'de' : 'en']}`} width="max-w-4xl">
    <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); setValidationError(''); try { payload(resource.fields, form, !record); if (!save.isPending) save.mutate(); } catch { setValidationError(t('data.invalidForm')); } }}>
      <fieldset disabled={save.isPending} className="max-h-[60vh] overflow-y-auto pr-2"><FormFields resource={resource} fields={resource.fields} form={form} onChange={setForm} creating={!record} /></fieldset>
      {(validationError || save.error) && <p role="alert" className="text-sm text-destructive">{validationError || save.error?.message}</p>}
      {resource.native && <Link to={resource.native} className="inline-flex items-center gap-1 text-xs text-primary"><ExternalLink size={12} />{t('data.openModule')}</Link>}
      <div className="flex justify-end gap-2"><Button type="button" variant="secondary" disabled={save.isPending} onClick={onClose}>{t('common.cancel')}</Button><Button type="submit" disabled={save.isPending}>{t(save.isPending ? 'common.loading' : 'common.save')}</Button></div>
    </form>
  </Dialog>;
}


export function useRecordDisplay() {
  const { t, i18n } = useTranslation();
  return (row: RecordRow, field: RecordField) => {
    const value = row[field.name]; if (value == null || value === '') return '—';
    if (field.reference && !field.list) return row._references?.[field.name] ?? t('data.unavailable');
    if (field.reference && field.list) return row._referenceLists?.[field.name]?.map((name) => name ?? t('data.unavailable')).join(', ') || '—';
    if (field.type === 'Boolean') return t(value ? 'data.yes' : 'data.no');
    if (field.type === 'DateTime') return new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short' }).format(new Date(String(value)));
    if (typeof value === 'object') return Array.isArray(value) ? value.join(', ') : JSON.stringify(value);
    return field.values ? t(`data.values.${String(value)}`, { defaultValue: human(String(value)) }) : String(value);
  };
}

export function RecordDetails({ resource, record }: { resource: Resource; record: RecordRow }) {
  const { t } = useTranslation(); const display = useRecordDisplay();
  return <dl className="grid max-h-[60vh] gap-3 overflow-y-auto text-sm sm:grid-cols-2">{resource.fields.filter((field) => field.name !== 'id' && field.name !== 'companyId' && field.type !== 'Password' && (!['createdById','updatedById','authorId','creatorId','ownerId','evaluatedById'].includes(field.name) || !!field.reference)).map((field) => <div key={field.name} className={field.fields ? 'sm:col-span-2' : undefined}><dt className="text-xs text-muted-foreground">{fieldLabel(t, field.name)}</dt><dd className="whitespace-pre-wrap break-words">{field.fields ? <div className="mt-2 space-y-2">{(record[field.name] as RecordRow[] ?? []).map((row, index) => <dl key={index} className="grid gap-2 rounded border border-border p-2 sm:grid-cols-3">{field.fields!.filter((child) => !['id','invoiceId','requestId','orderId'].includes(child.name)).map((child) => <div key={child.name}><dt className="text-xs text-muted-foreground">{fieldLabel(t, child.name)}</dt><dd>{display(row, child)}</dd></div>)}</dl>)}</div> : display(record, field)}</dd></div>)}</dl>;
}
