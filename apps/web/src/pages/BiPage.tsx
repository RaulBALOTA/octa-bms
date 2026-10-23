import { useQuery } from '@tanstack/react-query';
import { BarChart3, FileBarChart2, Hash, LineChart, Search, Sigma } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { api } from '../lib/api';
import { useFormat, ValueType } from '../lib/format';
import { AreaChart, BarChart } from '../components/charts';
import { DataColumn, DataTable } from '../components/DataTable';
import { EmptyState, KpiTile, PageHeader, Panel } from '../components/infographics';
import { Skeleton } from '../components/ui';

interface ReportMeta {
  code: string;
  name: string;
  nameDe: string;
}

interface ReportResult {
  code: string;
  columns: { key: string; label: string; type: 'text' | 'number' | 'money' | 'date' }[];
  rows: Record<string, unknown>[];
}

const MEASURES: ValueType[] = ['number', 'money'];
const CHART_LIMIT = 15;

export function BiPage() {
  const { t, i18n } = useTranslation();
  const fmt = useFormat();
  const [active, setActive] = useState('revenue-by-client');
  const [catalogFilter, setCatalogFilter] = useState('');
  const [measureKey, setMeasureKey] = useState('');
  const [dimensionKey, setDimensionKey] = useState('');

  const { data: catalogData } = useQuery({
    queryKey: ['bi-catalog'],
    queryFn: () => api.get<ReportMeta[]>('/bi/reports'),
  });
  const catalog = Array.isArray(catalogData) ? catalogData : [];

  const { data: reportData, isLoading } = useQuery({
    queryKey: ['bi-report', active],
    queryFn: () => api.get<ReportResult>(`/bi/reports/${active}`),
  });
  const report =
    reportData && Array.isArray(reportData.columns) && Array.isArray(reportData.rows)
      ? reportData
      : null;

  const nameOf = (meta?: ReportMeta) =>
    meta ? (i18n.language === 'de' ? meta.nameDe : meta.name) : '';
  const activeMeta = catalog.find((m) => m.code === active);

  const measures = report?.columns.filter((c) => MEASURES.includes(c.type)) ?? [];
  const dimensions = report?.columns.filter((c) => !MEASURES.includes(c.type)) ?? [];

  // reset the chart encoding whenever the report changes
  useEffect(() => {
    setMeasureKey(measures.find((m) => m.type === 'money')?.key ?? measures[0]?.key ?? '');
    setDimensionKey(dimensions.find((d) => d.type === 'text')?.key ?? dimensions[0]?.key ?? '');
  }, [report?.code]);

  const measure = measures.find((m) => m.key === measureKey);
  const dimension = dimensions.find((d) => d.key === dimensionKey);

  const chartData = useMemo(() => {
    if (!report || !measure || !dimension) return [];
    const sums = new Map<string, number>();
    for (const row of report.rows) {
      const raw = row[dimension.key];
      const label =
        dimension.type === 'date' && raw
          ? String(raw).slice(0, 7) // group dates by month
          : raw === null || raw === undefined || raw === ''
            ? '—'
            : String(raw);
      sums.set(label, (sums.get(label) ?? 0) + (Number(row[measure.key]) || 0));
    }
    const entries = [...sums.entries()];
    if (dimension.type === 'date') entries.sort((a, b) => a[0].localeCompare(b[0]));
    else entries.sort((a, b) => b[1] - a[1]);
    return entries.map(([label, value]) => ({ label, value }));
  }, [report, measure, dimension]);

  const columns: DataColumn<Record<string, unknown>>[] = (report?.columns ?? []).map((c) => ({
    key: c.key,
    header: c.label,
    type: c.type,
    value: (row) => row[c.key],
    align: c.type === 'text' || c.type === 'date' ? 'left' : 'right',
    bar: c.key === measure?.key,
    total: c.type === 'money' || c.type === 'number' ? 'sum' : undefined,
  }));

  const visibleCatalog = catalog.filter((m) =>
    nameOf(m).toLowerCase().includes(catalogFilter.trim().toLowerCase()),
  );
  const fmtMeasure = (v: number) =>
    measure?.type === 'money' ? fmt.compactMoney(v) : fmt.compact(v);

  return (
    <div>
      <PageHeader
        title={nameOf(activeMeta) || t('bi.reports')}
        subtitle={`${t('nav.bi')} · ${t('insights.reportCount', { count: catalog.length })}`}
        icon={BarChart3}
      />
      <div className="flex flex-col gap-4 lg:flex-row">
        {/* report catalog */}
        <aside className="shrink-0 lg:w-64">
          <div className="surface p-2">
            <div className="relative mb-2">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                value={catalogFilter}
                onChange={(e) => setCatalogFilter(e.target.value)}
                placeholder={t('bi.reports')}
                aria-label={t('bi.reports')}
                className="h-8 w-full rounded-md border border-border bg-background pl-7 pr-2 text-xs outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <nav className="space-y-0.5">
              {visibleCatalog.map((meta) => (
                <button
                  key={meta.code}
                  onClick={() => setActive(meta.code)}
                  aria-current={active === meta.code ? 'true' : undefined}
                  className={clsx(
                    'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors',
                    active === meta.code
                      ? 'bg-accent font-medium text-primary'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  <span
                    className={clsx(
                      'rounded-md p-1',
                      active === meta.code ? 'bg-primary text-primary-foreground' : 'bg-muted',
                    )}
                  >
                    <FileBarChart2 size={13} />
                  </span>
                  <span className="truncate">{nameOf(meta)}</span>
                </button>
              ))}
            </nav>
          </div>
        </aside>

        {/* result */}
        <div className="min-w-0 flex-1 space-y-4">
          {isLoading ? (
            <Skeleton className="h-72 w-full" />
          ) : !report ? (
            <div className="surface">
              <EmptyState title={t('common.noResults')} />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <KpiTile label={t('bi.rows')} value={fmt.number(report.rows.length)} icon={Hash} tone="neutral" />
                {measures.slice(0, 3).map((m) => {
                  const sum = report.rows.reduce((s, row) => s + (Number(row[m.key]) || 0), 0);
                  return (
                    <KpiTile
                      key={m.key}
                      label={`Σ ${m.label}`}
                      value={m.type === 'money' ? fmt.money(sum) : fmt.number(sum)}
                      icon={Sigma}
                      sub={
                        report.rows.length
                          ? `Ø ${m.type === 'money' ? fmt.money(sum / report.rows.length) : fmt.number(sum / report.rows.length)}`
                          : undefined
                      }
                    />
                  );
                })}
              </div>

              <Panel
                title={
                  measure && dimension
                    ? t('insights.autoChart', { measure: measure.label, dimension: dimension.label })
                    : t('insights.chartView')
                }
                icon={LineChart}
                actions={
                  measures.length > 0 &&
                  dimensions.length > 0 && (
                    <div className="flex gap-2">
                      <select
                        value={measureKey}
                        onChange={(e) => setMeasureKey(e.target.value)}
                        aria-label={t('pivot.values')}
                        className="h-7 rounded-md border border-border bg-card px-2 text-xs"
                      >
                        {measures.map((m) => (
                          <option key={m.key} value={m.key}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                      <select
                        value={dimensionKey}
                        onChange={(e) => setDimensionKey(e.target.value)}
                        aria-label={t('pivot.rows')}
                        className="h-7 rounded-md border border-border bg-card px-2 text-xs"
                      >
                        {dimensions.map((d) => (
                          <option key={d.key} value={d.key}>
                            {d.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  )
                }
              >
                {!chartData.length ? (
                  <EmptyState compact icon={BarChart3} title={t('insights.noChart')} />
                ) : dimension?.type === 'date' ? (
                  <AreaChart
                    height={220}
                    name={measure?.label}
                    data={chartData.map((d) => ({ ...d, hint: fmt.value(d.value, measure?.type) }))}
                    formatValue={fmtMeasure}
                  />
                ) : (
                  <>
                    <BarChart
                      height={220}
                      data={chartData.slice(0, CHART_LIMIT).map((d) => ({
                        label: d.label.length > 12 ? `${d.label.slice(0, 11)}…` : d.label,
                        value: d.value,
                        hint: `${d.label}: ${fmt.value(d.value, measure?.type)}`,
                      }))}
                      formatValue={fmtMeasure}
                    />
                    {chartData.length > CHART_LIMIT && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        {t('pivot.topN', { n: CHART_LIMIT, total: chartData.length })}
                      </p>
                    )}
                  </>
                )}
              </Panel>

              <DataTable
                rows={report.rows}
                columns={columns}
                rowKey={(_, index) => String(index)}
                exportName={report.code}
                pivot={{ value: measure?.key }}
                key={report.code}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
