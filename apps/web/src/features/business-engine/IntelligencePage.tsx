import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertOctagon, AlertTriangle, Info, RefreshCw, Sparkles } from 'lucide-react';
import { Button, Field, SelectInput, Tabs, TextArea, TextInput } from '../../components/ui';
import { BasisBadge, EngineNav, NoAccess, PageHeader, QueryState, Section, Table, td, useCan } from './components';
import { enginePost, enginePut, useEngineFilters, useEngineMutation, useEngineQuery } from './queries';
import { useFormat } from './format';

interface Alert { id: string; ruleCode: string; severity: string; entityType: string; entityId: string; title: string; detail: string | null; status: string; detectedAt: string; lastSeenAt: string; resolution: string | null; actions: { id: string; title: string; status: string }[] }
interface Action { id: string; kind: string; title: string; description: string | null; status: string; outcome: string | null; dueDate: string | null; alert: { title: string } | null }
interface Rec { id: string; source: string; title: string; problem: string; evidence: unknown; proposedAction: string; estimatedBenefit: string | null; assumptions: string | null; confidence: string; risks: string | null; responsibleRole: string | null; priority: string; status: string; aiModel: string | null; createdAt: string }
interface Decision { id: string; title: string; context: string | null; status: string; expectedImpact: unknown; actualOutcome: string | null; updatedAt: string; recommendation: { title: string; source: string } | null; events: { id: string; fromStatus: string | null; toStatus: string; note: string | null; createdAt: string }[] }
interface Recal { id: string; metric: string; currentValue: string; proposedValue: string; sampleCount: number; status: string; statistics: Record<string, unknown>; createdAt: string; service: { code: string; name: string } }

const SEVERITY_ICON = { CRITICAL: AlertOctagon, WARNING: AlertTriangle, INFO: Info } as const;
const SEVERITY_TONE: Record<string, string> = { CRITICAL: 'text-destructive', WARNING: 'text-warning', INFO: 'text-muted-foreground' };
const FLOW: Record<string, string[]> = { DRAFT: ['UNDER_REVIEW', 'SUPERSEDED'], UNDER_REVIEW: ['APPROVED', 'REJECTED', 'DRAFT'], APPROVED: ['IMPLEMENTED', 'SUPERSEDED'], REJECTED: ['DRAFT'], IMPLEMENTED: ['SUPERSEDED'], SUPERSEDED: [] };

export function EngineIntelligencePage() {
  const { t } = useTranslation(); const can = useCan();
  const [tab, setTab] = useState('alerts');
  if (!can('engine.intelligence.read')) return <><EngineNav /><NoAccess permission="engine.intelligence.read" /></>;
  return (
    <>
      <EngineNav />
      <PageHeader title={t('engine.intelligence.title')} subtitle={t('engine.intelligence.subtitle')} />
      <Tabs active={tab} onChange={setTab} tabs={['alerts', 'actions', 'recommendations', 'decisions', 'recalibration', 'advisor'].map((k) => ({ key: k, label: t(`engine.intelligence.tab.${k}`) }))} />
      <div className="mt-3">{tab === 'alerts' ? <Alerts /> : tab === 'actions' ? <Actions /> : tab === 'recommendations' ? <Recommendations /> : tab === 'decisions' ? <Decisions /> : tab === 'recalibration' ? <Recalibration /> : <Advisor />}</div>
    </>
  );
}

function Alerts() {
  const { t } = useTranslation(); const can = useCan(); const fmt = useFormat();
  const [status, setStatus] = useState('');
  const alerts = useEngineQuery<Alert[]>(['alerts', status], `/intelligence/alerts${status ? `?status=${status}` : ''}`);
  const scan = useEngineMutation(() => enginePost<{ created: number; escalated: number; resolved: number }>('/intelligence/alerts/scan'), { onSuccess: (r) => alert(t('engine.intelligence.scanned', r)) });
  const transition = useEngineMutation((v: { id: string; status: string }) => enginePost(`/intelligence/alerts/${v.id}/status`, { status: v.status }), { success: t('common.saved') });
  const act = useEngineMutation((a: Alert) => enginePost('/intelligence/actions', { kind: a.ruleCode === 'COLLECTION_OVERDUE' ? 'RECOVER_INVOICE' : a.ruleCode.includes('MARGIN') ? 'REPRICE' : a.ruleCode === 'HOURS_OVERRUN' ? 'REFORECAST' : 'REALLOCATE',
    title: a.title.slice(0, 200), alertId: a.id, entityType: a.entityType, entityId: a.entityId }), { success: t('engine.intelligence.actionCreated') });
  return (
    <Section title={t('engine.intelligence.tab.alerts')} actions={<div className="flex gap-2">
      <SelectInput className="h-7 w-40 py-0 text-xs" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">{t('engine.intelligence.unresolved')}</option>{['OPEN', 'ACKNOWLEDGED', 'RESOLVED'].map((s) => <option key={s} value={s}>{t(`engine.alertStatus.${s}`)}</option>)}</SelectInput>
      {can('engine.intelligence.create') && can('engine.economics.read') && <Button size="sm" variant="secondary" disabled={scan.isPending} onClick={() => scan.mutate(undefined)}><RefreshCw size={12} />{t('engine.intelligence.scan')}</Button>}</div>}>
      <p className="mb-2 text-[11px] text-muted-foreground">{t('engine.intelligence.alertsHint')}</p>
      <QueryState query={alerts} empty={!alerts.data?.length}>
        <Table head={[t('engine.col.severity'), t('engine.col.rule'), t('engine.col.alert'), t('engine.col.detected'), t('engine.col.status'), '']}>
          {alerts.data?.map((a) => { const Icon = SEVERITY_ICON[a.severity as keyof typeof SEVERITY_ICON] ?? Info; return (
            <tr key={a.id}>
              <td className={td}><span className={`inline-flex items-center gap-1 ${SEVERITY_TONE[a.severity]}`}><Icon size={13} />{t(`engine.severity.${a.severity}`)}</span></td>
              <td className={td}>{t(`engine.rule.${a.ruleCode}`, { defaultValue: a.ruleCode })}</td>
              <td className="px-2 py-1.5"><div className="font-medium">{a.title}</div><div className="text-muted-foreground">{a.detail}</div>{a.actions.length > 0 && <div className="text-[11px] text-primary">{a.actions.map((x) => `${x.title} (${t(`engine.actionStatus.${x.status}`)})`).join(', ')}</div>}</td>
              <td className={td}>{fmt.dateTime(a.detectedAt)}</td><td className={td}>{t(`engine.alertStatus.${a.status}`)}{a.resolution && <div className="text-[10px] text-muted-foreground">{a.resolution}</div>}</td>
              <td className="flex gap-1 px-2 py-1.5">{a.status !== 'RESOLVED' && can('engine.intelligence.update') && <>
                {a.status === 'OPEN' && <Button size="sm" variant="secondary" onClick={() => transition.mutate({ id: a.id, status: 'ACKNOWLEDGED' })}>{t('engine.intelligence.ack')}</Button>}
                <Button size="sm" variant="secondary" onClick={() => transition.mutate({ id: a.id, status: 'RESOLVED' })}>{t('engine.intelligence.resolve')}</Button></>}
                {can('engine.intelligence.create') && a.status !== 'RESOLVED' && <Button size="sm" variant="ghost" onClick={() => act.mutate(a)}>{t('engine.intelligence.createAction')}</Button>}</td>
            </tr>); })}
        </Table>
      </QueryState>
    </Section>
  );
}

function Actions() {
  const { t } = useTranslation(); const can = useCan(); const fmt = useFormat();
  const actions = useEngineQuery<Action[]>(['actions'], '/intelligence/actions');
  const [form, setForm] = useState({ kind: 'REFORECAST', title: '', dueDate: '' });
  const create = useEngineMutation(() => enginePost('/intelligence/actions', { ...form, dueDate: form.dueDate || null }), { success: t('common.saved'), onSuccess: () => setForm({ ...form, title: '' }) });
  const update = useEngineMutation((v: { id: string; status: string; outcome?: string }) => enginePut(`/intelligence/actions/${v.id}`, { status: v.status, outcome: v.outcome }), { success: t('common.saved') });
  const KINDS = ['REFORECAST', 'REALLOCATE', 'REPRICE', 'RENEGOTIATE', 'SUBCONTRACT', 'RECOVER_INVOICE', 'ESCALATE', 'CHANGE_PLAN'];
  return (
    <Section title={t('engine.intelligence.tab.actions')} actions={can('engine.intelligence.create') && <div className="flex gap-2">
      <SelectInput className="h-7 w-40 py-0 text-xs" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>{KINDS.map((k) => <option key={k} value={k}>{t(`engine.actionKind.${k}`)}</option>)}</SelectInput>
      <TextInput className="h-7 w-64 py-0 text-xs" placeholder={t('engine.col.name')} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
      <TextInput className="h-7 w-36 py-0 text-xs" type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
      <Button size="sm" disabled={!form.title} onClick={() => create.mutate(undefined)}>{t('engine.common.add')}</Button></div>}>
      <QueryState query={actions} empty={!actions.data?.length}>
        <Table head={[t('engine.col.kind'), t('engine.col.name'), t('engine.col.due'), t('engine.col.status'), t('engine.col.outcome'), '']}>
          {actions.data?.map((a) => <tr key={a.id}><td className={td}>{t(`engine.actionKind.${a.kind}`)}</td><td className="px-2 py-1.5">{a.title}{a.alert && <div className="text-[10px] text-muted-foreground">{a.alert.title}</div>}</td>
            <td className={td}>{fmt.date(a.dueDate)}</td><td className={td}>{t(`engine.actionStatus.${a.status}`)}</td><td className="px-2 py-1.5 text-muted-foreground">{a.outcome}</td>
            <td className="flex gap-1 px-2 py-1.5">{can('engine.intelligence.update') && !['DONE', 'CANCELLED'].includes(a.status) && <>
              {a.status === 'OPEN' && <Button size="sm" variant="secondary" onClick={() => update.mutate({ id: a.id, status: 'IN_PROGRESS' })}>{t('engine.actionStatus.IN_PROGRESS')}</Button>}
              <Button size="sm" variant="secondary" onClick={() => { const outcome = prompt(t('engine.intelligence.outcomePrompt')) ?? undefined; update.mutate({ id: a.id, status: 'DONE', outcome }); }}>{t('engine.actionStatus.DONE')}</Button></>}</td></tr>)}
        </Table>
      </QueryState>
    </Section>
  );
}

function Recommendations() {
  const { t, i18n } = useTranslation(); const can = useCan(); const f = useEngineFilters();
  const [status, setStatus] = useState('PROPOSED');
  const recs = useEngineQuery<Rec[]>(['recommendations', status], `/intelligence/recommendations${status ? `?status=${status}` : ''}`);
  const advisor = useEngineQuery<{ enabled: boolean; model: string | null }>(['advisor'], '/intelligence/advisor');
  const generate = useEngineMutation(() => enginePost<{ generated: number }>('/intelligence/recommendations/generate'), { onSuccess: (r) => alert(t('engine.intelligence.generated', r)) });
  const analyze = useEngineMutation(() => enginePost<{ summary: string; stored: number; rejectedUngrounded: number; assumptionsToValidate: string[] }>('/intelligence/advisor/analyze', { language: i18n.language.startsWith('de') ? 'de' : 'en', mode: f.mode }),
    { onSuccess: (r) => alert(`${r.summary}\n\n${t('engine.intelligence.aiStored', r)}\n${r.assumptionsToValidate.map((a) => `• ${a}`).join('\n')}`) });
  const setRecStatus = useEngineMutation((v: { id: string; status: string }) => enginePost(`/intelligence/recommendations/${v.id}/status`, { status: v.status }), { success: t('common.saved') });
  const decide = useEngineMutation((r: Rec) => enginePost('/intelligence/decisions', { title: r.title.slice(0, 200), context: `${r.problem}\n\n${r.proposedAction}`, recommendationId: r.id }), { success: t('engine.optimization.decisionCreated') });
  return (
    <Section title={t('engine.intelligence.tab.recommendations')} actions={<div className="flex gap-2">
      <SelectInput className="h-7 w-36 py-0 text-xs" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">{t('engine.filters.all')}</option>{['PROPOSED', 'ACCEPTED', 'DISMISSED'].map((s) => <option key={s} value={s}>{t(`engine.recStatus.${s}`)}</option>)}</SelectInput>
      {can('engine.intelligence.create') && can('engine.economics.read') && <Button size="sm" variant="secondary" onClick={() => generate.mutate(undefined)}><RefreshCw size={12} />{t('engine.intelligence.generateRules')}</Button>}
      {can('engine.intelligence.create') && can('engine.economics.read') && <Button size="sm" disabled={!advisor.data?.enabled || analyze.isPending} title={advisor.data?.enabled ? '' : t('engine.intelligence.aiOff')} onClick={() => analyze.mutate(undefined)}><Sparkles size={12} />{analyze.isPending ? t('engine.common.calculating') : t('engine.intelligence.aiAnalyze')}</Button>}</div>}>
      {advisor.data && !advisor.data.enabled && <p className="mb-2 text-[11px] text-muted-foreground">{t('engine.intelligence.aiOffHint')}</p>}
      <QueryState query={recs} empty={!recs.data?.length}>
        <div className="space-y-2">{recs.data?.map((r) => (
          <details key={r.id} className="rounded-md border border-border p-2">
            <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-xs"><span className="font-semibold">{r.title}</span>
              <span className="rounded bg-muted px-1 text-[10px]">{r.source === 'AI' ? `${t('engine.intelligence.aiInterpretation')} · ${r.aiModel ?? ''}` : t(`engine.recSource.${r.source}`)}</span>
              <span className="text-muted-foreground">{t(`engine.priority.${r.priority}`)} · {t('engine.col.confidence')} {t(`engine.confidence.${r.confidence}`)} · {r.responsibleRole}</span>
              <span className="ml-auto text-muted-foreground">{t(`engine.recStatus.${r.status}`)}</span></summary>
            <div className="mt-2 grid gap-2 text-xs md:grid-cols-2">
              <div><b>{t('engine.intelligence.problem')}:</b> {r.problem}<br /><b>{t('engine.intelligence.proposal')}:</b> {r.proposedAction}<br /><b>{t('engine.intelligence.benefit')}:</b> {r.estimatedBenefit ?? '—'}</div>
              <div><b>{t('engine.intelligence.assumptions')}:</b> {r.assumptions ?? '—'}<br /><b>{t('engine.intelligence.risks')}:</b> {r.risks ?? '—'}</div>
              <pre className="max-h-40 overflow-auto rounded bg-muted p-2 text-[10px] md:col-span-2">{JSON.stringify(r.evidence, null, 1)}</pre>
            </div>
            {r.status === 'PROPOSED' && <div className="mt-2 flex gap-2">{can('engine.intelligence.create') && <Button size="sm" onClick={() => decide.mutate(r)}>{t('engine.intelligence.toDecision')}</Button>}
              {can('engine.intelligence.update') && <Button size="sm" variant="secondary" onClick={() => setRecStatus.mutate({ id: r.id, status: 'DISMISSED' })}>{t('engine.intelligence.dismiss')}</Button>}</div>}
          </details>))}</div>
      </QueryState>
    </Section>
  );
}

function Decisions() {
  const { t } = useTranslation(); const can = useCan(); const fmt = useFormat();
  const decisions = useEngineQuery<Decision[]>(['decisions'], '/intelligence/decisions');
  const quality = useEngineQuery<{ total: number; withOutcome: number }>(['decision-quality'], '/intelligence/decisions/quality');
  const [title, setTitle] = useState(''); const [context, setContext] = useState('');
  const create = useEngineMutation(() => enginePost('/intelligence/decisions', { title, context: context || null }), { success: t('common.saved'), onSuccess: () => { setTitle(''); setContext(''); } });
  const move = useEngineMutation((v: { id: string; status: string }) => enginePost(`/intelligence/decisions/${v.id}/status`, { status: v.status, note: prompt(t('engine.intelligence.notePrompt')) ?? undefined }), { success: t('common.saved') });
  const outcome = useEngineMutation((id: string) => { const text = prompt(t('engine.intelligence.outcomePrompt')); return text ? enginePost(`/intelligence/decisions/${id}/outcome`, { actualOutcome: text }) : Promise.resolve(null); }, { success: t('common.saved') });
  return (
    <div className="space-y-3">
      {can('engine.intelligence.create') && <Section title={t('engine.intelligence.newDecision')}>
        <div className="grid gap-2 md:grid-cols-[1fr_2fr_auto]"><TextInput placeholder={t('engine.col.name')} value={title} onChange={(e) => setTitle(e.target.value)} />
          <TextArea rows={1} placeholder={t('engine.intelligence.context')} value={context} onChange={(e) => setContext(e.target.value)} /><Button disabled={!title} onClick={() => create.mutate(undefined)}>{t('engine.common.add')}</Button></div>
        <p className="mt-1 text-[11px] text-muted-foreground">{t('engine.intelligence.decisionHint')}</p>
      </Section>}
      <Section title={t('engine.intelligence.tab.decisions')} actions={quality.data && <span className="text-xs text-muted-foreground">{t('engine.intelligence.quality', quality.data)}</span>}>
        <QueryState query={decisions} empty={!decisions.data?.length}>
          <div className="space-y-2">{decisions.data?.map((d) => (
            <div key={d.id} className="rounded-md border border-border p-2 text-xs">
              <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{d.title}</span><span className="rounded bg-muted px-1.5 text-[10px] font-medium">{t(`engine.decisionStatus.${d.status}`)}</span>
                {d.recommendation && <span className="text-muted-foreground">← {d.recommendation.title} ({d.recommendation.source})</span>}
                <span className="ml-auto flex gap-1">{can('engine.intelligence.update') && FLOW[d.status].filter((s) => !['APPROVED', 'REJECTED'].includes(s) || can('engine.intelligence.approve')).map((s) =>
                  <Button key={s} size="sm" variant="secondary" onClick={() => move.mutate({ id: d.id, status: s })}>→ {t(`engine.decisionStatus.${s}`)}</Button>)}
                  {can('engine.intelligence.update') && ['IMPLEMENTED', 'REJECTED', 'SUPERSEDED'].includes(d.status) && <Button size="sm" variant="ghost" onClick={() => outcome.mutate(d.id)}>{t('engine.intelligence.recordOutcome')}</Button>}</span></div>
              {d.context && <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{d.context}</p>}
              {d.expectedImpact !== null && d.expectedImpact !== undefined && <details className="mt-1"><summary className="cursor-pointer text-muted-foreground">{t('engine.intelligence.expectedImpact')} <BasisBadge basis="SIMULATED" /></summary><pre className="max-h-40 overflow-auto rounded bg-muted p-2 text-[10px]">{JSON.stringify(d.expectedImpact, null, 1)}</pre></details>}
              {d.actualOutcome && <p className="mt-1"><b>{t('engine.intelligence.actualOutcome')}:</b> {d.actualOutcome} <BasisBadge basis="ACTUAL" /></p>}
              <ol className="mt-1 text-[10px] text-muted-foreground">{d.events.map((e) => <li key={e.id}>{fmt.dateTime(e.createdAt)} · {e.fromStatus ?? '∅'} → {e.toStatus}{e.note ? ` · ${e.note}` : ''}</li>)}</ol>
            </div>))}</div>
        </QueryState>
      </Section>
    </div>
  );
}

function Recalibration() {
  const { t } = useTranslation(); const can = useCan(); const fmt = useFormat();
  const rows = useEngineQuery<Recal[]>(['recalibrations'], '/intelligence/recalibrations');
  const generate = useEngineMutation(() => enginePost<{ generated: number; candidates: number }>('/intelligence/recalibrations/generate'), { onSuccess: (r) => alert(t('engine.intelligence.recalGenerated', r)) });
  const decide = useEngineMutation((v: { id: string; status: string }) => enginePost(`/intelligence/recalibrations/${v.id}/decision`, { status: v.status }), { success: t('common.saved') });
  return (
    <Section title={t('engine.intelligence.tab.recalibration')} actions={can('engine.services.update') && <Button size="sm" variant="secondary" onClick={() => generate.mutate(undefined)}><RefreshCw size={12} />{t('engine.intelligence.generateRecal')}</Button>}>
      <p className="mb-2 text-[11px] text-muted-foreground">{t('engine.intelligence.recalHint')}</p>
      <QueryState query={rows} empty={!rows.data?.length}>
        <Table head={[t('engine.col.service'), t('engine.col.metric'), t('engine.intelligence.current'), t('engine.intelligence.proposed'), t('engine.col.samples'), t('engine.col.confidence'), t('engine.col.status'), '']}>
          {rows.data?.map((r) => <tr key={r.id}><td className={td}>{r.service.code} · {r.service.name}</td><td className={td}>{r.metric}</td><td className={td}>{fmt.hours(Number(r.currentValue))}</td><td className={td}>{fmt.hours(Number(r.proposedValue))}</td>
            <td className={td}>{r.sampleCount}</td><td className={td}>{String(r.statistics.confidence ?? '')}</td><td className={td}>{t(`engine.recalStatus.${r.status}`)}</td>
            <td className="flex gap-1 px-2 py-1.5">{r.status === 'PROPOSED' && can('engine.services.approve') && <><Button size="sm" onClick={() => decide.mutate({ id: r.id, status: 'APPROVED' })}>{t('engine.intelligence.approve')}</Button>
              <Button size="sm" variant="secondary" onClick={() => decide.mutate({ id: r.id, status: 'REJECTED' })}>{t('engine.intelligence.reject')}</Button></>}</td></tr>)}
        </Table>
      </QueryState>
    </Section>
  );
}

function Advisor() {
  const { t, i18n } = useTranslation(); const f = useEngineFilters();
  const status = useEngineQuery<{ enabled: boolean; model: string | null; tools: string[] }>(['advisor'], '/intelligence/advisor');
  const [question, setQuestion] = useState(''); const [tool, setTool] = useState('');
  const [answer, setAnswer] = useState<{ answer: string; refs: string[]; unverifiedRefs: string[]; model: string } | null>(null);
  const ask = useEngineMutation(() => enginePost<typeof answer>('/intelligence/advisor/ask', { question, language: i18n.language.startsWith('de') ? 'de' : 'en', mode: f.mode }), { onSuccess: setAnswer });
  const toolData = useEngineQuery<unknown>(['advisor-tool', tool, f.mode], tool ? `/intelligence/advisor/tools/${tool}?mode=${f.mode}` : null);
  return (
    <div className="grid gap-3 xl:grid-cols-2">
      <Section title={t('engine.intelligence.ask')}>
        <p className="mb-2 text-[11px] text-muted-foreground">{status.data?.enabled ? t('engine.intelligence.askHint', { model: status.data.model }) : t('engine.intelligence.aiOffHint')}</p>
        <Field label={t('engine.intelligence.question')}><TextArea value={question} onChange={(e) => setQuestion(e.target.value)} placeholder={t('engine.intelligence.questionExample')} /></Field>
        <Button className="mt-2" disabled={!status.data?.enabled || !question.trim() || ask.isPending} onClick={() => ask.mutate(undefined)}><Sparkles size={13} />{ask.isPending ? t('engine.common.calculating') : t('engine.intelligence.askButton')}</Button>
        {answer && <div className="mt-3 rounded-md border border-border p-2 text-xs"><div className="mb-1 flex items-center gap-2"><span className="rounded bg-muted px-1 text-[10px]">{t('engine.intelligence.aiInterpretation')} · {answer.model}</span></div>
          <p className="whitespace-pre-wrap">{answer.answer}</p>
          {answer.refs.length > 0 && <p className="mt-1 text-[10px] text-muted-foreground">{t('engine.intelligence.refs')}: {answer.refs.join(', ')}</p>}
          {answer.unverifiedRefs.length > 0 && <p className="mt-1 text-[10px] text-warning">{t('engine.intelligence.unverifiedRefs')}: {answer.unverifiedRefs.join(', ')}</p>}</div>}
      </Section>
      <Section title={t('engine.intelligence.tools')}>
        <p className="mb-2 text-[11px] text-muted-foreground">{t('engine.intelligence.toolsHint')}</p>
        <SelectInput className="mb-2 h-7 py-0 text-xs" value={tool} onChange={(e) => setTool(e.target.value)}><option value="">—</option>{status.data?.tools.map((x) => <option key={x} value={x}>{t(`engine.tool.${x}`)}</option>)}</SelectInput>
        {tool && <QueryState query={toolData}><pre className="max-h-96 overflow-auto rounded bg-muted p-2 text-[10px]">{JSON.stringify(toolData.data, null, 1)}</pre></QueryState>}
      </Section>
    </div>
  );
}
