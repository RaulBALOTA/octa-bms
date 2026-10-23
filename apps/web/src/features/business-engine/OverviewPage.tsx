import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { HBarList } from '../../components/charts';
import { EngineNav, FilterBar, IllustrativeBanner, KpiTile, NoAccess, PageHeader, QueryState, Section, Table, WarningsList, td, tdNum, useCan } from './components';
import { LineChart, SERIES, StackedColumns } from './charts';
import { filterQuery, useEngineFilters, useEngineQuery, type OverviewDto } from './queries';
import { useFormat } from './format';

export function EngineOverviewPage() {
  const { t } = useTranslation();
  const can = useCan();
  const navigate = useNavigate();
  const f = useEngineFilters();
  const query = useEngineQuery<OverviewDto>(['overview', f.mode, f.clientId, f.serviceId, f.scenarioId, f.departmentId],
    can('engine.economics.read') ? `/analytics/overview?${filterQuery({ mode: f.mode, clientId: f.clientId, serviceId: f.serviceId, scenarioId: f.scenarioId, departmentId: f.departmentId })}` : null);
  const r = query.data?.result;
  const fmt = useFormat(r?.currency);
  const weighted = f.mode === 'EXPECTED' ? 'WEIGHTED' : f.mode === 'ALL_WIN' ? 'SIMULATED' : 'CONTRACTED';
  const basis = f.scenarioId ? 'SIMULATED' : weighted;
  const monthly = useMemo(() => r ? r.capacity.resources.filter((x) => x.internal) : [], [r]);
  if (!can('engine.economics.read')) return <><EngineNav /><NoAccess permission="engine.economics.read" /></>;
  const d = query.data?.definitions;
  return (
    <>
      <EngineNav />
      <PageHeader title={t('engine.overview.title')} subtitle={r ? t('engine.common.asOf', { date: fmt.date(r.asOf), calculated: fmt.dateTime(r.calculatedAt), version: r.engineVersion }) : undefined} />
      <FilterBar />
      <QueryState query={query}>
        {r && query.data && (
          <>
            <IllustrativeBanner show={r.illustrativeConfig} />
            {query.data.meta.scenario && <p className="mb-2 text-xs text-muted-foreground">{t('engine.overview.scenarioApplied', { name: query.data.meta.scenario.name })}</p>}
            <WarningsList warnings={r.warnings} />
            <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
              <KpiTile label={t('engine.kpi.backlog')} value={fmt.compact(r.totals.backlog)} basis="CONTRACTED" definition={d?.backlog} calculatedAt={r.calculatedAt} onClick={() => navigate('/engine/portfolio')} />
              <KpiTile label={t('engine.kpi.pipelineWeighted')} value={fmt.compact(r.totals.pipelineWeighted)} basis="WEIGHTED" definition={d?.pipelineWeighted} calculatedAt={r.calculatedAt}
                hint={t('engine.kpi.unweighted', { value: fmt.compact(r.totals.pipelineUnweighted) })} onClick={() => navigate('/engine/portfolio')} />
              <KpiTile label={t('engine.kpi.revenue')} value={fmt.compact(r.totals.revenue)} basis={basis} definition={d?.revenue} calculatedAt={r.calculatedAt} onClick={() => navigate('/engine/financials')} />
              <KpiTile label={t('engine.kpi.contribution')} value={fmt.compact(r.totals.contribution)} basis={basis} definition={d?.contribution} calculatedAt={r.calculatedAt}
                hint={t('engine.kpi.margin', { value: fmt.pct(r.totals.marginPct) })} tone={Number(r.totals.contribution) < 0 ? 'bad' : undefined} />
              <KpiTile label={t('engine.kpi.operatingResult')} value={fmt.compact(r.totals.operatingResult)} basis={basis} definition={d?.operatingResult} calculatedAt={r.calculatedAt}
                hint={t('engine.kpi.unabsorbed', { value: fmt.compact(r.totals.unabsorbedCapacity) })} tone={Number(r.totals.operatingResult) < 0 ? 'bad' : undefined} />
              <KpiTile label={t('engine.kpi.minCash')} value={fmt.compact(r.cash.minBalance)} basis={basis} definition={d?.minCash} calculatedAt={r.calculatedAt}
                hint={t('engine.kpi.onDate', { date: fmt.date(r.cash.minBalanceDate), peak: fmt.compact(r.cash.peakDeficit) })} tone={Number(r.cash.financingRequirement) > 0 ? 'bad' : undefined} onClick={() => navigate('/engine/financials')} />
              <KpiTile label={t('engine.kpi.utilization')} value={fmt.pct(r.totals.utilization, true)} basis={basis} definition={d?.utilization} calculatedAt={r.calculatedAt}
                hint={t('engine.kpi.shortage', { value: fmt.hours(r.totals.shortageHours) })} tone={r.totals.shortageHours > 0 ? 'bad' : undefined} onClick={() => navigate('/engine/resources')} />
            </div>
            <div className="grid gap-3 xl:grid-cols-2">
              <Section title={t('engine.overview.revenueByMonth')}>
                <StackedColumns labels={r.pnl.map((p) => fmt.month(p.key))} format={(v) => fmt.compact(v)}
                  series={[{ label: t('engine.series.contracted'), color: SERIES[0], values: r.pnl.map((p) => Number(p.revenueContracted)) },
                    { label: t('engine.series.pipelineWeighted'), color: SERIES[1], values: r.pnl.map((p) => Number(p.revenuePipeline)) }]}
                  line={{ label: t('engine.series.contribution'), color: SERIES[2], values: r.pnl.map((p) => Number(p.contribution)) }} onSelect={() => navigate('/engine/financials')} />
              </Section>
              <Section title={t('engine.overview.cashForecast')}>
                <LineChart labels={r.cash.months.map((m) => fmt.month(m.key))} format={(v) => fmt.compact(v)}
                  series={[{ label: t('engine.series.closingCash', { mode: t(`engine.mode.${r.mode}`) }), color: SERIES[0], values: r.cash.months.map((m) => Number(m.closing)) }]}
                  reference={{ value: 0, label: t('engine.overview.zeroLine') }} />
                {query.data.contracted && <p className="mt-1 text-[11px] text-muted-foreground">{t('engine.overview.contractedCash', { min: fmt.compact(query.data.contracted.cash.minBalance), date: fmt.date(query.data.contracted.cash.minBalanceDate) })}</p>}
              </Section>
              <Section title={t('engine.overview.demandCapacity')}>
                <StackedColumns labels={r.months.map((m) => fmt.month(m.key))} format={(v) => fmt.num(v)}
                  series={[{ label: t('engine.series.plannedHours'), color: SERIES[0], values: r.months.map((m) => monthly.reduce((s, res) => s + res.weeks.reduce((x, w, i) => x + (r.weeks[i].start >= m.start && r.weeks[i].start <= m.end ? w.planned : 0), 0), 0)) },
                    { label: t('engine.series.unfilledHours'), color: SERIES[1], values: r.months.map((m) => r.capacity.bottlenecks.filter((b) => b.kind === 'SKILL_SHORTAGE' && b.periodKey === m.key).reduce((s, b) => s + b.excessHours, 0)) }]}
                  line={{ label: t('engine.series.availableHours'), color: 'hsl(var(--muted-foreground))', values: r.months.map((m) => monthly.reduce((s, res) => s + res.weeks.reduce((x, w, i) => x + (r.weeks[i].start >= m.start && r.weeks[i].start <= m.end ? w.available : 0), 0), 0)) }}
                  onSelect={() => navigate('/engine/resources')} />
              </Section>
              <Section title={t('engine.overview.services')}>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <h3 className="mb-2 text-xs font-medium text-muted-foreground">{t('engine.overview.topServices')}</h3>
                    <HBarList data={query.data.topServices.filter((s) => Number(s.contribution) > 0).map((s) => ({ label: s.name, value: Number(s.contribution), detail: `${fmt.compact(s.contribution)} · ${fmt.pct(s.marginPct)}` }))} />
                  </div>
                  <div>
                    <h3 className="mb-2 text-xs font-medium text-muted-foreground">{t('engine.overview.underperforming')}</h3>
                    <Table head={[t('engine.col.service'), t('engine.col.margin')]}>
                      {query.data.underperformingServices.map((s) => <tr key={s.key}><td className={td}>{s.name}</td><td className={tdNum}>{fmt.pct(s.marginPct)}</td></tr>)}
                    </Table>
                  </div>
                </div>
              </Section>
              <Section title={t('engine.overview.bottlenecks')} actions={<button className="text-xs text-primary hover:underline" onClick={() => navigate('/engine/resources')}>{t('engine.common.details')}</button>}>
                <Table head={[t('engine.col.kind'), t('engine.col.name'), t('engine.col.month'), t('engine.col.hours')]}>
                  {r.capacity.bottlenecks.slice(0, 8).map((b, i) => <tr key={i}><td className={td}>{t(`engine.bottleneck.${b.kind}`)}</td><td className={td}>{b.name}</td><td className={td}>{fmt.month(b.periodKey)}</td><td className={tdNum}>{fmt.hours(b.excessHours)}</td></tr>)}
                </Table>
                {!r.capacity.bottlenecks.length && <p className="text-xs text-muted-foreground">{t('engine.overview.noBottlenecks')}</p>}
              </Section>
              <Section title={t('engine.overview.recommendations')} actions={<button className="text-xs text-primary hover:underline" onClick={() => navigate('/engine/intelligence')}>{t('engine.common.details')}</button>}>
                <div className="mb-2 flex gap-3 text-xs">{(['CRITICAL', 'WARNING', 'INFO'] as const).map((s) => <span key={s}>{t(`engine.severity.${s}`)}: <b>{query.data.alerts[s] ?? 0}</b></span>)}</div>
                <ul className="space-y-1 text-xs">{query.data.recommendations.map((rec) => <li key={rec.id} className="flex justify-between gap-2"><span>{rec.title}</span><span className="text-muted-foreground">{t(`engine.priority.${rec.priority}`)} · {rec.source}</span></li>)}</ul>
                {!query.data.recommendations.length && <p className="text-xs text-muted-foreground">{t('engine.overview.noRecommendations')}</p>}
              </Section>
            </div>
            {query.data.meta.excluded.length > 0 && <p className="mt-3 text-[11px] text-muted-foreground">{t('engine.overview.excluded', { count: query.data.meta.excluded.length })}: {query.data.meta.excluded.map((e) => `${e.title} (${e.reason})`).join('; ')}</p>}
          </>
        )}
      </QueryState>
    </>
  );
}
