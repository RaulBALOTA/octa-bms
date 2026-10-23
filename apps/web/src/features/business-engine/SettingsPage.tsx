import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2 } from 'lucide-react';
import type { EngineConfig } from '../../../../../packages/shared/src/business-engine';
import { Button, Field, SelectInput, TextInput } from '../../components/ui';
import { EngineNav, IllustrativeBanner, NoAccess, PageHeader, QueryState, Section, useCan } from './components';
import { enginePut, useEngineMutation, useEngineQuery } from './queries';
import { useFormat } from './format';

interface SettingsDto { version: number; config: EngineConfig; confirmedAt: string | null; updatedAt: string | null; engineVersion: string }
type Json = string | number | boolean | null | Json[] | { [k: string]: Json };
const ENUMS: Record<string, string[]> = {
  'calendar.holidayRegion': ['DE_NATIONAL', 'NONE'], probabilitySource: ['OPPORTUNITY', 'STAGE'], 'overhead.allocation.method': ['NONE', 'PERCENT_OF_REVENUE', 'RATE_PER_INTERNAL_HOUR', 'PERCENT_OF_DIRECT_COST'],
  'cash.openingCashSource': ['BANK', 'MANUAL'], 'optimization.basis': ['IF_WON', 'EXPECTED'], currency: ['EUR', 'CHF', 'GBP', 'USD', 'PLN', 'CZK', 'DKK', 'SEK'],
};

export function EngineSettingsPage() {
  const { t } = useTranslation(); const can = useCan(); const fmt = useFormat();
  const settings = useEngineQuery<SettingsDto>(['settings'], can('engine.settings.read') ? '/settings' : null);
  const revisions = useEngineQuery<{ version: number; note: string | null; createdAt: string }[]>(['settings-revisions'], can('engine.settings.read') ? '/settings/revisions' : null);
  const [draft, setDraft] = useState<Record<string, Json> | null>(null); const [note, setNote] = useState('');
  useEffect(() => { if (settings.data) setDraft(structuredClone(settings.data.config) as unknown as Record<string, Json>); }, [settings.data]);
  const save = useEngineMutation((confirm: boolean) => { const { illustrative: _i, ...config } = draft as Record<string, Json>;
    return enginePut('/settings', { config, note: note || undefined, confirm, expectedVersion: settings.data?.version }); }, { success: t('common.saved'), onSuccess: () => setNote('') });
  if (!can('engine.settings.read')) return <><EngineNav /><NoAccess permission="engine.settings.read" /></>;
  const setAt = (path: string[], value: Json) => setDraft((d) => {
    const next = structuredClone(d) as Record<string, Json>; let cur = next as Record<string, Json>;
    for (const k of path.slice(0, -1)) cur = cur[k] as Record<string, Json>;
    cur[path[path.length - 1]] = value; return next;
  });
  const editable = can('engine.settings.update');
  const leaf = (path: string[], value: Json) => {
    const key = path.join('.'); const label = t(`engine.settings.field.${path.join('__')}`, { defaultValue: path[path.length - 1] });
    if (ENUMS[key]) return <Field key={key} label={label}><SelectInput value={String(value)} onChange={(e) => setAt(path, e.target.value)}>{ENUMS[key].map((o) => <option key={o} value={o}>{t(`engine.settings.enum.${o}`, { defaultValue: o })}</option>)}</SelectInput></Field>;
    if (typeof value === 'boolean') return <label key={key} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={value} onChange={(e) => setAt(path, e.target.checked)} />{label}</label>;
    if (typeof value === 'number') return <Field key={key} label={label}><TextInput type="number" step="any" value={value} onChange={(e) => setAt(path, e.target.value === '' ? 0 : Number(e.target.value))} /></Field>;
    if (Array.isArray(value) && value.every((v) => typeof v === 'string')) return <Field key={key} label={label} className="col-span-2"><TextInput value={value.join(', ')} placeholder="YYYY-MM-DD, …" onChange={(e) => setAt(path, e.target.value.split(',').map((x) => x.trim()).filter(Boolean))} /></Field>;
    return <Field key={key} label={label}><TextInput value={String(value ?? '')} onChange={(e) => setAt(path, e.target.value)} /></Field>;
  };
  const group = (path: string[], value: Record<string, Json>): JSX.Element[] => Object.entries(value).flatMap(([k, v]) => {
    const p = [...path, k];
    if (p.join('.') === 'overhead.monthly') return [<OverheadEditor key="ov" lines={v as { category: string; amount: string }[]} onChange={(lines) => setAt(p, lines as unknown as Json)} />];
    if (v && typeof v === 'object' && !Array.isArray(v)) return [<div key={p.join('.')} className="col-span-full mt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t(`engine.settings.field.${p.join('__')}`, { defaultValue: k })}</div>, ...group(p, v as Record<string, Json>)];
    return [leaf(p, v)];
  });
  return (
    <>
      <EngineNav />
      <PageHeader title={t('engine.settings.title')} subtitle={settings.data ? t('engine.settings.subtitle', { version: settings.data.version, engine: settings.data.engineVersion, confirmed: settings.data.confirmedAt ? fmt.dateTime(settings.data.confirmedAt) : '—' }) : undefined} />
      <QueryState query={settings}>{settings.data && draft && <>
        <IllustrativeBanner show={settings.data.config.illustrative} />
        <fieldset disabled={!editable || save.isPending}>
          <div className="grid gap-3 xl:grid-cols-2">
            {Object.entries(draft).filter(([k]) => k !== 'illustrative').map(([k, v]) => (
              <Section key={k} title={t(`engine.settings.section.${k}`, { defaultValue: k })}>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-3">{v && typeof v === 'object' && !Array.isArray(v) ? group([k], v as Record<string, Json>) : leaf([k], v)}</div>
              </Section>))}
          </div>
          {editable && <div className="sticky bottom-0 mt-3 flex flex-wrap items-end gap-2 border-t border-border bg-background py-2">
            <Field label={t('engine.settings.note')} className="w-80"><TextInput value={note} onChange={(e) => setNote(e.target.value)} /></Field>
            <Button onClick={() => save.mutate(false)}>{t('common.save', { defaultValue: 'Save' })}</Button>
            {settings.data.config.illustrative && <Button variant="secondary" onClick={() => confirm(t('engine.settings.confirmQuestion')) && save.mutate(true)}>{t('engine.settings.confirm')}</Button>}
          </div>}
        </fieldset>
        <Section title={t('engine.settings.revisions')} className="mt-3">
          <ul className="text-[11px] text-muted-foreground">{revisions.data?.map((r) => <li key={r.version}>v{r.version} · {fmt.dateTime(r.createdAt)}{r.note ? ` · ${r.note}` : ''}</li>)}</ul>
          {!revisions.data?.length && <p className="text-xs text-muted-foreground">{t('engine.settings.noRevisions')}</p>}
        </Section>
      </>}</QueryState>
    </>
  );
}

function OverheadEditor({ lines, onChange }: { lines: { category: string; amount: string }[]; onChange: (lines: { category: string; amount: string }[]) => void }) {
  const { t } = useTranslation();
  return (
    <div className="col-span-full">
      <div className="mb-1 text-xs font-medium text-muted-foreground">{t('engine.settings.field.overhead__monthly')}</div>
      {lines.map((l, i) => <div key={i} className="mb-1 flex gap-2"><TextInput className="h-7 py-0 text-xs" value={l.category} placeholder={t('engine.settings.category')} onChange={(e) => onChange(lines.map((x, j) => (j === i ? { ...x, category: e.target.value } : x)))} />
        <TextInput className="h-7 w-32 py-0 text-xs" value={l.amount} placeholder="0.00" onChange={(e) => onChange(lines.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
        <button type="button" aria-label={t('engine.common.remove')} onClick={() => onChange(lines.filter((_, j) => j !== i))}><Trash2 size={13} /></button></div>)}
      <Button size="sm" type="button" variant="secondary" onClick={() => onChange([...lines, { category: '', amount: '0.00' }])}><Plus size={12} />{t('engine.common.add')}</Button>
    </div>
  );
}
