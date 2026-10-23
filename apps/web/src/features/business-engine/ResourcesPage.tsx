import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, UserPlus } from 'lucide-react';
import type { Bottleneck, Period, ResourceCapacity, SkillCapacity } from '../../../../../packages/shared/src/business-engine';
import { Button, Drawer, Field, SelectInput, TextArea, TextInput } from '../../components/ui';
import { BasisBadge, EngineNav, FilterBar, NoAccess, PageHeader, QueryState, Section, Table, td, tdNum, useCan } from './components';
import { Heatmap } from './charts';
import { engineDelete, enginePost, enginePut, filterQuery, useEngineFilters, useEngineMutation, useEngineQuery } from './queries';
import { today, useFormat } from './format';

const KINDS = ['EMPLOYEE', 'MANAGEMENT', 'PART_TIME', 'FREELANCER', 'CONSULTANT', 'SUBCONTRACTOR', 'PARTNER', 'ENGINEERING_OFFICE', 'AUTOMATION'];
const INTERNAL = new Set(['EMPLOYEE', 'MANAGEMENT', 'PART_TIME', 'AUTOMATION']);
interface Resource {
  id: string; kind: string; status: string; displayName: string; weeklyHours: string; maxAllocationPct: string; nonProjectPct: string; activeFrom: string | null; activeTo: string | null; location: string | null;
  remoteEligible: boolean; languages: string[]; restrictions: string | null; employeeId: string | null; partnerId: string | null; internal: boolean; employee: { name: string; status: string } | null;
  skills: { skillId: string; name: string; level: number; source: 'HR' | 'ENGINE' }[]; rates: { id: string; effectiveFrom: string; costRate: string; billRate: string | null; monthlyFixedCost: string | null; note: string | null }[];
  ratesRedacted: boolean; absences: { id: string; startDate: string; endDate: string; fraction: string; reason: string | null }[];
}
interface CapacityDto { weeks: Period[]; months: Period[]; calculatedAt: string; capacity: { resources: ResourceCapacity[]; skills: SkillCapacity[]; bottlenecks: Bottleneck[] }; totals: { availableHours: number; internalHours: number; utilization: number | null; shortageHours: number } }

export function EngineResourcesPage() {
  const { t } = useTranslation();
  const can = useCan(); const fmt = useFormat(); const f = useEngineFilters();
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const resources = useEngineQuery<Resource[]>(['resources'], can('engine.resources.read') ? '/resources' : null);
  const capacity = useEngineQuery<CapacityDto>(['capacity', f.mode, f.clientId, f.serviceId, f.departmentId], can('engine.resources.read') ? `/analytics/capacity?${filterQuery({ mode: f.mode, clientId: f.clientId, serviceId: f.serviceId, departmentId: f.departmentId })}` : null);
  const importEmployees = useEngineMutation(() => enginePost<{ created: number; missingWeeklyHours: number }>('/resources/import-employees'), { onSuccess: (r) => alert(t('engine.resources.imported', r)) });
  if (!can('engine.resources.read')) return <><EngineNav /><NoAccess permission="engine.resources.read" /></>;
  const c = capacity.data;
  const caps = new Map((c?.capacity.resources ?? []).map((r) => [r.id, r]));
  return (
    <>
      <EngineNav />
      <PageHeader title={t('engine.resources.title')} subtitle={t('engine.resources.subtitle')} actions={<>
        {can('engine.resources.create') && <Button variant="secondary" onClick={() => importEmployees.mutate(undefined)}><UserPlus size={14} />{t('engine.resources.import')}</Button>}
        {can('engine.resources.create') && <Button onClick={() => setEditing('new')}><Plus size={14} />{t('engine.resources.new')}</Button>}</>} />
      <FilterBar showScenario={false} />
      <QueryState query={capacity}>
        {c && <>
          <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-4">
            {[[t('engine.kpi.available'), fmt.hours(c.totals.availableHours)], [t('engine.kpi.planned'), fmt.hours(c.totals.internalHours)], [t('engine.kpi.utilization'), fmt.pct(c.totals.utilization, true)],
              [t('engine.kpi.shortageHours'), fmt.hours(c.totals.shortageHours)]].map(([k, v]) => <div key={k} className="rounded-lg border border-border bg-card p-2.5"><div className="text-[11px] uppercase tracking-wide text-muted-foreground">{k}</div><div className="text-lg font-semibold">{v}</div></div>)}
          </div>
          <Section title={<span className="flex items-center gap-2">{t('engine.resources.heatmap')} <BasisBadge basis={f.mode === 'EXPECTED' ? 'WEIGHTED' : f.mode === 'ALL_WIN' ? 'SIMULATED' : 'CONTRACTED'} /></span>} className="mb-3">
            <Heatmap columns={c.weeks.map((w) => w.key)} overLabel={t('engine.resources.overloaded')} format={(v) => fmt.pct(v, true)}
              rows={c.capacity.resources.map((r) => ({ id: r.id, label: `${r.name}${r.simulated ? ' *' : ''}`, onClick: () => setEditing(r.id),
                cells: r.weeks.map((w) => ({ value: w.available > 0 ? w.planned / w.available : w.planned > 0 ? 2 : null, detail: `${fmt.hours(w.planned)} / ${fmt.hours(w.available)}` })) }))} />
          </Section>
          <div className="mb-3 grid gap-3 xl:grid-cols-2">
            <Section title={t('engine.resources.skillGaps')}>
              <Table head={[t('engine.col.skill'), t('engine.col.demand'), t('engine.col.covered'), t('engine.col.shortage')]}>
                {c.capacity.skills.map((s) => { const dem = s.weeks.reduce((x, w) => x + w.demand, 0); const cov = s.weeks.reduce((x, w) => x + w.covered, 0); return (
                  <tr key={s.skillId ?? 'any'}><td className={td}>{s.name}</td><td className={tdNum}>{fmt.hours(dem)}</td><td className={tdNum}>{fmt.hours(cov)}</td><td className={`${tdNum} ${s.totalShortage > 0 ? 'text-destructive' : ''}`}>{fmt.hours(s.totalShortage)}</td></tr>); })}
              </Table>
              {!c.capacity.skills.length && <p className="text-xs text-muted-foreground">{t('engine.resources.noSkillDemand')}</p>}
            </Section>
            <Section title={t('engine.overview.bottlenecks')}>
              <Table head={[t('engine.col.kind'), t('engine.col.name'), t('engine.col.month'), t('engine.col.hours'), t('engine.col.assignments')]}>
                {c.capacity.bottlenecks.map((b, i) => <tr key={i}><td className={td}>{t(`engine.bottleneck.${b.kind}`)}</td><td className={td}>{b.name}</td><td className={td}>{fmt.month(b.periodKey)}</td><td className={tdNum}>{fmt.hours(b.excessHours)}</td><td className={tdNum}>{b.assignmentIds.length}</td></tr>)}
              </Table>
              {!c.capacity.bottlenecks.length && <p className="text-xs text-muted-foreground">{t('engine.overview.noBottlenecks')}</p>}
            </Section>
          </div>
        </>}
      </QueryState>
      <Section title={t('engine.resources.list')}>
        <QueryState query={resources} empty={!resources.data?.length}>
          <Table head={[t('engine.col.name'), t('engine.col.kind'), t('engine.col.status'), t('engine.col.weeklyHours'), t('engine.col.nonProject'), t('engine.col.maxAllocation'), t('engine.col.skills'), t('engine.col.available'), t('engine.col.planned'), t('engine.col.utilization'), t('engine.col.billableUtilization')]}>
            {resources.data?.map((r) => { const cap = caps.get(r.id); return (
              <tr key={r.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setEditing(r.id)}>
                <td className={td}>{r.displayName}</td><td className={td}>{t(`engine.kind.${r.kind}`)}</td><td className={td}>{t(`engine.resourceStatus.${r.status}`)}</td><td className={tdNum}>{Number(r.weeklyHours)}</td>
                <td className={tdNum}>{Number(r.nonProjectPct)} %</td><td className={tdNum}>{Number(r.maxAllocationPct)} %</td><td className="max-w-56 truncate px-2 py-1.5">{r.skills.map((s) => `${s.name} ${s.level}`).join(', ')}</td>
                <td className={tdNum}>{fmt.hours(cap?.totals.available)}</td><td className={tdNum}>{fmt.hours(cap?.totals.planned)}</td>
                <td className={`${tdNum} ${(cap?.totals.utilization ?? 0) > 1 ? 'text-destructive' : ''}`}>{fmt.pct(cap?.totals.utilization ?? null, true)}</td><td className={tdNum}>{fmt.pct(cap?.totals.billableUtilization ?? null, true)}</td>
              </tr>); })}
          </Table>
        </QueryState>
      </Section>
      {editing && <ResourceEditor id={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function ResourceEditor({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { t } = useTranslation(); const can = useCan(); const fmt = useFormat();
  const detail = useEngineQuery<Resource>(['resource', id], id ? `/resources/${id}` : null);
  const skills = useEngineQuery<{ id: string; name: string }[]>(['skills'], '/skills');
  const refs = useEngineQuery<{ employees: { id: string; name: string }[] }>(['references'], can('engine.portfolio.read') ? '/assignments/references' : null);
  const [d, setD] = useState<Partial<Resource> | null>(id ? null : { kind: 'FREELANCER', status: 'ACTIVE', displayName: '', weeklyHours: '40', remoteEligible: true, languages: [] });
  useEffect(() => { if (detail.data) setD(detail.data); }, [detail.data]);
  const [rate, setRate] = useState({ effectiveFrom: today(), costRate: '', billRate: '', monthlyFixedCost: '', note: '' });
  const [absence, setAbsence] = useState({ startDate: today(), endDate: today(), fraction: '1', reason: '' });
  const [skillRows, setSkillRows] = useState<{ skillId: string; level: number }[]>([]);
  useEffect(() => { if (detail.data && !detail.data.employeeId) setSkillRows(detail.data.skills.map((s) => ({ skillId: s.skillId, level: s.level }))); }, [detail.data]);
  const save = useEngineMutation(() => {
    const x = d as Resource; const n = (v: unknown) => (v === '' || v === undefined ? null : v);
    const body = { kind: x.kind, status: x.status, employeeId: n(x.employeeId), partnerId: n(x.partnerId), displayName: x.displayName, weeklyHours: Number(x.weeklyHours),
      ...(x.maxAllocationPct !== undefined ? { maxAllocationPct: Number(x.maxAllocationPct) } : {}), ...(x.nonProjectPct !== undefined ? { nonProjectPct: Number(x.nonProjectPct) } : {}),
      activeFrom: x.activeFrom ? x.activeFrom.slice(0, 10) : null, activeTo: x.activeTo ? x.activeTo.slice(0, 10) : null, location: n(x.location), remoteEligible: x.remoteEligible, languages: x.languages ?? [], restrictions: n(x.restrictions) };
    return id ? enginePut(`/resources/${id}`, body) : enginePost('/resources', body);
  }, { success: t('common.saved'), onSuccess: () => { if (!id) onClose(); } });
  const addRate = useEngineMutation(() => enginePost(`/resources/${id}/rates`, { effectiveFrom: rate.effectiveFrom, costRate: rate.costRate, billRate: rate.billRate || null, monthlyFixedCost: rate.monthlyFixedCost || null, note: rate.note || undefined }), { success: t('common.saved') });
  const saveSkills = useEngineMutation(() => enginePut(`/resources/${id}/skills`, { skills: skillRows.filter((s) => s.skillId) }), { success: t('common.saved') });
  const addAbsence = useEngineMutation(() => enginePost(`/resources/${id}/absences`, { ...absence, fraction: Number(absence.fraction), reason: absence.reason || undefined }), { success: t('common.saved') });
  const removeAbsence = useEngineMutation((aid: string) => engineDelete(`/resources/${id}/absences/${aid}`));
  const archive = useEngineMutation(() => engineDelete(`/resources/${id}`), { onSuccess: onClose });
  const set = (p: Partial<Resource>) => setD((x) => (x ? { ...x, ...p } : x));
  return (
    <Drawer open onClose={onClose} width="w-[720px]">
      <div className="flex items-center justify-between border-b border-border px-4 py-3"><h2 className="text-sm font-semibold">{id ? d?.displayName : t('engine.resources.new')}</h2><Button size="sm" variant="ghost" onClick={onClose}>✕</Button></div>
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {!d ? <QueryState query={detail}><span /></QueryState> : (
          <fieldset disabled={!can(id ? 'engine.resources.update' : 'engine.resources.create')} className="grid grid-cols-3 gap-2">
            <Field label={t('engine.col.name')} required className="col-span-2"><TextInput value={d.displayName ?? ''} onChange={(e) => set({ displayName: e.target.value })} /></Field>
            <Field label={t('engine.col.kind')}><SelectInput value={d.kind} onChange={(e) => set({ kind: e.target.value })}>{KINDS.map((k) => <option key={k} value={k}>{t(`engine.kind.${k}`)}</option>)}</SelectInput></Field>
            {INTERNAL.has(d.kind ?? '') && d.kind !== 'AUTOMATION' && <Field label={t('engine.resources.employee')}><SelectInput value={d.employeeId ?? ''} onChange={(e) => set({ employeeId: e.target.value || null })}><option value="">—</option>
              {refs.data?.employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</SelectInput></Field>}
            <Field label={t('engine.col.status')}><SelectInput value={d.status} onChange={(e) => set({ status: e.target.value })}>{['PLANNED', 'ACTIVE', 'INACTIVE'].map((s) => <option key={s} value={s}>{t(`engine.resourceStatus.${s}`)}</option>)}</SelectInput></Field>
            <Field label={t('engine.col.weeklyHours')}><TextInput type="number" min={0} value={d.weeklyHours ?? ''} onChange={(e) => set({ weeklyHours: e.target.value })} /></Field>
            <Field label={t('engine.col.nonProject')}><TextInput type="number" min={0} max={100} value={d.nonProjectPct ?? ''} placeholder={t('engine.resources.default')} onChange={(e) => set({ nonProjectPct: e.target.value })} /></Field>
            <Field label={t('engine.col.maxAllocation')}><TextInput type="number" min={0} max={150} value={d.maxAllocationPct ?? ''} placeholder={t('engine.resources.default')} onChange={(e) => set({ maxAllocationPct: e.target.value })} /></Field>
            <Field label={t('engine.resources.activeFrom')}><TextInput type="date" value={d.activeFrom?.slice(0, 10) ?? ''} onChange={(e) => set({ activeFrom: e.target.value || null })} /></Field>
            <Field label={t('engine.resources.activeTo')}><TextInput type="date" value={d.activeTo?.slice(0, 10) ?? ''} onChange={(e) => set({ activeTo: e.target.value || null })} /></Field>
            <Field label={t('engine.resources.location')}><TextInput value={d.location ?? ''} onChange={(e) => set({ location: e.target.value })} /></Field>
            <Field label={t('engine.resources.languages')}><TextInput value={(d.languages ?? []).join(', ')} onChange={(e) => set({ languages: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} /></Field>
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={!!d.remoteEligible} onChange={(e) => set({ remoteEligible: e.target.checked })} />{t('engine.resources.remote')}</label>
            <Field label={t('engine.resources.restrictions')} className="col-span-3"><TextArea value={d.restrictions ?? ''} onChange={(e) => set({ restrictions: e.target.value })} /></Field>
            <div className="col-span-3 flex gap-2"><Button type="button" disabled={!d.displayName} onClick={() => save.mutate(undefined)}>{t('common.save', { defaultValue: 'Save' })}</Button>
              {id && can('engine.resources.delete') && <Button type="button" variant="destructive" onClick={() => confirm(t('engine.resources.archiveConfirm')) && archive.mutate(undefined)}>{t('engine.common.archive')}</Button>}</div>
          </fieldset>
        )}
        {id && detail.data && <>
          <Section title={t('engine.resources.rates')}>
            {detail.data.ratesRedacted ? <p className="text-xs text-muted-foreground">{t('engine.resources.ratesRedacted')}</p> : <>
              <p className="mb-2 text-[11px] text-muted-foreground">{t('engine.resources.ratesHint')}</p>
              <Table head={[t('engine.resources.effectiveFrom'), t('engine.col.costRate'), t('engine.col.billRate'), t('engine.resources.monthlyFixed'), t('engine.col.note')]}>
                {detail.data.rates.map((r) => <tr key={r.id}><td className={td}>{fmt.date(r.effectiveFrom)}</td><td className={tdNum}>{fmt.money(r.costRate)}</td><td className={tdNum}>{fmt.money(r.billRate)}</td><td className={tdNum}>{fmt.money(r.monthlyFixedCost)}</td><td className={td}>{r.note}</td></tr>)}
              </Table>
              {can('engine.economics.update') && <div className="mt-2 flex flex-wrap gap-2">
                <TextInput className="h-7 w-36 py-0 text-xs" type="date" value={rate.effectiveFrom} onChange={(e) => setRate({ ...rate, effectiveFrom: e.target.value })} />
                <TextInput className="h-7 w-24 py-0 text-xs" placeholder={t('engine.col.costRate')} value={rate.costRate} onChange={(e) => setRate({ ...rate, costRate: e.target.value })} />
                <TextInput className="h-7 w-24 py-0 text-xs" placeholder={t('engine.col.billRate')} value={rate.billRate} onChange={(e) => setRate({ ...rate, billRate: e.target.value })} />
                {detail.data.internal && <TextInput className="h-7 w-32 py-0 text-xs" placeholder={t('engine.resources.monthlyFixed')} value={rate.monthlyFixedCost} onChange={(e) => setRate({ ...rate, monthlyFixedCost: e.target.value })} />}
                <TextInput className="h-7 w-40 py-0 text-xs" placeholder={t('engine.col.note')} value={rate.note} onChange={(e) => setRate({ ...rate, note: e.target.value })} />
                <Button size="sm" disabled={!rate.costRate} onClick={() => addRate.mutate(undefined)}><Plus size={12} /></Button></div>}
            </>}
          </Section>
          <Section title={t('engine.col.skills')}>
            {detail.data.employeeId ? <><p className="mb-1 text-[11px] text-muted-foreground">{t('engine.resources.skillsFromHr')}</p><p className="text-xs">{detail.data.skills.map((s) => `${s.name} (${s.level})`).join(', ') || '—'}</p></> : <>
              {skillRows.map((s, i) => <div key={i} className="mb-1 flex gap-2">
                <SelectInput className="h-7 py-0 text-xs" value={s.skillId} onChange={(e) => setSkillRows(skillRows.map((x, j) => (j === i ? { ...x, skillId: e.target.value } : x)))}><option value="">—</option>{skills.data?.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}</SelectInput>
                <SelectInput className="h-7 w-20 py-0 text-xs" value={s.level} onChange={(e) => setSkillRows(skillRows.map((x, j) => (j === i ? { ...x, level: Number(e.target.value) } : x)))}>{[1, 2, 3, 4, 5].map((l) => <option key={l} value={l}>{l}</option>)}</SelectInput>
                <button aria-label={t('engine.common.remove')} onClick={() => setSkillRows(skillRows.filter((_, j) => j !== i))}><Trash2 size={13} /></button></div>)}
              <div className="flex gap-2"><Button size="sm" variant="secondary" onClick={() => setSkillRows([...skillRows, { skillId: '', level: 3 }])}><Plus size={12} />{t('engine.common.add')}</Button>
                <Button size="sm" onClick={() => saveSkills.mutate(undefined)}>{t('common.save', { defaultValue: 'Save' })}</Button></div></>}
          </Section>
          <Section title={t('engine.resources.absences')}>
            <p className="mb-2 text-[11px] text-muted-foreground">{t('engine.resources.absenceHint')}</p>
            <Table head={[t('engine.col.start'), t('engine.col.end'), t('engine.resources.fraction'), t('engine.col.note'), '']}>
              {detail.data.absences.map((a) => <tr key={a.id}><td className={td}>{fmt.date(a.startDate)}</td><td className={td}>{fmt.date(a.endDate)}</td><td className={tdNum}>{Number(a.fraction)}</td><td className={td}>{a.reason}</td>
                <td className={td}><button aria-label={t('engine.common.remove')} onClick={() => removeAbsence.mutate(a.id)}><Trash2 size={13} /></button></td></tr>)}
            </Table>
            {can('engine.resources.update') && <div className="mt-2 flex gap-2">
              <TextInput className="h-7 w-36 py-0 text-xs" type="date" value={absence.startDate} onChange={(e) => setAbsence({ ...absence, startDate: e.target.value })} />
              <TextInput className="h-7 w-36 py-0 text-xs" type="date" value={absence.endDate} onChange={(e) => setAbsence({ ...absence, endDate: e.target.value })} />
              <TextInput className="h-7 w-16 py-0 text-xs" value={absence.fraction} onChange={(e) => setAbsence({ ...absence, fraction: e.target.value })} />
              <TextInput className="h-7 py-0 text-xs" placeholder={t('engine.col.note')} value={absence.reason} onChange={(e) => setAbsence({ ...absence, reason: e.target.value })} />
              <Button size="sm" onClick={() => addAbsence.mutate(undefined)}><Plus size={12} /></Button></div>}
          </Section>
        </>}
      </div>
    </Drawer>
  );
}
