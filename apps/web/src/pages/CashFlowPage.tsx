import { useQuery } from '@tanstack/react-query';
import { ArrowDownUp, LineChart, TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { api } from '../lib/api';
import { useFormat } from '../lib/format';
import { FinanceNav } from '../components/FinanceNav';
import { AreaChart, CHART_SLOTS, DivergingBarChart } from '../components/charts';
import { DataTable } from '../components/DataTable';
import { KpiTile, PageHeader, Panel, Pill } from '../components/infographics';
import { Skeleton } from '../components/ui';

interface CashFlowResult {
  startingBalance: number;
  totalExpectedIn: number;
  totalExpectedOut: number;
  endBalance: number;
  weeks: {
    weekStart: string;
    expectedIn: number;
    expectedOut: number;
    net: number;
    balance: number;
  }[];
}

export function CashFlowPage() {
  const { t } = useTranslation();
  const fmt = useFormat();

  const { data, isLoading } = useQuery({
    queryKey: ['cashflow'],
    queryFn: () => api.get<CashFlowResult>('/finance/cashflow?weeks=12'),
  });

  const weekLabel = (iso: string) =>
    new Intl.DateTimeFormat(fmt.lang, { day: '2-digit', month: '2-digit' }).format(new Date(iso));

  const lowest = data?.weeks.reduce<CashFlowResult['weeks'][number] | null>(
    (low, w) => (!low || w.balance < low.balance ? w : low),
    null,
  );
  const change = data ? data.endBalance - data.startingBalance : 0;

  return (
    <>
      <FinanceNav />
      <PageHeader
        title={t('finance.cashflow')}
        subtitle={t('finance.next12Weeks')}
        icon={LineChart}
      />

      {isLoading || !data ? (
        <Skeleton className="h-64" />
      ) : (
        <>
          <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiTile label={t('finance.currentBalance')} value={fmt.money(data.startingBalance)} icon={Wallet} tone="neutral" />
            <KpiTile
              label={t('finance.expectedIn')}
              value={fmt.money(data.totalExpectedIn)}
              icon={TrendingUp}
              tone="success"
              spark={data.weeks.map((w) => w.expectedIn)}
            />
            <KpiTile
              label={t('finance.expectedOut')}
              value={fmt.money(data.totalExpectedOut)}
              icon={TrendingDown}
              tone="destructive"
              spark={data.weeks.map((w) => w.expectedOut)}
            />
            <KpiTile
              label={t('finance.projectedBalance')}
              value={fmt.money(data.endBalance)}
              icon={Wallet}
              tone={data.endBalance >= data.startingBalance ? 'success' : 'warning'}
              delta={data.startingBalance ? (change / Math.abs(data.startingBalance)) * 100 : null}
              spark={data.weeks.map((w) => w.balance)}
            />
          </div>

          <div className="mb-5 grid gap-4 xl:grid-cols-2">
            <Panel
              title={t('insights.balanceTrend')}
              icon={LineChart}
              actions={
                lowest && (
                  <Pill tone={lowest.balance < 0 ? 'destructive' : 'neutral'}>
                    {t('insights.lowestBalance')}: {fmt.compactMoney(lowest.balance)} · KW{' '}
                    {weekLabel(lowest.weekStart)}
                  </Pill>
                )
              }
            >
              <AreaChart
                height={230}
                name={t('finance.balance')}
                color={CHART_SLOTS[0]}
                data={data.weeks.map((w) => ({
                  label: weekLabel(w.weekStart),
                  value: w.balance,
                  hint: fmt.money(w.balance),
                }))}
                formatValue={fmt.compact}
              />
            </Panel>
            <Panel title={t('insights.flows')} icon={ArrowDownUp}>
              <DivergingBarChart
                height={210}
                upLabel={t('finance.expectedIn')}
                downLabel={t('finance.expectedOut')}
                data={data.weeks.map((w) => ({
                  label: weekLabel(w.weekStart),
                  up: w.expectedIn,
                  down: w.expectedOut,
                }))}
                formatValue={fmt.compact}
              />
            </Panel>
          </div>

          <DataTable
            rows={data.weeks}
            rowKey={(w) => w.weekStart}
            search={false}
            pageSize={0}
            exportName="cashflow"
            columns={[
              {
                key: 'week',
                header: t('finance.week'),
                value: (w) => w.weekStart,
                type: 'date',
                render: (w) => (
                  <span className="flex items-center gap-2">
                    KW {weekLabel(w.weekStart)}
                    {w === data.weeks[0] && <Pill tone="primary">{t('finance.thisWeek')}</Pill>}
                  </span>
                ),
              },
              {
                key: 'in',
                header: t('finance.expectedIn'),
                value: (w) => w.expectedIn,
                type: 'money',
                align: 'right',
                total: 'sum',
                render: (w) => (
                  <span className="text-success">{w.expectedIn ? `+${fmt.money(w.expectedIn)}` : '—'}</span>
                ),
              },
              {
                key: 'out',
                header: t('finance.expectedOut'),
                value: (w) => w.expectedOut,
                type: 'money',
                align: 'right',
                total: 'sum',
                render: (w) => (
                  <span className="text-destructive">{w.expectedOut ? `−${fmt.money(w.expectedOut)}` : '—'}</span>
                ),
              },
              {
                key: 'net',
                header: t('finance.net2'),
                value: (w) => w.net,
                type: 'money',
                align: 'right',
                total: 'sum',
                render: (w) => (
                  <span
                    className={clsx(
                      'font-medium',
                      w.net > 0 && 'text-success',
                      w.net < 0 && 'text-destructive',
                    )}
                  >
                    {w.net ? fmt.money(w.net) : '—'}
                  </span>
                ),
              },
              {
                key: 'balance',
                header: t('finance.balance'),
                value: (w) => w.balance,
                type: 'money',
                align: 'right',
                bar: true,
                render: (w) => (
                  <span className={clsx('font-semibold', w.balance < 0 && 'text-destructive')}>
                    {fmt.money(w.balance)}
                  </span>
                ),
              },
            ]}
          />
          <p className="mt-2 text-xs text-muted-foreground">{t('finance.cashflowHint')}</p>
        </>
      )}
    </>
  );
}
