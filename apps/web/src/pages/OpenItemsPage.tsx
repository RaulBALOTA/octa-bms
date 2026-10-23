import { CircleDollarSign, Users, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { useFormat } from '../lib/format';
import { FinanceNav } from '../components/FinanceNav';
import { StatusBadge } from '../components/ListPage';
import { HBarList, ORDINAL_SLOTS, SegmentBar } from '../components/charts';
import { DataTable } from '../components/DataTable';
import { Meter, PageHeader, Panel, TONE_TEXT, Tone } from '../components/infographics';
import { useOpenItems } from '../components/OpenItemsSummary';
import { SelectInput, Skeleton } from '../components/ui';

const BUCKET_TONE: Record<string, Tone> = {
  current: 'success',
  d1_30: 'warning',
  d31_60: 'warning',
  d61_90: 'destructive',
  d90plus: 'destructive',
};

export function OpenItemsPage() {
  const { t } = useTranslation();
  const fmt = useFormat();
  const [direction, setDirection] = useState<'OUTGOING' | 'INCOMING'>('OUTGOING');
  const [bucketFilter, setBucketFilter] = useState<string | null>(null);

  const { data, isLoading } = useOpenItems(direction);

  const items = data?.items ?? [];
  const visibleItems = items.filter((item) => !bucketFilter || item.bucket === bucketFilter);
  const bucketLabel = (key: string) => t(`finance.bucket.${key}`);

  const overdueItems = items.filter((i) => i.overdueDays > 0);
  const overdueTotal = overdueItems.reduce((sum, i) => sum + i.open, 0);
  // open-amount-weighted average days overdue
  const avgOverdue = overdueTotal
    ? overdueItems.reduce((sum, i) => sum + i.overdueDays * i.open, 0) / overdueTotal
    : 0;

  // largest open balances by partner (top 6, rest folded)
  const byPartner = new Map<string, number>();
  for (const item of visibleItems)
    byPartner.set(item.partner.name, (byPartner.get(item.partner.name) ?? 0) + item.open);
  const partnerRows = [...byPartner.entries()].sort((a, b) => b[1] - a[1]);
  const topPartners = partnerRows.slice(0, 6);
  const otherTotal = partnerRows.slice(6).reduce((sum, [, v]) => sum + v, 0);

  return (
    <>
      <FinanceNav />
      <PageHeader
        title={t('finance.openItems')}
        subtitle={
          <>
            Σ <strong className="text-foreground">{fmt.money(data?.totalOpen ?? 0)}</strong>
          </>
        }
        icon={CircleDollarSign}
        actions={
          <SelectInput
            value={direction}
            onChange={(e) => {
              setDirection(e.target.value as 'OUTGOING' | 'INCOMING');
              setBucketFilter(null);
            }}
            className="!w-auto"
          >
            <option value="OUTGOING">{t('finance.receivables')}</option>
            <option value="INCOMING">{t('finance.payables')}</option>
          </SelectInput>
        }
      />

      {/* aging buckets */}
      {isLoading || !data ? (
        <Skeleton className="mb-4 h-24" />
      ) : (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
          {data.buckets.map((bucket, i) => {
            const share = data.totalOpen ? (bucket.total / data.totalOpen) * 100 : 0;
            const active = bucketFilter === bucket.key;
            return (
              <button
                key={bucket.key}
                type="button"
                aria-pressed={active}
                onClick={() => setBucketFilter((current) => (current === bucket.key ? null : bucket.key))}
                className={clsx(
                  'surface surface-hover relative overflow-hidden p-3 text-left',
                  active && 'border-primary ring-1 ring-primary',
                )}
              >
                <span
                  className="absolute inset-x-0 top-0 h-1"
                  style={{ backgroundColor: ORDINAL_SLOTS[i] }}
                />
                <div className="eyebrow">{bucketLabel(bucket.key)}</div>
                <div className={clsx('mt-1 text-lg font-bold tabular-nums', TONE_TEXT[BUCKET_TONE[bucket.key] ?? 'neutral'])}>
                  {fmt.money(bucket.total)}
                </div>
                <div className="mb-2 text-[11px] text-muted-foreground">
                  {bucket.count} {t('finance.title')} · {fmt.percent(share)}
                </div>
                <Meter value={share} tone={BUCKET_TONE[bucket.key] ?? 'neutral'} />
              </button>
            );
          })}
        </div>
      )}

      {data && (
        <div className="mb-4 grid gap-4 lg:grid-cols-5">
          <Panel
            className="lg:col-span-3"
            title={t('insights.agingProfile')}
            subtitle={t('insights.agingHint')}
            actions={
              bucketFilter && (
                <button
                  type="button"
                  onClick={() => setBucketFilter(null)}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-primary hover:bg-accent"
                >
                  <X size={12} />
                  {t('insights.clearFilter')}
                </button>
              )
            }
          >
            <SegmentBar
              height={18}
              formatValue={fmt.compactMoney}
              selected={bucketFilter ? bucketLabel(bucketFilter) : null}
              onSelect={(label) => {
                const bucket = data.buckets.find((b) => bucketLabel(b.key) === label);
                if (bucket) setBucketFilter((cur) => (cur === bucket.key ? null : bucket.key));
              }}
              data={data.buckets.map((b, i) => ({
                label: bucketLabel(b.key),
                value: b.total,
                color: ORDINAL_SLOTS[i],
              }))}
            />
            <dl className="mt-5 grid grid-cols-3 gap-3 border-t border-border pt-4">
              {[
                { label: t('finance.open2'), value: fmt.money(data.totalOpen) },
                { label: t('insights.overdueAmount'), value: fmt.money(overdueTotal), tone: overdueTotal > 0 ? 'text-destructive' : '' },
                { label: t('insights.avgOverdue'), value: fmt.number(Math.round(avgOverdue)) },
              ].map((stat) => (
                <div key={stat.label}>
                  <dt className="eyebrow">{stat.label}</dt>
                  <dd className={clsx('mt-1 text-xl font-bold tabular-nums', stat.tone)}>{stat.value}</dd>
                </div>
              ))}
            </dl>
          </Panel>
          <Panel
            className="lg:col-span-2"
            title={t('insights.topDebtors')}
            subtitle={bucketFilter ? bucketLabel(bucketFilter) : undefined}
            icon={Users}
          >
            {topPartners.length ? (
              <HBarList
                data={[
                  ...topPartners.map(([name, value]) => ({
                    label: name,
                    value,
                    detail: fmt.money(value),
                  })),
                  ...(otherTotal > 0
                    ? [{ label: t('pivot.other'), value: otherTotal, detail: fmt.money(otherTotal) }]
                    : []),
                ]}
              />
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">{t('common.noResults')}</p>
            )}
          </Panel>
        </div>
      )}

      <DataTable
        rows={visibleItems}
        loading={isLoading}
        rowKey={(item) => item.id}
        exportName={`open-items-${direction.toLowerCase()}`}
        initialSort={{ key: 'overdue', dir: 'desc' }}
        pivot={{ row: 'partner', col: 'bucket', value: 'open' }}
        rowClassName={(item) => (item.overdueDays > 60 ? 'dt-row-alert' : undefined)}
        columns={[
          {
            key: 'number',
            header: t('finance.invoiceNumber'),
            value: (i) => i.invoiceNumber,
            render: (i) => <span className="font-mono text-xs">{i.invoiceNumber}</span>,
          },
          { key: 'partner', header: t('contracts.partner'), value: (i) => i.partner.name },
          { key: 'due', header: t('finance.dueDate'), value: (i) => i.dueDate, type: 'date' },
          {
            key: 'bucket',
            header: t('insights.agingProfile'),
            value: (i) => bucketLabel(i.bucket),
            hidden: true,
          },
          {
            key: 'overdue',
            header: t('finance.overdueDays'),
            value: (i) => i.overdueDays,
            type: 'number',
            align: 'right',
            render: (i) => (
              <span className={clsx(i.overdueDays > 0 && 'font-medium text-destructive')}>
                {i.overdueDays || '—'}
              </span>
            ),
          },
          { key: 'gross', header: t('finance.gross'), value: (i) => i.gross, type: 'money', align: 'right', total: 'sum' },
          {
            key: 'paid',
            header: t('finance.paid'),
            value: (i) => i.paid,
            type: 'money',
            align: 'right',
            total: 'sum',
            className: 'text-muted-foreground',
          },
          {
            key: 'open',
            header: t('finance.open2'),
            value: (i) => i.open,
            type: 'money',
            align: 'right',
            bar: true,
            total: 'sum',
            className: 'font-semibold',
          },
          {
            key: 'status',
            header: t('common.status'),
            value: (i) => i.status,
            render: (i) => <StatusBadge value={i.status} />,
          },
        ]}
      />
    </>
  );
}
