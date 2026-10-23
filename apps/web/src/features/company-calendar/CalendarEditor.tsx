import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Field, SelectInput, TextArea, TextInput } from '../../components/ui';
import { useAuthStore } from '../../stores/auth';
import { CalendarModal } from './CalendarModal';
import { useCalendarEntities, useCalendarMembers, useCalendarMutation } from './queries';
import { CalendarItem, KINDS } from './types';

export function CalendarEditor({ item, domains, entityTypes, initialDate, onClose }: { item?: CalendarItem; domains: string[]; entityTypes: string[]; initialDate: string; onClose: () => void }) {
  const { t } = useTranslation(); const { me } = useAuthStore();
  const members = useCalendarMembers(true); const mutation = useCalendarMutation();
  const [form, setForm] = useState({
    title: item?.title ?? '', description: item?.description ?? '', domain: item?.domain ?? domains[0] ?? 'OPERATIONS',
    kind: item?.kind ?? 'OBLIGATION', sensitivity: item?.sensitivity ?? 'PUBLIC_INTERNAL', priority: String(item?.priority ?? 1),
    ownerUserId: item?.ownerUserId ?? me?.id ?? '', timezoneIana: item?.timezoneIana ?? 'Europe/Berlin',
    dateOnly: item?.dateOnly ?? (item?.startsAt ? '' : initialDate), endDateOnly: item?.endDateOnly ?? '',
    startsAt: item?.startsAt ?? '', endsAt: item?.endsAt ?? '', hardDueAt: item?.hardDueAt ?? '',
    hardDueDate: item?.hardDueDate ?? '', internalTargetDate: item?.internalTargetDate ?? '', forecastDate: item?.forecastDate ?? '',
    allDay: item?.allDay ?? false, completionEvidenceRequired: item?.completionEvidenceRequired ?? false,
    sourceUrl: item?.sourceUrl ?? '', businessEntityType: item?.businessEntityType ?? '', businessEntityId: item?.businessEntityId ?? '',
    recurrenceFrequency: item?.recurrenceFrequency ?? '', recurrenceInterval: String(item?.recurrenceInterval ?? 1), recurrenceUntil: item?.recurrenceUntil ?? '',
  });
  const [checklist, setChecklist] = useState(item?.checklist.map((c) => ({ title: c.title, done: c.done })) ?? []);
  const [grants, setGrants] = useState(item?.grants.map((g) => ({ userId: g.userId, canEdit: g.canEdit })) ?? []);
  const [newTask, setNewTask] = useState('');
  const [entitySearch, setEntitySearch] = useState('');
  const entities = useCalendarEntities(form.businessEntityType, entitySearch, form.businessEntityId);
  const sharingAllowed = !item || item.createdById === me?.id || item.ownerUserId === me?.id;
  const set = (key: string) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));
  async function submit(e: FormEvent) {
    e.preventDefault(); if (mutation.isPending) return;
    const { recurrenceFrequency, recurrenceInterval, recurrenceUntil, ...fields } = form;
    const body = { ...fields, priority: Number(form.priority),
      ...Object.fromEntries(['description', 'ownerUserId', 'dateOnly', 'endDateOnly', 'startsAt', 'endsAt', 'hardDueAt', 'hardDueDate', 'internalTargetDate', 'forecastDate', 'sourceUrl', 'businessEntityType', 'businessEntityId'].map((key) => [key, fields[key as keyof typeof fields] || null])),
      checklist, ...(sharingAllowed ? { grants } : {}), ...(item ? { version: item.version } : { recurrenceFrequency: recurrenceFrequency || null, recurrenceInterval: Number(recurrenceInterval), recurrenceUntil: recurrenceUntil || null }),
    };
    try { await mutation.mutateAsync({ path: item ? `items/${item.id}` : 'items', method: item ? 'patch' : 'post', body }); onClose(); } catch { /* rendered below */ }
  }
  return <CalendarModal title={t(item ? 'calendar.edit' : 'calendar.create')} onClose={() => { if (!mutation.isPending) onClose(); }}>
    <form className="space-y-4" onSubmit={submit}>
      {mutation.error && <p role="alert" className="text-sm text-destructive">{mutation.error.message}</p>}
      <Field label={t('calendar.recordTitle')} required><TextInput value={form.title} onChange={set('title')} required maxLength={250} data-calendar-autofocus/></Field>
      <Field label={t('calendar.description')}><TextArea value={form.description} onChange={set('description')} maxLength={5000}/></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('calendar.domain')}><SelectInput value={form.domain} onChange={set('domain')}>{domains.map((d) => <option key={d} value={d}>{t(`calendar.domains.${d}`)}</option>)}</SelectInput></Field>
        <Field label={t('calendar.kind')}><SelectInput value={form.kind} onChange={set('kind')}>{KINDS.map((d) => <option key={d} value={d}>{t(`calendar.kinds.${d}`)}</option>)}</SelectInput></Field>
        <Field label={t('calendar.owner')}><SelectInput value={form.ownerUserId} onChange={set('ownerUserId')}><option value="">{t('calendar.unassigned')}</option>{members.data?.map((u) => <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>)}</SelectInput></Field>
        <Field label={t('calendar.priority')}><SelectInput value={form.priority} onChange={set('priority')}>{[1, 2, 3, 4].map((v) => <option key={v} value={v}>{t(`calendar.priorities.${v}`)}</option>)}</SelectInput></Field>
        <Field label={t('calendar.sensitivity')}><SelectInput value={form.sensitivity} onChange={set('sensitivity')} disabled={!sharingAllowed}>{['PUBLIC_INTERNAL', 'TEAM', 'RESTRICTED', 'PRIVATE'].map((d) => <option key={d} value={d}>{t(`calendar.sensitivities.${d}`)}</option>)}</SelectInput></Field>
        <Field label={t('calendar.timezone')}><TextInput value={form.timezoneIana} onChange={set('timezoneIana')} required/></Field>
      </div>
      <fieldset className="rounded-lg border border-border p-3"><legend className="px-1 text-sm font-medium">{t('calendar.dates')}</legend>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.allDay} onChange={(e) => setForm((f) => ({ ...f, allDay: e.target.checked }))}/>{t('calendar.allDay')}</label>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {['dateOnly', 'endDateOnly', 'hardDueDate', 'internalTargetDate', 'forecastDate'].map((key) => <Field key={key} label={t(`calendar.${key}`)}><TextInput type="date" value={form[key as keyof typeof form] as string} onChange={set(key)}/></Field>)}
          {['startsAt', 'endsAt', 'hardDueAt'].map((key) => <Field key={key} label={t(`calendar.${key}`)}><TextInput value={form[key as keyof typeof form] as string} onChange={set(key)} placeholder="2026-10-12T09:00:00+02:00"/></Field>)}
        </div><p className="mt-2 text-xs text-muted-foreground">{t('calendar.dateHelp')}</p>
      </fieldset>
      {!item && <fieldset className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-3"><legend className="px-1 text-sm font-medium">{t('calendar.recurrence')}</legend>
        <Field label={t('calendar.frequency')}><SelectInput value={form.recurrenceFrequency} onChange={set('recurrenceFrequency')}><option value="">{t('calendar.noRecurrence')}</option>{['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].map((f) => <option key={f} value={f}>{t(`calendar.frequencies.${f}`)}</option>)}</SelectInput></Field>
        <Field label={t('calendar.interval')}><TextInput type="number" min={1} max={120} value={form.recurrenceInterval} onChange={set('recurrenceInterval')} required/></Field>
        <Field label={t('calendar.until')}><TextInput type="date" value={form.recurrenceUntil} onChange={set('recurrenceUntil')}/></Field>
      </fieldset>}
      <fieldset className="space-y-2 rounded-lg border border-border p-3"><legend className="px-1 text-sm font-medium">{t('calendar.preparation')}</legend>
        {checklist.map((c, i) => <div key={i} className="flex items-center gap-2"><label className="flex flex-1 items-center gap-2 text-sm"><input type="checkbox" checked={c.done} onChange={(e) => setChecklist((rows) => rows.map((r, j) => j === i ? { ...r, done: e.target.checked } : r))}/>{c.title}</label><Button variant="ghost" type="button" aria-label={t('calendar.removeTask', { title: c.title })} onClick={() => setChecklist((rows) => rows.filter((_r, j) => j !== i))}>{t('common.delete')}</Button></div>)}
        <div className="flex gap-2"><TextInput aria-label={t('calendar.newTask')} value={newTask} onChange={(e) => setNewTask(e.target.value)} maxLength={300}/><Button type="button" variant="secondary" disabled={!newTask.trim() || checklist.length >= 100} onClick={() => { setChecklist((rows) => [...rows, { title: newTask.trim(), done: false }]); setNewTask(''); }}>{t('calendar.addTask')}</Button></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.completionEvidenceRequired} onChange={(e) => setForm((f) => ({ ...f, completionEvidenceRequired: e.target.checked }))}/>{t('calendar.evidenceRequired')}</label>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('calendar.entityType')}><SelectInput value={form.businessEntityType} onChange={(e) => { const type = e.target.value; setForm((f) => ({ ...f, businessEntityType: type, businessEntityId: '', domain: type === 'invoice' ? 'FINANCE' : type === 'employee' ? 'HR' : f.domain })); setEntitySearch(''); }}><option value="">{t('calendar.noLink')}</option>{entityTypes.map((v) => <option key={v} value={v}>{t(`calendar.entities.${v}`)}</option>)}</SelectInput></Field>
        {form.businessEntityType && <><Field label={t('calendar.entitySearch')}><TextInput value={entitySearch} onChange={(e) => setEntitySearch(e.target.value)} maxLength={250}/></Field><Field label={t('calendar.entityId')} className="sm:col-span-2"><SelectInput value={form.businessEntityId} onChange={set('businessEntityId')} required><option value="">{t('calendar.selectEntity')}</option>{entities.data?.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}</SelectInput></Field>{entities.error && <p role="alert" className="text-sm text-destructive">{entities.error.message}</p>}</>}
        <Field label={t('calendar.sourceUrl')} className="sm:col-span-2"><TextInput type="url" value={form.sourceUrl} onChange={set('sourceUrl')} maxLength={2000}/></Field>
      </div>
      {sharingAllowed && <fieldset className="space-y-2 rounded-lg border border-border p-3"><legend className="px-1 text-sm font-medium">{t('calendar.sharing')}</legend><p className="text-xs text-muted-foreground">{t('calendar.sharingHelp')}</p>
        <Field label={t('calendar.addPerson')}><SelectInput value="" onChange={(e) => { const id = e.target.value; if (id && !grants.some((g) => g.userId === id)) setGrants((rows) => [...rows, { userId: id, canEdit: false }]); }}><option value="">{t('calendar.selectPerson')}</option>{members.data?.map((u) => <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>)}</SelectInput></Field>
        {grants.map((g) => { const person = members.data?.find((m) => m.id === g.userId); return <div key={g.userId} className="flex flex-wrap items-center gap-3 text-sm"><span>{person ? `${person.firstName} ${person.lastName}` : t('calendar.member')}</span><label className="flex items-center gap-2"><input type="checkbox" checked={g.canEdit} onChange={(e) => setGrants((rows) => rows.map((r) => r.userId === g.userId ? { ...r, canEdit: e.target.checked } : r))}/>{t('calendar.allowEdit')}</label><Button type="button" variant="ghost" onClick={() => setGrants((rows) => rows.filter((r) => r.userId !== g.userId))}>{t('common.delete')}</Button></div>; })}
      </fieldset>}
      <div className="flex justify-end gap-2"><Button type="button" variant="secondary" disabled={mutation.isPending} onClick={onClose}>{t('common.cancel')}</Button><Button type="submit" disabled={mutation.isPending || !form.title.trim()}>{t('common.save')}</Button></div>
    </form>
  </CalendarModal>;
}
