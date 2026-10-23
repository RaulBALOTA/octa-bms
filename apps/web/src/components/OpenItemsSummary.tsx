import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CircleDollarSign, Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { useFormat } from '../lib/format';
import { useAuthStore } from '../stores/auth';
import { ORDINAL_SLOTS, SegmentBar } from './charts';
import { KpiTile, Panel } from './infographics';
import { Skeleton } from './ui';

export interface OpenItemsResult {
  direction: string;
  totalOpen: number;
  buckets: { key: string; total: number; count: number }[];
  items: {
    id: string;
    invoiceNumber: string;
    partner: { name: string };
    dueDate: string;
    status: string;
    gross: number;
    paid: number;
    open: number;
    overdueDays: number;
    bucket: string;
  }[];
}

export function useOpenItems(direction: string) {
  const companyId = useAuthStore((s) => s.companyId);
  return useQuery({
    queryKey: ['open-items-page', direction, companyId],
    queryFn: () => api.get<OpenItemsResult>(`/finance/open-items?direction=${direction}`),
  });
}

/** KPI strip + aging bar for receivables / payables, from the server's totals. */
export function OpenItemsSummary({ direction }: { direction: string }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const { data, isLoading } = useOpenItems(direction);

  if (isLoading) return <Skeleton className="h-28 w-full" />;
  if (!data || !Array.isArray(data.buckets) || !Array.isArray(data.items)) return null;

  const overdue = data.buckets
    .filter((b) => b.key !== 'current')
    .reduce((sum, b) => sum + b.total, 0);
  const overdueCount = data.buckets
    .filter((b) => b.key !== 'current')
    .reduce((sum, b) => sum + b.count, 0);
  const share = data.totalOpen ? (overdue / data.totalOpen) * 100 : 0;
  const severe = data.buckets.find((b) => b.key === 'd90plus');

  return (
    <div className="grid gap-3 lg:grid-cols-4">
      <KpiTile
        label={direction === 'OUTGOING' ? t('finance.receivables') : t('finance.payables')}
        value={fmt.money(data.totalOpen)}
        icon={CircleDollarSign}
        sub={t('table.rowCount', { count: data.items.length })}
        to="/finance/open-items"
      />
      <KpiTile
        label={t('insights.overdueShare')}
        value={fmt.percent(share)}
        icon={Clock}
        tone={share > 30 ? 'destructive' : share > 10 ? 'warning' : 'success'}
        sub={`${fmt.money(overdue)} · ${overdueCount}`}
        progress={share}
      />
      <Panel
        className="lg:col-span-2"
        title={t('insights.agingProfile')}
        actions={
          severe && severe.total > 0 ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-destructive">
              <AlertTriangle size={12} />
              {t('finance.bucket.d90plus')}: {fmt.compactMoney(severe.total)}
            </span>
          ) : undefined
        }
        bodyClassName="pt-2"
      >
        <SegmentBar
          formatValue={fmt.compactMoney}
          data={data.buckets.map((b, i) => ({
            label: t(`finance.bucket.${b.key}`),
            value: b.total,
            color: ORDINAL_SLOTS[i],
          }))}
        />
      </Panel>
    </div>
  );
}
