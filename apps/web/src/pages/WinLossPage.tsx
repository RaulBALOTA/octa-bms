import { useQuery } from '@tanstack/react-query';
import { PieChart, Trophy, XCircle } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { api } from '../lib/api';
import { useFormat } from '../lib/format';
import { StatusBadge } from '../components/ListPage';
import { SubNav } from '../components/SubNav';
import { CHART_SLOTS, DonutChart, HBarList, RingGauge } from '../components/charts';
import { DataTable } from '../components/DataTable';
import { KpiTile, PageHeader, Panel } from '../components/infographics';
import { Skeleton } from '../components/ui';
import { OpportunityDrawer } from './OpportunityDrawer';

interface WinLossResult {
  wonCount: number;
  lostCount: number;
  wonValue: number;
  lostValue: number;
  winRate: number;
  items: {
    id: string;
    opportunityNumber: string;
    title: string;
    partner: string;
    stage: string;
    value: number;
    lostReason: string | null;
    closedAt: string;
    owner: string | null;
  }[];
}

function groupSum<T>(rows: T[], key: (row: T) => string, value: (row: T) => number) {
  const map = new Map<string, number>();
  for (const row of rows) map.set(key(row), (map.get(key(row)) ?? 0) + value(row));
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

export function WinLossPage() {
  const { t } = useTranslation();
  const fmt = useFormat();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['win-loss'],
    queryFn: () => api.get<WinLossResult>('/sales/win-loss'),
  });

  const items = data?.items ?? [];
  const lostReasons = groupSum(
    items.filter((i) => i.stage === 'LOST'),
    (i) => i.lostReason?.trim() || '—',
    (i) => i.value,
  );
  const wonByClient = groupSum(
    items.filter((i) => i.stage === 'WON'),
    (i) => i.partner,
    (i) => i.value,
  ).slice(0, 6);
  const closed = (data?.wonCount ?? 0) + (data?.lostCount ?? 0);
  const avgWon = data && data.wonCount ? data.wonValue / data.wonCount : 0;

  return (
    <>
      <SubNav
        items={[
          { label: t('sales.pipeline'), to: '/sales/pipeline' },
          { label: t('sales.winLoss'), to: '/sales/win-loss' },
        ]}
      />
      <PageHeader title={t('sales.winLoss')} icon={Trophy} />

      {isLoading || !data ? (
        <Skeleton className="h-64" />
      ) : (
        <>
          <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiTile
              label={t('sales.won')}
              value={data.wonCount}
              icon={Trophy}
              tone="success"
              sub={fmt.money(data.wonValue)}
            />
            <KpiTile
              label={t('sales.lost')}
              value={data.lostCount}
              icon={XCircle}
              tone="destructive"
              sub={fmt.money(data.lostValue)}
            />
            <KpiTile label={t('insights.avgDeal')} value={fmt.compactMoney(avgWon)} icon={PieChart} tone="neutral" sub={t('sales.won')} />
            <div className="surface flex items-center gap-4 p-4">
              <RingGauge
                value={data.winRate}
                tone={data.winRate >= 50 ? 'success' : data.winRate >= 30 ? 'warning' : 'destructive'}
              />
              <div className="min-w-0">
                <div className="eyebrow">{t('sales.winRate')}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {data.wonCount} / {closed}
                </div>
              </div>
            </div>
          </div>

          <div className="mb-5 grid gap-4 xl:grid-cols-3">
            <Panel title={t('insights.outcome')} icon={PieChart}>
              <DonutChart
                size={150}
                data={[
                  { label: t('sales.won'), value: data.wonValue, color: CHART_SLOTS[0] },
                  { label: t('sales.lost'), value: data.lostValue, color: CHART_SLOTS[1] },
                ]}
                centerValue={fmt.compactMoney(data.wonValue + data.lostValue)}
                centerLabel={t('insights.closedDeals', { count: closed })}
                formatValue={fmt.compactMoney}
              />
            </Panel>
            <Panel title={t('insights.lostReasons')} subtitle={t('insights.lostReasonsHint')} icon={XCircle}>
              {lostReasons.length ? (
                <HBarList
                  data={lostReasons.slice(0, 6).map(([label, value]) => ({
                    label,
                    value,
                    detail: fmt.compactMoney(value),
                  }))}
                />
              ) : (
                <p className="py-6 text-center text-sm text-muted-foreground">{t('common.noResults')}</p>
              )}
            </Panel>
            <Panel title={t('insights.byClient')} icon={Trophy}>
              {wonByClient.length ? (
                <HBarList
                  data={wonByClient.map(([label, value]) => ({
                    label,
                    value,
                    detail: fmt.compactMoney(value),
                  }))}
                />
              ) : (
                <p className="py-6 text-center text-sm text-muted-foreground">{t('common.noResults')}</p>
              )}
            </Panel>
          </div>

          <DataTable
            rows={items}
            rowKey={(i) => i.id}
            onRowClick={(i) => setSelectedId(i.id)}
            exportName="win-loss"
            initialSort={{ key: 'closed', dir: 'desc' }}
            pivot={{ row: 'partner', col: 'stage', value: 'value' }}
            columns={[
              {
                key: 'number',
                header: t('crm.number'),
                value: (i) => i.opportunityNumber,
                render: (i) => <span className="font-mono text-xs">{i.opportunityNumber}</span>,
              },
              { key: 'title', header: t('contracts.contractTitle'), value: (i) => i.title, className: 'font-medium' },
              { key: 'partner', header: t('nav.clients'), value: (i) => i.partner },
              {
                key: 'value',
                header: t('contracts.value'),
                value: (i) => i.value,
                type: 'money',
                align: 'right',
                bar: true,
                total: 'sum',
                render: (i) => (
                  <span className={clsx(i.stage === 'WON' ? 'font-medium text-success' : 'text-muted-foreground')}>
                    {fmt.money(i.value)}
                  </span>
                ),
              },
              {
                key: 'reason',
                header: t('sales.lostReason'),
                value: (i) => i.lostReason,
                className: 'max-w-48 truncate text-xs text-muted-foreground',
              },
              { key: 'closed', header: t('sales.closedAt'), value: (i) => i.closedAt, type: 'date', align: 'right' },
              {
                key: 'stage',
                header: t('common.status'),
                value: (i) => i.stage,
                render: (i) => <StatusBadge value={i.stage} />,
              },
            ]}
          />
        </>
      )}

      {selectedId && (
        <OpportunityDrawer id={selectedId} onClose={() => setSelectedId(null)} />
      )}
    </>
  );
}
