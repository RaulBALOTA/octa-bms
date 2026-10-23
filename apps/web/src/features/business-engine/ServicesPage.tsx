import { Fragment, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2 } from 'lucide-react';
import type { ServiceAttractiveness, ServiceBenchmark } from '../../../../../packages/shared/src/business-engine';
import { Button, Drawer, Field, SelectInput, Tabs, TextArea, TextInput } from '../../components/ui';
import { EngineNav, NoAccess, PageHeader, QueryState, Section, Table, td, tdNum, useCan } from './components';
import { engineDelete, enginePost, enginePut, useEngineMutation, useEngineQuery } from './queries';
import { useFormat } from './format';

const CATEGORIES = ['STRATEGY', 'PROJECT_MANAGEMENT', 'ENGINEERING', 'PERMITTING', 'PROCUREMENT', 'CONSTRUCTION_MANAGEMENT', 'COMMISSIONING'];
const FEE_MODELS = ['FIXED_FEE', 'TIME_AND_MATERIALS', 'DAILY_RATE', 'RETAINER', 'MILESTONE', 'CAPEX_PERCENT', 'HYBRID'];
const DELIVERY = ['INTERNAL', 'FREELANCE', 'SUBCONTRACT', 'PARTNER', 'HYBRID'];
const LIFECYCLE_NEXT: Record<string, string[]> = {
  PROPOSED: ['EXPERIMENTAL', 'COMMERCIAL', 'RETIRED'], EXPERIMENTAL: ['COMMERCIAL', 'UNDER_REVIEW', 'RETIRED'], COMMERCIAL: ['GROWING', 'CORE', 'UNDER_REVIEW', 'RETIRED'],
  GROWING: ['CORE', 'COMMERCIAL', 'UNDER_REVIEW', 'RETIRED'], CORE: ['GROWING', 'UNDER_REVIEW', 'RETIRED'], UNDER_REVIEW: ['COMMERCIAL', 'GROWING', 'CORE', 'RETIRED'], RETIRED: ['UNDER_REVIEW'],
};
const SENIORITY = ['JUNIOR', 'PROFESSIONAL', 'SENIOR', 'LEAD', 'PRINCIPAL'];
const SCORES = ['commercialRisk', 'technicalRisk', 'contractualRisk', 'strategicImportance', 'repeatability', 'scalability', 'crossSelling', 'referenceValue'] as const;

interface Requirement { skillId: string | null; role: string; seniority: string; typicalHours: number | string; internalSharePct: number | string; costRate: string | null; externalRate: string | null; billRate: string | null; skill?: { name: string } | null }
type Service = {
  id: string; code: string; name: string; description: string | null; category: string; parentId: string | null; lifecycle: string; revenueModel: string; deliveryModel: string;
  externalDeliveryAllowed: boolean; typicalDurationWeeks: number | null; targetHourlyRate: string | null; targetMarginPct: string | null; version: number; ownerEmployeeId: string | null;
  contractModel: string | null; workingCapitalProfile: string | null; targetSegments: string[]; projectTypes: string[]; requirements: Requirement[];
  lifecycleEvents?: { id: string; fromState: string | null; toState: string; reason: string | null; createdAt: string }[]; versions?: { version: number; note: string | null; createdAt: string }[];
} & Partial<Record<(typeof SCORES)[number], number | null>>;
interface Skill { id: string; name: string; nameDe: string | null; category: string; parentId: string | null; _count: { employeeSkills: number; engineResourceSkills: number; engineRequirements: number } }
interface Pkg { id: string; code: string; name: string; description: string | null; isActive: boolean; version: number; items: { serviceId: string; hoursFactor: string; feeOverride: string | null; service: { code: string; name: string } }[] }

export function EngineServicesPage() {
  const { t } = useTranslation();
  const can = useCan();
  const [tab, setTab] = useState('catalog');
  if (!can('engine.services.read')) return <><EngineNav /><NoAccess permission="engine.services.read" /></>;
  return (
    <>
      <EngineNav />
      <PageHeader title={t('engine.services.title')} subtitle={t('engine.services.subtitle')} />
      <Tabs active={tab} onChange={setTab} tabs={[{ key: 'catalog', label: t('engine.services.catalog') }, { key: 'packages', label: t('engine.services.packages') },
        { key: 'skills', label: t('engine.services.skills') }, { key: 'performance', label: t('engine.services.performance') }]} />
      <div className="mt-3">
        {tab === 'catalog' && <Catalog />}{tab === 'packages' && <Packages />}{tab === 'skills' && <Skills />}{tab === 'performance' && <Performance />}
      </div>
    </>
  );
}

function Catalog() {
  const { t } = useTranslation();
  const can = useCan();
  const [category, setCategory] = useState(''); const [q, setQ] = useState('');
  const services = useEngineQuery<Service[]>(['services', category, q], `/services?${new URLSearchParams({ ...(category ? { category } : {}), ...(q ? { q } : {}) })}`);
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const apply = useEngineMutation(() => enginePost<{ skills: number; services: number; packages: number }>('/templates/apply'), { onSuccess: (r) => alert(t('engine.services.templatesApplied', r)) });
  const ordered = useMemo(() => {
    const rows = services.data ?? []; const byParent = new Map<string | null, Service[]>();
    for (const s of rows) { const p = s.parentId && rows.some((x) => x.id === s.parentId) ? s.parentId : null; byParent.set(p, [...(byParent.get(p) ?? []), s]); }
    const out: { s: Service; depth: number }[] = [];
    const walk = (p: string | null, depth: number) => { for (const s of byParent.get(p) ?? []) { out.push({ s, depth }); walk(s.id, depth + 1); } };
    walk(null, 0); return out;
  }, [services.data]);
  return (
    <Section title={t('engine.services.catalog')} actions={<div className="flex gap-2">
      <SelectInput className="h-7 w-48 py-0 text-xs" value={category} onChange={(e) => setCategory(e.target.value)}><option value="">{t('engine.filters.all')}</option>{CATEGORIES.map((c) => <option key={c} value={c}>{t(`engine.category.${c}`)}</option>)}</SelectInput>
      <TextInput className="h-7 w-40 py-0 text-xs" placeholder={t('engine.common.search')} value={q} onChange={(e) => setQ(e.target.value)} />
      {can('engine.services.create') && <Button size="sm" variant="secondary" disabled={apply.isPending} onClick={() => apply.mutate(undefined)}>{t('engine.services.applyTemplates')}</Button>}
      {can('engine.services.create') && <Button size="sm" onClick={() => setEditing('new')}><Plus size={13} />{t('engine.services.new')}</Button>}
    </div>}>
      <QueryState query={services} empty={!services.data?.length}>
        <Table head={[t('engine.col.code'), t('engine.col.service'), t('engine.col.category'), t('engine.col.lifecycle'), t('engine.col.revenueModel'), t('engine.col.delivery'), t('engine.col.typicalHours'), t('engine.col.version')]}>
          {ordered.map(({ s, depth }) => (
            <tr key={s.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setEditing(s.id)}>
              <td className={td}><span className="font-mono">{s.code}</span></td>
              <td className={td} style={{ paddingLeft: 8 + depth * 14 }}>{depth > 0 && '↳ '}{s.name}</td>
              <td className={td}>{t(`engine.category.${s.category}`, { defaultValue: s.category })}</td>
              <td className={td}><span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium">{t(`engine.lifecycle.${s.lifecycle}`)}</span></td>
              <td className={td}>{t(`engine.fee.${s.revenueModel}`)}</td><td className={td}>{t(`engine.delivery.${s.deliveryModel}`)}</td>
              <td className={tdNum}>{s.requirements.reduce((x, r) => x + Number(r.typicalHours), 0)}</td><td className={tdNum}>v{s.version}</td>
            </tr>
          ))}
        </Table>
      </QueryState>
      {editing && <ServiceEditor id={editing === 'new' ? null : editing} services={services.data ?? []} onClose={() => setEditing(null)} />}
    </Section>
  );
}

function emptyService(): Service {
  return { id: '', code: '', name: '', description: '', category: 'PROJECT_MANAGEMENT', parentId: null, lifecycle: 'PROPOSED', revenueModel: 'TIME_AND_MATERIALS', deliveryModel: 'INTERNAL', externalDeliveryAllowed: true,
    typicalDurationWeeks: null, targetHourlyRate: null, targetMarginPct: null, version: 0, ownerEmployeeId: null, contractModel: null, workingCapitalProfile: null, targetSegments: [], projectTypes: [], requirements: [] };
}

function ServiceEditor({ id, services, onClose }: { id: string | null; services: Service[]; onClose: () => void }) {
  const { t } = useTranslation();
  const can = useCan(); const fmt = useFormat();
  const detail = useEngineQuery<Service>(['service', id], id ? `/services/${id}` : null);
  const skills = useEngineQuery<Skill[]>(['skills'], '/skills');
  const refs = useEngineQuery<{ employees: { id: string; name: string }[] }>(['references'], can('engine.portfolio.read') ? '/assignments/references' : null);
  const [draft, setDraft] = useState<Service | null>(id ? null : emptyService());
  const [note, setNote] = useState(''); const [reason, setReason] = useState('');
  useEffect(() => { if (detail.data) setDraft(structuredClone(detail.data)); }, [detail.data]);
  const save = useEngineMutation(() => {
    const d = draft as Service;
    const body = { code: d.code, name: d.name, description: d.description || null, category: d.category, parentId: d.parentId || null, ownerEmployeeId: d.ownerEmployeeId || null,
      revenueModel: d.revenueModel, deliveryModel: d.deliveryModel, externalDeliveryAllowed: d.externalDeliveryAllowed, typicalDurationWeeks: d.typicalDurationWeeks ? Number(d.typicalDurationWeeks) : null,
      targetHourlyRate: d.targetHourlyRate || null, targetMarginPct: d.targetMarginPct === null || d.targetMarginPct === '' ? null : Number(d.targetMarginPct), contractModel: d.contractModel || null,
      workingCapitalProfile: d.workingCapitalProfile || null, targetSegments: d.targetSegments, projectTypes: d.projectTypes,
      ...Object.fromEntries(SCORES.map((k) => [k, d[k] ? Number(d[k]) : null])),
      requirements: d.requirements.map((r) => ({ skillId: r.skillId || null, role: r.role, seniority: r.seniority, typicalHours: Number(r.typicalHours), internalSharePct: Number(r.internalSharePct),
        ...(can('engine.economics.read') ? { costRate: r.costRate || null, externalRate: r.externalRate || null } : {}), billRate: r.billRate || null })),
      versionNote: note || undefined, ...(id ? { expectedVersion: d.version } : {}) };
    return id ? enginePut(`/services/${id}`, body) : enginePost('/services', body);
  }, { success: t('common.saved'), onSuccess: () => { if (!id) onClose(); } });
  const transition = useEngineMutation((toState: string) => enginePost(`/services/${id}/lifecycle`, { toState, reason: reason || undefined }), { success: t('common.saved') });
  const archive = useEngineMutation(() => engineDelete(`/services/${id}`), { onSuccess: onClose });
  const editable = can(id ? 'engine.services.update' : 'engine.services.create');
  const set = (patch: Partial<Service>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const setReq = (i: number, patch: Partial<Requirement>) => setDraft((d) => (d ? { ...d, requirements: d.requirements.map((r, j) => (j === i ? { ...r, ...patch } : r)) } : d));
  return (
    <Drawer open onClose={onClose} width="w-[760px]">
      <div className="flex items-center justify-between border-b border-border px-4 py-3"><h2 className="text-sm font-semibold">{id ? draft?.name : t('engine.services.new')}</h2>
        <Button size="sm" variant="ghost" onClick={onClose}>{t('common.close', { defaultValue: 'Close' })}</Button></div>
      <div className="flex-1 overflow-y-auto p-4">
        {!draft ? <QueryState query={detail}><span /></QueryState> : (
          <fieldset disabled={!editable || save.isPending} className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <Field label={t('engine.col.code')} required><TextInput value={draft.code} onChange={(e) => set({ code: e.target.value })} /></Field>
              <Field label={t('engine.col.service')} required className="col-span-2"><TextInput value={draft.name} onChange={(e) => set({ name: e.target.value })} /></Field>
              <Field label={t('engine.col.category')}><SelectInput value={draft.category} onChange={(e) => set({ category: e.target.value })}>{CATEGORIES.map((c) => <option key={c} value={c}>{t(`engine.category.${c}`)}</option>)}</SelectInput></Field>
              <Field label={t('engine.services.parent')}><SelectInput value={draft.parentId ?? ''} onChange={(e) => set({ parentId: e.target.value || null })}><option value="">—</option>
                {services.filter((s) => s.id !== id).map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</SelectInput></Field>
              <Field label={t('engine.services.owner')}><SelectInput value={draft.ownerEmployeeId ?? ''} onChange={(e) => set({ ownerEmployeeId: e.target.value || null })}><option value="">—</option>
                {refs.data?.employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</SelectInput></Field>
              <Field label={t('engine.col.revenueModel')}><SelectInput value={draft.revenueModel} onChange={(e) => set({ revenueModel: e.target.value })}>{FEE_MODELS.map((m) => <option key={m} value={m}>{t(`engine.fee.${m}`)}</option>)}</SelectInput></Field>
              <Field label={t('engine.col.delivery')}><SelectInput value={draft.deliveryModel} onChange={(e) => set({ deliveryModel: e.target.value })}>{DELIVERY.map((m) => <option key={m} value={m}>{t(`engine.delivery.${m}`)}</option>)}</SelectInput></Field>
              <Field label={t('engine.services.durationWeeks')}><TextInput type="number" min={1} value={draft.typicalDurationWeeks ?? ''} onChange={(e) => set({ typicalDurationWeeks: e.target.value ? Number(e.target.value) : null })} /></Field>
              <Field label={t('engine.services.targetRate')}><TextInput inputMode="decimal" value={draft.targetHourlyRate ?? ''} onChange={(e) => set({ targetHourlyRate: e.target.value || null })} /></Field>
              <Field label={t('engine.services.targetMargin')}><TextInput inputMode="decimal" value={draft.targetMarginPct ?? ''} onChange={(e) => set({ targetMarginPct: e.target.value || null })} /></Field>
              <Field label={t('engine.services.contractModel')}><TextInput value={draft.contractModel ?? ''} onChange={(e) => set({ contractModel: e.target.value || null })} /></Field>
              <Field label={t('engine.services.segments')} className="col-span-2"><TextInput value={draft.targetSegments.join(', ')} onChange={(e) => set({ targetSegments: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} /></Field>
              <Field label={t('engine.services.projectTypes')}><TextInput value={draft.projectTypes.join(', ')} onChange={(e) => set({ projectTypes: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} /></Field>
              <label className="col-span-3 flex items-center gap-2 text-xs"><input type="checkbox" checked={draft.externalDeliveryAllowed} onChange={(e) => set({ externalDeliveryAllowed: e.target.checked })} />{t('engine.services.externalAllowed')}</label>
            </div>
            <Field label={t('engine.services.description')}><TextArea value={draft.description ?? ''} onChange={(e) => set({ description: e.target.value })} /></Field>
            <div>
              <h3 className="mb-1 text-xs font-semibold">{t('engine.services.assessments')}</h3>
              <p className="mb-1 text-[11px] text-muted-foreground">{t('engine.services.assessmentHint')}</p>
              <div className="grid grid-cols-4 gap-2">{SCORES.map((k) => (
                <Field key={k} label={t(`engine.score.${k}`)}><SelectInput value={draft[k] ?? ''} onChange={(e) => set({ [k]: e.target.value ? Number(e.target.value) : null } as Partial<Service>)}>
                  <option value="">—</option>{[1, 2, 3, 4, 5].map((v) => <option key={v} value={v}>{v}</option>)}</SelectInput></Field>))}</div>
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between"><h3 className="text-xs font-semibold">{t('engine.services.requirements')}</h3>
                <Button size="sm" variant="secondary" type="button" onClick={() => set({ requirements: [...draft.requirements, { skillId: null, role: '', seniority: 'PROFESSIONAL', typicalHours: 0, internalSharePct: 100, costRate: null, externalRate: null, billRate: null }] })}><Plus size={12} />{t('engine.common.add')}</Button></div>
              <Table head={[t('engine.col.skill'), t('engine.col.role'), t('engine.col.seniority'), t('engine.col.hours'), t('engine.col.internalShare'), ...(can('engine.economics.read') ? [t('engine.col.costRate'), t('engine.col.externalRate')] : []), t('engine.col.billRate'), '']}>
                {draft.requirements.map((r, i) => (
                  <tr key={i}>
                    <td className="p-1"><SelectInput className="h-7 py-0 text-xs" value={r.skillId ?? ''} onChange={(e) => setReq(i, { skillId: e.target.value || null })}><option value="">—</option>{skills.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</SelectInput></td>
                    <td className="p-1"><TextInput className="h-7 py-0 text-xs" value={r.role} onChange={(e) => setReq(i, { role: e.target.value })} /></td>
                    <td className="p-1"><SelectInput className="h-7 py-0 text-xs" value={r.seniority} onChange={(e) => setReq(i, { seniority: e.target.value })}>{SENIORITY.map((s) => <option key={s} value={s}>{t(`engine.seniority.${s}`)}</option>)}</SelectInput></td>
                    <td className="p-1"><TextInput className="h-7 w-20 py-0 text-xs" type="number" min={0} value={r.typicalHours} onChange={(e) => setReq(i, { typicalHours: e.target.value })} /></td>
                    <td className="p-1"><TextInput className="h-7 w-16 py-0 text-xs" type="number" min={0} max={100} value={r.internalSharePct} onChange={(e) => setReq(i, { internalSharePct: e.target.value })} /></td>
                    {can('engine.economics.read') && <><td className="p-1"><TextInput className="h-7 w-20 py-0 text-xs" value={r.costRate ?? ''} onChange={(e) => setReq(i, { costRate: e.target.value || null })} /></td>
                      <td className="p-1"><TextInput className="h-7 w-20 py-0 text-xs" value={r.externalRate ?? ''} onChange={(e) => setReq(i, { externalRate: e.target.value || null })} /></td></>}
                    <td className="p-1"><TextInput className="h-7 w-20 py-0 text-xs" value={r.billRate ?? ''} onChange={(e) => setReq(i, { billRate: e.target.value || null })} /></td>
                    <td className="p-1"><button type="button" aria-label={t('engine.common.remove')} onClick={() => set({ requirements: draft.requirements.filter((_, j) => j !== i) })}><Trash2 size={13} /></button></td>
                  </tr>
                ))}
              </Table>
            </div>
            {id && <Field label={t('engine.services.versionNote')}><TextInput value={note} onChange={(e) => setNote(e.target.value)} /></Field>}
            <div className="flex gap-2"><Button type="button" onClick={() => save.mutate(undefined)} disabled={!draft.code || !draft.name}>{t('common.save', { defaultValue: 'Save' })}</Button>
              {id && can('engine.services.delete') && <Button type="button" variant="destructive" onClick={() => confirm(t('engine.services.archiveConfirm')) && archive.mutate(undefined)}>{t('engine.common.archive')}</Button>}</div>
          </fieldset>
        )}
        {id && draft && (
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            <Section title={t('engine.services.lifecycle')}>
              <p className="mb-2 text-xs">{t('engine.services.currentState')}: <b>{t(`engine.lifecycle.${draft.lifecycle}`)}</b></p>
              {can('engine.services.update') && <div className="mb-2 flex flex-wrap gap-1">
                <TextInput className="h-7 py-0 text-xs" placeholder={t('engine.services.reason')} value={reason} onChange={(e) => setReason(e.target.value)} />
                {LIFECYCLE_NEXT[draft.lifecycle].map((s) => <Button key={s} size="sm" variant="secondary" onClick={() => transition.mutate(s)}>→ {t(`engine.lifecycle.${s}`)}</Button>)}</div>}
              <ul className="space-y-0.5 text-[11px] text-muted-foreground">{detail.data?.lifecycleEvents?.map((e) => <li key={e.id}>{fmt.dateTime(e.createdAt)} · {e.fromState ?? '∅'} → {e.toState}{e.reason ? ` · ${e.reason}` : ''}</li>)}</ul>
            </Section>
            <Section title={t('engine.services.versions')}>
              <ul className="space-y-0.5 text-[11px] text-muted-foreground">{detail.data?.versions?.map((v) => <li key={v.version}>v{v.version} · {fmt.dateTime(v.createdAt)}{v.note ? ` · ${v.note}` : ''}</li>)}</ul>
            </Section>
          </div>
        )}
      </div>
    </Drawer>
  );
}

function Packages() {
  const { t } = useTranslation();
  const can = useCan();
  const packages = useEngineQuery<Pkg[]>(['packages'], '/packages');
  const services = useEngineQuery<Service[]>(['services'], '/services');
  const [draft, setDraft] = useState<{ id?: string; code: string; name: string; description: string; isActive: boolean; version?: number; items: { serviceId: string; hoursFactor: string; feeOverride: string }[] } | null>(null);
  const save = useEngineMutation(() => {
    const d = draft as NonNullable<typeof draft>;
    const body = { code: d.code, name: d.name, description: d.description || null, isActive: d.isActive, items: d.items.filter((i) => i.serviceId).map((i) => ({ serviceId: i.serviceId, hoursFactor: Number(i.hoursFactor || 1), feeOverride: i.feeOverride || null })),
      ...(d.id ? { expectedVersion: d.version } : {}) };
    return d.id ? enginePut(`/packages/${d.id}`, body) : enginePost('/packages', body);
  }, { success: t('common.saved'), onSuccess: () => setDraft(null) });
  return (
    <Section title={t('engine.services.packages')} actions={can('engine.services.create') && <Button size="sm" onClick={() => setDraft({ code: '', name: '', description: '', isActive: true, items: [] })}><Plus size={13} />{t('engine.services.newPackage')}</Button>}>
      <p className="mb-2 text-[11px] text-muted-foreground">{t('engine.services.packageHint')}</p>
      <QueryState query={packages} empty={!packages.data?.length}>
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">{packages.data?.map((p) => (
          <button key={p.id} className="rounded-md border border-border p-2 text-left hover:bg-muted/50" onClick={() => setDraft({ id: p.id, code: p.code, name: p.name, description: p.description ?? '', isActive: p.isActive, version: p.version,
            items: p.items.map((i) => ({ serviceId: i.serviceId, hoursFactor: i.hoursFactor, feeOverride: i.feeOverride ?? '' })) })}>
            <div className="text-xs font-semibold">{p.name} <span className="font-mono text-muted-foreground">{p.code}</span> {!p.isActive && <span className="text-muted-foreground">({t('engine.common.inactive')})</span>}</div>
            <ul className="mt-1 text-[11px] text-muted-foreground">{p.items.map((i) => <li key={i.serviceId}>{i.service.code} · {i.service.name}{Number(i.hoursFactor) !== 1 ? ` ×${Number(i.hoursFactor)}` : ''}</li>)}</ul>
          </button>))}</div>
      </QueryState>
      {draft && (
        <Drawer open onClose={() => setDraft(null)} width="w-[620px]">
          <div className="border-b border-border px-4 py-3 text-sm font-semibold">{draft.id ? draft.name : t('engine.services.newPackage')}</div>
          <fieldset disabled={!can(draft.id ? 'engine.services.update' : 'engine.services.create')} className="flex-1 space-y-3 overflow-y-auto p-4">
            <div className="grid grid-cols-3 gap-2">
              <Field label={t('engine.col.code')} required><TextInput value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value })} /></Field>
              <Field label={t('engine.col.name')} required className="col-span-2"><TextInput value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
            </div>
            <Field label={t('engine.services.description')}><TextArea value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></Field>
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={draft.isActive} onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })} />{t('engine.common.active')}</label>
            <Table head={[t('engine.col.service'), t('engine.col.hoursFactor'), t('engine.col.feeOverride'), '']}>
              {draft.items.map((it, i) => (
                <tr key={i}>
                  <td className="p-1"><SelectInput className="h-7 py-0 text-xs" value={it.serviceId} onChange={(e) => setDraft({ ...draft, items: draft.items.map((x, j) => (j === i ? { ...x, serviceId: e.target.value } : x)) })}>
                    <option value="">—</option>{services.data?.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</SelectInput></td>
                  <td className="p-1"><TextInput className="h-7 w-20 py-0 text-xs" value={it.hoursFactor} onChange={(e) => setDraft({ ...draft, items: draft.items.map((x, j) => (j === i ? { ...x, hoursFactor: e.target.value } : x)) })} /></td>
                  <td className="p-1"><TextInput className="h-7 w-28 py-0 text-xs" value={it.feeOverride} onChange={(e) => setDraft({ ...draft, items: draft.items.map((x, j) => (j === i ? { ...x, feeOverride: e.target.value } : x)) })} /></td>
                  <td className="p-1"><button type="button" aria-label={t('engine.common.remove')} onClick={() => setDraft({ ...draft, items: draft.items.filter((_, j) => j !== i) })}><Trash2 size={13} /></button></td>
                </tr>))}
            </Table>
            <Button size="sm" variant="secondary" type="button" onClick={() => setDraft({ ...draft, items: [...draft.items, { serviceId: '', hoursFactor: '1', feeOverride: '' }] })}><Plus size={12} />{t('engine.common.add')}</Button>
            <div><Button type="button" onClick={() => save.mutate(undefined)} disabled={!draft.code || !draft.name}>{t('common.save', { defaultValue: 'Save' })}</Button></div>
          </fieldset>
        </Drawer>
      )}
    </Section>
  );
}

function Skills() {
  const { t } = useTranslation();
  const can = useCan();
  const skills = useEngineQuery<Skill[]>(['skills'], '/skills');
  const [name, setName] = useState(''); const [parentId, setParentId] = useState('');
  const create = useEngineMutation(() => enginePost('/skills', { name, category: 'DISCIPLINE', parentId: parentId || null }), { success: t('common.saved'), onSuccess: () => setName('') });
  const reparent = useEngineMutation((v: { id: string; parentId: string | null }) => enginePut(`/skills/${v.id}/parent`, { parentId: v.parentId }), { success: t('common.saved') });
  const tree = useMemo(() => {
    const rows = skills.data ?? []; const out: { s: Skill; depth: number }[] = [];
    const walk = (p: string | null, depth: number) => rows.filter((s) => s.parentId === p).forEach((s) => { out.push({ s, depth }); walk(s.id, depth + 1); });
    walk(null, 0); return out;
  }, [skills.data]);
  return (
    <Section title={t('engine.services.skills')} actions={can('engine.services.create') && <div className="flex gap-2">
      <TextInput className="h-7 w-48 py-0 text-xs" placeholder={t('engine.services.newSkill')} value={name} onChange={(e) => setName(e.target.value)} />
      <SelectInput className="h-7 w-48 py-0 text-xs" value={parentId} onChange={(e) => setParentId(e.target.value)}><option value="">{t('engine.services.noParent')}</option>{skills.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</SelectInput>
      <Button size="sm" disabled={!name.trim()} onClick={() => create.mutate(undefined)}><Plus size={13} />{t('engine.common.add')}</Button></div>}>
      <p className="mb-2 text-[11px] text-muted-foreground">{t('engine.services.skillHint')}</p>
      <QueryState query={skills} empty={!skills.data?.length}>
        <Table head={[t('engine.col.skill'), t('engine.col.category'), t('engine.services.parent'), t('engine.col.usage')]}>
          {tree.map(({ s, depth }) => (
            <tr key={s.id}><td className={td} style={{ paddingLeft: 8 + depth * 14 }}>{depth > 0 && '↳ '}{s.name}</td><td className={td}>{s.category}</td>
              <td className="p-1">{can('engine.services.update') ? <SelectInput className="h-7 w-48 py-0 text-xs" value={s.parentId ?? ''} onChange={(e) => reparent.mutate({ id: s.id, parentId: e.target.value || null })}>
                <option value="">—</option>{skills.data?.filter((x) => x.id !== s.id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</SelectInput> : skills.data?.find((x) => x.id === s.parentId)?.name ?? '—'}</td>
              <td className={tdNum}>{s._count.employeeSkills + s._count.engineResourceSkills} / {s._count.engineRequirements}</td></tr>))}
        </Table>
      </QueryState>
    </Section>
  );
}

function Performance() {
  const { t } = useTranslation();
  const can = useCan(); const fmt = useFormat();
  const attractiveness = useEngineQuery<{ scores: ServiceAttractiveness[]; calculatedAt: string; illustrativeConfig: boolean }>(['attractiveness'], can('engine.economics.read') ? '/analytics/attractiveness' : null);
  const benchmarks = useEngineQuery<{ benchmarks: ServiceBenchmark[]; minSamples: number; note: string }>(['benchmarks'], '/analytics/benchmarks');
  const record = useEngineMutation(() => enginePost<{ recorded: number }>('/analytics/attractiveness/record'), { success: t('engine.services.scoresRecorded') });
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      {can('engine.economics.read') && (
        <Section title={t('engine.services.attractiveness')} actions={can('engine.services.update') && <Button size="sm" variant="secondary" onClick={() => record.mutate(undefined)}>{t('engine.services.recordScores')}</Button>}>
          <p className="mb-2 text-[11px] text-muted-foreground">{t('engine.services.attractivenessHint')}</p>
          <QueryState query={attractiveness} empty={!attractiveness.data?.scores.length}>
            <Table head={[t('engine.col.service'), t('engine.col.score'), t('engine.col.confidence'), t('engine.col.samples'), t('engine.col.action'), t('engine.col.rationale')]}>
              {[...(attractiveness.data?.scores ?? [])].sort((a, b) => (b.total ?? -1) - (a.total ?? -1)).map((s) => (
                <Fragment key={s.serviceId}>
                  <tr className="cursor-pointer hover:bg-muted/50" onClick={() => setOpen(open === s.serviceId ? null : s.serviceId)}>
                    <td className={td}><span className="font-mono">{s.code}</span> {s.name}</td><td className={tdNum}>{s.total ?? '—'}</td><td className={tdNum}>{fmt.pct(s.confidence, true)}</td>
                    <td className={tdNum}>{s.sampleCount}</td><td className={td}>{t(`engine.action.${s.suggestedAction}`)}</td><td className="px-2 py-1.5 text-muted-foreground">{s.rationale.join('; ')}</td>
                  </tr>
                  {open === s.serviceId && <tr><td colSpan={6} className="bg-muted/30 p-2">
                    <div className="grid grid-cols-2 gap-x-6 gap-y-0.5 text-[11px] md:grid-cols-3">{s.dimensions.map((d) => <div key={d.key} className="flex justify-between gap-2">
                      <span>{t(`engine.dimension.${d.key}`)} <span className="text-muted-foreground">({t(`engine.dimBasis.${d.basis}`)}, w {d.weight})</span></span><span className="tabular-nums">{d.score ?? '—'}</span></div>)}</div>
                  </td></tr>}
                </Fragment>
              ))}
            </Table>
          </QueryState>
        </Section>
      )}
      <Section title={t('engine.services.benchmarks')}>
        <p className="mb-2 text-[11px] text-muted-foreground">{t('engine.services.benchmarkHint', { min: benchmarks.data?.minSamples ?? '…' })}</p>
        <QueryState query={benchmarks} empty={!benchmarks.data?.benchmarks.length}>
          <Table head={[t('engine.col.service'), t('engine.col.samples'), t('engine.col.confidence'), t('engine.col.effortMedian'), 'P10–P90', t('engine.col.cv'), t('engine.col.outliers'), t('engine.col.marginDelta')]}>
            {benchmarks.data?.benchmarks.filter((b) => b.sampleCount > 0).map((b) => (
              <tr key={b.serviceId}><td className={td}>{b.code} · {b.name}</td><td className={tdNum}>{b.sampleCount}</td><td className={td}>{t(`engine.confidence.${b.confidence}`)}</td>
                <td className={tdNum}>{fmt.num(b.effortRatio.median)}</td><td className={tdNum}>{fmt.num(b.effortRatio.p10)}–{fmt.num(b.effortRatio.p90)}</td><td className={tdNum}>{fmt.num(b.effortRatio.cv)}</td>
                <td className={tdNum}>{b.effortRatio.outliers.length}</td><td className={tdNum}>{fmt.num(b.marginDeltaPts.median)}</td></tr>))}
          </Table>
          {!benchmarks.data?.benchmarks.some((b) => b.sampleCount > 0) && <p className="text-xs text-muted-foreground">{t('engine.services.noBenchmarks')}</p>}
        </QueryState>
      </Section>
    </div>
  );
}
