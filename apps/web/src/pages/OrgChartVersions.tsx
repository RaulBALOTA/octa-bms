import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { Button, Dialog, Field, SelectInput, TextArea, TextInput, useToast } from '../components/ui';
import { compareOrgCharts, OrgChartSnapshot, OrgChartVersion } from './org-chart';

export function OrgChartVersions({ companyId, selectedId, onSelect, canEdit, live, ready }: {
  companyId: string | null; selectedId: string; onSelect: (id: string) => void;
  canEdit: boolean; live: OrgChartSnapshot; ready: boolean;
}) {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [comparing, setComparing] = useState(false);
  const [compareId, setCompareId] = useState('');
  useEffect(() => { setSaving(false); setComparing(false); setCompareId(''); setTitle(''); setNote(''); }, [companyId]);
  const versions = useQuery({ queryKey: ['org-chart-versions', companyId],
    queryFn: () => api.get<Omit<OrgChartVersion, 'snapshot'>[]>('/hr/org-chart/versions') });
  const comparison = useQuery({ queryKey: ['org-chart-version', companyId, compareId], enabled: comparing && !!compareId,
    queryFn: () => api.get<OrgChartVersion>(`/hr/org-chart/versions/${encodeURIComponent(compareId)}`) });
  const changes = useMemo(() => comparison.data ? compareOrgCharts(comparison.data.snapshot, live) : [], [comparison.data, live]);
  const save = useMutation({ mutationFn: () => api.post('/hr/org-chart/versions', { title: title.trim(), note: note.trim() || undefined }),
    onSuccess: async () => { await client.invalidateQueries({ queryKey: ['org-chart-versions', companyId] });
      setSaving(false); setTitle(''); setNote(''); toast(t('hr.versionSaved')); } });
  const formatDate = (value: string) => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Berlin' }).format(new Date(value));
  const selected = versions.data?.find((row) => row.id === selectedId);
  const value = (field: string, text: string | null) => text === null ? '—' : field === 'status' ? t(`hr.positionStatus.${text}`) : text;
  return <section aria-label={t('hr.orgChartVersions')} className="mb-4 space-y-2 rounded-lg border border-border bg-card p-3">
    <div className="flex flex-wrap items-end gap-3">
      <Field label={t('hr.orgChartVersions')} className="min-w-60 flex-1">
        <SelectInput value={selectedId} onChange={(event) => onSelect(event.target.value)}>
          <option value="">{t('hr.liveChart')}</option>
          {versions.data?.map((row) => <option key={row.id} value={row.id}>v{row.version} · {row.title} · {formatDate(row.createdAt)}</option>)}
        </SelectInput>
      </Field>
      {canEdit && <Button variant="secondary" disabled={!ready || !!selectedId} onClick={() => { save.reset(); setSaving(true); }}>{t('hr.saveVersion')}</Button>}
      <Button variant="secondary" disabled={!ready || !versions.data?.length} onClick={() => {
        setCompareId(selectedId || versions.data?.[0].id || ''); setComparing(true);
      }}>{t('hr.compareWithLive')}</Button>
    </div>
    {versions.error && <p role="alert" className="text-sm text-destructive">{versions.error.message}</p>}
    {selected && <p className="text-xs text-muted-foreground">
      {t('hr.historicalChart')} · {selected.createdBy.firstName} {selected.createdBy.lastName} · {formatDate(selected.createdAt)}
      {selected.note ? ` · ${selected.note}` : ''}
    </p>}
    <Dialog open={saving} onClose={() => { if (!save.isPending) setSaving(false); }} title={t('hr.saveVersion')}>
      <div className="space-y-3">
        <Field label={t('hr.versionTitle')} required><TextInput maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} /></Field>
        <Field label={t('hr.versionNote')}><TextArea maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} /></Field>
        <p className="text-xs text-muted-foreground">{t('hr.versionSaveHint')}</p>
        {save.error && <p role="alert" className="text-sm text-destructive">{save.error.message}</p>}
        <div className="flex justify-end gap-2"><Button variant="secondary" disabled={save.isPending} onClick={() => setSaving(false)}>{t('common.cancel')}</Button>
          <Button disabled={!title.trim() || save.isPending} onClick={() => save.mutate()}>{t(save.isPending ? 'common.loading' : 'common.save')}</Button></div>
      </div>
    </Dialog>
    <Dialog open={comparing} onClose={() => setComparing(false)} title={t('hr.compareWithLive')} width="max-w-5xl">
      <Field label={t('hr.savedVersion')}><SelectInput value={compareId} onChange={(event) => setCompareId(event.target.value)}>
        {versions.data?.map((row) => <option key={row.id} value={row.id}>v{row.version} · {row.title}</option>)}
      </SelectInput></Field>
      {comparison.error ? <p role="alert" className="mt-3 text-destructive">{comparison.error.message}</p>
        : comparison.isLoading || !comparison.data ? <p className="mt-3">{t('common.loading')}</p>
          : !changes.length ? <p className="mt-3 text-sm">{t('hr.noVersionChanges')}</p>
            : <div className="mt-3 max-h-[60vh] overflow-auto"><table className="w-full text-left text-sm">
              <thead><tr className="border-b border-border"><th className="p-2">{t('hr.chartItem')}</th><th className="p-2">{t('hr.change')}</th><th className="p-2">{t('hr.savedVersion')}</th><th className="p-2">{t('hr.liveChart')}</th></tr></thead>
              <tbody>{changes.map((change) => <tr key={`${change.entity}:${change.id}`} className="border-b border-border align-top">
                <td className="p-2">{change.label}<div className="text-xs text-muted-foreground">{t(`hr.${change.entity}`)}</div></td>
                <td className="p-2">{t(`hr.versionChange.${change.kind}`)}</td>
                <td className="p-2">{change.fields.map((field) => <div key={field.field}>{t(`hr.chartFields.${field.field}`)}: {value(field.field, field.before)}</div>)}</td>
                <td className="p-2">{change.fields.map((field) => <div key={field.field}>{t(`hr.chartFields.${field.field}`)}: {value(field.field, field.after)}</div>)}</td>
              </tr>)}</tbody>
            </table></div>}
    </Dialog>
  </section>;
}
