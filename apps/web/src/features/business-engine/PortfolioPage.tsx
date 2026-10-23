import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, RefreshCw, Trash2 } from 'lucide-react';
import type { AssignmentEconomics, PortfolioResult } from '../../../../../packages/shared/src/business-engine';
import { Button, Drawer, Field, SelectInput, Tabs, TextArea, TextInput } from '../../components/ui';
import type { Paged } from '../../lib/api';
import { BasisBadge, EngineNav, FilterBar, IllustrativeBanner, NoAccess, PageHeader, QueryState, Section, Table, td, tdNum, useCan } from './components';
import { engineDelete, enginePost, enginePut, filterQuery, useEngineFilters, useEngineMutation, useEngineQuery } from './queries';
import { today, useFormat } from './format';

const FEE_MODELS = ['FIXED_FEE', 'TIME_AND_MATERIALS', 'DAILY_RATE', 'RETAINER', 'MILESTONE', 'CAPEX_PERCENT', 'HYBRID'];
const BILLING = ['MONTHLY', 'MILESTONE', 'UPFRONT', 'ON_COMPLETION'];
const SENIORITY = ['JUNIOR', 'PROFESSIONAL', 'SENIOR', 'LEAD', 'PRINCIPAL'];
const NEXT: Record<string, string[]> = { PLANNED: ['ACTIVE', 'ON_HOLD', 'CANCELLED'], ACTIVE: ['ON_HOLD', 'COMPLETED', 'CANCELLED'], ON_HOLD: ['ACTIVE', 'CANCELLED'], COMPLETED: [], CANCELLED: [] };

interface Refs {
  clients: { id: string; name: string }[]; contracts: { id: string; contractNumber: string; title: string; partnerId: string | null; status: string }[];
  opportunities: { id: string; opportunityNumber: string; title: string; partnerId: string; stage: string; probability: number }[]; employees: { id: string; name: string }[];
}
interface Demand { id: string; skillId: string | null; role: string; seniority: string; hours: string; startDate: string | null; endDate: string | null; resourceId: string | null; sourcing: string; billable: boolean;
  costRate: string | null; externalRate: string | null; actualHours: string; remainingHours: string | null; source: string; overrideNote: string | null; skill?: { name: string } | null; resource?: { displayName: string } | null }
interface Assignment {
  id: string; title: string; status: string; version: number; clientId: string; contractId: string | null; opportunityId: string | null; externalProjectRef: string | null; serviceId: string; packageId: string | null;
  responsibleEmployeeId: string | null; startDate: string; endDate: string; feeModel: string; billing: string; fixedFee: string | null; hourlyRate: string | null; dailyRate: string | null; hoursPerDay: string | null;
  monthlyRetainer: string | null; capexBasis: string | null; capexBasisDefinition: string | null; capexPercent: string | null; paymentTermDays: number | null; vatRatePct: string | null;
  travelCost: string; softwareCost: string; otherCost: string; subcontractFixedCost: string; probabilityOverride: number | null; probabilityNote: string | null; exclusiveGroup: string | null; shiftableWeeks: number;
  scope: string | null; deliverables: string | null; risks: string | null; assumptions: string | null; actualCost: string | null; actualRevenue: string; percentComplete: string | null;
  service?: { code: string; name: string }; client?: { name: string }; contract?: { contractNumber: string; status: string } | null; opportunity?: { opportunityNumber: string; stage: string; probability: number } | null;
  demands?: Demand[]; milestones?: { id: string; title: string; dueDate: string; amount: string; isInvoiced: boolean }[]; adjustments?: { id: string; effectiveDate: string; amount: string; kind: string; note: string | null }[];
  forecasts?: { id: string; kind: string; version: number; note: string | null; createdAt: string; snapshot: Record<string, unknown> | null }[];
}

export function EnginePortfolioPage() {
  const { t } = useTranslation();
  const can = useCan(); const f = useEngineFilters();
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [status, setStatus] = useState('');
  const economics = useEngineQuery<{ result: PortfolioResult }>(['portfolio', f.mode, f.clientId, f.serviceId, f.scenarioId, f.departmentId],
    can('engine.economics.read') ? `/analytics/portfolio?${filterQuery({ mode: f.mode, clientId: f.clientId, serviceId: f.serviceId, departmentId: f.departmentId })}` : null);
  const list = useEngineQuery<Paged<Assignment>>(['assignments', status, f.clientId, f.serviceId], `/assignments?pageSize=200&${filterQuery({ status, clientId: f.clientId, serviceId: f.serviceId })}`);
  const fmt = useFormat(economics.data?.result.currency);
  const byId = useMemo(() => new Map((economics.data?.result.assignments ?? []).map((a) => [a.id, a])), [economics.data]);
  if (!can('engine.portfolio.read')) return <><EngineNav /><NoAccess permission="engine.portfolio.read" /></>;
  const r = economics.data?.result;
  return (
    <>
      <EngineNav />
      <PageHeader title={t('engine.portfolio.title')} subtitle={t('engine.portfolio.subtitle')}
        actions={can('engine.portfolio.create') && <Button onClick={() => setEditing('new')}><Plus size={14} />{t('engine.portfolio.new')}</Button>} />
      <FilterBar showScenario={false} />
      {r && <IllustrativeBanner show={r.illustrativeConfig} />}
      <Section title={t('engine.portfolio.assignments')} actions={<SelectInput className="h-7 w-40 py-0 text-xs" value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="">{t('engine.filters.all')}</option>{Object.keys(NEXT).map((s) => <option key={s} value={s}>{t(`engine.status.${s}`)}</option>)}</SelectInput>}>
        <QueryState query={list} empty={!list.data?.data.length}>
          <Table head={[t('engine.col.assignment'), t('engine.col.client'), t('engine.col.service'), t('engine.col.status'), t('engine.col.commitment'), t('engine.col.period'),
            ...(r ? [t('engine.col.revenue'), t('engine.col.contribution'), t('engine.col.margin'), t('engine.col.hoursAtCompletion'), t('engine.col.shortage'), t('engine.col.peakCash')] : [])]}>
            {list.data?.data.map((a) => { const e = byId.get(a.id); return (
              <tr key={a.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setEditing(a.id)}>
                <td className={td}>{a.title}</td><td className={td}>{a.client?.name}</td><td className={td}>{a.service?.code}</td><td className={td}>{t(`engine.status.${a.status}`)}</td>
                <td className={td}>{e ? <span className="inline-flex items-center gap-1"><BasisBadge basis={e.commitment === 'PIPELINE' ? 'WEIGHTED' : e.commitment === 'COMPLETED' ? 'ACTUAL' : 'CONTRACTED'} />{e.commitment === 'PIPELINE' && fmt.pct(e.probability, true)}</span> : '—'}</td>
                <td className={td}>{fmt.date(a.startDate)} – {fmt.date(a.endDate)}</td>
                {r && <><td className={tdNum}>{e ? fmt.moneyShort(e.revenue) : <BasisBadge basis="MISSING" />}</td><td className={`${tdNum} ${e && Number(e.contribution) < 0 ? 'text-destructive' : ''}`}>{e ? fmt.moneyShort(e.contribution) : '—'}</td>
                  <td className={tdNum}>{e ? fmt.pct(e.marginPct) : '—'}</td><td className={tdNum}>{e ? fmt.hours(e.hoursAtCompletion) : '—'}</td>
                  <td className={`${tdNum} ${e && e.shortageHours > 0 ? 'text-destructive' : ''}`}>{e ? fmt.hours(e.shortageHours) : '—'}</td><td className={tdNum}>{e ? fmt.moneyShort(e.cash.peakFinancingNeed) : '—'}</td></>}
              </tr>); })}
          </Table>
        </QueryState>
      </Section>
      {editing && <AssignmentEditor id={editing === 'new' ? null : editing} economics={editing === 'new' ? undefined : byId.get(editing)} onClose={() => setEditing(null)} onCreated={(id) => setEditing(id)} />}
    </>
  );
}

const blank = (): Partial<Assignment> & { generateDemand?: string } => ({ title: '', clientId: '', contractId: null, opportunityId: null, serviceId: '', packageId: null, startDate: today(), endDate: today(),
  feeModel: 'FIXED_FEE', billing: 'MONTHLY', travelCost: '0', softwareCost: '0', otherCost: '0', subcontractFixedCost: '0', shiftableWeeks: 0, generateDemand: 'SERVICE' });

function AssignmentEditor({ id, economics, onClose, onCreated }: { id: string | null; economics?: AssignmentEconomics; onClose: () => void; onCreated: (id: string) => void }) {
  const { t } = useTranslation();
  const can = useCan(); const fmt = useFormat();
  const [tab, setTab] = useState('details');
  const detail = useEngineQuery<Assignment>(['assignment', id], id ? `/assignments/${id}` : null);
  const refs = useEngineQuery<Refs>(['references'], '/assignments/references');
  const services = useEngineQuery<{ id: string; code: string; name: string; revenueModel: string }[]>(['services'], '/services');
  const packages = useEngineQuery<{ id: string; code: string; name: string; items: { serviceId: string }[] }[]>(['packages'], '/packages');
  const [draft, setDraft] = useState<(Partial<Assignment> & { generateDemand?: string }) | null>(id ? null : blank());
  useEffect(() => { if (detail.data) setDraft({ ...detail.data, startDate: detail.data.startDate.slice(0, 10), endDate: detail.data.endDate.slice(0, 10) }); }, [detail.data]);
  const set = (patch: Partial<Assignment> & { generateDemand?: string }) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const body = () => {
    const d = draft as Assignment & { generateDemand?: string }; const n = (v: unknown) => (v === '' || v === null || v === undefined ? null : v);
    return { clientId: d.clientId, contractId: n(d.contractId), opportunityId: n(d.opportunityId), externalProjectRef: n(d.externalProjectRef), serviceId: d.serviceId, packageId: n(d.packageId), title: d.title,
      scope: n(d.scope), deliverables: n(d.deliverables), responsibleEmployeeId: n(d.responsibleEmployeeId), startDate: d.startDate.slice(0, 10), endDate: d.endDate.slice(0, 10), feeModel: d.feeModel,
      fixedFee: n(d.fixedFee), hourlyRate: n(d.hourlyRate), dailyRate: n(d.dailyRate), hoursPerDay: d.hoursPerDay ? Number(d.hoursPerDay) : null, monthlyRetainer: n(d.monthlyRetainer), capexBasis: n(d.capexBasis),
      capexBasisDefinition: n(d.capexBasisDefinition), capexPercent: n(d.capexPercent), billing: d.billing, paymentTermDays: d.paymentTermDays === null || d.paymentTermDays === undefined || (d.paymentTermDays as unknown) === '' ? null : Number(d.paymentTermDays),
      vatRatePct: d.vatRatePct ? Number(d.vatRatePct) : null, travelCost: d.travelCost || '0', softwareCost: d.softwareCost || '0', otherCost: d.otherCost || '0', subcontractFixedCost: d.subcontractFixedCost || '0',
      probabilityOverride: d.probabilityOverride === null || d.probabilityOverride === undefined || (d.probabilityOverride as unknown) === '' ? null : Number(d.probabilityOverride), probabilityNote: n(d.probabilityNote),
      exclusiveGroup: n(d.exclusiveGroup), shiftableWeeks: Number(d.shiftableWeeks ?? 0), risks: n(d.risks), assumptions: n(d.assumptions),
      ...(id ? { expectedVersion: d.version } : { generateDemand: d.generateDemand }) };
  };
  const save = useEngineMutation(() => (id ? enginePut<Assignment>(`/assignments/${id}`, body()) : enginePost<Assignment>('/assignments', body())), { success: t('common.saved'), onSuccess: (a) => { if (!id) onCreated(a.id); } });
  const transition = useEngineMutation((status: string) => enginePost(`/assignments/${id}/status`, { status }), { success: t('common.saved') });
  const archive = useEngineMutation(() => engineDelete(`/assignments/${id}`), { onSuccess: onClose });
  const d = draft;
  const readOnly = !can(id ? 'engine.portfolio.update' : 'engine.portfolio.create') || (!!d?.status && ['COMPLETED', 'CANCELLED'].includes(d.status));
  const feeField = (key: keyof Assignment, label: string) => <Field label={label}><TextInput inputMode="decimal" value={(d?.[key] as string) ?? ''} onChange={(e) => set({ [key]: e.target.value } as Partial<Assignment>)} /></Field>;
  return (
    <Drawer open onClose={onClose} width="w-[900px]">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div><h2 className="text-sm font-semibold">{id ? d?.title : t('engine.portfolio.new')}</h2>{d?.status && <span className="text-xs text-muted-foreground">{t(`engine.status.${d.status}`)} · v{d.version}</span>}</div>
        <div className="flex gap-1">{id && can('engine.portfolio.update') && d?.status && NEXT[d.status].map((s) => <Button key={s} size="sm" variant="secondary" onClick={() => transition.mutate(s)}>→ {t(`engine.status.${s}`)}</Button>)}
          <Button size="sm" variant="ghost" onClick={onClose}>✕</Button></div>
      </div>
      {id && <Tabs active={tab} onChange={setTab} tabs={['details', 'demand', 'milestones', 'actuals', 'versions', ...(can('engine.economics.read') ? ['economics'] : [])].map((k) => ({ key: k, label: t(`engine.portfolio.tab.${k}`) }))} />}
      <div className="flex-1 overflow-y-auto p-4">
        {!d ? <QueryState query={detail}><span /></QueryState> : tab === 'details' ? (
          <fieldset disabled={readOnly || save.isPending} className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <Field label={t('engine.col.assignment')} required className="col-span-2"><TextInput value={d.title ?? ''} onChange={(e) => set({ title: e.target.value })} /></Field>
              <Field label={t('engine.portfolio.pmoRef')}><TextInput value={d.externalProjectRef ?? ''} onChange={(e) => set({ externalProjectRef: e.target.value })} /></Field>
              <Field label={t('engine.col.client')} required><SelectInput value={d.clientId ?? ''} onChange={(e) => set({ clientId: e.target.value, contractId: null, opportunityId: null })}><option value="">—</option>
                {refs.data?.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</SelectInput></Field>
              <Field label={t('engine.portfolio.contract')}><SelectInput value={d.contractId ?? ''} onChange={(e) => set({ contractId: e.target.value || null })}><option value="">—</option>
                {refs.data?.contracts.filter((c) => !d.clientId || c.partnerId === d.clientId).map((c) => <option key={c.id} value={c.id}>{c.contractNumber} · {c.title} ({c.status})</option>)}</SelectInput></Field>
              <Field label={t('engine.portfolio.opportunity')}><SelectInput value={d.opportunityId ?? ''} onChange={(e) => set({ opportunityId: e.target.value || null })}><option value="">—</option>
                {refs.data?.opportunities.filter((o) => !d.clientId || o.partnerId === d.clientId).map((o) => <option key={o.id} value={o.id}>{o.opportunityNumber} · {o.title} ({o.stage}, {o.probability} %)</option>)}</SelectInput></Field>
              <Field label={t('engine.col.service')} required><SelectInput value={d.serviceId ?? ''} onChange={(e) => set({ serviceId: e.target.value, feeModel: services.data?.find((s) => s.id === e.target.value)?.revenueModel ?? d.feeModel })}><option value="">—</option>
                {services.data?.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</SelectInput></Field>
              <Field label={t('engine.portfolio.package')}><SelectInput value={d.packageId ?? ''} onChange={(e) => set({ packageId: e.target.value || null })}><option value="">—</option>
                {packages.data?.filter((p) => p.items.some((i) => i.serviceId === d.serviceId)).map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</SelectInput></Field>
              <Field label={t('engine.portfolio.responsible')}><SelectInput value={d.responsibleEmployeeId ?? ''} onChange={(e) => set({ responsibleEmployeeId: e.target.value || null })}><option value="">—</option>
                {refs.data?.employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</SelectInput></Field>
              <Field label={t('engine.col.start')} required><TextInput type="date" value={d.startDate ?? ''} onChange={(e) => set({ startDate: e.target.value })} /></Field>
              <Field label={t('engine.col.end')} required><TextInput type="date" value={d.endDate ?? ''} onChange={(e) => set({ endDate: e.target.value })} /></Field>
              {!id && <Field label={t('engine.portfolio.generateDemand')}><SelectInput value={d.generateDemand} onChange={(e) => set({ generateDemand: e.target.value })}>
                {['SERVICE', 'PACKAGE', 'NONE'].map((g) => <option key={g} value={g}>{t(`engine.portfolio.gen.${g}`)}</option>)}</SelectInput></Field>}
            </div>
            <h3 className="text-xs font-semibold">{t('engine.portfolio.fees')}</h3>
            <div className="grid grid-cols-4 gap-2">
              <Field label={t('engine.col.revenueModel')}><SelectInput value={d.feeModel} onChange={(e) => set({ feeModel: e.target.value })}>{FEE_MODELS.map((m) => <option key={m} value={m}>{t(`engine.fee.${m}`)}</option>)}</SelectInput></Field>
              <Field label={t('engine.portfolio.billing')}><SelectInput value={d.billing} onChange={(e) => set({ billing: e.target.value })}>{BILLING.map((m) => <option key={m} value={m}>{t(`engine.billing.${m}`)}</option>)}</SelectInput></Field>
              {['FIXED_FEE', 'HYBRID'].includes(d.feeModel ?? '') && feeField('fixedFee', t('engine.portfolio.fixedFee'))}
              {['TIME_AND_MATERIALS', 'HYBRID'].includes(d.feeModel ?? '') && feeField('hourlyRate', t('engine.portfolio.hourlyRate'))}
              {d.feeModel === 'DAILY_RATE' && <>{feeField('dailyRate', t('engine.portfolio.dailyRate'))}{feeField('hoursPerDay', t('engine.portfolio.hoursPerDay'))}</>}
              {d.feeModel === 'RETAINER' && feeField('monthlyRetainer', t('engine.portfolio.monthlyRetainer'))}
              {d.feeModel === 'CAPEX_PERCENT' && <>{feeField('capexBasis', t('engine.portfolio.capexBasis'))}{feeField('capexPercent', t('engine.portfolio.capexPercent'))}</>}
              <Field label={t('engine.portfolio.paymentTerms')}><TextInput type="number" min={0} value={d.paymentTermDays ?? ''} onChange={(e) => set({ paymentTermDays: e.target.value as unknown as number })} /></Field>
              <Field label={t('engine.portfolio.vat')}><TextInput inputMode="decimal" value={d.vatRatePct ?? ''} onChange={(e) => set({ vatRatePct: e.target.value })} /></Field>
            </div>
            {d.feeModel === 'CAPEX_PERCENT' && <Field label={t('engine.portfolio.capexDefinition')} required><TextArea value={d.capexBasisDefinition ?? ''} onChange={(e) => set({ capexBasisDefinition: e.target.value })} /></Field>}
            {d.feeModel === 'CAPEX_PERCENT' && <p className="text-[11px] text-muted-foreground">{t('engine.portfolio.capexHint')}</p>}
            <h3 className="text-xs font-semibold">{t('engine.portfolio.expenses')}</h3>
            <div className="grid grid-cols-4 gap-2">{feeField('travelCost', t('engine.portfolio.travel'))}{feeField('softwareCost', t('engine.portfolio.software'))}{feeField('otherCost', t('engine.portfolio.other'))}{feeField('subcontractFixedCost', t('engine.portfolio.subcontract'))}</div>
            <h3 className="text-xs font-semibold">{t('engine.portfolio.pipeline')}</h3>
            <div className="grid grid-cols-4 gap-2">
              <Field label={t('engine.portfolio.probabilityOverride')}><TextInput type="number" min={0} max={100} value={d.probabilityOverride ?? ''} onChange={(e) => set({ probabilityOverride: e.target.value as unknown as number })} /></Field>
              <Field label={t('engine.portfolio.probabilityNote')}><TextInput value={d.probabilityNote ?? ''} onChange={(e) => set({ probabilityNote: e.target.value })} /></Field>
              <Field label={t('engine.portfolio.exclusiveGroup')}><TextInput value={d.exclusiveGroup ?? ''} onChange={(e) => set({ exclusiveGroup: e.target.value })} /></Field>
              <Field label={t('engine.portfolio.shiftable')}><TextInput type="number" min={0} max={52} value={d.shiftableWeeks ?? 0} onChange={(e) => set({ shiftableWeeks: Number(e.target.value) })} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label={t('engine.portfolio.scope')}><TextArea value={d.scope ?? ''} onChange={(e) => set({ scope: e.target.value })} /></Field>
              <Field label={t('engine.portfolio.deliverables')}><TextArea value={d.deliverables ?? ''} onChange={(e) => set({ deliverables: e.target.value })} /></Field>
              <Field label={t('engine.portfolio.risks')}><TextArea value={d.risks ?? ''} onChange={(e) => set({ risks: e.target.value })} /></Field>
              <Field label={t('engine.portfolio.assumptions')}><TextArea value={d.assumptions ?? ''} onChange={(e) => set({ assumptions: e.target.value })} /></Field>
            </div>
            <div className="flex gap-2"><Button type="button" onClick={() => save.mutate(undefined)} disabled={!d.title || !d.clientId || !d.serviceId}>{t('common.save', { defaultValue: 'Save' })}</Button>
              {id && can('engine.portfolio.delete') && <Button type="button" variant="destructive" onClick={() => confirm(t('engine.portfolio.archiveConfirm')) && archive.mutate(undefined)}>{t('engine.common.archive')}</Button>}</div>
          </fieldset>
        ) : tab === 'demand' && detail.data ? <DemandTab a={detail.data} readOnly={readOnly} />
          : tab === 'milestones' && detail.data ? <MilestonesTab a={detail.data} readOnly={readOnly} />
          : tab === 'actuals' && detail.data ? <ActualsTab a={detail.data} readOnly={readOnly} />
          : tab === 'versions' && detail.data ? <VersionsTab a={detail.data} />
          : tab === 'economics' && id ? <EconomicsTab id={id} fallback={economics} fmt={fmt} /> : null}
      </div>
    </Drawer>
  );
}

function DemandTab({ a, readOnly }: { a: Assignment; readOnly: boolean }) {
  const { t } = useTranslation();
  const can = useCan(); const costs = can('engine.economics.read');
  const skills = useEngineQuery<{ id: string; name: string }[]>(['skills'], '/skills');
  const resources = useEngineQuery<{ id: string; displayName: string; kind: string }[]>(['resources'], can('engine.resources.read') ? '/resources' : null);
  const [lines, setLines] = useState<Demand[]>(a.demands ?? []);
  useEffect(() => setLines(a.demands ?? []), [a.demands]);
  const payload = (l: Demand) => ({ skillId: l.skillId || null, role: l.role, seniority: l.seniority, hours: Number(l.hours), startDate: l.startDate ? l.startDate.slice(0, 10) : null, endDate: l.endDate ? l.endDate.slice(0, 10) : null,
    resourceId: l.resourceId || null, sourcing: l.sourcing, billable: l.billable, ...(costs ? { costRate: l.costRate || null, externalRate: l.externalRate || null } : {}), overrideNote: l.overrideNote || null });
  const save = useEngineMutation((l: Demand) => (l.id.startsWith('new-') ? enginePost(`/assignments/${a.id}/demands`, payload(l)) : enginePut(`/assignments/${a.id}/demands/${l.id}`, payload(l))), { success: t('common.saved') });
  const remove = useEngineMutation((l: Demand) => engineDelete(`/assignments/${a.id}/demands/${l.id}`), { success: t('common.saved') });
  const regenerate = useEngineMutation(() => enginePost(`/assignments/${a.id}/demands/regenerate`), { success: t('common.saved') });
  const upd = (i: number, patch: Partial<Demand>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <fieldset disabled={readOnly} className="space-y-2">
      <p className="text-[11px] text-muted-foreground">{t('engine.portfolio.demandHint')}</p>
      <Table head={[t('engine.col.role'), t('engine.col.skill'), t('engine.col.seniority'), t('engine.col.hours'), t('engine.col.resource'), t('engine.col.sourcing'), t('engine.col.start'), t('engine.col.end'),
        ...(costs ? [t('engine.col.costRate'), t('engine.col.externalRate')] : []), t('engine.col.source'), '']}>
        {lines.map((l, i) => (
          <tr key={l.id}>
            <td className="p-1"><TextInput className="h-7 w-36 py-0 text-xs" value={l.role} onChange={(e) => upd(i, { role: e.target.value })} /></td>
            <td className="p-1"><SelectInput className="h-7 w-32 py-0 text-xs" value={l.skillId ?? ''} onChange={(e) => upd(i, { skillId: e.target.value || null })}><option value="">—</option>{skills.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</SelectInput></td>
            <td className="p-1"><SelectInput className="h-7 w-28 py-0 text-xs" value={l.seniority} onChange={(e) => upd(i, { seniority: e.target.value })}>{SENIORITY.map((s) => <option key={s} value={s}>{t(`engine.seniority.${s}`)}</option>)}</SelectInput></td>
            <td className="p-1"><TextInput className="h-7 w-20 py-0 text-xs" type="number" min={0} value={l.hours} onChange={(e) => upd(i, { hours: e.target.value })} /></td>
            <td className="p-1"><SelectInput className="h-7 w-36 py-0 text-xs" value={l.resourceId ?? ''} onChange={(e) => upd(i, { resourceId: e.target.value || null })}><option value="">{t('engine.portfolio.unfilled')}</option>{resources.data?.map((r) => <option key={r.id} value={r.id}>{r.displayName}</option>)}</SelectInput></td>
            <td className="p-1"><SelectInput className="h-7 w-24 py-0 text-xs" value={l.sourcing} onChange={(e) => upd(i, { sourcing: e.target.value })}><option value="INTERNAL">{t('engine.sourcing.INTERNAL')}</option><option value="EXTERNAL">{t('engine.sourcing.EXTERNAL')}</option></SelectInput></td>
            <td className="p-1"><TextInput className="h-7 w-32 py-0 text-xs" type="date" value={l.startDate?.slice(0, 10) ?? ''} onChange={(e) => upd(i, { startDate: e.target.value || null })} /></td>
            <td className="p-1"><TextInput className="h-7 w-32 py-0 text-xs" type="date" value={l.endDate?.slice(0, 10) ?? ''} onChange={(e) => upd(i, { endDate: e.target.value || null })} /></td>
            {costs && <><td className="p-1"><TextInput className="h-7 w-20 py-0 text-xs" value={l.costRate ?? ''} onChange={(e) => upd(i, { costRate: e.target.value || null })} /></td>
              <td className="p-1"><TextInput className="h-7 w-20 py-0 text-xs" value={l.externalRate ?? ''} onChange={(e) => upd(i, { externalRate: e.target.value || null })} /></td></>}
            <td className="px-1 text-[10px] text-muted-foreground" title={l.overrideNote ?? ''}>{l.source}</td>
            <td className="flex gap-1 p-1"><Button size="sm" variant="secondary" type="button" onClick={() => save.mutate(l)}>{t('common.save', { defaultValue: 'Save' })}</Button>
              {!l.id.startsWith('new-') && <button type="button" aria-label={t('engine.common.remove')} onClick={() => remove.mutate(l)}><Trash2 size={13} /></button>}</td>
          </tr>))}
      </Table>
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" type="button" onClick={() => setLines([...lines, { id: `new-${Date.now()}`, skillId: null, role: '', seniority: 'PROFESSIONAL', hours: '0', startDate: null, endDate: null, resourceId: null, sourcing: 'INTERNAL', billable: true, costRate: null, externalRate: null, actualHours: '0', remainingHours: null, source: 'MANUAL', overrideNote: null }])}><Plus size={12} />{t('engine.common.add')}</Button>
        <Button size="sm" variant="secondary" type="button" onClick={() => confirm(t('engine.portfolio.regenerateConfirm')) && regenerate.mutate(undefined)}><RefreshCw size={12} />{t('engine.portfolio.regenerate')}</Button>
      </div>
    </fieldset>
  );
}

function MilestonesTab({ a, readOnly }: { a: Assignment; readOnly: boolean }) {
  const { t } = useTranslation(); const fmt = useFormat();
  const [m, setM] = useState({ title: '', dueDate: today(), amount: '' });
  const [adj, setAdj] = useState({ effectiveDate: today(), amount: '', kind: 'SCOPE_CHANGE', note: '' });
  const add = useEngineMutation(() => enginePost(`/assignments/${a.id}/milestones`, m), { success: t('common.saved'), onSuccess: () => setM({ title: '', dueDate: today(), amount: '' }) });
  const remove = useEngineMutation((mid: string) => engineDelete(`/assignments/${a.id}/milestones/${mid}`));
  const addAdj = useEngineMutation(() => enginePost(`/assignments/${a.id}/adjustments`, { ...adj, note: adj.note || undefined }), { success: t('common.saved') });
  return (
    <fieldset disabled={readOnly} className="space-y-4">
      <Section title={t('engine.portfolio.milestones')}>
        <Table head={[t('engine.col.name'), t('engine.col.date'), t('engine.col.amount'), t('engine.portfolio.invoiced'), '']}>
          {a.milestones?.map((x) => <tr key={x.id}><td className={td}>{x.title}</td><td className={td}>{fmt.date(x.dueDate)}</td><td className={tdNum}>{fmt.money(x.amount)}</td><td className={td}>{x.isInvoiced ? '✓' : ''}</td>
            <td className={td}>{!x.isInvoiced && <button aria-label={t('engine.common.remove')} onClick={() => remove.mutate(x.id)}><Trash2 size={13} /></button>}</td></tr>)}
        </Table>
        <div className="mt-2 flex gap-2"><TextInput className="h-7 py-0 text-xs" placeholder={t('engine.col.name')} value={m.title} onChange={(e) => setM({ ...m, title: e.target.value })} />
          <TextInput className="h-7 w-36 py-0 text-xs" type="date" value={m.dueDate} onChange={(e) => setM({ ...m, dueDate: e.target.value })} />
          <TextInput className="h-7 w-32 py-0 text-xs" placeholder={t('engine.col.amount')} value={m.amount} onChange={(e) => setM({ ...m, amount: e.target.value })} />
          <Button size="sm" disabled={!m.title || !m.amount} onClick={() => add.mutate(undefined)}><Plus size={12} /></Button></div>
      </Section>
      <Section title={t('engine.portfolio.adjustments')}>
        <p className="mb-2 text-[11px] text-muted-foreground">{t('engine.portfolio.adjustmentHint')}</p>
        <Table head={[t('engine.col.date'), t('engine.col.kind'), t('engine.col.amount'), t('engine.col.note')]}>
          {a.adjustments?.map((x) => <tr key={x.id}><td className={td}>{fmt.date(x.effectiveDate)}</td><td className={td}>{t(`engine.adjustment.${x.kind}`)}</td><td className={tdNum}>{fmt.money(x.amount)}</td><td className={td}>{x.note}</td></tr>)}
        </Table>
        <div className="mt-2 flex gap-2"><TextInput className="h-7 w-36 py-0 text-xs" type="date" value={adj.effectiveDate} onChange={(e) => setAdj({ ...adj, effectiveDate: e.target.value })} />
          <SelectInput className="h-7 w-36 py-0 text-xs" value={adj.kind} onChange={(e) => setAdj({ ...adj, kind: e.target.value })}>{['SCOPE_CHANGE', 'AMENDMENT', 'VARIATION'].map((k) => <option key={k} value={k}>{t(`engine.adjustment.${k}`)}</option>)}</SelectInput>
          <TextInput className="h-7 w-32 py-0 text-xs" placeholder={t('engine.col.amount')} value={adj.amount} onChange={(e) => setAdj({ ...adj, amount: e.target.value })} />
          <TextInput className="h-7 py-0 text-xs" placeholder={t('engine.col.note')} value={adj.note} onChange={(e) => setAdj({ ...adj, note: e.target.value })} />
          <Button size="sm" disabled={!adj.amount} onClick={() => addAdj.mutate(undefined)}><Plus size={12} /></Button></div>
      </Section>
    </fieldset>
  );
}

function ActualsTab({ a, readOnly }: { a: Assignment; readOnly: boolean }) {
  const { t } = useTranslation(); const can = useCan();
  const [lines, setLines] = useState((a.demands ?? []).map((d) => ({ id: d.id, role: d.role, hours: d.hours, actualHours: d.actualHours, remainingHours: d.remainingHours ?? '' })));
  const [form, setForm] = useState({ actualsAsOf: today(), actualCost: a.actualCost ?? '', actualRevenue: a.actualRevenue ?? '0', percentComplete: a.percentComplete ?? '' });
  const save = useEngineMutation(() => enginePost(`/assignments/${a.id}/actuals`, { actualsAsOf: form.actualsAsOf, ...(can('engine.economics.read') && form.actualCost !== '' ? { actualCost: form.actualCost } : {}),
    actualRevenue: form.actualRevenue || '0', percentComplete: form.percentComplete === '' ? null : Number(form.percentComplete),
    demand: lines.map((l) => ({ id: l.id, actualHours: Number(l.actualHours || 0), remainingHours: l.remainingHours === '' ? null : Number(l.remainingHours) })) }), { success: t('common.saved') });
  return (
    <fieldset disabled={readOnly} className="space-y-3">
      <p className="text-[11px] text-muted-foreground">{t('engine.portfolio.actualsHint')}</p>
      <div className="grid grid-cols-4 gap-2">
        <Field label={t('engine.portfolio.actualsAsOf')}><TextInput type="date" value={form.actualsAsOf} onChange={(e) => setForm({ ...form, actualsAsOf: e.target.value })} /></Field>
        {can('engine.economics.read') && <Field label={t('engine.portfolio.actualCost')}><TextInput value={form.actualCost} onChange={(e) => setForm({ ...form, actualCost: e.target.value })} /></Field>}
        <Field label={t('engine.portfolio.actualRevenue')}><TextInput value={form.actualRevenue} onChange={(e) => setForm({ ...form, actualRevenue: e.target.value })} /></Field>
        <Field label={t('engine.portfolio.percentComplete')}><TextInput type="number" min={0} max={100} value={form.percentComplete} onChange={(e) => setForm({ ...form, percentComplete: e.target.value })} /></Field>
      </div>
      <Table head={[t('engine.col.role'), t('engine.col.plannedHours'), t('engine.col.actualHours'), t('engine.col.remainingHours')]}>
        {lines.map((l, i) => <tr key={l.id}><td className={td}>{l.role}</td><td className={tdNum}>{l.hours}</td>
          <td className="p-1"><TextInput className="h-7 w-24 py-0 text-xs" type="number" min={0} value={l.actualHours} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, actualHours: e.target.value } : x)))} /></td>
          <td className="p-1"><TextInput className="h-7 w-24 py-0 text-xs" type="number" min={0} placeholder={t('engine.portfolio.derived')} value={l.remainingHours} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, remainingHours: e.target.value } : x)))} /></td></tr>)}
      </Table>
      <Button onClick={() => save.mutate(undefined)}>{t('common.save', { defaultValue: 'Save' })}</Button>
    </fieldset>
  );
}

function VersionsTab({ a }: { a: Assignment }) {
  const { t } = useTranslation(); const can = useCan(); const fmt = useFormat();
  const [kind, setKind] = useState('FORECAST'); const [note, setNote] = useState('');
  const add = useEngineMutation(() => enginePost(`/assignments/${a.id}/forecast-versions`, { kind, note: note || undefined }), { success: t('common.saved') });
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-muted-foreground">{t('engine.portfolio.versionsHint')}</p>
      {can('engine.portfolio.update') && <div className="flex gap-2"><SelectInput className="h-7 w-48 py-0 text-xs" value={kind} onChange={(e) => setKind(e.target.value)}>
        {['ESTIMATE', 'CONTRACT_BASELINE', 'APPROVED_BUDGET', 'FORECAST', 'ACTUAL'].map((k) => <option key={k} value={k}>{t(`engine.forecastKind.${k}`)}</option>)}</SelectInput>
        <TextInput className="h-7 py-0 text-xs" placeholder={t('engine.col.note')} value={note} onChange={(e) => setNote(e.target.value)} /><Button size="sm" onClick={() => add.mutate(undefined)}>{t('engine.portfolio.snapshot')}</Button></div>}
      <Table head={['v', t('engine.col.kind'), t('engine.col.date'), t('engine.col.revenue'), t('engine.col.directCost'), t('engine.col.margin'), t('engine.col.hours'), t('engine.col.note')]}>
        {a.forecasts?.map((f) => { const s = (f.snapshot ?? {}) as Record<string, string | number | null>; return (
          <tr key={f.id}><td className={td}>v{f.version}</td><td className={td}>{t(`engine.forecastKind.${f.kind}`)}</td><td className={td}>{fmt.dateTime(f.createdAt)}</td>
            <td className={tdNum}>{f.snapshot ? fmt.moneyShort(s.revenue) : '🔒'}</td><td className={tdNum}>{f.snapshot ? fmt.moneyShort(s.directCost) : '🔒'}</td><td className={tdNum}>{f.snapshot ? fmt.pct(s.marginPct as number | null) : ''}</td>
            <td className={tdNum}>{f.snapshot ? fmt.hours(s.hours as number) : ''}</td><td className={td}>{f.note}</td></tr>); })}
      </Table>
    </div>
  );
}

function EconomicsTab({ id, fallback, fmt }: { id: string; fallback?: AssignmentEconomics; fmt: ReturnType<typeof useFormat> }) {
  const { t } = useTranslation();
  const q = useEngineQuery<{ economics: AssignmentEconomics; calculatedAt: string; illustrativeConfig: boolean }>(['assignment-economics', id], `/assignments/${id}/economics`);
  const e = q.data?.economics ?? fallback;
  const rows: [string, string][] = e ? [
    [t('engine.eco.plannedRevenue'), fmt.money(e.plannedRevenue)], [t('engine.eco.revenue'), fmt.money(e.revenue)], [t('engine.eco.actualCost'), fmt.money(e.actualCost)],
    [t('engine.eco.internalCost'), fmt.money(e.internalCost)], [t('engine.eco.externalCost'), fmt.money(e.externalCost)], [t('engine.eco.shortageCost'), fmt.money(e.shortageCost)],
    [t('engine.eco.expenses'), fmt.money(e.expenses)], [t('engine.eco.costToComplete'), fmt.money(e.costToComplete)], [t('engine.eco.costAtCompletion'), fmt.money(e.costAtCompletion)],
    [t('engine.eco.contribution'), `${fmt.money(e.contribution)} (${fmt.pct(e.marginPct)})`], [t('engine.eco.allocatedOverhead'), fmt.money(e.allocatedOverhead)], [t('engine.eco.operatingResult'), fmt.money(e.operatingResult)],
    [t('engine.eco.hours'), `${fmt.hours(e.plannedHours)} → ${fmt.hours(e.hoursAtCompletion)} (${fmt.hours(e.actualHours)} ${t('engine.eco.actual')})`],
    [t('engine.eco.hoursSplit'), `${fmt.hours(e.internalHours)} / ${fmt.hours(e.externalHours)} / ${fmt.hours(e.shortageHours)}`],
    [t('engine.eco.baselineMargin'), `${fmt.pct(e.baselineMarginPct)} (${e.marginVariancePts === null ? '—' : `${e.marginVariancePts > 0 ? '+' : ''}${e.marginVariancePts} pts`})`],
    [t('engine.eco.contributionPerHour'), fmt.money(e.contributionPerInternalHour)], [t('engine.eco.peakFinancing'), fmt.money(e.cash.peakFinancingNeed)],
    [t('engine.eco.timeToPositive'), fmt.date(e.cash.timeToPositive)], [t('engine.eco.collectionExposure'), fmt.money(e.cash.outstandingReceivable)], [t('engine.eco.invoiced'), fmt.money(e.invoicedNet)],
  ] : [];
  return (
    <QueryState query={q}>
      {e && <>
        <IllustrativeBanner show={!!q.data?.illustrativeConfig} />
        <p className="mb-2 text-[11px] text-muted-foreground">{t('engine.eco.hint')}</p>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">{rows.map(([k, v]) => <div key={k} className="flex justify-between border-b border-border/50 py-1"><dt className="text-muted-foreground">{k}</dt><dd className="tabular-nums">{v}</dd></div>)}</dl>
        {e.warnings.length > 0 && <p className="mt-2 text-[11px] text-warning">{e.warnings.join(' · ')}</p>}
      </>}
    </QueryState>
  );
}
