import { useQuery } from '@tanstack/react-query';
import { Crown, Trophy } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { api } from '../lib/api';
import { BarChart, HBarList } from '../components/charts';
import { SubNav } from '../components/SubNav';
import { Skeleton } from '../components/ui';

interface GroupCompany {
  id: string;
  code: string;
  name: string;
  countryCode: string | null;
  currency: string;
  isParent: boolean;
  offices: { name: string }[];
  headcount: number;
  activeClients: number;
  revenueYtdEUR: number;
  openItemsEUR: number;
  backlogEUR: number;
  pipelineWeightedEUR: number;
  revenueByMonthEUR: number[];
}

interface GroupOverview {
  year: number;
  companies: GroupCompany[];
  totals: {
    headcount: number;
    revenueYtdEUR: number;
    openItemsEUR: number;
    backlogEUR: number;
    pipelineWeightedEUR: number;
  };
}

const FLAG: Record<string, string> = {
  DE: '🇩🇪', AT: '🇦🇹', CH: '🇨🇭', AE: '🇦🇪', FR: '🇫🇷', NL: '🇳🇱',
};

export function GroupComparePage() {
  const { t, i18n } = useTranslation();

  const { data, isLoading } = useQuery({
    queryKey: ['group-overview'],
    queryFn: () => api.get<GroupOverview>('/group/overview'),
  });

  const eur = (value: number) =>
    new Intl.NumberFormat(i18n.language, {
      style: 'currency',
      currency: 'EUR',
      maximumFractionDigits: 0,
    }).format(value);
  const eurCompact = (value: number) =>
    new Intl.NumberFormat(i18n.language, {
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(value);
  const num = (value: number) =>
    new Intl.NumberFormat(i18n.language).format(value);
  const monthLabel = (index: number) =>
    new Intl.DateTimeFormat(i18n.language, { month: 'short' }).format(
      new Date(2026, index, 1),
    );

  const companies = data?.companies ?? [];

  // KPI matrix rows: label, per-company value, formatter, higher-is-better
  const metrics: {
    key: string;
    label: string;
    value: (c: GroupCompany) => number;
    format: (v: number) => string;
    higherIsBetter: boolean;
    total?: number;
  }[] = data
    ? [
        {
          key: 'revenue',
          label: `${t('group.revenue')} (EUR)`,
          value: (c) => c.revenueYtdEUR,
          format: eur,
          higherIsBetter: true,
          total: data.totals.revenueYtdEUR,
        },
        {
          key: 'backlog',
          label: `${t('group.backlog')} (EUR)`,
          value: (c) => c.backlogEUR,
          format: eur,
          higherIsBetter: true,
          total: data.totals.backlogEUR,
        },
        {
          key: 'pipeline',
          label: `${t('group.pipeline')} (EUR)`,
          value: (c) => c.pipelineWeightedEUR,
          format: eur,
          higherIsBetter: true,
          total: data.totals.pipelineWeightedEUR,
        },
        {
          key: 'openItems',
          label: `${t('group.openItems')} (EUR)`,
          value: (c) => c.openItemsEUR,
          format: eur,
          higherIsBetter: false,
          total: data.totals.openItemsEUR,
        },
        {
          key: 'headcount',
          label: t('dashboard.employees'),
          value: (c) => c.headcount,
          format: num,
          higherIsBetter: true,
          total: data.totals.headcount,
        },
        {
          key: 'clients',
          label: t('dashboard.clients'),
          value: (c) => c.activeClients,
          format: num,
          higherIsBetter: true,
        },
        {
          key: 'perHead',
          label: t('group.revenuePerHead'),
          value: (c) => (c.headcount ? c.revenueYtdEUR / c.headcount : 0),
          format: eur,
          higherIsBetter: true,
        },
      ]
    : [];

  const bestValue = (metric: (typeof metrics)[number]) => {
    const values = companies.map(metric.value);
    return metric.higherIsBetter ? Math.max(...values) : Math.min(...values);
  };

  return (
    <div className="mx-auto max-w-6xl">
      <SubNav
        items={[
          { label: t('nav.corporate'), to: '/corporate' },
          { label: t('group.title'), to: '/group' },
          { label: t('group.compare'), to: '/group/compare' },
        ]}
      />
      <h1 className="text-lg font-bold">{t('group.compare')}</h1>
      <p className="mb-5 text-sm text-muted-foreground">{t('group.compareSubtitle')}</p>

      {isLoading || !data ? (
        <Skeleton className="h-96" />
      ) : (
        <>
          {/* KPI matrix */}
          <div className="mb-6 overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">KPI</th>
                  {companies.map((company) => (
                    <th key={company.id} className="px-4 py-2.5 text-right font-medium">
                      <span className="inline-flex items-center gap-1.5 normal-case">
                        {FLAG[company.countryCode ?? ''] ?? '🏳️'} {company.code}
                        {company.isParent && <Crown size={11} className="text-warning" />}
                      </span>
                    </th>
                  ))}
                  <th className="border-l border-border px-4 py-2.5 text-right font-medium">
                    Σ {t('group.title')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {metrics.map((metric) => {
                  const best = bestValue(metric);
                  return (
                    <tr key={metric.key} className="border-b border-border last:border-0">
                      <td className="px-4 py-2.5 font-medium">{metric.label}</td>
                      {companies.map((company) => {
                        const value = metric.value(company);
                        const isBest = value === best && companies.length > 1 && value !== 0;
                        return (
                          <td
                            key={company.id}
                            className={clsx(
                              'px-4 py-2.5 text-right tabular-nums',
                              isBest && 'font-semibold text-success',
                            )}
                          >
                            {isBest && <Trophy size={11} className="mr-1 inline" />}
                            {metric.format(value)}
                          </td>
                        );
                      })}
                      <td className="border-l border-border px-4 py-2.5 text-right font-semibold tabular-nums">
                        {metric.total !== undefined ? metric.format(metric.total) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* rankings */}
          <div className="mb-6 grid gap-4 md:grid-cols-2">
            <section className="rounded-xl border border-border bg-card p-4">
              <h2 className="mb-3 text-sm font-semibold">
                {t('group.revenue')} {data.year} (EUR)
              </h2>
              <HBarList
                data={[...companies]
                  .sort((a, b) => b.revenueYtdEUR - a.revenueYtdEUR)
                  .map((company) => ({
                    label: `${FLAG[company.countryCode ?? ''] ?? ''} ${company.name}`,
                    value: company.revenueYtdEUR,
                    detail: eur(company.revenueYtdEUR),
                  }))}
              />
            </section>
            <section className="rounded-xl border border-border bg-card p-4">
              <h2 className="mb-3 text-sm font-semibold">{t('group.revenuePerHead')}</h2>
              <HBarList
                data={[...companies]
                  .sort(
                    (a, b) =>
                      (b.headcount ? b.revenueYtdEUR / b.headcount : 0) -
                      (a.headcount ? a.revenueYtdEUR / a.headcount : 0),
                  )
                  .map((company) => ({
                    label: `${FLAG[company.countryCode ?? ''] ?? ''} ${company.name}`,
                    value: company.headcount ? company.revenueYtdEUR / company.headcount : 0,
                    detail: eur(company.headcount ? company.revenueYtdEUR / company.headcount : 0),
                  }))}
              />
            </section>
          </div>

          {/* monthly revenue — small multiples, one single-series chart per company */}
          <h2 className="mb-3 text-sm font-semibold">
            {t('group.monthlyRevenue')} {data.year} (EUR)
          </h2>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {companies.map((company) => (
              <section
                key={company.id}
                className="rounded-xl border border-border bg-card p-4"
              >
                <h3 className="mb-2 text-xs font-semibold">
                  {FLAG[company.countryCode ?? ''] ?? ''} {company.name}
                </h3>
                <BarChart
                  width={380}
                  data={company.revenueByMonthEUR.map((value, index) => ({
                    label: monthLabel(index),
                    value,
                    hint: eur(value),
                  }))}
                  formatValue={eurCompact}
                />
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
